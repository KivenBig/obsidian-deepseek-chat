// 侧栏对话视图。

import { Component, ItemView, Keymap, Menu, Notice, Platform, setIcon, setTooltip, TFile, WorkspaceLeaf } from "obsidian";
import { ApiError, createMessage, transcribe } from "../api/client";
import { Recorder } from "../api/speech";
import { ACCEPT_ATTR, ALL_EXT, buildAttachment, isImageName, textDocumentBlock, type PendingAttachment } from "../attachments";
import { addUsage } from "../core/accumulator";
import { SourceCollector, sourcesToMarkdown } from "../core/citations";
import { buildRequestMessages, groupTurns, hasFileBlocks, textOf, toolResultMap, turnIndexes, usedWebTools, type Turn } from "../core/history";
import { computeCost, formatCost, parsePricing } from "../core/pricing";
import { buildReminder } from "../core/reminder";
import type { ApiMessage, ApiResult, Block, MessagesRequest, Session, StoredMessage, ToolDefinition, Usage } from "../core/types";
import { t } from "../i18n";
import type DeepSeekChatPlugin from "../../main";
import { modelList, reminderLanguage } from "../settings";
import { newSession } from "../store";
import { activeMarkdownFile, runVaultTool, VAULT_SYSTEM, VAULT_TOOLS } from "../tools";
import { CodeModal, ConfirmModal, SessionPicker, TextPromptModal, VaultFilePicker } from "./modals";
import { renderAssistantBlocks, resolveNote } from "./render";

export const VIEW_TYPE = "deepseek-chat-view";
const MAX_TOOL_ROUNDS = 8;
const ASR_MAX_SECONDS = 118;

export class ChatView extends ItemView {
	session!: Session;
	private busy = false;
	private abort: AbortController | null = null;
	private pending: PendingAttachment[] = [];
	private includeNote = false;
	private recorder = new Recorder();
	private recTimer: number | null = null;
	private raw = new WeakMap<StoredMessage, { request: unknown; response: unknown }>();

	private renderComp: Component | null = null;
	private liveComp: Component | null = null;
	private liveTurnEl: HTMLElement | null = null;
	private renderQueued = false;
	private rendering = false;

	// 界面元素
	private titleEl!: HTMLElement;
	private costEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private chipsEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private toolbarEl!: HTMLElement;
	private sendBtn!: HTMLButtonElement;
	private micBtn: HTMLButtonElement | null = null;
	private fileInput!: HTMLInputElement;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: DeepSeekChatPlugin,
	) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}
	getDisplayText() {
		return "DeepSeek Chat";
	}
	getIcon() {
		return "message-circle";
	}

	private get s() {
		return this.plugin.settings;
	}

	async onOpen() {
		this.session = this.freshSession();
		const last = this.plugin.data.lastSessionId;
		if (last) {
			const loaded = await this.plugin.store.load(this.plugin.store.pathFor(last));
			if (loaded) this.session = loaded;
		}
		this.includeNote = this.s.activeNoteEnabled && this.s.activeNoteDefault;
		this.build();
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.renderChips()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.renderChips()));
	}

	async onClose() {
		this.abort?.abort();
		this.recorder.cancel();
		this.renderComp?.unload();
		this.liveComp?.unload();
	}

	private freshSession(): Session {
		return newSession(modelList(this.s)[0], {
			webSearch: this.s.webSearchEnabled && this.s.webSearchDefault,
			vaultTools: this.s.vaultToolsEnabled && this.s.vaultToolsDefault,
			thinking: this.s.thinkingDefault,
			effort: this.s.thinkingEffort,
		}, t().untitled);
	}

	// ———————————————————————— 布局 ————————————————————————

	/** 设置变化后整体重建 */
	refresh() {
		this.build();
	}

	private build() {
		const L = t();
		const root = this.contentEl;
		root.empty();
		root.addClass("dsc-root");

		// 头部
		const header = root.createDiv({ cls: "dsc-header" });
		this.titleEl = header.createDiv({ cls: "dsc-title" });
		this.titleEl.onclick = () => this.renameSession();
		this.costEl = header.createDiv({ cls: "dsc-total-cost" });
		const actions = header.createDiv({ cls: "dsc-header-actions" });
		this.iconButton(actions, "plus", L.newChat, () => void this.newChat());
		this.iconButton(actions, "history", L.history, () => void this.openHistory());
		this.iconButton(actions, "more-horizontal", "", (e) => this.openMenu(e));

		this.messagesEl = root.createDiv({ cls: "dsc-messages" });
		this.bindInternalLinks(this.messagesEl);

		// 输入区
		const composer = root.createDiv({ cls: "dsc-composer" });
		this.chipsEl = composer.createDiv({ cls: "dsc-chips" });
		this.inputEl = composer.createEl("textarea", { cls: "dsc-input" });
		this.inputEl.placeholder = this.s.sendKey === "enter" ? L.placeholder : L.placeholderMod;
		this.inputEl.rows = 3;
		this.inputEl.addEventListener("keydown", (e) => this.onKey(e));
		this.inputEl.addEventListener("input", () => this.autoGrow());
		this.inputEl.addEventListener("paste", (e) => this.onPaste(e));
		this.toolbarEl = composer.createDiv({ cls: "dsc-toolbar" });

		this.fileInput = root.createEl("input", { type: "file", cls: "dsc-hidden" });
		this.fileInput.multiple = true;
		this.fileInput.accept = ACCEPT_ATTR;
		this.fileInput.onchange = () => {
			const files = Array.from(this.fileInput.files ?? []);
			this.fileInput.value = "";
			files.forEach((f) => void this.addFile(f.name, () => f.arrayBuffer()));
		};

		root.ondragover = (e) => {
			if (!this.s.fileInputEnabled) return;
			e.preventDefault();
			root.addClass("dsc-dragging");
		};
		root.ondragleave = (e) => {
			if (e.target === root) root.removeClass("dsc-dragging");
		};
		root.ondrop = (e) => {
			root.removeClass("dsc-dragging");
			if (!this.s.fileInputEnabled) return;
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (!files.length) return;
			e.preventDefault();
			files.forEach((f) => void this.addFile(f.name, () => f.arrayBuffer()));
		};

		this.renderToolbar();
		this.renderChips();
		this.renderHeader();
		void this.renderAll();
	}

	/** 回答里的 [[双链]]、笔记路径：点击在 Obsidian 里打开，Cmd/Ctrl 点击开新标签，悬停预览 */
	private bindInternalLinks(el: HTMLElement) {
		const hrefOf = (a: HTMLElement) => a.dataset.href ?? a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
		el.addEventListener("click", (e) => {
			const a = (e.target as HTMLElement).closest<HTMLElement>("a.internal-link");
			if (!a) return;
			e.preventDefault();
			e.stopPropagation();
			void this.app.workspace.openLinkText(hrefOf(a), "", Keymap.isModEvent(e));
		});
		el.addEventListener("auxclick", (e) => {
			const a = (e.target as HTMLElement).closest<HTMLElement>("a.internal-link");
			if (!a || e.button !== 1) return;
			e.preventDefault();
			void this.app.workspace.openLinkText(hrefOf(a), "", "tab");
		});
		el.addEventListener("mouseover", (e) => {
			const a = (e.target as HTMLElement).closest<HTMLElement>("a.internal-link");
			if (!a) return;
			this.app.workspace.trigger("hover-link", { event: e, source: VIEW_TYPE, hoverParent: this, targetEl: a, linktext: hrefOf(a), sourcePath: "" });
		});
	}

	private iconButton(parent: HTMLElement, icon: string, tip: string, onClick: (e: MouseEvent) => void, cls = "dsc-icon-btn"): HTMLButtonElement {
		const b = parent.createEl("button", { cls: `clickable-icon ${cls}` });
		setIcon(b, icon);
		if (tip) setTooltip(b, tip);
		b.onclick = (e) => onClick(e);
		return b;
	}

	private renderHeader() {
		const L = t();
		this.titleEl.setText(this.session.title || L.untitled);
		setTooltip(this.titleEl, L.rename);
		if (this.s.usageEnabled) {
			const total = this.session.messages.reduce((sum, m) => sum + (m.meta?.cost ?? 0), 0);
			this.costEl.setText(total ? `${L.total} ${formatCost(total, parsePricing(this.s.pricingJson).currency)}` : "");
		} else this.costEl.setText("");
	}

	private renderToolbar() {
		const L = t();
		const bar = this.toolbarEl;
		bar.empty();
		const left = bar.createDiv({ cls: "dsc-toolbar-left" });
		const right = bar.createDiv({ cls: "dsc-toolbar-right" });
		const o = this.session.options;

		// 模型
		const models = modelList(this.s);
		if (!models.includes(this.session.model)) models.unshift(this.session.model);
		const sel = left.createEl("select", { cls: "dropdown dsc-select" });
		for (const m of models) sel.createEl("option", { text: m.replace(/^deepseek-/, ""), value: m });
		sel.value = this.session.model;
		setTooltip(sel, L.sessionModelHint);
		sel.onchange = () => {
			this.session.model = sel.value;
			this.warnVisionModel();
			void this.save();
		};

		// 思考
		this.pill(left, "brain", L.thinking, o.thinking, (on) => {
			o.thinking = on;
			this.renderToolbar();
			void this.save();
		});
		if (o.thinking) {
			const eff = left.createEl("select", { cls: "dropdown dsc-select dsc-select-small" });
			for (const v of ["low", "high", "max"]) eff.createEl("option", { text: v, value: v });
			eff.value = o.effort;
			setTooltip(eff, L.effort);
			eff.onchange = () => {
				o.effort = eff.value;
				void this.save();
			};
		}

		// 联网
		if (this.s.webSearchEnabled) {
			this.pill(left, "globe", L.web, o.webSearch, (on) => {
				o.webSearch = on;
				void this.save();
			});
		}

		// 笔记库工具
		if (this.s.vaultToolsEnabled) {
			const b = this.pill(left, "library", L.vault, !!o.vaultTools, (on) => {
				o.vaultTools = on;
				void this.save();
			});
			setTooltip(b, L.vaultTip);
		}

		// 附件
		if (this.s.fileInputEnabled) {
			this.iconButton(left, "paperclip", L.attach, (e) => {
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(L.attachVault).setIcon("vault").onClick(() => this.pickVaultFile()));
				menu.addItem((i) => i.setTitle(L.attachDevice).setIcon("upload").onClick(() => this.fileInput.click()));
				menu.showAtMouseEvent(e);
			});
		}

		// 语音输入
		this.micBtn = null;
		if (this.s.asrEnabled && Recorder.supported()) {
			this.micBtn = this.iconButton(right, "mic", L.mic, () => void this.toggleRecording());
		}

		this.sendBtn = right.createEl("button", { cls: "mod-cta dsc-send" });
		this.updateSendButton();
	}

	private pill(parent: HTMLElement, icon: string, label: string, on: boolean, onToggle: (on: boolean) => void): HTMLButtonElement {
		const b = parent.createEl("button", { cls: `dsc-pill${on ? " is-active" : ""}` });
		setIcon(b.createSpan({ cls: "dsc-pill-icon" }), icon);
		b.createSpan({ text: label });
		b.onclick = () => {
			const next = !b.hasClass("is-active");
			b.toggleClass("is-active", next);
			onToggle(next);
		};
		return b;
	}

	private updateSendButton() {
		const L = t();
		const b = this.sendBtn;
		if (!b) return;
		b.empty();
		if (this.busy) {
			setIcon(b, "square");
			setTooltip(b, L.stop);
			b.onclick = () => this.abort?.abort();
		} else {
			setIcon(b, "send");
			setTooltip(b, L.send);
			b.onclick = () => void this.send();
		}
		b.toggleClass("is-busy", this.busy);
	}

	private renderChips() {
		if (!this.chipsEl) return;
		const L = t();
		this.chipsEl.empty();
		if (this.s.activeNoteEnabled) {
			const f = activeMarkdownFile(this.app);
			const on = this.includeNote && !!f;
			// 已附带：实心高亮 + ✓ + × 移除；未附带：虚线框 + 「＋ 附带」
			const chip = this.chipsEl.createDiv({ cls: `dsc-chip dsc-chip-toggle${on ? " is-active" : ""}${f ? "" : " is-disabled"}` });
			setIcon(chip.createSpan({ cls: "dsc-chip-icon" }), on ? "check" : "plus");
			if (!on && f) chip.createSpan({ text: L.attachNoteShort, cls: "dsc-chip-prefix" });
			chip.createSpan({ text: f ? f.basename : L.noActiveNote });
			setTooltip(chip, on ? L.detachNote : L.activeNote);
			chip.onclick = () => {
				if (!f) return;
				this.includeNote = !this.includeNote;
				this.renderChips();
			};
			if (on) {
				const x = chip.createSpan({ cls: "dsc-chip-x" });
				setIcon(x, "x");
				setTooltip(x, L.detachNote);
				x.onclick = (e) => {
					e.stopPropagation();
					this.includeNote = false;
					this.renderChips();
				};
			}
		}
		for (const p of this.pending) {
			const chip = this.chipsEl.createDiv({ cls: `dsc-chip dsc-chip-${p.status}` });
			setIcon(chip.createSpan({ cls: "dsc-chip-icon" }), p.meta.kind === "image" ? "image" : "paperclip");
			chip.createSpan({ text: p.meta.name });
			if (p.status === "uploading") chip.createSpan({ cls: "dsc-spinner" });
			if (p.status === "error") {
				chip.createSpan({ text: "✗", cls: "dsc-err" });
				setTooltip(chip, p.error ?? L.uploadFailed);
			}
			const x = chip.createSpan({ cls: "dsc-chip-x" });
			setIcon(x, "x");
			x.onclick = (e) => {
				e.stopPropagation();
				this.pending = this.pending.filter((q) => q !== p);
				this.renderChips();
			};
		}
	}

	private autoGrow() {
		const el = this.inputEl;
		el.setCssProps({ "--dsc-input-height": "auto" });
		el.setCssProps({ "--dsc-input-height": `${Math.min(el.scrollHeight, 240)}px` });
	}

	private onKey(e: KeyboardEvent) {
		if (e.key !== "Enter" || e.isComposing) return;
		const mod = e.metaKey || e.ctrlKey;
		if (this.s.sendKey === "enter" ? !e.shiftKey && !mod : mod) {
			e.preventDefault();
			void this.send();
		}
	}

	private onPaste(e: ClipboardEvent) {
		if (!this.s.fileInputEnabled) return;
		const files = Array.from(e.clipboardData?.files ?? []);
		if (!files.length) return;
		e.preventDefault();
		files.forEach((f, i) => {
			const name = f.name && f.name !== "image.png" ? f.name : `pasted-${Date.now()}-${i}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`;
			void this.addFile(name, () => f.arrayBuffer());
		});
	}

	// ———————————————————————— 附件 ————————————————————————

	private pickVaultFile() {
		new VaultFilePicker(this.app, ALL_EXT, (f) => void this.addFile(f.name, () => this.app.vault.readBinary(f))).open();
	}

	private warnVisionModel() {
		const hasImage = this.pending.some((p) => p.meta.kind === "image");
		if (hasImage && this.session.model.includes("pro")) new Notice(t().visionProWarn, 6000);
	}

	async addFile(name: string, read: () => Promise<ArrayBuffer>) {
		const p: PendingAttachment = { key: `${Date.now()}-${Math.random()}`, meta: { name, kind: "file" }, status: "uploading" };
		this.pending.push(p);
		this.renderChips();
		try {
			const data = await read();
			const res = await buildAttachment(this.conn(), name, data, {
				vision: this.s.visionEnabled,
				parseMode: this.s.fileParseMode,
			});
			p.block = res.block;
			p.meta = res.meta;
			p.status = "ready";
			if (isImageName(name)) this.warnVisionModel();
		} catch (e) {
			p.status = "error";
			const msg = (e as Error).message;
			p.error = msg === "NO_KEY" ? t().noKey : msg;
			new Notice(`${t().uploadFailed}: ${name}\n${p.error}`, 8000);
		}
		this.renderChips();
	}

	// ———————————————————————— 语音输入 ————————————————————————

	private async toggleRecording() {
		const L = t();
		const btn = this.micBtn;
		if (!btn) return;
		if (!this.recorder.recording) {
			try {
				await this.recorder.start(ASR_MAX_SECONDS, () => void this.toggleRecording());
			} catch (e) {
				new Notice(`${L.micDenied}: ${(e as Error).message}`);
				return;
			}
			btn.addClass("is-recording");
			setTooltip(btn, L.micStop);
			const tick = () => {
				const sec = Math.floor((Date.now() - this.recorder.startedAt) / 1000);
				btn.setAttr("data-time", `${sec}s`);
			};
			tick();
			this.recTimer = window.setInterval(tick, 500);
			return;
		}
		if (this.recTimer) window.clearInterval(this.recTimer);
		btn.removeClass("is-recording");
		btn.removeAttribute("data-time");
		btn.addClass("is-busy");
		setTooltip(btn, L.transcribing);
		try {
			const wav = await this.recorder.stop();
			const text = await transcribe(this.conn(), wav);
			if (text) {
				const cur = this.inputEl.value;
				this.inputEl.value = cur ? `${cur}${cur.endsWith(" ") ? "" : " "}${text}` : text;
				this.autoGrow();
				if (this.s.asrAutoSend) void this.send();
				else this.inputEl.focus();
			}
		} catch (e) {
			const msg = (e as Error).message;
			new Notice(`${L.asrError}: ${msg === "NO_KEY" ? L.noKey : msg}`, 8000);
		} finally {
			btn.removeClass("is-busy");
			setTooltip(btn, L.mic);
		}
	}

	// ———————————————————————— 渲染 ————————————————————————

	private async renderAll() {
		this.renderComp?.unload();
		this.liveComp?.unload();
		this.liveComp = null;
		this.renderComp = new Component();
		this.renderComp.load();
		const el = this.messagesEl;
		el.empty();
		this.renderHeader();
		const turns = groupTurns(this.session.messages);
		if (!turns.length) {
			this.renderEmpty(el);
			return;
		}
		const results = toolResultMap(this.session.messages);
		for (let i = 0; i < turns.length; i++) {
			const isLast = i === turns.length - 1;
			const turnEl = el.createDiv({ cls: "dsc-turn" });
			await this.renderTurn(turnEl, turns[i], isLast, results, this.renderComp, false);
			if (isLast) this.liveTurnEl = turnEl;
		}
		el.scrollTop = el.scrollHeight;
	}

	private renderEmpty(el: HTMLElement) {
		const L = t();
		const box = el.createDiv({ cls: "dsc-empty" });
		box.createDiv({ text: "DeepSeek Chat", cls: "dsc-empty-title" });
		const feats: [boolean, string, string][] = [
			[true, "brain", L.thinking],
			[this.s.webSearchEnabled, "globe", L.sWebEnabled],
			[this.s.readUrlEnabled, "link", L.sReadUrl],
			[this.s.fileInputEnabled, "paperclip", L.sFiles],
			[this.s.safetyEnabled, "shield", L.sSafety],
			[this.s.reminderEnabled, "calendar", L.sReminder],
			[this.s.titleEnabled, "heading", L.sTitle],
			[this.s.ttsEnabled, "volume-2", L.sTts],
			[this.s.asrEnabled, "mic", L.sAsr],
			[this.s.vaultToolsEnabled, "wrench", L.toolCall],
		];
		const list = box.createDiv({ cls: "dsc-empty-feats" });
		for (const [on, icon, label] of feats) {
			if (!on) continue;
			const f = list.createDiv({ cls: "dsc-chip" });
			setIcon(f.createSpan({ cls: "dsc-chip-icon" }), icon);
			f.createSpan({ text: label });
		}
		if (!this.s.apiKey) {
			const warn = box.createDiv({ cls: "dsc-empty-warn" });
			warn.createSpan({ text: L.noKey });
			const b = warn.createEl("button", { text: L.openSettings });
			b.onclick = () => this.plugin.openSettings();
		}
	}

	private async renderTurn(el: HTMLElement, turn: Turn, isLast: boolean, results: Map<string, Block>, comp: Component, live: boolean) {
		const L = t();
		const msgs = this.session.messages;
		const user = msgs[turn.userIndex];

		// —— 用户消息
		const u = el.createDiv({ cls: "dsc-msg dsc-user" });
		u.createDiv({ text: textOf(user.content), cls: "dsc-user-text" });
		const atts = user.meta?.attachments ?? [];
		if (atts.length) {
			const row = u.createDiv({ cls: "dsc-chips dsc-chips-static" });
			for (const a of atts) {
				const c = row.createDiv({ cls: "dsc-chip" });
				setIcon(c.createSpan({ cls: "dsc-chip-icon" }), a.kind === "image" ? "image" : a.kind === "note" ? "file-text" : "paperclip");
				c.createSpan({ text: a.name });
				// 附带的笔记 / 库内文件：点击打开
				const docTitles = (Array.isArray(user.content) ? user.content : []).filter((b) => b.type === "document" && b.title).map((b) => String(b.title));
				const path = docTitles.find((p) => p === a.name || p.endsWith(`/${a.name}.md`) || p.endsWith(`/${a.name}`) || p === `${a.name}.md`);
				const file = path ? resolveNote(this.app, path.includes("/") || /\.\w+$/.test(path) ? path : `${path}.md`) : null;
				if (file) {
					c.addClass("dsc-chip-link");
					c.onclick = (e) => void this.app.workspace.openLinkText(file.path, "", Keymap.isModEvent(e));
					setTooltip(c, file.path);
				}
			}
		}
		if (isLast && !this.busy) {
			const ua = u.createDiv({ cls: "dsc-msg-actions" });
			this.iconButton(ua, "pencil", L.edit, () => this.editLastTurn());
			this.iconButton(ua, "copy", L.copy, () => void this.copy(textOf(user.content)));
		}

		// —— 回答
		const replies = turn.replyIndexes.map((i) => msgs[i]).filter((m) => m.role === "assistant");
		if (!replies.length && !live) {
			if (user.meta?.error) this.renderError(el, user.meta.error, isLast);
			return;
		}
		const a = el.createDiv({ cls: "dsc-msg dsc-assistant" });
		const sources = new SourceCollector();
		const ctx = { app: this.app, component: comp, sourcePath: "", sources, results, live };
		let usage: Usage | undefined;
		let cost = 0;
		for (const m of replies) {
			if (m.meta?.refused) {
				a.createDiv({ text: this.s.refusalMessage || L.refused, cls: "dsc-notice dsc-refused" });
			} else {
				await renderAssistantBlocks(a, Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }], ctx);
			}
			if (m.meta?.usage) usage = addUsage(usage, m.meta.usage);
			cost += m.meta?.cost ?? 0;
		}
		if (live && !a.hasChildNodes()) a.createDiv({ cls: "dsc-typing" }).createSpan({ cls: "dsc-spinner" });

		if (sources.list.length) {
			const det = a.createEl("details", { cls: "dsc-sources" });
			det.createEl("summary", { text: `${L.exportSources} (${sources.list.length})` });
			const ol = det.createEl("ol");
			for (const s of sources.list) {
				const li = ol.createEl("li");
				const link = li.createEl("a", { text: s.title, href: s.url });
				link.setAttr("target", "_blank");
			}
		}
		if (live) return;

		const last = replies[replies.length - 1];
		const stop = last?.meta?.stopReason;
		if (last?.meta?.error) this.renderError(a, last.meta.error, isLast);
		else if (stop === "max_tokens") a.createDiv({ text: L.truncated, cls: "dsc-notice" });
		else if (stop === "aborted") a.createDiv({ text: L.aborted, cls: "dsc-notice" });

		// —— 用量
		if (this.s.usageEnabled && usage) {
			const pricing = parsePricing(this.s.pricingJson);
			const k = (n?: number) => (n ?? 0) >= 1000 ? `${((n ?? 0) / 1000).toFixed(1)}k` : `${n ?? 0}`;
			const parts = [
				`${L.cacheHit} ${k(usage.cache_read_input_tokens)}`,
				`${L.cacheMiss} ${k(usage.input_tokens)}`,
				`${L.output} ${k(usage.output_tokens)}${usage.output_tokens_details?.thinking_tokens ? `（${L.thinkTokens} ${k(usage.output_tokens_details.thinking_tokens)}）` : ""}`,
			];
			const st = usage.server_tool_use;
			const searches = (st?.tool_search ?? 0) + (st?.tool_image_search ?? 0);
			if (searches) parts.push(`${L.searchCount} ${searches}`);
			if (st?.tool_fetch) parts.push(`${L.fetchCount} ${st.tool_fetch}`);
			if (cost) parts.push(formatCost(cost, pricing.currency));
			a.createDiv({ text: parts.join(" · "), cls: "dsc-usage" });
		}

		// —— 操作
		const bar = a.createDiv({ cls: "dsc-msg-actions" });
		const answer = () => this.turnAnswer(turn, sources);
		this.iconButton(bar, "copy", L.copy, () => void this.copy(answer()));
		this.iconButton(bar, "file-input", L.insert, () => this.insertIntoNote(answer()));
		this.iconButton(bar, "file-plus", L.saveNote, () => void this.saveAnswerAsNote(answer()));
		if (this.s.ttsEnabled) {
			this.iconButton(bar, "volume-2", L.speak, () => this.plugin.speak(this.turnAnswer(turn, null)));
		}
		if (isLast) {
			this.iconButton(bar, "refresh-cw", L.regenerate, () => void this.regenerate());
			if (this.s.continueEnabled && stop === "max_tokens") {
				const blocks = replies.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
				const btn = this.iconButton(bar, "chevrons-right", L.continue, () => void this.continueLast());
				if (usedWebTools(blocks)) {
					btn.disabled = true;
					setTooltip(btn, L.continueDisabled);
				}
			}
		}
		if (this.s.devPanelEnabled && last && this.raw.has(last)) {
			this.iconButton(bar, "code", L.raw, () => {
				const r = this.raw.get(last);
				new CodeModal(this.app, L.raw, JSON.stringify(r, null, 2)).open();
			});
		}
	}

	private renderError(parent: HTMLElement, message: string, isLast: boolean) {
		const L = t();
		const box = parent.createDiv({ cls: "dsc-notice dsc-error" });
		box.createSpan({ text: `${L.errorPrefix}: ${message === "NO_KEY" ? L.noKey : message === "STREAM_INCOMPLETE" ? L.streamIncomplete : message}` });
		if (isLast && !this.busy) {
			const b = box.createEl("button", { text: L.retry });
			b.onclick = () => void this.regenerate();
		}
	}

	/** 流式时只重绘最后一轮，节流 */
	private scheduleLiveRender() {
		if (this.renderQueued) return;
		this.renderQueued = true;
		window.setTimeout(() => void this.liveRender(), 120);
	}

	private async liveRender() {
		this.renderQueued = false;
		if (this.rendering) {
			this.scheduleLiveRender();
			return;
		}
		this.rendering = true;
		try {
			const turns = groupTurns(this.session.messages);
			const turn = turns[turns.length - 1];
			if (!turn) return;
			const el = this.messagesEl;
			const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
			const comp = new Component();
			comp.load();
			const fresh = createDiv({ cls: "dsc-turn" });
			await this.renderTurn(fresh, turn, true, toolResultMap(this.session.messages), comp, this.busy);
			if (this.liveTurnEl && this.liveTurnEl.parentElement === el) this.liveTurnEl.replaceWith(fresh);
			else {
				el.querySelector(".dsc-empty")?.remove();
				el.appendChild(fresh);
			}
			this.liveTurnEl = fresh;
			this.liveComp?.unload();
			this.liveComp = comp;
			if (nearBottom) el.scrollTop = el.scrollHeight;
		} finally {
			this.rendering = false;
		}
	}

	// ———————————————————————— 发送与回答 ————————————————————————

	private conn() {
		return { baseUrl: this.s.baseUrl, apiKey: this.s.apiKey };
	}

	/** 外部调用：预填并发送（右键菜单、命令） */
	async ask(text: string, autoSend: boolean) {
		this.inputEl.value = text;
		this.autoGrow();
		if (autoSend) await this.send();
		else this.inputEl.focus();
	}

	async send() {
		const L = t();
		if (this.busy) return;
		const text = this.inputEl.value.trim();
		const ready = this.pending.filter((p) => p.status === "ready");
		if (this.pending.some((p) => p.status === "uploading")) {
			new Notice(L.uploading);
			return;
		}
		if (!text && !ready.length) return;
		if (!this.s.apiKey) {
			new Notice(L.noKey);
			this.plugin.openSettings();
			return;
		}

		const blocks: Block[] = ready.map((p) => p.block!);
		const metas = ready.map((p) => p.meta);
		if (this.s.activeNoteEnabled && this.includeNote) {
			const f = activeMarkdownFile(this.app);
			if (f) {
				blocks.push(textDocumentBlock(f.path, await this.app.vault.cachedRead(f)));
				metas.push({ name: f.basename, kind: "note" });
			}
		}
		blocks.push({ type: "text", text: text || "…" });

		const now = Date.now();
		if (this.s.reminderEnabled) {
			this.session.messages.push({
				role: "latest_reminder",
				content: buildReminder(new Date(now), this.s.reminderLocation, reminderLanguage(this.s), "App"),
			});
		}
		this.session.messages.push({ role: "user", content: blocks, meta: { createdAt: now, attachments: metas } });
		this.inputEl.value = "";
		this.autoGrow();
		this.pending = [];
		this.renderChips();
		await this.runTurn();
	}

	private buildBody(messages: ApiMessage[]): MessagesRequest {
		const s = this.s;
		const o = this.session.options;
		const body: MessagesRequest = { model: this.session.model, messages };
		if (s.maxTokens > 0) body.max_tokens = s.maxTokens;
		const useVault = s.vaultToolsEnabled && !!o.vaultTools;
		const system = [useVault ? VAULT_SYSTEM : "", this.session.systemPrompt ?? s.systemPrompt].filter((x) => x?.trim()).join("\n\n");
		if (system) body.system = system;
		body.thinking = { type: o.thinking ? "enabled" : "disabled" };
		if (o.thinking) body.output_config = { effort: o.effort };
		const tools: ToolDefinition[] = [];
		if (s.webSearchEnabled && o.webSearch) tools.push({ type: "deepseek_web_search", name: "deepseek_web_search" });
		if (s.readUrlEnabled) tools.push({ type: "deepseek_read_url", name: "deepseek_read_url" });
		if (useVault) tools.push(...VAULT_TOOLS.map((x) => ({ ...x })));
		if (tools.length) body.tools = tools;
		if (s.safetyEnabled) body.safety_check = { level: "high" };
		const firstTurn = groupTurns(this.session.messages).length === 1;
		if (s.titleEnabled && firstTurn && !this.session.titleFromModel) body.title = { enabled: true };
		return body;
	}

	private setBusy(b: boolean) {
		this.busy = b;
		this.updateSendButton();
	}

	private markTurnExcluded(turn: Turn, excluded: boolean) {
		for (const i of turnIndexes(turn)) {
			const m = this.session.messages[i];
			if (excluded) (m.meta ??= {}).excluded = true;
			else if (m.meta) delete m.meta.excluded;
		}
	}

	private lastTurn(): Turn | undefined {
		const turns = groupTurns(this.session.messages);
		return turns[turns.length - 1];
	}

	private async runTurn() {
		const L = t();
		this.setBusy(true);
		this.abort = new AbortController();
		let finalText = "";
		try {
			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				const messages = buildRequestMessages(this.session.messages);
				const body = this.buildBody(messages);
				const reply: StoredMessage = { role: "assistant", content: [], meta: { createdAt: Date.now(), model: this.session.model } };
				this.session.messages.push(reply);
				this.scheduleLiveRender();

				let result: ApiResult;
				try {
					result = await createMessage(this.conn(), body, {
						stream: this.s.stream,
						betaFiles: hasFileBlocks(messages),
						signal: this.abort.signal,
						onUpdate: (acc) => {
							reply.content = acc.finalContent();
							this.scheduleLiveRender();
						},
					});
				} catch (e) {
					const err = e as ApiError & { partial?: ApiResult };
					reply.content = err.partial?.content ?? [];
					reply.meta!.error = /cannot be used together|other tools/i.test(err.message) ? `${err.message}\n${L.toolsConflict}` : err.message;
					if (err.partial?.usage) this.applyUsage(reply, err.partial.usage);
					const turn = this.lastTurn();
					if (turn) this.markTurnExcluded(turn, true);
					if (/Content Exists Risk/i.test(err.message)) {
						reply.meta!.refused = true;
						delete reply.meta!.error;
					}
					break;
				}

				reply.content = result.content;
				reply.meta!.stopReason = result.stop_reason;
				this.applyUsage(reply, result.usage);
				if (this.devRaw()) this.raw.set(reply, { request: body, response: result });

				if (result.title && !this.session.titleFromModel) {
					this.session.title = result.title;
					this.session.titleFromModel = true;
				}

				if (result.stop_reason === "refusal") {
					reply.meta!.refused = true;
					const turn = this.lastTurn();
					if (turn) this.markTurnExcluded(turn, true);
					break;
				}

				if (result.stop_reason === "aborted") {
					// 停止时只保留已完整的文本，避免把半截思考 / 工具块发回去
					const texts = result.content.filter((b) => b.type === "text" && b.text);
					reply.content = texts;
					if (!texts.length) {
						const turn = this.lastTurn();
						if (turn) this.markTurnExcluded(turn, true);
					}
					break;
				}

				if (result.stop_reason === "tool_use") {
					const uses = result.content.filter((b) => b.type === "tool_use");
					if (!uses.length) break;
					const outputs: Block[] = [];
					for (const u of uses) {
						const r = await runVaultTool(this.app, u.name ?? "", u.input ?? {});
						outputs.push({ type: "tool_result", tool_use_id: u.id, content: r.text, ...(r.isError ? { is_error: true } : {}) });
					}
					this.session.messages.push({ role: "user", content: outputs, meta: { toolResults: true, createdAt: Date.now() } });
					this.scheduleLiveRender();
					continue;
				}

				finalText = textOf(result.content);
				break;
			}
		} finally {
			this.abort = null;
			this.setBusy(false);
			if (!this.session.titleFromModel && (!this.session.title || this.session.title === L.untitled)) {
				const first = groupTurns(this.session.messages)[0];
				if (first) this.session.title = textOf(this.session.messages[first.userIndex].content).slice(0, 24) || L.untitled;
			}
			await this.save();
			await this.renderAll();
		}
		if (finalText && this.s.ttsEnabled && this.s.ttsAutoPlay) this.plugin.speak(finalText);
	}

	private devRaw() {
		return this.s.devPanelEnabled;
	}

	private applyUsage(m: StoredMessage, usage: Usage) {
		const meta = (m.meta ??= {});
		meta.usage = addUsage(meta.usage, usage);
		const cost = computeCost(usage, this.session.model, parsePricing(this.s.pricingJson), new Date());
		meta.cost = (meta.cost ?? 0) + (cost ?? 0);
	}

	/** 去掉最后一轮的回答，重新请求 */
	private async regenerate() {
		if (this.busy) return;
		const turn = this.lastTurn();
		if (!turn) return;
		const keep = new Set(turn.replyIndexes);
		this.session.messages = this.session.messages.filter((_, i) => !keep.has(i));
		const fresh = this.lastTurn();
		if (fresh) {
			this.markTurnExcluded(fresh, false);
			const u = this.session.messages[fresh.userIndex];
			if (u.meta) delete u.meta.error;
		}
		await this.renderAll();
		await this.runTurn();
	}

	/** 把最后一轮放回输入框，删掉这一轮 */
	private editLastTurn() {
		if (this.busy) return;
		const turn = this.lastTurn();
		if (!turn) return;
		const user = this.session.messages[turn.userIndex];
		const blocks = Array.isArray(user.content) ? user.content : [];
		const metas = user.meta?.attachments ?? [];
		const extra = blocks.filter((b) => b.type !== "text");
		this.pending = extra
			.map((block, i) => ({ key: `${Date.now()}-${i}`, meta: metas[i] ?? { name: "attachment", kind: "file" as const }, status: "ready" as const, block }))
			.filter((p) => p.meta.kind !== "note");
		const drop = new Set(turnIndexes(turn));
		this.session.messages = this.session.messages.filter((_, i) => !drop.has(i));
		this.inputEl.value = textOf(user.content);
		this.autoGrow();
		this.renderChips();
		void this.renderAll();
		this.inputEl.focus();
	}

	/** 续写被 max_tokens 截断的回答（assistant 前缀续写） */
	private async continueLast() {
		if (this.busy) return;
		const turn = this.lastTurn();
		if (!turn) return;
		const lastIdx = turn.replyIndexes[turn.replyIndexes.length - 1];
		const m = this.session.messages[lastIdx];
		if (!m || m.role !== "assistant" || !Array.isArray(m.content)) return;
		const original = JSON.parse(JSON.stringify(m.content)) as Block[];
		const body = this.buildBody(buildRequestMessages(this.session.messages));
		delete body.title;
		const merge = (added: Block[]) => {
			const extraText = textOf(added);
			const out = JSON.parse(JSON.stringify(original)) as Block[];
			const lastText = [...out].reverse().find((b) => b.type === "text");
			if (lastText) lastText.text = (lastText.text ?? "") + extraText;
			else out.push({ type: "text", text: extraText });
			return out;
		};
		this.setBusy(true);
		this.abort = new AbortController();
		try {
			const result = await createMessage(this.conn(), body, {
				stream: this.s.stream,
				betaFiles: hasFileBlocks(body.messages),
				signal: this.abort.signal,
				onUpdate: (acc) => {
					m.content = merge(acc.finalContent());
					this.scheduleLiveRender();
				},
			});
			m.content = merge(result.content);
			m.meta!.stopReason = result.stop_reason;
			this.applyUsage(m, result.usage);
		} catch (e) {
			m.content = original;
			new Notice(`${t().errorPrefix}: ${(e as Error).message}`, 8000);
		} finally {
			this.abort = null;
			this.setBusy(false);
			await this.save();
			await this.renderAll();
		}
	}

	// ———————————————————————— 会话管理 ————————————————————————

	private async save() {
		await this.plugin.store.save(this.session);
		if (this.session.messages.length && this.plugin.data.lastSessionId !== this.session.id) {
			this.plugin.data.lastSessionId = this.session.id;
			await this.plugin.saveSettings();
		}
		this.renderHeader();
	}

	async newChat() {
		if (this.busy) this.abort?.abort();
		this.session = this.freshSession();
		this.pending = [];
		this.plugin.data.lastSessionId = undefined;
		await this.plugin.saveSettings();
		this.build();
		this.inputEl.focus();
	}

	async openHistory() {
		const list = await this.plugin.store.list();
		new SessionPicker(this.app, list, async (info) => {
			const s = await this.plugin.store.load(info.path);
			if (!s) return;
			if (this.busy) this.abort?.abort();
			this.session = s;
			this.plugin.data.lastSessionId = s.id;
			await this.plugin.saveSettings();
			this.build();
		}).open();
	}

	private renameSession() {
		new TextPromptModal(this.app, t().rename, this.session.title, false, async (v) => {
			if (!v.trim()) return;
			this.session.title = v.trim();
			this.session.titleFromModel = true;
			await this.save();
		}).open();
	}

	private openMenu(e: MouseEvent) {
		const L = t();
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(L.newChat).setIcon("plus").onClick(() => void this.newChat()));
		menu.addItem((i) => i.setTitle(L.history).setIcon("history").onClick(() => void this.openHistory()));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle(L.rename).setIcon("pencil").onClick(() => this.renameSession()));
		menu.addItem((i) =>
			i
				.setTitle(L.systemPrompt)
				.setIcon("settings-2")
				.onClick(() =>
					new TextPromptModal(this.app, L.systemPrompt, this.session.systemPrompt ?? this.s.systemPrompt, true, async (v) => {
						this.session.systemPrompt = v;
						await this.save();
					}).open(),
				),
		);
		menu.addItem((i) => i.setTitle(L.exportNote).setIcon("file-output").onClick(() => void this.exportSession()));
		menu.addItem((i) =>
			i
				.setTitle(L.deleteChat)
				.setIcon("trash-2")
				.onClick(() =>
					new ConfirmModal(this.app, L.confirmDelete, async () => {
						await this.plugin.store.remove(this.session.id);
						new Notice(L.deleted);
						await this.newChat();
					}).open(),
				),
		);
		menu.addSeparator();
		menu.addItem((i) => i.setTitle(L.openSettings).setIcon("settings").onClick(() => this.plugin.openSettings()));
		menu.showAtMouseEvent(e);
	}

	async exportSession() {
		if (!this.session.messages.length) return;
		const file = await this.plugin.exportSession(this.session);
		if (file) await this.app.workspace.getLeaf("tab").openFile(file);
	}

	// ———————————————————————— 回答的操作 ————————————————————————

	private turnAnswer(turn: Turn, sources: SourceCollector | null): string {
		const text = turn.replyIndexes
			.map((i) => this.session.messages[i])
			.filter((m) => m.role === "assistant" && !m.meta?.refused)
			.map((m) => textOf(m.content))
			.join("")
			.trim();
		// 复制 / 插入时附上来源列表
		if (sources && sources.list.length) return `${text}\n\n${t().exportSources}:\n${sourcesToMarkdown(sources.list)}`;
		return text;
	}

	private async copy(text: string) {
		await navigator.clipboard.writeText(text);
		new Notice(t().copied);
	}

	private insertIntoNote(text: string) {
		const view = this.plugin.lastMarkdownView();
		if (!view) {
			new Notice(t().insertNoEditor);
			return;
		}
		view.editor.replaceSelection(text);
		this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
	}

	private async saveAnswerAsNote(text: string) {
		const file = await this.plugin.createNote(`${this.session.title} - ${new Date().toLocaleDateString()}`, text);
		if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
	}

	isBusy() {
		return this.busy;
	}

	isMobile() {
		return Platform.isMobile;
	}
}

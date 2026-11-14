import { Editor, MarkdownView, Notice, normalizePath, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { chatJson } from "./src/api/client";
import { Speaker } from "./src/api/speech";
import { safeFileName, sessionToMarkdown } from "./src/core/export";
import type { Session } from "./src/core/types";
import { setLanguage, t } from "./src/i18n";
import { DEFAULT_SETTINGS, DSSettingTab, modelList, type DSSettings } from "./src/settings";
import { SessionStore } from "./src/store";
import { CodeModal } from "./src/ui/modals";
import { ChatView, VIEW_TYPE } from "./src/ui/view";

interface AppWithSetting {
	setting?: { open?: () => void; openTabById?: (id: string) => void };
}

interface PluginData extends DSSettings {
	lastSessionId?: string;
}

const JSON_SYSTEM = `You extract structured information from a note and reply in json only.
Output a JSON object with exactly these fields:
{"title": string, "summary": string, "keywords": string[], "people": string[], "dates": string[], "action_items": string[], "questions": string[]}
Use the note's own language. Use empty arrays when nothing applies.`;

export default class DeepSeekChatPlugin extends Plugin {
	data!: PluginData;
	store!: SessionStore;
	speaker = new Speaker();
	private lastMdView: MarkdownView | null = null;

	get settings(): DSSettings {
		return this.data;
	}

	async onload() {
		const saved = ((await this.loadData()) as Partial<PluginData> | null) ?? {};
		this.data = Object.assign({}, DEFAULT_SETTINGS, saved);
		// v1 → v2：笔记库工具改为「功能可用 + 对话框开关」，旧配置里的 false 是旧默认值
		if (!saved.settingsVersion) {
			this.data.vaultToolsEnabled = true;
			this.data.settingsVersion = 2;
		}
		setLanguage(this.data.language);
		const L = t();
		this.store = new SessionStore(this.app, () => this.data.chatFolder);

		this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.registerHoverLinkSource(VIEW_TYPE, { display: "DeepSeek Chat", defaultMod: true });
		this.addRibbonIcon("message-circle", L.ribbonOpen, () => void this.activateView());
		this.addSettingTab(new DSSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) this.lastMdView = leaf.view;
			}),
		);

		this.addCommand({ id: "open", name: L.cmdOpen, callback: () => void this.activateView() });
		this.addCommand({
			id: "new-chat",
			name: L.cmdNew,
			callback: async () => (await this.activateView())?.newChat(),
		});
		this.addCommand({
			id: "history",
			name: L.cmdHistory,
			callback: async () => (await this.activateView())?.openHistory(),
		});
		this.addCommand({
			id: "export-chat",
			name: L.cmdExport,
			callback: async () => (await this.activateView())?.exportSession(),
		});

		const selectionCommands: [string, string, string][] = [
			["ask-selection", L.cmdAskSelection, L.promptAsk],
			["explain-selection", L.cmdExplain, L.promptExplain],
			["summarize-selection", L.cmdSummarize, L.promptSummarize],
			["translate-selection", L.cmdTranslate, L.promptTranslate],
		];
		for (const [id, name, prompt] of selectionCommands) {
			this.addCommand({
				id,
				name,
				editorCheckCallback: (checking, editor) => {
					if (!editor.getSelection()) return false;
					if (!checking) void this.askSelection(editor, prompt, id !== "ask-selection");
					return true;
				},
			});
		}
		this.addCommand({
			id: "speak-selection",
			name: L.cmdSpeakSelection,
			editorCheckCallback: (checking, editor) => {
				if (!this.data.ttsEnabled || !editor.getSelection()) return false;
				if (!checking) this.speak(editor.getSelection());
				return true;
			},
		});
		this.addCommand({
			id: "extract-json",
			name: L.jsonExtract,
			editorCheckCallback: (checking, editor, ctx) => {
				if (!this.data.jsonExtractEnabled || !ctx.file) return false;
				if (!checking) void this.extractJson(editor, ctx.file);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				if (!this.data.editorMenuEnabled) return;
				const sel = editor.getSelection();
				if (!sel) return;
				menu.addSeparator();
				for (const [id, name, prompt] of selectionCommands) {
					menu.addItem((i) =>
						i
							.setTitle(`${L.menuPrefix}${name}`)
							.setIcon("message-circle")
							.onClick(() => void this.askSelection(editor, prompt, id !== "ask-selection")),
					);
				}
				if (this.data.ttsEnabled) {
					menu.addItem((i) =>
						i
							.setTitle(`${L.menuPrefix}${L.cmdSpeakSelection}`)
							.setIcon("volume-2")
							.onClick(() => this.speak(sel)),
					);
				}
			}),
		);
	}

	onunload() {
		this.speaker.stop();
	}

	async saveSettings() {
		await this.saveData(this.data);
	}

	/** 设置改变后，已打开的对话视图重建 */
	refreshViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const v = leaf.view;
			if (v instanceof ChatView && !v.isBusy()) v.refresh();
		}
	}

	openSettings() {
		// Obsidian 没有公开「打开某个插件设置页」的 API；这里做了存在性检查，缺失时只提示用户
		const setting = (this.app as unknown as AppWithSetting).setting;
		if (setting?.open && setting.openTabById) {
			setting.open();
			setting.openTabById(this.manifest.id);
		} else new Notice(t().noKey);
	}

	async activateView(): Promise<ChatView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof ChatView ? leaf.view : null;
	}

	lastMarkdownView(): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;
		if (this.lastMdView && this.lastMdView.leaf.parent) return this.lastMdView;
		return null;
	}

	speak(text: string) {
		const L = t();
		if (!this.data.apiKey) {
			new Notice(L.noKey);
			return;
		}
		if (this.speaker.playing) {
			this.speaker.stop();
			return;
		}
		void this.speaker.speak({ baseUrl: this.data.baseUrl, apiKey: this.data.apiKey }, text, this.data.ttsVoice, this.data.ttsStreaming, (msg) =>
			new Notice(`${L.ttsError}: ${msg}`, 8000),
		);
	}

	private async askSelection(editor: Editor, prompt: string, autoSend: boolean) {
		const sel = editor.getSelection();
		const view = await this.activateView();
		if (!view) return;
		const quoted = sel
			.split("\n")
			.map((l) => `> ${l}`)
			.join("\n");
		await view.ask(`${prompt}\n\n${quoted}\n\n`, autoSend);
	}

	private async extractJson(editor: Editor, file: TFile) {
		const L = t();
		if (!this.data.apiKey) {
			new Notice(L.noKey);
			return;
		}
		const notice = new Notice(L.jsonExtracting, 0);
		try {
			const content = editor.getValue();
			const raw = await chatJson(
				{ baseUrl: this.data.baseUrl, apiKey: this.data.apiKey },
				modelList(this.data)[0],
				JSON_SYSTEM,
				`Note title: ${file.basename}\n\n${content.slice(0, 200_000)}`,
			);
			let pretty = raw.trim();
			try {
				pretty = JSON.stringify(JSON.parse(raw), null, 2);
			} catch {
				/* 原样显示 */
			}
			new CodeModal(this.app, `${L.jsonResult} · ${file.basename}`, pretty || "(empty)", {
				label: L.insertCodeBlock,
				run: () => {
					const last = editor.lastLine();
					editor.replaceRange(`\n\n\`\`\`json\n${pretty}\n\`\`\`\n`, { line: last, ch: editor.getLine(last).length });
				},
			}).open();
		} catch (e) {
			new Notice(`${L.errorPrefix}: ${(e as Error).message}`, 8000);
		} finally {
			notice.hide();
		}
	}

	private async uniquePath(folder: string, base: string): Promise<string> {
		const dir = normalizePath(folder);
		if (!this.app.vault.getFolderByPath(dir)) await this.app.vault.createFolder(dir);
		let path = normalizePath(`${dir}/${base}.md`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${dir}/${base} (${n}).md`);
		return path;
	}

	async createNote(title: string, content: string): Promise<TFile> {
		const path = await this.uniquePath(this.data.exportFolder, safeFileName(title));
		return this.app.vault.create(path, content);
	}

	async exportSession(session: Session): Promise<TFile | null> {
		const L = t();
		const md = sessionToMarkdown(
			session,
			{
				user: L.exportUser,
				assistant: L.exportAssistant,
				thinking: L.thinkingProcess,
				sources: L.exportSources,
				attachments: L.exportAttachments,
				refused: this.data.refusalMessage || L.refused,
			},
			this.data.exportThinking,
		);
		const file = await this.createNote(session.title, md);
		new Notice(`${L.exported}${file.path}`);
		return file;
	}
}

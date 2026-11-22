import { App, FuzzySuggestModal, Modal, Setting, SuggestModal, TFile } from "obsidian";
import { t } from "../i18n";
import type { SessionInfo } from "../store";

/** 单行或多行文字输入 */
export class TextPromptModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private value: string,
		private multiline: boolean,
		private onSubmit: (v: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		const L = t();
		this.titleEl.setText(this.title);
		let input: HTMLInputElement | HTMLTextAreaElement;
		if (this.multiline) {
			input = this.contentEl.createEl("textarea", { cls: "dsc-modal-textarea" });
			input.rows = 8;
		} else {
			input = this.contentEl.createEl("input", { type: "text", cls: "dsc-modal-input" });
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					this.submit(input.value);
				}
			});
		}
		input.value = this.value;
		window.setTimeout(() => input.focus(), 0);
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(L.cancel).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(L.save)
					.setCta()
					.onClick(() => this.submit(input.value)),
			);
	}

	private submit(v: string) {
		void this.onSubmit(v);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private message: string,
		private onConfirm: () => void | Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		const L = t();
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(L.cancel).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(L.deleteChat)
					.setWarning()
					.onClick(() => {
						void this.onConfirm();
						this.close();
					}),
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class SessionPicker extends SuggestModal<SessionInfo> {
	constructor(
		app: App,
		private sessions: SessionInfo[],
		private onPick: (s: SessionInfo) => void | Promise<void>,
	) {
		super(app);
		this.setPlaceholder(t().searchChats);
		this.emptyStateText = t().noChats;
	}

	getSuggestions(query: string): SessionInfo[] {
		const q = query.toLowerCase();
		return this.sessions.filter((s) => s.title.toLowerCase().includes(q));
	}

	renderSuggestion(s: SessionInfo, el: HTMLElement) {
		el.createDiv({ text: s.title || t().untitled });
		el.createEl("small", { text: new Date(s.updatedAt).toLocaleString(), cls: "dsc-muted" });
	}

	onChooseSuggestion(s: SessionInfo) {
		void this.onPick(s);
	}
}

export class VaultFilePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private exts: Set<string>,
		private onPick: (f: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(t().attachVault);
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => this.exts.has(f.extension.toLowerCase()))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	getItemText(f: TFile): string {
		return f.path;
	}

	onChooseItem(f: TFile) {
		this.onPick(f);
	}
}

/** 展示一段代码 / JSON，可复制，可选一个额外动作 */
export class CodeModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private code: string,
		private extra?: { label: string; run: () => void },
	) {
		super(app);
	}

	onOpen() {
		const L = t();
		this.modalEl.addClass("dsc-code-modal");
		this.titleEl.setText(this.title);
		this.contentEl.createEl("pre", { cls: "dsc-code" }).createEl("code", { text: this.code });
		const s = new Setting(this.contentEl).addButton((b) =>
			b.setButtonText(L.copy).onClick(async () => {
				await navigator.clipboard.writeText(this.code);
				b.setButtonText(L.copied);
			}),
		);
		if (this.extra) {
			const extra = this.extra;
			s.addButton((b) =>
				b
					.setButtonText(extra.label)
					.setCta()
					.onClick(() => {
						extra.run();
						this.close();
					}),
			);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

export interface WriteConfirmRequest {
	tool: string;
	actionLabel: string;
	path: string;
	newPath?: string;
	content?: string;
	before?: string;
	after?: string;
	isDelete?: boolean;
}

export type WriteConfirmDecision = "allow" | "allow-session" | "deny";

const MAX_PREVIEW_CHARS = 1800;

function clipPreview(text: string): string {
	return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}\n…` : text;
}

/** 写入 / 移动 / 删除笔记前的确认弹窗 */
export class WriteConfirmModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private req: WriteConfirmRequest,
		private onDecision: (decision: WriteConfirmDecision) => void,
	) {
		super(app);
	}

	private resolve(decision: WriteConfirmDecision) {
		if (this.settled) return;
		this.settled = true;
		this.onDecision(decision);
		this.close();
	}

	onOpen() {
		const L = t();
		this.modalEl.addClass("dsc-write-modal");
		this.titleEl.setText(`${L.confirmWriteTitle} · ${this.req.actionLabel}`);

		const pathBox = this.contentEl.createDiv({ cls: "dsc-write-path" });
		if (this.req.newPath) {
			pathBox.createEl("code", { text: this.req.path });
			pathBox.createSpan({ text: " → ", cls: "dsc-muted" });
			pathBox.createEl("code", { text: this.req.newPath });
		} else {
			pathBox.createEl("code", { text: this.req.path });
		}

		if (this.req.isDelete) {
			this.contentEl.createDiv({ text: L.deleteTrashHint, cls: "dsc-notice dsc-error dsc-write-warn" });
		} else if (this.req.before !== undefined && this.req.after !== undefined) {
			const wrap = this.contentEl.createDiv({ cls: "dsc-write-preview" });
			wrap.createDiv({ text: `${L.previewBefore} (${this.req.before.length} ${L.previewChars})`, cls: "dsc-write-label" });
			wrap.createEl("pre", { cls: "dsc-code dsc-write-diff-old" }).createEl("code", { text: clipPreview(this.req.before) });
			wrap.createDiv({ text: `${L.previewAfter} (${this.req.after.length} ${L.previewChars})`, cls: "dsc-write-label" });
			wrap.createEl("pre", { cls: "dsc-code dsc-write-diff-new" }).createEl("code", { text: clipPreview(this.req.after) });
		} else if (this.req.content !== undefined) {
			const wrap = this.contentEl.createDiv({ cls: "dsc-write-preview" });
			wrap.createDiv({ text: `${L.previewContent} (${this.req.content.length} ${L.previewChars})`, cls: "dsc-write-label" });
			wrap.createEl("pre", { cls: "dsc-code" }).createEl("code", { text: clipPreview(this.req.content) });
		}

		const actions = new Setting(this.contentEl);
		actions.addButton((b) => b.setButtonText(L.confirmDeny).onClick(() => this.resolve("deny")));
		if (!this.req.isDelete) {
			actions.addButton((b) => b.setButtonText(L.confirmAllowSession).onClick(() => this.resolve("allow-session")));
		}
		actions.addButton((b) => {
			b.setButtonText(L.confirmAllow).onClick(() => this.resolve("allow"));
			if (this.req.isDelete) b.setWarning();
			else b.setCta();
		});
	}

	onClose() {
		this.contentEl.empty();
		if (!this.settled) {
			this.settled = true;
			this.onDecision("deny");
		}
	}
}

export function confirmVaultWrite(app: App, req: WriteConfirmRequest): Promise<WriteConfirmDecision> {
	return new Promise((resolve) => {
		new WriteConfirmModal(app, req, resolve).open();
	});
}

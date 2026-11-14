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

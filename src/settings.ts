import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { createMessage } from "./api/client";
import { DEFAULT_PRICING } from "./core/pricing";
import { REMINDER_LANGUAGES } from "./core/reminder";
import { isZh, setLanguage, t } from "./i18n";
import type DeepSeekChatPlugin from "../main";

export interface DSSettings {
	apiKey: string;
	baseUrl: string;
	models: string;
	stream: boolean;
	maxTokens: number;
	systemPrompt: string;
	sendKey: "enter" | "mod-enter";
	language: "auto" | "zh" | "en";

	thinkingDefault: boolean;
	thinkingEffort: "low" | "high" | "max";
	webSearchEnabled: boolean;
	webSearchDefault: boolean;
	readUrlEnabled: boolean;
	fileInputEnabled: boolean;
	fileParseMode: "text_recognition" | "rich_layout_recognition";
	visionEnabled: boolean;
	safetyEnabled: boolean;
	refusalMessage: string;
	reminderEnabled: boolean;
	reminderLocation: string;
	reminderLanguage: string;
	titleEnabled: boolean;
	continueEnabled: boolean;
	ttsEnabled: boolean;
	ttsVoice: "stella" | "tide";
	ttsStreaming: boolean;
	ttsAutoPlay: boolean;
	asrEnabled: boolean;
	asrAutoSend: boolean;

	activeNoteEnabled: boolean;
	activeNoteDefault: boolean;
	vaultToolsEnabled: boolean;
	vaultToolsDefault: boolean;
	vaultWriteEnabled: boolean;
	vaultWriteConfirm: boolean;
	vaultMoveEnabled: boolean;
	vaultDeleteEnabled: boolean;
	settingsVersion: number;
	editorMenuEnabled: boolean;
	jsonExtractEnabled: boolean;

	usageEnabled: boolean;
	pricingJson: string;

	chatFolder: string;
	exportFolder: string;
	exportThinking: boolean;

	devPanelEnabled: boolean;
}

export const DEFAULT_SETTINGS: DSSettings = {
	apiKey: "",
	baseUrl: "https://api.deepseek.com",
	models: "deepseek-flash, deepseek-v4-pro",
	stream: true,
	maxTokens: 0,
	systemPrompt: "",
	sendKey: "enter",
	language: "auto",

	thinkingDefault: true,
	thinkingEffort: "high",
	webSearchEnabled: true,
	webSearchDefault: false,
	readUrlEnabled: true,
	fileInputEnabled: true,
	fileParseMode: "text_recognition",
	visionEnabled: true,
	safetyEnabled: false,
	refusalMessage: "",
	reminderEnabled: true,
	reminderLocation: "",
	reminderLanguage: "",
	titleEnabled: true,
	continueEnabled: true,
	ttsEnabled: true,
	ttsVoice: "stella",
	ttsStreaming: true,
	ttsAutoPlay: false,
	asrEnabled: true,
	asrAutoSend: false,

	activeNoteEnabled: true,
	activeNoteDefault: false,
	vaultToolsEnabled: true,
	vaultToolsDefault: false,
	vaultWriteEnabled: true,
	vaultWriteConfirm: true,
	vaultMoveEnabled: false,
	vaultDeleteEnabled: false,
	settingsVersion: 3,
	editorMenuEnabled: true,
	jsonExtractEnabled: true,

	usageEnabled: true,
	pricingJson: JSON.stringify(DEFAULT_PRICING, null, 2),

	chatFolder: "DeepSeek Chats",
	exportFolder: "DeepSeek Chats",
	exportThinking: false,

	devPanelEnabled: false,
};

export function modelList(s: DSSettings): string[] {
	const list = s.models
		.split(/[,，\n]/)
		.map((m) => m.trim())
		.filter(Boolean);
	return list.length ? list : ["deepseek-flash"];
}

export function reminderLanguage(s: DSSettings): string {
	return s.reminderLanguage || (isZh() ? "中文" : "English");
}

export class DSSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: DeepSeekChatPlugin,
	) {
		super(app, plugin);
	}

	private async save(refreshView = true) {
		await this.plugin.saveSettings();
		if (refreshView) this.plugin.refreshViews();
	}

	private toggle(el: HTMLElement, name: string, desc: string, key: keyof DSSettings, rerender = false) {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addToggle((tg) =>
				tg.setValue(Boolean(s[key])).onChange(async (v) => {
					s[key] = v;
					await this.save();
					if (rerender) this.display();
				}),
			);
	}

	private sub(el: HTMLElement): HTMLElement {
		return el.createDiv({ cls: "dsc-setting-sub" });
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const L = t();
		containerEl.empty();

		containerEl.createEl("p", { text: L.sPrivacy, cls: "dsc-setting-privacy" });

		// —— 连接（首组设置按规范不加标题）——
		new Setting(containerEl)
			.setName(L.sApiKey)
			.setDesc(L.sApiKeyDesc)
			.addText((tx) => {
				tx.inputEl.type = "password";
				tx.inputEl.autocomplete = "off";
				tx.setPlaceholder("sk-…")
					.setValue(s.apiKey)
					.onChange(async (v) => {
						s.apiKey = v.trim();
						await this.save(false);
					});
			})
			.addButton((b) =>
				b.setButtonText(L.sTestBtn).onClick(async () => {
					b.setDisabled(true);
					try {
						const model = modelList(s)[0];
						await createMessage(
							{ baseUrl: s.baseUrl, apiKey: s.apiKey },
							{ model, max_tokens: 8, thinking: { type: "disabled" }, messages: [{ role: "user", content: "ping" }] },
							{ stream: false, betaFiles: false },
						);
						new Notice(`✓ ${L.sTestOk} · ${model}`);
					} catch (e) {
						const msg = (e as Error).message;
						new Notice(`✗ ${msg === "NO_KEY" ? L.noKey : msg}`, 8000);
					} finally {
						b.setDisabled(false);
					}
				}),
			);
		new Setting(containerEl)
			.setName(L.sBaseUrl)
			.setDesc(L.sBaseUrlDesc)
			.addText((tx) =>
				tx.setValue(s.baseUrl).onChange(async (v) => {
					s.baseUrl = v.trim() || DEFAULT_SETTINGS.baseUrl;
					await this.save(false);
				}),
			);
		new Setting(containerEl)
			.setName(L.sModels)
			.setDesc(L.sModelsDesc)
			.addText((tx) =>
				tx.setValue(s.models).onChange(async (v) => {
					s.models = v;
					await this.save();
				}),
			);
		this.toggle(containerEl, L.sStream, L.sStreamDesc, "stream");
		new Setting(containerEl)
			.setName(L.sMaxTokens)
			.setDesc(L.sMaxTokensDesc)
			.addText((tx) => {
				tx.inputEl.type = "number";
				tx.setValue(String(s.maxTokens)).onChange(async (v) => {
					s.maxTokens = Math.max(0, parseInt(v) || 0);
					await this.save(false);
				});
			});
		new Setting(containerEl)
			.setName(L.sSystemPrompt)
			.setDesc(L.sSystemPromptDesc)
			.addTextArea((ta) => {
				ta.inputEl.rows = 4;
				ta.inputEl.addClass("dsc-setting-textarea");
				ta.setValue(s.systemPrompt).onChange(async (v) => {
					s.systemPrompt = v;
					await this.save(false);
				});
			});
		new Setting(containerEl).setName(L.sSendKey).addDropdown((d) =>
			d
				.addOption("enter", L.sSendEnter)
				.addOption("mod-enter", L.sSendMod)
				.setValue(s.sendKey)
				.onChange(async (v) => {
					s.sendKey = v as DSSettings["sendKey"];
					await this.save();
				}),
		);
		new Setting(containerEl).setName(L.sLanguage).addDropdown((d) =>
			d
				.addOption("auto", L.sLangAuto)
				.addOption("zh", "中文")
				.addOption("en", "English")
				.setValue(s.language)
				.onChange(async (v) => {
					s.language = v as DSSettings["language"];
					setLanguage(s.language);
					await this.save();
					this.display();
				}),
		);

		// —— 功能开关 ——
		new Setting(containerEl).setName(L.sFeatures).setDesc(L.sFeaturesDesc).setHeading();

		this.toggle(containerEl, L.sThinking, L.sThinkingDesc, "thinkingDefault");
		new Setting(containerEl).setName(L.sEffort).addDropdown((d) =>
			d
				.addOption("low", "low")
				.addOption("high", "high")
				.addOption("max", "max")
				.setValue(s.thinkingEffort)
				.onChange(async (v) => {
					s.thinkingEffort = v as DSSettings["thinkingEffort"];
					await this.save();
				}),
		);

		this.toggle(containerEl, L.sWebEnabled, L.sWebEnabledDesc, "webSearchEnabled", true);
		if (s.webSearchEnabled) this.toggle(this.sub(containerEl), L.sWebDefault, "", "webSearchDefault");

		this.toggle(containerEl, L.sReadUrl, L.sReadUrlDesc, "readUrlEnabled");

		this.toggle(containerEl, L.sFiles, L.sFilesDesc, "fileInputEnabled", true);
		if (s.fileInputEnabled) {
			const sub = this.sub(containerEl);
			new Setting(sub).setName(L.sParseMode).addDropdown((d) =>
				d
					.addOption("text_recognition", L.sParseText)
					.addOption("rich_layout_recognition", L.sParseRich)
					.setValue(s.fileParseMode)
					.onChange(async (v) => {
						s.fileParseMode = v as DSSettings["fileParseMode"];
						await this.save(false);
					}),
			);
			this.toggle(sub, L.sVision, L.sVisionDesc, "visionEnabled");
		}

		this.toggle(containerEl, L.sSafety, L.sSafetyDesc, "safetyEnabled", true);
		if (s.safetyEnabled) {
			new Setting(this.sub(containerEl)).setName(L.sRefusalMsg).addText((tx) =>
				tx
					.setPlaceholder(L.refused)
					.setValue(s.refusalMessage)
					.onChange(async (v) => {
						s.refusalMessage = v;
						await this.save(false);
					}),
			);
		}

		this.toggle(containerEl, L.sReminder, L.sReminderDesc, "reminderEnabled", true);
		if (s.reminderEnabled) {
			const sub = this.sub(containerEl);
			new Setting(sub)
				.setName(L.sLocation)
				.setDesc(L.sLocationDesc)
				.addText((tx) =>
					tx.setValue(s.reminderLocation).onChange(async (v) => {
						s.reminderLocation = v;
						await this.save(false);
					}),
				);
			new Setting(sub).setName(L.sReminderLang).addDropdown((d) => {
				d.addOption("", L.sLangAuto);
				for (const name of Object.keys(REMINDER_LANGUAGES)) d.addOption(name, name);
				d.setValue(s.reminderLanguage).onChange(async (v) => {
					s.reminderLanguage = v;
					await this.save(false);
				});
			});
		}

		this.toggle(containerEl, L.sTitle, L.sTitleDesc, "titleEnabled");

		this.toggle(containerEl, L.sTts, L.sTtsDesc, "ttsEnabled", true);
		if (s.ttsEnabled) {
			const sub = this.sub(containerEl);
			new Setting(sub).setName(L.sVoice).addDropdown((d) =>
				d
					.addOption("stella", L.sVoiceStella)
					.addOption("tide", L.sVoiceTide)
					.setValue(s.ttsVoice)
					.onChange(async (v) => {
						s.ttsVoice = v as DSSettings["ttsVoice"];
						await this.save(false);
					}),
			);
			this.toggle(sub, L.sTtsStream, L.sTtsStreamDesc, "ttsStreaming");
			this.toggle(sub, L.sTtsAuto, "", "ttsAutoPlay");
		}

		this.toggle(containerEl, L.sAsr, L.sAsrDesc, "asrEnabled", true);
		if (s.asrEnabled) this.toggle(this.sub(containerEl), L.sAsrAutoSend, "", "asrAutoSend");

		this.toggle(containerEl, L.sContinue, "", "continueEnabled");

		// —— Obsidian 集成 ——
		new Setting(containerEl).setName(L.sObsidian).setHeading();
		this.toggle(containerEl, L.sActiveNote, L.sActiveNoteDesc, "activeNoteEnabled", true);
		if (s.activeNoteEnabled) this.toggle(this.sub(containerEl), L.sActiveNoteDefault, "", "activeNoteDefault");
		this.toggle(containerEl, L.sVaultTools, L.sVaultToolsDesc, "vaultToolsEnabled", true);
		if (s.vaultToolsEnabled) {
			const sub = this.sub(containerEl);
			this.toggle(sub, L.sVaultToolsDefault, "", "vaultToolsDefault");
			this.toggle(sub, L.sVaultWrite, L.sVaultWriteDesc, "vaultWriteEnabled", true);
			if (s.vaultWriteEnabled) {
				const wsub = this.sub(sub);
				this.toggle(wsub, L.sVaultWriteConfirm, L.sVaultWriteConfirmDesc, "vaultWriteConfirm");
				this.toggle(wsub, L.sVaultMove, L.sVaultMoveDesc, "vaultMoveEnabled");
				this.toggle(wsub, L.sVaultDelete, L.sVaultDeleteDesc, "vaultDeleteEnabled");
			}
		}
		this.toggle(containerEl, L.sEditorMenu, L.sEditorMenuDesc, "editorMenuEnabled");
		this.toggle(containerEl, L.sJson, L.sJsonDesc, "jsonExtractEnabled");

		// —— 用量与费用 ——
		new Setting(containerEl).setName(L.sUsage).setHeading();
		this.toggle(containerEl, L.sShowUsage, L.sShowUsageDesc, "usageEnabled");
		const pricing = new Setting(containerEl).setName(L.sPricing).setDesc(L.sPricingDesc);
		let area: HTMLTextAreaElement | null = null;
		pricing.addTextArea((ta) => {
			area = ta.inputEl;
			ta.inputEl.rows = 10;
			ta.inputEl.addClass("dsc-setting-textarea", "dsc-mono");
			ta.setValue(s.pricingJson).onChange(async (v) => {
				s.pricingJson = v;
				try {
					JSON.parse(v);
					ta.inputEl.removeClass("dsc-invalid");
				} catch {
					ta.inputEl.addClass("dsc-invalid");
				}
				await this.save();
			});
		});
		pricing.addButton((b) =>
			b.setButtonText(L.sPricingReset).onClick(async () => {
				s.pricingJson = JSON.stringify(DEFAULT_PRICING, null, 2);
				if (area) area.value = s.pricingJson;
				await this.save();
			}),
		);

		// —— 存储与导出 ——
		new Setting(containerEl).setName(L.sStorage).setHeading();
		new Setting(containerEl)
			.setName(L.sChatFolder)
			.setDesc(L.sChatFolderDesc)
			.addText((tx) =>
				tx.setValue(s.chatFolder).onChange(async (v) => {
					s.chatFolder = v.trim() || DEFAULT_SETTINGS.chatFolder;
					await this.save(false);
				}),
			);
		new Setting(containerEl).setName(L.sExportFolder).addText((tx) =>
			tx.setValue(s.exportFolder).onChange(async (v) => {
				s.exportFolder = v.trim() || DEFAULT_SETTINGS.exportFolder;
				await this.save(false);
			}),
		);
		this.toggle(containerEl, L.sExportThinking, "", "exportThinking");

		// —— 高级 ——
		new Setting(containerEl).setName(L.sAdvanced).setHeading();
		this.toggle(containerEl, L.sDev, L.sDevDesc, "devPanelEnabled");
	}
}

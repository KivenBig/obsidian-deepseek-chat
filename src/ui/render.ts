// 渲染一轮回答：思考过程、联网 / 工具过程卡、正文（带引用角标）。

import { App, Component, MarkdownRenderer, setIcon, TFile } from "obsidian";
import { blocksToMarkdown, type SourceCollector } from "../core/citations";
import type { Block, FetchResult, SearchResultItem } from "../core/types";
import { t } from "../i18n";

export interface RenderCtx {
	app: App;
	component: Component;
	sourcePath: string;
	sources: SourceCollector;
	results: Map<string, Block>; // tool_use_id → 结果块
	live: boolean; // 正在生成
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function link(parent: HTMLElement, url: string, text: string, cls = "dsc-link"): HTMLAnchorElement {
	const a = parent.createEl("a", { text, href: url, cls });
	a.setAttr("target", "_blank");
	a.setAttr("rel", "noopener");
	return a;
}

/** 文字是否指向库里的一篇笔记（路径、带 .md 的名字、[[双链]]） */
export function resolveNote(app: App, raw: string): TFile | null {
	let text = raw.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
	if (!text || text.length > 300) return null;
	const looksLikeNote = text.includes("/") || /\.(md|canvas|base|pdf)$/i.test(text) || raw.trim().startsWith("[[");
	if (!looksLikeNote) return null;
	for (const p of [text, `${text}.md`]) {
		const f = app.vault.getAbstractFileByPath(p);
		if (f instanceof TFile) return f;
	}
	return app.metadataCache.getFirstLinkpathDest(text.replace(/\.md$/i, ""), "");
}

/** 生成一个 Obsidian 内部链接（点击由视图统一处理） */
export function noteLink(parent: HTMLElement, file: TFile, text?: string): HTMLAnchorElement {
	const a = parent.createEl("a", { text: text ?? file.path, cls: "internal-link dsc-note-link", href: file.path });
	a.dataset.href = file.path;
	return a;
}

/** 正文里 `路径/笔记.md` 这种行内代码，换成可点击的笔记链接 */
function linkifyCodePaths(el: HTMLElement, app: App) {
	el.querySelectorAll("code").forEach((code) => {
		if (code.parentElement?.tagName === "PRE") return;
		const f = resolveNote(app, code.textContent ?? "");
		if (!f) return;
		const a = createEl("a", { cls: "internal-link dsc-note-link", href: f.path });
		a.dataset.href = f.path;
		code.replaceWith(a);
		a.appendChild(code);
	});
}

/** 工具结果：每行里的笔记路径可点击 */
function renderToolOutput(parent: HTMLElement, content: string, app: App) {
	const box = parent.createDiv({ cls: "dsc-tool-output" });
	for (const line of clipText(content, 4000).split("\n")) {
		const row = box.createDiv();
		const m = /^(-|📄|📁|path:)\s*(.+?)(\.md)?(\/)?(:\s.*)?$/u.exec(line);
		const f = m ? resolveNote(app, `${m[2]}${m[3] ?? ""}`) ?? resolveNote(app, `${m[2]}.md`) : null;
		if (m && f) {
			row.appendText(`${m[1]} `);
			noteLink(row, f);
			if (m[5]) row.createSpan({ text: m[5], cls: "dsc-muted" });
		} else row.setText(line);
	}
}

function clipText(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n)}…` : s;
}

function stepIcon(el: HTMLElement, icon: string) {
	setIcon(el.createSpan({ cls: "dsc-step-icon" }), icon);
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

/** 一个服务端或客户端工具步骤 */
function renderStep(card: HTMLElement, use: Block, ctx: RenderCtx) {
	const L = t();
	const result = use.id ? ctx.results.get(use.id) : undefined;
	const step = card.createDiv({ cls: "dsc-step" });
	const head = step.createDiv({ cls: "dsc-step-head" });
	const input = use.input ?? {};
	const action = str(input.action) || (use.kind === "read_link" ? "read_link" : "search");
	const pending = !result && ctx.live;

	if (use.type === "tool_use") {
		const iconMap: Record<string, string> = {
			create_note: "file-plus",
			append_note: "file-pen",
			edit_note: "file-pen",
			update_note: "file-pen",
			rename_note: "folder-input",
			delete_note: "trash-2",
		};
		stepIcon(head, iconMap[use.name ?? ""] ?? "wrench");
		head.createSpan({ text: `${L.toolCall} · ${use.name ?? ""}`, cls: "dsc-step-label" });
		const path = str(input.new_path) || str(input.path);
		const target = path ? (resolveNote(ctx.app, path) ?? resolveNote(ctx.app, `${path}.md`)) : null;
		if (target) noteLink(head, target);
		else if (path) head.createSpan({ text: path, cls: "dsc-step-arg" });
		else {
			const args = JSON.stringify(input);
			if (args && args !== "{}") head.createSpan({ text: clipText(args, 80), cls: "dsc-step-arg" });
		}
		if (result) {
			head.createSpan({ text: result.is_error ? "✗" : "✓", cls: result.is_error ? "dsc-err" : "dsc-ok" });
			const content = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
			const det = step.createEl("details", { cls: "dsc-step-detail" });
			det.createEl("summary", { text: `${L.toolResult}${result.is_error ? ` · ${L.failed}` : ""}` });
			if (use.name === "read_note" || use.name === "get_current_note") det.createEl("pre", { text: clipText(content, 2000) });
			else renderToolOutput(det, content, ctx.app);
		}
	} else if (action === "read_link" || action === "open_page") {
		stepIcon(head, action === "read_link" ? "link" : "file-text");
		head.createSpan({ text: action === "read_link" ? L.readPage : L.openPage, cls: "dsc-step-label" });
		const url = str(input.url);
		const c = result?.content as FetchResult | undefined;
		if (c?.type === "web_fetch_result") {
			const target = c.url || url;
			link(head, target, c.content?.title || hostOf(target));
			head.createSpan({ text: "✓", cls: "dsc-ok" });
		} else if (c?.type === "web_fetch_tool_result_error") {
			if (url) link(head, url, hostOf(url));
			head.createSpan({ text: `✗ ${c.error_code ?? L.failed}`, cls: "dsc-err" });
		} else if (url) {
			link(head, url, hostOf(url));
		}
	} else if (action === "find_in_page") {
		stepIcon(head, "text-search");
		head.createSpan({ text: L.findInPage, cls: "dsc-step-label" });
		const pattern = str(input.pattern);
		if (pattern) head.createSpan({ text: `“${pattern}”`, cls: "dsc-step-arg" });
	} else {
		const isImage = (use.kind ?? "").includes("image");
		stepIcon(head, isImage ? "image" : "search");
		head.createSpan({ text: isImage ? L.imageSearch : L.searching, cls: "dsc-step-label" });
		const queries = Array.isArray(input.queries) ? input.queries.map(str).filter(Boolean) : str(input.query) ? [str(input.query)] : [];
		if (queries.length) head.createSpan({ text: queries.join(" · "), cls: "dsc-step-arg" });
		const items = Array.isArray(result?.content) ? (result.content as SearchResultItem[]) : [];
		const ok = items.filter((i) => i.type === "web_search_result" && i.url);
		const err = items.find((i) => i.type === "web_search_tool_result_error");
		if (err) head.createSpan({ text: `✗ ${err.error_code ?? L.failed}`, cls: "dsc-err" });
		if (ok.length) {
			const det = step.createEl("details", { cls: "dsc-step-detail" });
			det.createEl("summary", { text: `${ok.length} ${L.searchResults}` });
			const list = det.createDiv({ cls: "dsc-results" });
			for (const r of ok) {
				const url = r.url ?? "";
				const row = list.createDiv({ cls: "dsc-result" });
				const top = row.createDiv({ cls: "dsc-result-top" });
				if (r.site_icon) {
					const img = top.createEl("img", { cls: "dsc-favicon" });
					img.src = r.site_icon;
					img.onerror = () => img.remove();
				}
				link(top, url, r.title || url, "dsc-result-title");
				const meta = [r.site_name || hostOf(url), r.page_age].filter(Boolean).join(" · ");
				if (meta) row.createDiv({ text: meta, cls: "dsc-muted dsc-small" });
				if (r.snippet) row.createDiv({ text: clipText(r.snippet, 200), cls: "dsc-result-snippet" });
				if (r.image_url) {
					const img = row.createEl("img", { cls: "dsc-result-image" });
					img.src = r.image_url;
					img.onerror = () => img.remove();
				}
			}
		}
	}
	if (pending) head.createSpan({ cls: "dsc-spinner" });
}

/** 渲染一条 assistant 消息的 content 块，按顺序 */
export async function renderAssistantBlocks(container: HTMLElement, blocks: Block[], ctx: RenderCtx) {
	const L = t();
	let textRun: Block[] = [];
	let card: HTMLElement | null = null;

	const flushText = async () => {
		if (!textRun.length) return;
		const md = blocksToMarkdown(textRun, ctx.sources);
		textRun = [];
		if (!md.trim()) return;
		const el = container.createDiv({ cls: "dsc-md markdown-rendered" });
		await MarkdownRenderer.render(ctx.app, md, el, ctx.sourcePath, ctx.component);
		linkifyCodePaths(el, ctx.app);
	};

	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		if (!b) continue;
		if (b.type === "text") {
			card = null;
			textRun.push(b);
			continue;
		}
		await flushText();
		if (b.type === "thinking") {
			card = null;
			if (!b.thinking) continue;
			const isLast = i === blocks.length - 1;
			const det = container.createEl("details", { cls: "dsc-thinking" });
			const sum = det.createEl("summary");
			setIcon(sum.createSpan({ cls: "dsc-step-icon" }), "brain");
			sum.createSpan({ text: ctx.live && isLast ? L.thinkingNow : L.thinkingProcess });
			det.createDiv({ text: b.thinking, cls: "dsc-thinking-body" });
			if (ctx.live && isLast) det.open = true;
		} else if (b.type === "server_tool_use" || b.type === "tool_use") {
			if (!card) card = container.createDiv({ cls: "dsc-process" });
			renderStep(card, b, ctx);
		}
		// 结果块由对应的步骤渲染
	}
	await flushText();
}

// 给模型的只读笔记工具（客户端工具调用）。不写入、不删除任何文件。

import { App, MarkdownView, normalizePath, TFile, TFolder } from "obsidian";
import { t } from "./i18n";

const MAX_CHARS = 20_000;

export const VAULT_TOOLS = [
	{
		name: "get_current_note",
		description: "Read the note the user currently has open in Obsidian. Returns its path and Markdown content.",
		input_schema: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: "search_notes",
		description:
			"Search the user's Obsidian vault (file names and note content). Separate keywords with spaces, e.g. \"笔记 思考\"; notes containing more of the keywords rank higher, name matches rank highest. Returns up to `limit` note paths with a snippet. If nothing is found, try shorter or different keywords.",
		input_schema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Space-separated keywords" },
				limit: { type: "integer", description: "Max results, default 10" },
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
	{
		name: "read_note",
		description: "Read a note in the vault by its path (as returned by search_notes or list_folder).",
		input_schema: {
			type: "object",
			properties: { path: { type: "string", description: "Vault-relative path, e.g. Folder/Note.md" } },
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "list_folder",
		description: "List files and sub-folders in a vault folder. Use an empty string for the vault root.",
		input_schema: {
			type: "object",
			properties: { path: { type: "string", description: "Vault-relative folder path" } },
			required: ["path"],
			additionalProperties: false,
		},
	},
];

/** 告诉模型它可以查笔记，别把搜索推回给用户 */
export const VAULT_SYSTEM =
	"You are running inside the user's Obsidian vault and have read-only tools to search and read their notes. When the user asks about their notes, ideas or past writing, look them up with search_notes / read_note / list_folder / get_current_note yourself instead of asking the user to search. If a search finds nothing, retry with shorter or different keywords (separate keywords with spaces). Cite note paths you used, as [[note name]] wikilinks.";

export function splitTerms(query: string): string[] {
	return [...new Set(query.toLowerCase().split(/[\s,，、;；|]+/).map((t) => t.trim()).filter(Boolean))];
}

function clip(s: string): string {
	return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n…[truncated, ${s.length} chars total]` : s;
}

export function activeMarkdownFile(app: App): TFile | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (view?.file) return view.file;
	// 侧栏获得焦点时，取最近一个 Markdown 标签页
	let found: TFile | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		if (!found && leaf.view instanceof MarkdownView && leaf.view.file) found = leaf.view.file;
	});
	const recent = app.workspace.getLastOpenFiles?.()[0];
	if (!found && recent) {
		const f = app.vault.getAbstractFileByPath(recent);
		if (f instanceof TFile && f.extension === "md") found = f;
	}
	return found;
}

export async function runVaultTool(app: App, name: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
	const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
	try {
		switch (name) {
			case "get_current_note": {
				const f = activeMarkdownFile(app);
				if (!f) return { text: t().noActiveNote, isError: true };
				return { text: `path: ${f.path}\n\n${clip(await app.vault.cachedRead(f))}`, isError: false };
			}
			case "search_notes": {
				const terms = splitTerms(str(input.query));
				const limit = Math.min(30, Math.max(1, Number(input.limit) || 10));
				if (!terms.length) return { text: "Empty query", isError: true };
				const hits: { path: string; score: number; all: boolean; mtime: number; snippet: string }[] = [];
				for (const f of app.vault.getMarkdownFiles()) {
					const name = f.path.toLowerCase();
					const text = await app.vault.cachedRead(f);
					const lower = text.toLowerCase();
					let score = 0;
					let matched = 0;
					let firstAt = -1;
					for (const term of terms) {
						const inName = name.includes(term);
						const at = lower.indexOf(term);
						if (inName || at >= 0) matched++;
						if (inName) score += 3;
						if (at >= 0) {
							score += 1;
							if (firstAt < 0) firstAt = at;
						}
					}
					if (!matched) continue;
					// 摘要优先取正文里的命中位置，跳过 frontmatter
					const fm = /^---\n[\s\S]*?\n---\n?/.exec(text);
					const bodyStart = fm ? fm[0].length : 0;
					let at = -1;
					for (const term of terms) {
						const i = lower.indexOf(term, bodyStart);
						if (i >= 0 && (at < 0 || i < at)) at = i;
					}
					if (at < 0) at = firstAt;
					const snippet = at >= 0 ? text.slice(Math.max(bodyStart, at - 50), at + 80).replace(/\s+/g, " ") : "";
					hits.push({ path: f.path, score, all: matched === terms.length, mtime: f.stat.mtime, snippet });
				}
				hits.sort((a, b) => Number(b.all) - Number(a.all) || b.score - a.score || b.mtime - a.mtime);
				const top = hits.slice(0, limit);
				if (!top.length) return { text: "No matches. Try shorter or different keywords.", isError: false };
				const lines = top.map((h) => `- ${h.path}${h.snippet ? `: …${h.snippet}…` : ""}`);
				return { text: `${hits.length} notes matched; top ${top.length}:\n${lines.join("\n")}`, isError: false };
			}
			case "read_note": {
				const path = normalizePath(str(input.path));
				let f = app.vault.getAbstractFileByPath(path);
				if (!f && !path.endsWith(".md")) f = app.vault.getAbstractFileByPath(`${path}.md`);
				if (!(f instanceof TFile)) return { text: `${t().noteNotFound}: ${path}`, isError: true };
				return { text: clip(await app.vault.cachedRead(f)), isError: false };
			}
			case "list_folder": {
				const raw = str(input.path).trim();
				const folder = raw ? app.vault.getAbstractFileByPath(normalizePath(raw)) : app.vault.getRoot();
				if (!(folder instanceof TFolder)) return { text: `Folder not found: ${raw}`, isError: true };
				const lines = folder.children
					.slice(0, 200)
					.map((c) => (c instanceof TFolder ? `📁 ${c.path}/` : `📄 ${c.path}`));
				return { text: lines.join("\n") || "(empty)", isError: false };
			}
			default:
				return { text: `${t().toolNotFound}: ${name}`, isError: true };
		}
	} catch (e) {
		return { text: (e as Error).message, isError: true };
	}
}

// 给模型的笔记库工具（客户端工具调用）：默认只读，可在设置中按需开启写入、移动、删除权限。

import { App, MarkdownView, normalizePath, TFile, TFolder } from "obsidian";
import {
	applyAppend,
	applyEdit,
	buildVaultSystem,
	getVaultTools,
	isWriteTool,
	validateNotePath,
	type VaultToolPermissions,
} from "./core/vault-tools";
import { t } from "./i18n";
import type { WriteConfirmRequest } from "./ui/modals";

export { buildVaultSystem, getVaultTools, isWriteTool, type VaultToolPermissions };

const MAX_CHARS = 20_000;

export interface VaultToolContext {
	perms: VaultToolPermissions;
	confirmWrite?: (req: WriteConfirmRequest) => Promise<boolean>;
}

export function splitTerms(query: string): string[] {
	return [...new Set(query.toLowerCase().split(/[\s,，、;；|]+/).map((x) => x.trim()).filter(Boolean))];
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

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
	const idx = filePath.lastIndexOf("/");
	if (idx <= 0) return;
	const parts = filePath.slice(0, idx).split("/").filter(Boolean);
	let cur = "";
	for (const part of parts) {
		cur = cur ? `${cur}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(cur);
		if (!existing) await app.vault.createFolder(cur);
		else if (!(existing instanceof TFolder)) throw new Error(`Parent path is not a folder: ${cur}`);
	}
}

function findExistingNote(app: App, rawPath: string): { file: TFile | null; path: string; error?: string } {
	const v = validateNotePath(rawPath);
	if (!v.ok) return { file: null, path: rawPath, error: v.error };
	const normalized = normalizePath(v.path);
	let f = app.vault.getAbstractFileByPath(normalized);
	if (!f) {
		const rawNorm = normalizePath(rawPath.trim());
		if (rawNorm && rawNorm !== normalized) f = app.vault.getAbstractFileByPath(rawNorm);
	}
	return { file: f instanceof TFile ? f : null, path: normalized };
}

export async function runVaultTool(
	app: App,
	name: string,
	input: Record<string, unknown>,
	ctx: VaultToolContext = { perms: { write: false, move: false, remove: false } },
): Promise<{ text: string; isError: boolean }> {
	const L = t();
	const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
	const confirm = async (req: WriteConfirmRequest): Promise<boolean> => {
		if (!ctx.confirmWrite) return true;
		return ctx.confirmWrite(req);
	};

	try {
		switch (name) {
			case "get_current_note": {
				const f = activeMarkdownFile(app);
				if (!f) return { text: L.noActiveNote, isError: true };
				return { text: `path: ${f.path}\n\n${clip(await app.vault.cachedRead(f))}`, isError: false };
			}
			case "search_notes": {
				const terms = splitTerms(str(input.query));
				const limit = Math.min(30, Math.max(1, Number(input.limit) || 10));
				if (!terms.length) return { text: "Empty query", isError: true };
				const hits: { path: string; score: number; all: boolean; mtime: number; snippet: string }[] = [];
				for (const f of app.vault.getMarkdownFiles()) {
					const fname = f.path.toLowerCase();
					const text = await app.vault.cachedRead(f);
					const lower = text.toLowerCase();
					let score = 0;
					let matched = 0;
					let firstAt = -1;
					for (const term of terms) {
						const inName = fname.includes(term);
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
				if (!(f instanceof TFile)) return { text: `${L.noteNotFound}: ${path}`, isError: true };
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

			// ———————————————————— 写入与笔记处理工具 ————————————————————

			case "create_note": {
				if (!ctx.perms.write) return { text: "Write permission is disabled in plugin settings.", isError: true };
				const v = validateNotePath(str(input.path));
				if (!v.ok) return { text: v.error, isError: true };
				const path = normalizePath(v.path);
				const content = str(input.content);
				const overwrite = Boolean(input.overwrite);
				const existing = app.vault.getAbstractFileByPath(path);
				if (existing instanceof TFolder) return { text: `A folder already exists at: ${path}`, isError: true };
				if (existing instanceof TFile && !overwrite) {
					return {
						text: `Note already exists: ${path}. Use edit_note / append_note, or pass overwrite: true to replace it.`,
						isError: true,
					};
				}
				const ok = await confirm({
					tool: name,
					actionLabel: existing ? L.opOverwriteNote : L.opCreateNote,
					path,
					content,
				});
				if (!ok) return { text: L.writeDenied, isError: true };
				if (existing instanceof TFile) {
					await app.vault.process(existing, () => content);
					return { text: `path: ${existing.path}\nOverwritten (${content.length} chars).`, isError: false };
				}
				await ensureParentFolder(app, path);
				const created = await app.vault.create(path, content);
				return { text: `path: ${created.path}\nCreated (${content.length} chars).`, isError: false };
			}

			case "append_note": {
				if (!ctx.perms.write) return { text: "Write permission is disabled in plugin settings.", isError: true };
				const found = findExistingNote(app, str(input.path));
				if (found.error) return { text: found.error, isError: true };
				if (!found.file) return { text: `${L.noteNotFound}: ${found.path}`, isError: true };
				const addition = str(input.content);
				if (!addition) return { text: "content cannot be empty", isError: true };
				const position = input.position === "start" ? "start" : "end";
				const ok = await confirm({
					tool: name,
					actionLabel: L.opAppendNote,
					path: found.file.path,
					content: addition,
				});
				if (!ok) return { text: L.writeDenied, isError: true };
				await app.vault.process(found.file, (data) => applyAppend(data, addition, position));
				return { text: `path: ${found.file.path}\nAppended (${addition.length} chars at ${position}).`, isError: false };
			}

			case "edit_note": {
				if (!ctx.perms.write) return { text: "Write permission is disabled in plugin settings.", isError: true };
				const found = findExistingNote(app, str(input.path));
				if (found.error) return { text: found.error, isError: true };
				if (!found.file) return { text: `${L.noteNotFound}: ${found.path}`, isError: true };
				const oldText = str(input.old_text);
				const newText = str(input.new_text);
				const replaceAll = Boolean(input.replace_all);
				const current = await app.vault.read(found.file);
				const check = applyEdit(current, oldText, newText, replaceAll);
				if (!check.ok) return { text: check.error, isError: true };
				const ok = await confirm({
					tool: name,
					actionLabel: L.opEditNote,
					path: found.file.path,
					before: oldText,
					after: newText,
				});
				if (!ok) return { text: L.writeDenied, isError: true };
				let editErr: string | null = null;
				let replacedCount = 0;
				await app.vault.process(found.file, (data) => {
					const res = applyEdit(data, oldText, newText, replaceAll);
					if (!res.ok) {
						editErr = res.error;
						return data;
					}
					replacedCount = res.count;
					return res.content;
				});
				if (editErr) return { text: editErr, isError: true };
				return { text: `path: ${found.file.path}\nReplaced ${replacedCount} occurrence(s).`, isError: false };
			}

			case "update_note": {
				if (!ctx.perms.write) return { text: "Write permission is disabled in plugin settings.", isError: true };
				const found = findExistingNote(app, str(input.path));
				if (found.error) return { text: found.error, isError: true };
				if (!found.file) return { text: `${L.noteNotFound}: ${found.path}`, isError: true };
				const content = str(input.content);
				const ok = await confirm({
					tool: name,
					actionLabel: L.opUpdateNote,
					path: found.file.path,
					content,
				});
				if (!ok) return { text: L.writeDenied, isError: true };
				await app.vault.process(found.file, () => content);
				return { text: `path: ${found.file.path}\nUpdated (${content.length} chars).`, isError: false };
			}

			case "rename_note": {
				if (!ctx.perms.write || !ctx.perms.move) {
					return { text: "Move/rename permission is disabled in plugin settings.", isError: true };
				}
				const found = findExistingNote(app, str(input.path));
				if (found.error) return { text: found.error, isError: true };
				if (!found.file) return { text: `${L.noteNotFound}: ${found.path}`, isError: true };
				const dst = validateNotePath(str(input.new_path));
				if (!dst.ok) return { text: dst.error, isError: true };
				const newPath = normalizePath(dst.path);
				if (newPath === found.file.path) return { text: `path: ${newPath}\nPath unchanged.`, isError: false };
				if (app.vault.getAbstractFileByPath(newPath)) {
					return { text: `Destination already exists: ${newPath}`, isError: true };
				}
				const ok = await confirm({
					tool: name,
					actionLabel: L.opRenameNote,
					path: found.file.path,
					newPath,
				});
				if (!ok) return { text: L.writeDenied, isError: true };
				await ensureParentFolder(app, newPath);
				await app.fileManager.renameFile(found.file, newPath);
				return { text: `path: ${newPath}\nMoved from ${found.path} to ${newPath}.`, isError: false };
			}

			case "delete_note": {
				if (!ctx.perms.write || !ctx.perms.remove) {
					return { text: "Delete permission is disabled in plugin settings.", isError: true };
				}
				const found = findExistingNote(app, str(input.path));
				if (found.error) return { text: found.error, isError: true };
				if (!found.file) return { text: `${L.noteNotFound}: ${found.path}`, isError: true };
				const ok = await confirm({
					tool: name,
					actionLabel: L.opDeleteNote,
					path: found.file.path,
					isDelete: true,
				});
				if (!ok) return { text: L.writeDenied, isError: true };
				const deletedPath = found.file.path;
				await app.fileManager.trashFile(found.file);
				return { text: `Moved to trash: ${deletedPath}`, isError: false };
			}

			default:
				return { text: `${L.toolNotFound}: ${name}`, isError: true };
		}
	} catch (e) {
		return { text: (e as Error).message, isError: true };
	}
}

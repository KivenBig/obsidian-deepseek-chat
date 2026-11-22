// 笔记库工具的定义、权限裁剪、系统提示词和纯文本/路径校验逻辑（无 Obsidian 依赖，方便单测）。

import type { ToolDefinition } from "./types";

export interface VaultToolPermissions {
	write: boolean;
	move: boolean;
	remove: boolean;
}

export const READ_TOOLS: ToolDefinition[] = [
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

export const WRITE_TOOLS: ToolDefinition[] = [
	{
		name: "create_note",
		description:
			"Create a new Markdown note in the user's Obsidian vault. Parent folders are created automatically. Fails if the file already exists unless `overwrite` is true.",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative note path, e.g. Folder/My Note.md (.md is added automatically if omitted)" },
				content: { type: "string", description: "Full Markdown content of the new note" },
				overwrite: { type: "boolean", description: "Overwrite if the note already exists (default false)" },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
	},
	{
		name: "append_note",
		description:
			"Append content to the end of an existing note, or prepend it right after YAML frontmatter when position is \"start\".",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative path of the existing note" },
				content: { type: "string", description: "Markdown text to insert" },
				position: { type: "string", enum: ["end", "start"], description: "Where to insert: \"end\" (default) or \"start\"" },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
	},
	{
		name: "edit_note",
		description:
			"Make a targeted replacement inside an existing note. Prefer this over update_note for partial edits. Read the note first so `old_text` matches verbatim.",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative path of the existing note" },
				old_text: { type: "string", description: "Exact existing text to replace" },
				new_text: { type: "string", description: "Replacement text" },
				replace_all: { type: "boolean", description: "Replace all occurrences (default false; fails if multiple matches exist)" },
			},
			required: ["path", "old_text", "new_text"],
			additionalProperties: false,
		},
	},
	{
		name: "update_note",
		description: "Replace the entire content of an existing note. Prefer edit_note or append_note unless rewriting most of the note.",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative path of the existing note" },
				content: { type: "string", description: "Complete new Markdown content" },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
	},
];

export const MOVE_TOOL: ToolDefinition = {
	name: "rename_note",
	description: "Rename or move an existing note to a new vault-relative path. Automatically updates internal wikilinks across the vault.",
	input_schema: {
		type: "object",
		properties: {
			path: { type: "string", description: "Current vault-relative path of the note" },
			new_path: { type: "string", description: "Destination vault-relative path (parent folders are created automatically)" },
		},
		required: ["path", "new_path"],
		additionalProperties: false,
	},
};

export const DELETE_TOOL: ToolDefinition = {
	name: "delete_note",
	description: "Move an existing note to the trash. Always requires explicit user confirmation.",
	input_schema: {
		type: "object",
		properties: {
			path: { type: "string", description: "Vault-relative path of the note to move to trash" },
		},
		required: ["path"],
		additionalProperties: false,
	},
};

export const WRITE_TOOL_NAMES = new Set(["create_note", "append_note", "edit_note", "update_note", "rename_note", "delete_note"]);

export function isWriteTool(name: string): boolean {
	return WRITE_TOOL_NAMES.has(name);
}

export function getVaultTools(perms: VaultToolPermissions): ToolDefinition[] {
	const tools: ToolDefinition[] = READ_TOOLS.map((x) => ({ ...x }));
	if (perms.write) {
		tools.push(...WRITE_TOOLS.map((x) => ({ ...x })));
		if (perms.move) tools.push({ ...MOVE_TOOL });
		if (perms.remove) tools.push({ ...DELETE_TOOL });
	}
	return tools;
}

export function buildVaultSystem(perms: VaultToolPermissions): string {
	if (!perms.write) {
		return "You are running inside the user's Obsidian vault and have read-only tools to search and read their notes. When the user asks about their notes, ideas or past writing, look them up with search_notes / read_note / list_folder / get_current_note yourself instead of asking the user to search. If a search finds nothing, retry with shorter or different keywords (separate keywords with spaces). Cite note paths you used, as [[note name]] wikilinks.";
	}
	const writeNames = ["create_note", "append_note", "edit_note", "update_note"];
	if (perms.move) writeNames.push("rename_note");
	if (perms.remove) writeNames.push("delete_note");
	return [
		`You are running inside the user's Obsidian vault and have both read tools (search_notes / read_note / list_folder / get_current_note) and write tools (${writeNames.join(" / ")}).`,
		"When the user asks about their notes, look them up yourself instead of asking the user to search. If a search finds nothing, retry with shorter or different keywords (separate keywords with spaces).",
		"When the user asks to create, append, edit, or organize notes, use the write tools directly instead of telling them to copy-paste.",
		"Before modifying an existing note, read it with read_note first. Prefer edit_note for targeted changes and append_note for adding content; use update_note only for full rewrites.",
		"If the user declines a write confirmation, respect their choice and do not retry the same write automatically. Cite created or modified notes as [[note name]] wikilinks.",
	].join(" ");
}

/** 校验并规范化笔记路径：禁止路径穿越、隐藏目录（如 .obsidian）和非法字符 */
export function validateNotePath(rawPath: string): { ok: true; path: string } | { ok: false; error: string } {
	const cleaned = rawPath.trim().replace(/\\/g, "/");
	if (!cleaned) return { ok: false, error: "Empty path" };
	if (cleaned.startsWith("/")) return { ok: false, error: "Path must be vault-relative (cannot start with /)" };
	const parts = cleaned.split("/").filter((p) => p.length > 0);
	if (!parts.length) return { ok: false, error: "Empty path" };
	for (const part of parts) {
		if (part === "." || part === "..") return { ok: false, error: "Path traversal (.. / .) is not allowed" };
		if (part.startsWith(".")) return { ok: false, error: `Hidden files or folders (${part}) are protected` };
		if (/[<>:"|?*\0]/.test(part)) return { ok: false, error: `Invalid characters in path segment: ${part}` };
	}
	const last = parts[parts.length - 1];
	if (!/\.[a-zA-Z0-9]+$/.test(last)) parts[parts.length - 1] = `${last}.md`;
	return { ok: true, path: parts.join("/") };
}

/** 向笔记末尾追加，或在 frontmatter 之后的开头插入 */
export function applyAppend(existing: string, addition: string, position: "start" | "end"): string {
	if (!addition) return existing;
	if (position === "start") {
		const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(existing);
		if (fm) {
			const head = fm[0].endsWith("\n") ? fm[0] : `${fm[0]}\n`;
			const rest = existing.slice(fm[0].length);
			const sep = addition.endsWith("\n") ? "" : "\n";
			const restSep = rest && !rest.startsWith("\n") ? "\n" : "";
			return `${head}\n${addition}${sep}${restSep}${rest}`;
		}
		if (!existing) return addition;
		const sep = addition.endsWith("\n") ? "" : "\n";
		return `${addition}${sep}\n${existing}`;
	}
	if (!existing) return addition;
	const tail = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
	return `${existing}${tail}${addition}`;
}

/** 精准局部替换 */
export function applyEdit(
	existing: string,
	oldText: string,
	newText: string,
	replaceAll: boolean,
): { ok: true; content: string; count: number } | { ok: false; error: string } {
	if (!oldText) return { ok: false, error: "old_text cannot be empty" };
	const parts = existing.split(oldText);
	const count = parts.length - 1;
	if (count === 0) {
		return { ok: false, error: "old_text not found in note. Call read_note first and provide the exact text." };
	}
	if (count > 1 && !replaceAll) {
		return {
			ok: false,
			error: `old_text matched ${count} places. Provide more surrounding context for a unique match, or set replace_all: true.`,
		};
	}
	if (replaceAll) return { ok: true, content: parts.join(newText), count };
	const idx = existing.indexOf(oldText);
	return { ok: true, content: existing.slice(0, idx) + newText + existing.slice(idx + oldText.length), count: 1 };
}

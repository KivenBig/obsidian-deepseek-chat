// 会话历史 → 下一次请求的 messages；以及把消息按「一问一答」分组给界面用。

import type { ApiMessage, Block, StoredMessage } from "./types";

/** 去掉不该发回的东西：被排除的消息、meta、空文本块 */
export function buildRequestMessages(messages: StoredMessage[]): ApiMessage[] {
	const out: ApiMessage[] = [];
	for (const m of messages) {
		if (m.meta?.excluded) continue;
		let content = m.content;
		if (Array.isArray(content)) {
			const cleaned = content.filter((b) => !(b.type === "text" && !b.text));
			content = cleaned.length ? cleaned : content;
		}
		out.push({ role: m.role, content });
	}
	return out;
}

export function textOf(content: string | Block[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("");
}

export function hasFileBlocks(messages: ApiMessage[]): boolean {
	return messages.some(
		(m) => Array.isArray(m.content) && m.content.some((b) => (b.type === "document" || b.type === "image") && b.source?.type === "file"),
	);
}

/** 这一轮回答里用过联网工具（不能续写） */
export function usedWebTools(content: Block[]): boolean {
	return content.some((b) => b.type === "server_tool_use" || b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result");
}

export interface Turn {
	reminderIndex?: number;
	userIndex: number;
	/** assistant 消息与 tool_result 消息的下标（按顺序） */
	replyIndexes: number[];
}

/** 按用户提问分组：reminder → user → (assistant | tool_result user)* */
export function groupTurns(messages: StoredMessage[]): Turn[] {
	const turns: Turn[] = [];
	let pendingReminder: number | undefined;
	messages.forEach((m, i) => {
		if (m.role === "latest_reminder") {
			pendingReminder = i;
			return;
		}
		if (m.role === "user" && !m.meta?.toolResults) {
			turns.push({ reminderIndex: pendingReminder, userIndex: i, replyIndexes: [] });
			pendingReminder = undefined;
			return;
		}
		const last = turns[turns.length - 1];
		if (last) last.replyIndexes.push(i);
	});
	return turns;
}

/** 一轮里所有下标（含 reminder） */
export function turnIndexes(t: Turn): number[] {
	const idx = [t.userIndex, ...t.replyIndexes];
	if (t.reminderIndex !== undefined) idx.unshift(t.reminderIndex);
	return idx;
}

/** tool_use_id → tool_result 内容 */
export function toolResultMap(messages: StoredMessage[]): Map<string, Block> {
	const map = new Map<string, Block>();
	for (const m of messages) {
		if (!Array.isArray(m.content)) continue;
		for (const b of m.content) {
			if (b.type === "tool_result" || b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result") {
				if (b.tool_use_id) map.set(b.tool_use_id, b);
			}
		}
	}
	return map;
}

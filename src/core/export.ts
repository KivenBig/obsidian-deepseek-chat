// 会话 → 可读 Markdown 笔记。

import { blocksToMarkdown, SourceCollector, sourcesToMarkdown } from "./citations";
import { groupTurns, textOf } from "./history";
import type { Block, Session } from "./types";

export interface ExportLabels {
	user: string;
	assistant: string;
	thinking: string;
	sources: string;
	attachments: string;
	refused: string;
}

function quoteCallout(kind: string, title: string, body: string): string {
	const lines = body.trim().split("\n").map((l) => `> ${l}`);
	return `> [!${kind}]- ${title}\n${lines.join("\n")}`;
}

function yamlString(s: string): string {
	return JSON.stringify(s);
}

export function sessionToMarkdown(session: Session, labels: ExportLabels, includeThinking: boolean): string {
	const parts: string[] = [];
	const created = new Date(session.createdAt);
	parts.push(
		[
			"---",
			`title: ${yamlString(session.title)}`,
			`model: ${session.model}`,
			`created: ${created.toISOString()}`,
			"source: deepseek-chat",
			"---",
			"",
			`# ${session.title}`,
		].join("\n"),
	);

	const sources = new SourceCollector();
	for (const turn of groupTurns(session.messages)) {
		const user = session.messages[turn.userIndex];
		let userMd = `## ${labels.user}\n\n${textOf(user.content).trim()}`;
		const atts = user.meta?.attachments ?? [];
		if (atts.length) userMd += `\n\n*${labels.attachments}: ${atts.map((a) => a.name).join("、")}*`;
		parts.push(userMd);

		const thinking: string[] = [];
		const blocks: Block[] = [];
		let refused = false;
		for (const i of turn.replyIndexes) {
			const m = session.messages[i];
			if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
			if (m.meta?.refused) refused = true;
			for (const b of m.content) {
				if (b.type === "thinking" && b.thinking) thinking.push(b.thinking);
				if (b.type === "text") blocks.push(b);
			}
		}
		let replyMd = `## ${labels.assistant}\n\n`;
		if (includeThinking && thinking.length) replyMd += quoteCallout("note", labels.thinking, thinking.join("\n\n")) + "\n\n";
		replyMd += refused ? `*${labels.refused}*` : blocksToMarkdown(blocks, sources).trim();
		parts.push(replyMd);
	}
	if (sources.list.length) parts.push(`## ${labels.sources}\n\n${sourcesToMarkdown(sources.list)}`);
	return parts.join("\n\n") + "\n";
}

export function safeFileName(name: string): string {
	return (
		name
			.replace(/[\\/:*?"<>|#^[\]]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 80) || "DeepSeek Chat"
	);
}

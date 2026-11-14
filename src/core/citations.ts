// 把 text 块 + citations 拼成带角标的 Markdown，同时收集来源列表。

import type { Block, Citation } from "./types";

export interface Source {
	n: number;
	url: string;
	title: string;
}

export class SourceCollector {
	private byUrl = new Map<string, Source>();
	list: Source[] = [];

	add(url: string, title?: string): Source {
		let s = this.byUrl.get(url);
		if (!s) {
			s = { n: this.list.length + 1, url, title: title || url };
			this.byUrl.set(url, s);
			this.list.push(s);
		}
		return s;
	}
}

function escapeLinkText(s: string): string {
	return s.replace(/[[\]]/g, (c) => `\\${c}`);
}

/** 一组 content 块里所有 text 块拼成 Markdown；引用在对应文字后加 [n] 链接 */
export function blocksToMarkdown(blocks: Block[], sources: SourceCollector): string {
	let md = "";
	for (const b of blocks) {
		if (b.type !== "text") continue;
		md += b.text ?? "";
		const cites: Citation[] = b.citations ?? [];
		const seen = new Set<number>();
		for (const c of cites) {
			if (!c?.url) continue;
			const s = sources.add(c.url, c.title);
			if (seen.has(s.n)) continue;
			seen.add(s.n);
			md += ` [\\[${s.n}\\]](${encodeURI(decodeURISafe(c.url))})`;
		}
	}
	return md;
}

function decodeURISafe(u: string): string {
	try {
		return decodeURI(u);
	} catch {
		return u;
	}
}

export function sourcesToMarkdown(sources: Source[]): string {
	return sources.map((s) => `${s.n}. [${escapeLinkText(s.title)}](${encodeURI(decodeURISafe(s.url))})`).join("\n");
}

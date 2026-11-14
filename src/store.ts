// 会话持久化：每个会话一个 JSON 文件，放在用户设置的文件夹里。

import { App, normalizePath, TFile } from "obsidian";
import type { ChatOptions, Session } from "./core/types";

export interface SessionInfo {
	path: string;
	id: string;
	title: string;
	updatedAt: number;
}

function stamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function newSession(model: string, options: ChatOptions, title: string): Session {
	const now = new Date();
	return {
		version: 1,
		id: `${stamp(now)}-${Math.random().toString(36).slice(2, 6)}`,
		title,
		createdAt: now.getTime(),
		updatedAt: now.getTime(),
		model,
		options,
		messages: [],
	};
}

export class SessionStore {
	private cache = new Map<string, { mtime: number; info: SessionInfo }>();

	constructor(
		private app: App,
		private folder: () => string,
	) {}

	pathFor(id: string): string {
		return normalizePath(`${this.folder()}/${id}.json`);
	}

	private async ensureFolder() {
		const folder = normalizePath(this.folder());
		if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
	}

	async save(session: Session) {
		if (!session.messages.length) return; // 空会话不落盘
		await this.ensureFolder();
		session.updatedAt = Date.now();
		const path = this.pathFor(session.id);
		const data = JSON.stringify(session, null, 1);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await this.app.vault.process(file, () => data);
		else await this.app.vault.create(path, data);
	}

	async load(path: string): Promise<Session | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		try {
			const s = JSON.parse(await this.app.vault.read(file)) as Session;
			return s?.version === 1 && Array.isArray(s.messages) ? s : null;
		} catch {
			return null;
		}
	}

	async list(): Promise<SessionInfo[]> {
		const folder = this.app.vault.getFolderByPath(normalizePath(this.folder()));
		if (!folder) return [];
		const files = folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === "json");
		const out: SessionInfo[] = [];
		for (const f of files) {
			const cached = this.cache.get(f.path);
			if (cached && cached.mtime === f.stat.mtime) {
				out.push(cached.info);
				continue;
			}
			try {
				const s = JSON.parse(await this.app.vault.cachedRead(f)) as Session;
				if (s?.version !== 1) continue;
				const info = { path: f.path, id: s.id, title: s.title, updatedAt: s.updatedAt };
				this.cache.set(f.path, { mtime: f.stat.mtime, info });
				out.push(info);
			} catch {
				/* 不是会话文件 */
			}
		}
		return out.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async remove(id: string) {
		const file = this.app.vault.getAbstractFileByPath(this.pathFor(id));
		if (file instanceof TFile) await this.app.fileManager.trashFile(file);
	}
}

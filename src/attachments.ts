// 附件：判断文件类型，变成 Messages API 的 content 块（必要时先上传解析）。

import { arrayBufferToBase64 } from "obsidian";
import { uploadFile, type Conn, type FilePurpose } from "./api/client";
import type { AttachmentMeta, Block } from "./core/types";
import { t } from "./i18n";

const TEXT_EXT = new Set(
	"md markdown txt csv tsv json jsonl yaml yml xml html htm css scss js mjs ts tsx jsx py java c cc cpp h hpp cs go rs rb php sh bash zsh sql swift kt lua r tex log ini toml conf canvas base".split(" "),
);
const DOC_EXT = new Set(["pdf", "doc", "docx", "ppt", "pptx"]);
const VISION_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const OCR_ONLY_EXT = new Set(["bmp", "tif", "tiff"]);
const DATA_EXT = new Set(["xlsx", "xls", "epub", "mobi"]);

export const ALL_EXT = new Set([...TEXT_EXT, ...DOC_EXT, ...Object.keys(VISION_EXT), ...OCR_ONLY_EXT, ...DATA_EXT]);
export const ACCEPT_ATTR = [...ALL_EXT].map((e) => `.${e}`).join(",");

const MiB = 1024 * 1024;

export interface PendingAttachment {
	key: string;
	meta: AttachmentMeta;
	status: "uploading" | "ready" | "error";
	block?: Block;
	error?: string;
}

export function extOf(name: string): string {
	const i = name.lastIndexOf(".");
	return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isImageName(name: string): boolean {
	return extOf(name) in VISION_EXT;
}

export function textDocumentBlock(title: string, text: string): Block {
	return { type: "document", source: { type: "text", media_type: "text/plain", data: text }, title };
}

/** 把一个文件变成附件块。上传类文件可能需要较长时间（服务端解析完才返回） */
export async function buildAttachment(
	conn: Conn,
	name: string,
	data: ArrayBuffer,
	opts: { vision: boolean; parseMode: FilePurpose },
): Promise<{ block: Block; meta: AttachmentMeta }> {
	const L = t();
	const ext = extOf(name);

	if (TEXT_EXT.has(ext)) {
		if (data.byteLength > 8 * MiB) throw new Error(`${L.tooLarge} (> 8 MiB)`);
		const text = new TextDecoder("utf-8").decode(data);
		return { block: textDocumentBlock(name, text), meta: { name, kind: "text" } };
	}

	if (ext in VISION_EXT && opts.vision) {
		if (data.byteLength > 32 * MiB) throw new Error(`${L.tooLarge} (> 32 MiB)`);
		return {
			block: { type: "image", source: { type: "base64", media_type: VISION_EXT[ext], data: arrayBufferToBase64(data) } },
			meta: { name, kind: "image" },
		};
	}

	let purpose: FilePurpose;
	if (DOC_EXT.has(ext)) purpose = opts.parseMode;
	else if (ext in VISION_EXT || OCR_ONLY_EXT.has(ext)) purpose = "text_recognition";
	else if (DATA_EXT.has(ext)) purpose = "user_data";
	else throw new Error(`${L.unsupported}: .${ext}`);

	const limit = purpose === "user_data" ? 32 * MiB : 100 * MiB;
	if (data.byteLength > limit) throw new Error(`${L.tooLarge} (> ${limit / MiB} MiB)`);

	const res = await uploadFile(conn, data, name, "", purpose);
	return {
		block: { type: "document", source: { type: "file", file_id: res.id } },
		meta: { name, kind: "file", detail: L.parsed },
	};
}

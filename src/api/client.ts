// DeepSeek HTTP 调用：Messages API（流式 / 非流式）、Chat Completions（JSON 模式）、文件上传、语音。
//
// 除流式对话外一律使用 Obsidian 的 requestUrl。流式对话必须逐块读取响应体（SSE），
// requestUrl 不支持流式读取，所以这一处使用 fetch；DeepSeek 接口已允许 Obsidian 的跨域来源。

import { requestUrl, type RequestUrlResponse } from "obsidian";
import { MessageAccumulator } from "../core/accumulator";
import { SSEParser } from "../core/sse";
import type { ApiResult, MessagesRequest, MessagesResponse, StreamEvent } from "../core/types";

export interface Conn {
	baseUrl: string;
	apiKey: string;
}

export class ApiError extends Error {
	partial?: ApiResult;
	constructor(
		message: string,
		public status?: number,
	) {
		super(message);
	}
}

export function apiRoot(conn: Conn): string {
	return (conn.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
}

function authHeaders(conn: Conn): Record<string, string> {
	if (!conn.apiKey) throw new ApiError("NO_KEY");
	return { Authorization: `Bearer ${conn.apiKey}` };
}

interface ErrorBody {
	error?: { message?: string };
	message?: string;
	detail?: string;
}

function errorMessage(status: number, text: string): string {
	try {
		const j = JSON.parse(text) as ErrorBody;
		const msg = j.error?.message ?? j.message ?? j.detail;
		if (msg) return `${status} · ${msg}`;
	} catch {
		/* 原文 */
	}
	return `${status} · ${text.slice(0, 300) || "Request failed"}`;
}

function check(res: RequestUrlResponse): RequestUrlResponse {
	if (res.status >= 400) throw new ApiError(errorMessage(res.status, res.text), res.status);
	return res;
}

/** 手工拼 multipart/form-data（requestUrl 不接受 FormData） */
function multipart(fields: { name: string; value: string | { data: ArrayBuffer; filename: string; type: string } }[]): {
	body: ArrayBuffer;
	contentType: string;
} {
	const boundary = `----dsc${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
	const enc = new TextEncoder();
	const parts: Uint8Array[] = [];
	for (const f of fields) {
		if (typeof f.value === "string") {
			parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`));
		} else {
			const safeName = f.value.filename.replace(/["\r\n]/g, "_");
			parts.push(
				enc.encode(
					`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${safeName}"\r\nContent-Type: ${f.value.type}\r\n\r\n`,
				),
			);
			parts.push(new Uint8Array(f.value.data));
			parts.push(enc.encode("\r\n"));
		}
	}
	parts.push(enc.encode(`--${boundary}--\r\n`));
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return { body: out.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

export interface StreamHandlers {
	onUpdate?: (acc: MessageAccumulator) => void;
}

function toResult(j: MessagesResponse): ApiResult {
	return {
		id: j.id,
		model: j.model,
		content: j.content ?? [],
		stop_reason: j.stop_reason,
		stop_details: j.stop_details,
		title: j.title,
		usage: j.usage ?? {},
	};
}

/** POST /anthropic/v1/messages。stream=true 用 fetch 读 SSE；否则用 requestUrl 一次取回 */
export async function createMessage(
	conn: Conn,
	body: MessagesRequest,
	opts: { stream: boolean; betaFiles: boolean; signal?: AbortSignal } & StreamHandlers,
): Promise<ApiResult> {
	const url = `${apiRoot(conn)}/anthropic/v1/messages`;
	const headers: Record<string, string> = { ...authHeaders(conn), "Content-Type": "application/json" };
	if (opts.betaFiles) headers["anthropic-beta"] = "files-api-2025-04-14";

	if (!opts.stream) {
		const res = check(await requestUrl({ url, method: "POST", headers, body: JSON.stringify({ ...body, stream: false }), throw: false }));
		const j = res.json as MessagesResponse;
		if (j.type === "error") throw new ApiError(j.error?.message ?? "Generation failed");
		return toResult(j);
	}

	const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...body, stream: true }), signal: opts.signal });
	if (!res.ok || !res.body) {
		const text = await res.text().catch(() => "");
		throw new ApiError(errorMessage(res.status, text), res.status);
	}
	const acc = new MessageAccumulator();
	const parser = new SSEParser();
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	const dispatch = (events: { event?: string; data: string }[]) => {
		for (const e of events) {
			let data: StreamEvent;
			try {
				data = JSON.parse(e.data) as StreamEvent;
			} catch {
				continue;
			}
			acc.handle(e.event, data);
		}
	};
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			dispatch(parser.feed(decoder.decode(value, { stream: true })));
			opts.onUpdate?.(acc);
		}
		dispatch(parser.flush());
	} catch (e) {
		if (e instanceof Error && e.name === "AbortError") {
			acc.result.stop_reason = "aborted";
			acc.result.content = acc.finalContent();
			return acc.result;
		}
		throw e;
	}
	opts.onUpdate?.(acc);
	acc.result.content = acc.finalContent();
	if (acc.error || !acc.done) {
		const err = new ApiError(acc.error?.message ?? "STREAM_INCOMPLETE");
		err.partial = acc.result; // 已生成的部分随错误一起交出去
		throw err;
	}
	return acc.result;
}

interface ChatCompletionResponse {
	choices?: { message?: { content?: string } }[];
}

/** Chat Completions + JSON 模式（Messages API 没有 response_format） */
export async function chatJson(conn: Conn, model: string, system: string, user: string): Promise<string> {
	const res = check(
		await requestUrl({
			url: `${apiRoot(conn)}/chat/completions`,
			method: "POST",
			headers: { ...authHeaders(conn), "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				thinking: { type: "disabled" },
				response_format: { type: "json_object" },
				max_tokens: 8192,
			}),
			throw: false,
		}),
	);
	return (res.json as ChatCompletionResponse).choices?.[0]?.message?.content ?? "";
}

export type FilePurpose = "text_recognition" | "rich_layout_recognition" | "user_data";

/** POST /files（multipart；purpose 必须在 file 之前）。会阻塞到服务端解析完成 */
export async function uploadFile(conn: Conn, data: ArrayBuffer, filename: string, mime: string, purpose: FilePurpose): Promise<{ id: string; bytes?: number }> {
	const form = multipart([
		{ name: "purpose", value: purpose },
		{ name: "file", value: { data, filename, type: mime || "application/octet-stream" } },
	]);
	const res = check(
		await requestUrl({
			url: `${apiRoot(conn)}/files`,
			method: "POST",
			headers: { ...authHeaders(conn), "anthropic-beta": "files-api-2025-04-14" },
			contentType: form.contentType,
			body: form.body,
			throw: false,
		}),
	);
	const j = res.json as { id: string; bytes?: number };
	return { id: j.id, bytes: j.bytes };
}

/** POST /v1/tools/asr：16-bit PCM WAV，≤120 秒 */
export async function transcribe(conn: Conn, wav: ArrayBuffer): Promise<string> {
	const form = multipart([{ name: "file", value: { data: wav, filename: "speech.wav", type: "audio/wav" } }]);
	const res = check(
		await requestUrl({
			url: `${apiRoot(conn)}/v1/tools/asr`,
			method: "POST",
			headers: authHeaders(conn),
			contentType: form.contentType,
			body: form.body,
			throw: false,
		}),
	);
	return (res.json as { text?: string }).text ?? "";
}

/** POST /v1/tools/tts（整段合成）→ WAV 数据 */
export async function synthesize(conn: Conn, text: string, voice: string): Promise<ArrayBuffer> {
	const res = check(
		await requestUrl({
			url: `${apiRoot(conn)}/v1/tools/tts`,
			method: "POST",
			headers: { ...authHeaders(conn), "Content-Type": "application/json" },
			body: JSON.stringify({ text, voice_id: voice, format: "wav", filter_markdown: true }),
			throw: false,
		}),
	);
	return res.arrayBuffer;
}

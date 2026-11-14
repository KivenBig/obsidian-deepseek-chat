// 把 Messages API 的流式事件累积成完整的 assistant 消息。
// 事件：message_start / content_block_start / content_block_delta / content_block_stop /
//       message_delta / message_stop / ping / error

import type { ApiResult, Block, StreamEvent, Usage } from "./types";

function cloneBlock(b: Block | undefined): Block {
	return b ? (JSON.parse(JSON.stringify(b)) as Block) : { type: "unknown" };
}

export class MessageAccumulator {
	result: ApiResult = { content: [], usage: {} };
	done = false;
	error: { type?: string; message?: string } | null = null;
	private partialJson = new Map<number, string>();

	handle(event: string | undefined, data: StreamEvent): void {
		const type = event ?? data.type;
		if (!type && data.error) {
			// 生成开始前超时：无名 data 帧 {"error":{...}}
			this.error = data.error;
			return;
		}
		const index = data.index ?? 0;
		switch (type) {
			case "message_start": {
				const m = data.message ?? {};
				this.result.id = m.id;
				this.result.model = m.model;
				if (m.usage) this.result.usage = { ...m.usage };
				break;
			}
			case "content_block_start": {
				const block = cloneBlock(data.content_block);
				if (block.type === "text" && typeof block.text !== "string") block.text = "";
				if (block.type === "thinking" && typeof block.thinking !== "string") block.thinking = "";
				if ((block.type === "tool_use" || block.type === "server_tool_use") && block.input && Object.keys(block.input).length === 0) {
					this.partialJson.set(index, "");
				}
				this.result.content[index] = block;
				break;
			}
			case "content_block_delta": {
				const block = this.result.content[index];
				const d = data.delta ?? {};
				if (!block) break;
				if (d.type === "text_delta") block.text = (block.text ?? "") + (d.text ?? "");
				else if (d.type === "thinking_delta") block.thinking = (block.thinking ?? "") + (d.thinking ?? "");
				else if (d.type === "signature_delta") block.signature = (block.signature ?? "") + (d.signature ?? "");
				else if (d.type === "input_json_delta") {
					this.partialJson.set(index, (this.partialJson.get(index) ?? "") + (d.partial_json ?? ""));
				} else if (d.type === "citations_delta" && d.citation) {
					(block.citations ??= []).push(d.citation);
				}
				break;
			}
			case "content_block_stop": {
				const json = this.partialJson.get(index);
				const block = this.result.content[index];
				if (block && json !== undefined && json.trim()) {
					try {
						block.input = JSON.parse(json) as Record<string, unknown>;
					} catch {
						block.input = { _raw: json };
					}
				}
				this.partialJson.delete(index);
				break;
			}
			case "message_delta": {
				const d = data.delta ?? {};
				if (d.stop_reason !== undefined) this.result.stop_reason = d.stop_reason;
				if (d.stop_details !== undefined) this.result.stop_details = d.stop_details;
				if (d.title) this.result.title = d.title;
				if (data.stop_details) this.result.stop_details = data.stop_details;
				if (data.usage) this.result.usage = mergeUsage(this.result.usage, data.usage);
				break;
			}
			case "message_stop":
				this.done = true;
				break;
			case "error":
				this.error = data.error ?? { message: "Unknown stream error" };
				break;
			default:
				break; // ping 等
		}
	}

	/** 去掉稀疏位置，返回干净的 content */
	finalContent(): Block[] {
		return this.result.content.filter((b) => b != null);
	}
}

/** message_delta.usage 是累计值：有就覆盖 */
export function mergeUsage(base: Usage, next: Usage): Usage {
	const out: Usage = { ...base };
	for (const [k, v] of Object.entries(next) as [keyof Usage, Usage[keyof Usage]][]) {
		if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
	}
	return out;
}

/** 两次调用的用量相加（续写、工具循环） */
export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage {
	const x = a ?? {};
	const y = b ?? {};
	const n = (p?: number, q?: number) => (p ?? 0) + (q ?? 0);
	const s1 = x.server_tool_use ?? {};
	const s2 = y.server_tool_use ?? {};
	return {
		input_tokens: n(x.input_tokens, y.input_tokens),
		cache_read_input_tokens: n(x.cache_read_input_tokens, y.cache_read_input_tokens),
		output_tokens: n(x.output_tokens, y.output_tokens),
		output_tokens_details: {
			thinking_tokens: n(x.output_tokens_details?.thinking_tokens, y.output_tokens_details?.thinking_tokens),
			safety_tokens: n(x.output_tokens_details?.safety_tokens, y.output_tokens_details?.safety_tokens),
		},
		server_tool_use: {
			tool_search: n(s1.tool_search, s2.tool_search),
			tool_fetch: n(s1.tool_fetch, s2.tool_fetch),
			tool_image_search: n(s1.tool_image_search, s2.tool_image_search),
			web_search_requests: n(s1.web_search_requests, s2.web_search_requests),
			web_fetch_requests: n(s1.web_fetch_requests, s2.web_fetch_requests),
		},
	};
}

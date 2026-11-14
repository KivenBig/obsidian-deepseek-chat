// Messages API（Anthropic 兼容）里用到的结构。字段名与 DeepSeek 文档一致。

export interface Citation {
	type?: string;
	url?: string;
	title?: string;
	cited_text?: string;
	encrypted_index?: string;
}

export interface BlockSource {
	type: string; // text | base64 | file | url
	media_type?: string;
	data?: string;
	file_id?: string;
	url?: string;
}

/** content 块。不同 type 用到不同字段，未知字段原样保留并发回 */
export interface Block {
	type: string;
	// text / thinking
	text?: string;
	thinking?: string;
	signature?: string;
	citations?: Citation[];
	// tool_use / server_tool_use
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	kind?: string;
	caller?: { type: string };
	// tool_result / web_search_tool_result / web_fetch_tool_result
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
	// document / image
	source?: BlockSource;
	title?: string;
}

/** web_search_tool_result.content 的元素 */
export interface SearchResultItem {
	type: string; // web_search_result | web_search_tool_result_error
	title?: string;
	url?: string;
	site_name?: string;
	site_icon?: string;
	snippet?: string;
	page_age?: string;
	image_url?: string;
	error_code?: string;
}

/** web_fetch_tool_result.content */
export interface FetchResult {
	type: string; // web_fetch_result | web_fetch_tool_result_error
	url?: string;
	content?: { title?: string };
	published_at?: string;
	error_code?: string;
}

export interface ServerToolUsage {
	web_search_requests?: number;
	web_fetch_requests?: number;
	tool_search?: number;
	tool_fetch?: number;
	tool_image_search?: number;
}

export interface Usage {
	input_tokens?: number; // 缓存未命中
	cache_read_input_tokens?: number; // 缓存命中
	cache_creation_input_tokens?: number;
	output_tokens?: number; // 含思考
	output_tokens_details?: { thinking_tokens?: number; safety_tokens?: number };
	server_tool_use?: ServerToolUsage;
}

export type Role = "user" | "assistant" | "latest_reminder";

export interface ApiMessage {
	role: Role;
	content: string | Block[];
}

export interface AttachmentMeta {
	name: string;
	kind: "text" | "file" | "image" | "note";
	detail?: string; // 例如「12 页」「已解析」
}

export interface MessageMeta {
	createdAt?: number;
	model?: string;
	usage?: Usage;
	cost?: number;
	stopReason?: string;
	excluded?: boolean; // 不再发回给模型（拒答、出错）
	refused?: boolean;
	error?: string;
	attachments?: AttachmentMeta[];
	toolResults?: boolean; // 这条 user 消息只装 tool_result
}

export interface StoredMessage extends ApiMessage {
	meta?: MessageMeta;
}

export interface ChatOptions {
	webSearch: boolean;
	vaultTools?: boolean;
	thinking: boolean;
	effort: string;
}

export interface Session {
	version: 1;
	id: string;
	title: string;
	titleFromModel?: boolean;
	createdAt: number;
	updatedAt: number;
	model: string;
	options: ChatOptions;
	systemPrompt?: string;
	messages: StoredMessage[];
}

export interface StopDetails {
	type?: string;
	category?: string | null;
	explanation?: string | null;
}

/** 一次响应的最终结果（流式累积或非流式） */
export interface ApiResult {
	id?: string;
	model?: string;
	content: Block[];
	stop_reason?: string;
	stop_details?: StopDetails;
	title?: string;
	usage: Usage;
}

export interface ToolDefinition {
	type?: string;
	name: string;
	description?: string;
	input_schema?: Record<string, unknown>;
}

/** POST /anthropic/v1/messages 的请求体 */
export interface MessagesRequest {
	model: string;
	messages: ApiMessage[];
	max_tokens?: number;
	system?: string;
	stream?: boolean;
	thinking?: { type: "enabled" | "disabled" };
	output_config?: { effort: string };
	tools?: ToolDefinition[];
	safety_check?: { level: "low" | "high" };
	title?: { enabled: boolean };
}

/** SSE 事件的 data（各事件字段的并集） */
export interface StreamEvent {
	type?: string;
	index?: number;
	message?: { id?: string; model?: string; usage?: Usage };
	content_block?: Block;
	delta?: {
		type?: string;
		text?: string;
		thinking?: string;
		signature?: string;
		partial_json?: string;
		citation?: Citation;
		stop_reason?: string;
		stop_details?: StopDetails;
		title?: string;
	};
	usage?: Usage;
	stop_details?: StopDetails;
	error?: { type?: string; message?: string };
}

/** 非流式响应 / 错误体 */
export interface MessagesResponse {
	type?: string;
	id?: string;
	model?: string;
	content?: Block[];
	stop_reason?: string;
	stop_details?: StopDetails;
	title?: string;
	usage?: Usage;
	error?: { type?: string; message?: string };
}

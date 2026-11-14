// 极简 SSE 解析：把任意切分的文本块拼成 {event, data} 事件。
// 注释行（以 ":" 开头，例如 ": keep-alive"）忽略。

export interface SSEEvent {
	event?: string;
	data: string;
}

export class SSEParser {
	private buffer = "";
	private event: string | undefined;
	private dataLines: string[] = [];

	feed(chunk: string): SSEEvent[] {
		this.buffer += chunk;
		const out: SSEEvent[] = [];
		let idx: number;
		while ((idx = this.buffer.indexOf("\n")) >= 0) {
			let line = this.buffer.slice(0, idx);
			this.buffer = this.buffer.slice(idx + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			this.processLine(line, out);
		}
		return out;
	}

	/** 流结束时调用，吐出最后一个没有空行收尾的事件 */
	flush(): SSEEvent[] {
		const out: SSEEvent[] = [];
		if (this.buffer.length) {
			this.processLine(this.buffer, out);
			this.buffer = "";
		}
		this.processLine("", out);
		return out;
	}

	private processLine(line: string, out: SSEEvent[]) {
		if (line === "") {
			if (this.dataLines.length) {
				out.push({ event: this.event, data: this.dataLines.join("\n") });
			}
			this.event = undefined;
			this.dataLines = [];
			return;
		}
		if (line.startsWith(":")) return;
		const colon = line.indexOf(":");
		const field = colon >= 0 ? line.slice(0, colon) : line;
		let value = colon >= 0 ? line.slice(colon + 1) : "";
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "event") this.event = value;
		else if (field === "data") this.dataLines.push(value);
	}
}

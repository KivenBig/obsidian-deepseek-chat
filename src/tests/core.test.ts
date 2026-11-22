import assert from "node:assert/strict";
import { addUsage, MessageAccumulator } from "../core/accumulator";
import { billingLength, encodeWav, pcm16ToFloat, truncateBilling } from "../core/audio";
import { blocksToMarkdown, SourceCollector } from "../core/citations";
import { sessionToMarkdown } from "../core/export";
import { buildRequestMessages, groupTurns, hasFileBlocks, toolResultMap, usedWebTools } from "../core/history";
import { computeCost, DEFAULT_PRICING, isPeak } from "../core/pricing";
import { buildReminder } from "../core/reminder";
import { SSEParser } from "../core/sse";
import type { Session, StoredMessage } from "../core/types";
import { applyAppend, applyEdit, buildVaultSystem, getVaultTools, validateNotePath } from "../core/vault-tools";

let passed = 0;
function test(name: string, fn: () => void) {
	fn();
	passed++;
	console.log(`  ✓ ${name}`);
}

console.log("core");

test("SSE：任意切分、注释、多行 data", () => {
	const p = new SSEParser();
	const raw = ': keep-alive\n\nevent: message_start\ndata: {"a":1}\n\nevent: ping\r\ndata: {}\r\n\ndata: {"error":{"message":"x"}}\n\n';
	const events = [];
	for (let i = 0; i < raw.length; i += 7) events.push(...p.feed(raw.slice(i, i + 7)));
	events.push(...p.flush());
	assert.equal(events.length, 3);
	assert.deepEqual(events[0], { event: "message_start", data: '{"a":1}' });
	assert.equal(events[1].event, "ping");
	assert.equal(events[2].event, undefined);
});

test("累积器：思考 + 读链接 + 引用 + 标题 + 用量", () => {
	const acc = new MessageAccumulator();
	const ev = (e: string, d: object) => acc.handle(e, { type: e, ...d });
	ev("message_start", { message: { id: "m1", model: "deepseek-flash", usage: { input_tokens: 10, output_tokens: 1 } } });
	ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } });
	ev("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "想" } });
	ev("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "一想" } });
	ev("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig" } });
	ev("content_block_stop", { index: 0 });
	ev("content_block_start", {
		index: 1,
		content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "deepseek_read_url", input: {}, kind: "read_link" },
	});
	ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"action":"read_link",' } });
	ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '"url":"https://a.com"}' } });
	ev("content_block_stop", { index: 1 });
	ev("content_block_start", {
		index: 2,
		content_block: {
			type: "web_fetch_tool_result",
			tool_use_id: "srvtoolu_1",
			content: { type: "web_fetch_result", url: "https://a.com", content: { title: "A" } },
			signature: "enc",
			kind: "read_link",
		},
	});
	ev("content_block_stop", { index: 2 });
	ev("content_block_start", { index: 3, content_block: { type: "text", text: "" } });
	ev("content_block_delta", { index: 3, delta: { type: "text_delta", text: "答案" } });
	ev("content_block_delta", { index: 3, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://a.com", title: "A" } } });
	ev("content_block_stop", { index: 3 });
	ev("message_delta", { delta: { stop_reason: "end_turn", title: "测试标题" }, usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 30, server_tool_use: { tool_fetch: 1 } } });
	ev("message_stop", {});
	const c = acc.finalContent();
	assert.equal(acc.done, true);
	assert.equal(c.length, 4);
	assert.equal(c[0].thinking, "想一想");
	assert.equal(c[0].signature, "sig");
	assert.deepEqual(c[1].input, { action: "read_link", url: "https://a.com" });
	assert.equal(c[2].signature, "enc");
	assert.equal(c[3].text, "答案");
	assert.equal(c[3].citations?.length, 1);
	assert.equal(acc.result.title, "测试标题");
	assert.equal(acc.result.stop_reason, "end_turn");
	assert.equal(acc.result.usage.input_tokens, 100);
	assert.equal(acc.result.usage.server_tool_use?.tool_fetch, 1);
	assert.ok(usedWebTools(c));
});

test("累积器：error 事件", () => {
	const acc = new MessageAccumulator();
	acc.handle("error", { type: "error", error: { type: "api_error", message: "boom" } });
	assert.equal(acc.error?.message, "boom");
	const acc2 = new MessageAccumulator();
	acc2.handle(undefined, { error: { message: "timeout" } });
	assert.equal(acc2.error?.message, "timeout");
});

test("用量相加", () => {
	const u = addUsage({ input_tokens: 1, output_tokens: 2, server_tool_use: { tool_search: 1 } }, { input_tokens: 3, server_tool_use: { tool_search: 2 } });
	assert.equal(u.input_tokens, 4);
	assert.equal(u.output_tokens, 2);
	assert.equal(u.server_tool_use?.tool_search, 3);
});

const msgs: StoredMessage[] = [
	{ role: "latest_reminder", content: "2026-11-14,星期六,,App,中文" },
	{ role: "user", content: [{ type: "text", text: "你好" }] },
	{ role: "assistant", content: [{ type: "text", text: "" }, { type: "tool_use", id: "t1", name: "read_note", input: {} }] },
	{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "笔记" }], meta: { toolResults: true } },
	{ role: "assistant", content: [{ type: "text", text: "读完了" }], meta: { usage: { output_tokens: 3 } } },
	{ role: "user", content: [{ type: "document", source: { type: "file", file_id: "f" } }, { type: "text", text: "坏" }], meta: { excluded: true } },
];

test("分组：reminder / 工具结果归入同一轮", () => {
	const turns = groupTurns(msgs);
	assert.equal(turns.length, 2);
	assert.equal(turns[0].reminderIndex, 0);
	assert.deepEqual(turns[0].replyIndexes, [2, 3, 4]);
	assert.equal(turns[1].userIndex, 5);
	assert.equal(toolResultMap(msgs).get("t1")?.content, "笔记");
});

test("请求消息：去掉 excluded、meta 和空文本块", () => {
	const req = buildRequestMessages(msgs);
	assert.equal(req.length, 5);
	assert.ok(!("meta" in req[4]));
	const a = req[2].content as { type: string }[];
	assert.equal(a.length, 1);
	assert.equal(a[0].type, "tool_use");
	assert.equal(hasFileBlocks(req), false);
	assert.equal(hasFileBlocks(buildRequestMessages(msgs.map((m) => ({ ...m, meta: undefined })))), true);
});

test("高峰判断（北京时间）", () => {
	assert.equal(isPeak(new Date("2026-11-16T02:00:00Z")), true); // 周一 10:00
	assert.equal(isPeak(new Date("2026-11-16T04:30:00Z")), false); // 周一 12:30
	assert.equal(isPeak(new Date("2026-11-16T09:59:00Z")), true); // 周一 17:59
	assert.equal(isPeak(new Date("2026-11-14T02:00:00Z")), false); // 周六
});

test("费用计算", () => {
	const cost = computeCost(
		{ input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, output_tokens: 1_000_000, server_tool_use: { tool_search: 2, tool_fetch: 1 } },
		"deepseek-flash",
		DEFAULT_PRICING,
		new Date("2026-11-14T02:00:00Z"), // 低谷
	);
	assert.ok(Math.abs((cost ?? 0) - (1 + 0.02 + 4 + 0.015)) < 1e-9);
});

test("元信息格式", () => {
	assert.equal(buildReminder(new Date(2026, 10, 9), "新加坡", "中文"), "2026-11-09,星期一,新加坡,App,中文");
	assert.equal(buildReminder(new Date(2026, 10, 9), "", "English"), "2026-11-09,Monday,,App,English");
});

test("引用转 Markdown", () => {
	const s = new SourceCollector();
	const md = blocksToMarkdown(
		[
			{ type: "text", text: "甲", citations: [{ url: "https://a.com/x y", title: "A" }] },
			{ type: "text", text: "乙", citations: [{ url: "https://a.com/x y", title: "A" }, { url: "https://b.com", title: "B" }] },
		],
		s,
	);
	assert.equal(s.list.length, 2);
	assert.equal(md, "甲 [\\[1\\]](https://a.com/x%20y)乙 [\\[1\\]](https://a.com/x%20y) [\\[2\\]](https://b.com)");
});

test("导出 Markdown", () => {
	const session: Session = {
		version: 1,
		id: "x",
		title: "标题: 测试",
		createdAt: Date.UTC(2026, 10, 14),
		updatedAt: 0,
		model: "deepseek-flash",
		options: { webSearch: false, thinking: true, effort: "high" },
		messages: [
			{ role: "user", content: [{ type: "text", text: "问" }], meta: { attachments: [{ name: "a.pdf", kind: "file" }] } },
			{ role: "assistant", content: [{ type: "thinking", thinking: "想" }, { type: "text", text: "答", citations: [{ url: "https://a.com", title: "A" }] }] },
		],
	};
	const md = sessionToMarkdown(session, { user: "我", assistant: "DS", thinking: "思考", sources: "来源", attachments: "附件", refused: "拒" }, true);
	assert.ok(md.startsWith('---\ntitle: "标题: 测试"'));
	assert.ok(md.includes("## 我\n\n问\n\n*附件: a.pdf*"));
	assert.ok(md.includes("> [!note]- 思考\n> 想"));
	assert.ok(md.includes("答 [\\[1\\]](https://a.com)"));
	assert.ok(md.includes("## 来源\n\n1. [A](https://a.com)"));
});

test("音频：WAV 头、PCM 解码、计费字符", () => {
	const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
	const v = new DataView(wav);
	assert.equal(wav.byteLength, 44 + 8);
	assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), "RIFF");
	assert.equal(v.getUint32(24, true), 16000);
	assert.equal(v.getInt16(46, true), Math.trunc(0.5 * 0x7fff));
	const { samples, rest } = pcm16ToFloat(new Uint8Array([0, 0x40, 0, 0xc0, 7]));
	assert.equal(samples.length, 2);
	assert.equal(samples[0], 0.5);
	assert.equal(samples[1], -0.5);
	assert.equal(rest.length, 1);
	assert.equal(billingLength("你好ab"), 6);
	assert.equal(truncateBilling("你好ab", 5), "你好a");
});

test("笔记库工具权限与系统提示词", () => {
	const ro = getVaultTools({ write: false, move: true, remove: true });
	assert.deepEqual(
		ro.map((x) => x.name),
		["get_current_note", "search_notes", "read_note", "list_folder"],
	);
	assert.ok(buildVaultSystem({ write: false, move: false, remove: false }).includes("read-only"));

	const rw = getVaultTools({ write: true, move: false, remove: false });
	assert.equal(rw.length, 8);
	assert.ok(rw.some((x) => x.name === "create_note"));
	assert.ok(!rw.some((x) => x.name === "rename_note"));
	assert.ok(!rw.some((x) => x.name === "delete_note"));

	const full = getVaultTools({ write: true, move: true, remove: true });
	assert.equal(full.length, 10);
	assert.ok(full.some((x) => x.name === "rename_note"));
	assert.ok(full.some((x) => x.name === "delete_note"));
	assert.ok(buildVaultSystem({ write: true, move: true, remove: true }).includes("create_note"));
});

test("笔记路径校验：自动补 .md、拦截越界和隐藏目录", () => {
	assert.deepEqual(validateNotePath("复盘/2026-11"), { ok: true, path: "复盘/2026-11.md" });
	assert.deepEqual(validateNotePath("a\\b\\c.md"), { ok: true, path: "a/b/c.md" });
	assert.equal(validateNotePath("").ok, false);
	assert.equal(validateNotePath("/etc/passwd").ok, false);
	assert.equal(validateNotePath("../secret.md").ok, false);
	assert.equal(validateNotePath(".obsidian/plugins/x.md").ok, false);
	assert.equal(validateNotePath("notes/.hidden.md").ok, false);
});

test("笔记追加与局部编辑", () => {
	assert.equal(applyAppend("第一段", "第二段", "end"), "第一段\n\n第二段");
	assert.equal(applyAppend("---\ntitle: 测试\n---\n正文", "导语", "start"), "---\ntitle: 测试\n---\n\n导语\n\n正文");
	assert.equal(applyAppend("正文", "导语", "start"), "导语\n\n正文");

	const ok1 = applyEdit("hello world", "world", "obsidian", false);
	assert.deepEqual(ok1, { ok: true, content: "hello obsidian", count: 1 });
	assert.equal(applyEdit("a b a", "a", "x", false).ok, false);
	assert.deepEqual(applyEdit("a b a", "a", "x", true), { ok: true, content: "x b x", count: 2 });
	assert.equal(applyEdit("hello", "missing", "x", false).ok, false);
});

console.log(`\n${passed} passed`);

// 朗读（TTS）与录音（ASR 前处理）。

import { encodeWav, pcm16ToFloat, truncateBilling } from "../core/audio";
import { apiRoot, ApiError, synthesize, type Conn } from "./client";

const MAX_TTS_BILLING_CHARS = 10_000;
const PCM_RATE = 24_000;

/** 同一时间只朗读一段；再次调用会停掉上一段 */
export class Speaker {
	private ctx: AudioContext | null = null;
	private ws: WebSocket | null = null;
	private audio: HTMLAudioElement | null = null;
	private generation = 0; // stop() 后作废进行中的整段合成
	private nextTime = 0;
	private rest: Uint8Array<ArrayBuffer> = new Uint8Array(0);
	onStateChange?: (playing: boolean) => void;
	playing = false;

	stop() {
		this.ws?.close();
		this.ws = null;
		this.generation++;
		if (this.audio) {
			this.audio.pause();
			URL.revokeObjectURL(this.audio.src);
			this.audio = null;
		}
		void this.ctx?.close();
		this.ctx = null;
		this.setPlaying(false);
	}

	private setPlaying(p: boolean) {
		this.playing = p;
		this.onStateChange?.(p);
	}

	async speak(conn: Conn, text: string, voice: string, streaming: boolean, onError: (msg: string) => void) {
		this.stop();
		const input = truncateBilling(text, MAX_TTS_BILLING_CHARS);
		if (!input.trim()) return;
		this.setPlaying(true);
		if (streaming) this.speakStream(conn, input, voice, onError);
		else await this.speakHttp(conn, input, voice, onError);
	}

	private async speakHttp(conn: Conn, text: string, voice: string, onError: (msg: string) => void) {
		const gen = this.generation;
		try {
			const wav = await synthesize(conn, text, voice);
			if (gen !== this.generation) return; // 合成期间已被停止
			const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
			const audio = new Audio(url);
			this.audio = audio;
			audio.onended = () => this.stop();
			await audio.play();
		} catch (e) {
			if (gen === this.generation) {
				onError(e instanceof Error ? e.message : String(e));
				this.stop();
			}
		}
	}

	private speakStream(conn: Conn, text: string, voice: string, onError: (msg: string) => void) {
		const base = apiRoot(conn).replace(/^http/, "ws");
		const url = `${base}/v1/tools/tts?voice_id=${encodeURIComponent(voice)}&format=pcm&filter_markdown=true`;
		// 浏览器里不能设置请求头，用文档支持的子协议认证
		const ws = new WebSocket(url, ["tts", `bearer.${conn.apiKey}`]);
		ws.binaryType = "arraybuffer";
		this.ws = ws;
		this.ctx = new AudioContext();
		this.nextTime = 0;
		this.rest = new Uint8Array(0);
		let finished = false;

		ws.onopen = () => {
			// 分段发送，模拟流式输入
			const chunks = text.match(/[\s\S]{1,400}/g) ?? [];
			for (const c of chunks) ws.send(JSON.stringify({ event: "text", text: c }));
			ws.send(JSON.stringify({ event: "finish_text" }));
		};
		ws.onmessage = (ev) => {
			if (typeof ev.data === "string") {
				try {
					const msg = JSON.parse(ev.data) as { event?: string; code?: string; message?: string };
					if (msg.event === "finish") {
						finished = true;
						if (msg.code && msg.code !== "success") onError(`${msg.code}${msg.message ? ` · ${msg.message}` : ""}`);
						this.scheduleEnd();
					}
				} catch {
					/* 忽略 */
				}
				return;
			}
			this.playPcm(new Uint8Array(ev.data as ArrayBuffer));
		};
		ws.onerror = () => {
			if (!finished) onError("TTS WebSocket error");
		};
		ws.onclose = () => {
			if (!finished) this.scheduleEnd();
		};
	}

	private playPcm(chunk: Uint8Array) {
		const ctx = this.ctx;
		if (!ctx) return;
		const merged = new Uint8Array(this.rest.length + chunk.length);
		merged.set(this.rest);
		merged.set(chunk, this.rest.length);
		const { samples, rest } = pcm16ToFloat(merged);
		this.rest = rest;
		if (!samples.length) return;
		const buf = ctx.createBuffer(1, samples.length, PCM_RATE);
		buf.copyToChannel(samples, 0);
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.connect(ctx.destination);
		const start = Math.max(ctx.currentTime + 0.05, this.nextTime);
		src.start(start);
		this.nextTime = start + buf.duration;
	}

	private scheduleEnd() {
		const ctx = this.ctx;
		if (!ctx) return this.stop();
		const wait = Math.max(0, this.nextTime - ctx.currentTime);
		window.setTimeout(() => {
			if (this.ctx === ctx) this.stop();
		}, wait * 1000 + 200);
	}
}

/** 录音 → 16 kHz 单声道 WAV */
export class Recorder {
	private rec: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private stream: MediaStream | null = null;
	private timer: number | null = null;
	startedAt = 0;

	static supported(): boolean {
		return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
	}

	get recording(): boolean {
		return !!this.rec;
	}

	async start(maxSeconds: number, onAutoStop: () => void) {
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.chunks = [];
		this.rec = new MediaRecorder(this.stream);
		this.rec.ondataavailable = (e) => {
			if (e.data.size) this.chunks.push(e.data);
		};
		this.rec.start();
		this.startedAt = Date.now();
		this.timer = window.setTimeout(onAutoStop, maxSeconds * 1000);
	}

	async stop(): Promise<ArrayBuffer> {
		const rec = this.rec;
		if (!rec) throw new ApiError("NOT_RECORDING");
		if (this.timer) window.clearTimeout(this.timer);
		const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
		rec.stop();
		await stopped;
		this.stream?.getTracks().forEach((t) => t.stop());
		this.rec = null;
		this.stream = null;
		const blob = new Blob(this.chunks, { type: rec.mimeType });
		return toWav16k(await blob.arrayBuffer());
	}

	cancel() {
		if (this.timer) window.clearTimeout(this.timer);
		try {
			this.rec?.stop();
		} catch {
			/* 已停止 */
		}
		this.stream?.getTracks().forEach((t) => t.stop());
		this.rec = null;
		this.stream = null;
	}
}

async function toWav16k(data: ArrayBuffer): Promise<ArrayBuffer> {
	const ctx = new AudioContext();
	const decoded = await ctx.decodeAudioData(data);
	void ctx.close();
	const rate = 16_000;
	const length = Math.max(1, Math.ceil(decoded.duration * rate));
	const offline = new OfflineAudioContext(1, length, rate);
	const src = offline.createBufferSource();
	src.buffer = decoded; // 多声道会被自动混成单声道
	src.connect(offline.destination);
	src.start();
	const rendered = await offline.startRendering();
	return encodeWav(rendered.getChannelData(0), rate);
}

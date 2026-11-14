// 音频相关的纯函数：WAV 编码、TTS 计费字符、PCM 解码。

/** TTS 计费：中文（及其他宽字符）算 2，其余算 1 */
export function billingLength(text: string): number {
	let n = 0;
	for (const ch of text) n += /[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 2 : 1;
	return n;
}

export function truncateBilling(text: string, max: number): string {
	let n = 0;
	let out = "";
	for (const ch of text) {
		const w = /[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 2 : 1;
		if (n + w > max) break;
		n += w;
		out += ch;
	}
	return out;
}

/** 单声道 Float32 → 16-bit PCM WAV */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);
	const writeStr = (offset: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
	};
	writeStr(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	writeStr(8, "WAVE");
	writeStr(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeStr(36, "data");
	view.setUint32(40, samples.length * 2, true);
	let o = 44;
	for (let i = 0; i < samples.length; i++, o += 2) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return buffer;
}

/** 16-bit 小端 PCM → Float32；返回解码结果和剩下的奇数字节 */
export function pcm16ToFloat(bytes: Uint8Array): { samples: Float32Array<ArrayBuffer>; rest: Uint8Array<ArrayBuffer> } {
	const usable = bytes.length - (bytes.length % 2);
	const samples = new Float32Array(usable / 2);
	const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
	for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000;
	return { samples, rest: bytes.slice(usable) };
}

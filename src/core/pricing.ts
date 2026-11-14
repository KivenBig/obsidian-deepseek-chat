// 费用估算。价格单位：人民币元 / 百万 token；搜索、读页按次。
// 高峰：北京时间周一至周五 9:00–12:00、14:00–18:00（不识别法定节假日），其余为低谷（半价）。

import type { Usage } from "./types";

export interface ModelPrice {
	cacheHit: [number, number]; // [高峰, 低谷]
	cacheMiss: [number, number];
	output: [number, number];
}

export interface PricingTable {
	currency: string;
	models: Record<string, ModelPrice>;
	perSearch: number; // 每次搜索（文字或图片）
	perFetch: number; // 每次读页
}

export const DEFAULT_PRICING: PricingTable = {
	currency: "¥",
	models: {
		"deepseek-flash": { cacheHit: [0.04, 0.02], cacheMiss: [2, 1], output: [8, 4] },
		"deepseek-v4-pro": { cacheHit: [0.3, 0.15], cacheMiss: [9, 4.5], output: [27, 13.5] },
	},
	perSearch: 0.005,
	perFetch: 0.005,
};

export function isPeak(date: Date): boolean {
	// 换算成北京时间（UTC+8）
	const bj = new Date(date.getTime() + 8 * 3600 * 1000);
	const day = bj.getUTCDay(); // 0 = 周日
	if (day === 0 || day === 6) return false;
	const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes();
	return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
}

export function computeCost(usage: Usage | undefined, model: string, table: PricingTable, date: Date): number | null {
	if (!usage) return null;
	const price = table.models[model];
	const slot = isPeak(date) ? 0 : 1;
	const s = usage.server_tool_use ?? {};
	const searches = (s.tool_search ?? 0) + (s.tool_image_search ?? 0);
	const fetches = s.tool_fetch ?? 0;
	let cost = searches * table.perSearch + fetches * table.perFetch;
	if (!price) return cost || null;
	cost +=
		((usage.cache_read_input_tokens ?? 0) * price.cacheHit[slot] +
			(usage.input_tokens ?? 0) * price.cacheMiss[slot] +
			(usage.output_tokens ?? 0) * price.output[slot]) /
		1_000_000;
	return cost;
}

export function formatCost(cost: number | null | undefined, currency: string): string {
	if (cost == null) return "";
	if (cost === 0) return `${currency}0`;
	if (cost < 0.0001) return `<${currency}0.0001`;
	return `${currency}${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`;
}

export function parsePricing(json: string): PricingTable {
	try {
		const p = JSON.parse(json) as Partial<PricingTable> | null;
		if (p && typeof p === "object" && p.models) return { ...DEFAULT_PRICING, ...p };
	} catch {
		/* 用默认 */
	}
	return DEFAULT_PRICING;
}

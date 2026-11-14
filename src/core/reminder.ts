// latest_reminder：<日期>,<星期>,<地点>,<平台>,<语言>
// 例：2026-11-09,星期一,新加坡,App,中文

/** 文档里的语言名 → 用来生成星期的 locale */
export const REMINDER_LANGUAGES: Record<string, string> = {
	中文: "zh-CN",
	中文繁體: "zh-TW",
	English: "en-US",
	日本語: "ja-JP",
	한국어: "ko-KR",
	Deutsch: "de-DE",
	français: "fr-FR",
	español: "es-ES",
	português: "pt-PT",
	italiano: "it-IT",
	русский: "ru-RU",
	Türkçe: "tr-TR",
	"Tiếng Việt": "vi-VN",
	ไทย: "th-TH",
	Indonesia: "id-ID",
	Melayu: "ms-MY",
	العربية: "ar",
	हिन्दी: "hi-IN",
};

const ZH_WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}

export function weekdayName(date: Date, language: string): string {
	if (language === "中文") return ZH_WEEKDAYS[date.getDay()];
	if (language === "English") return EN_WEEKDAYS[date.getDay()];
	const locale = REMINDER_LANGUAGES[language];
	if (locale) {
		try {
			return date.toLocaleDateString(locale, { weekday: "long" });
		} catch {
			/* 回退英文 */
		}
	}
	return EN_WEEKDAYS[date.getDay()];
}

export function buildReminder(date: Date, location: string, language: string, platform = "App"): string {
	const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	return [d, weekdayName(date, language), location.trim(), platform, language].join(",");
}

import esbuild from "esbuild";
import { readdirSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";

const mode = process.argv[2];

if (mode === "test") {
	// 纯逻辑单测：src/**/*.test.ts，逐个打包后用 node 运行
	mkdirSync(".cache", { recursive: true });
	const tests = readdirSync("src/tests").filter((f) => f.endsWith(".test.ts"));
	for (const t of tests) {
		const out = `.cache/${t.replace(/\.ts$/, ".js")}`;
		await esbuild.build({ entryPoints: [`src/tests/${t}`], bundle: true, platform: "node", outfile: out, logLevel: "error" });
		execFileSync("node", [out], { stdio: "inherit" });
	}
	console.log(`\n✓ ${tests.length} test files passed`);
	process.exit(0);
}

const prod = mode === "production";
const ctx = await esbuild.context({
	entryPoints: ["main.ts"],
	bundle: true,
	external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "main.js",
});
if (prod) {
	await ctx.rebuild();
	process.exit(0);
} else {
	await ctx.watch();
}

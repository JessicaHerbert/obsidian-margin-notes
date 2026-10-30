import esbuild from "esbuild";
import { builtinModules } from "node:module";

await esbuild.build({
	entryPoints: ["src/main.ts"],
	bundle: true,
	outfile: "dist/main.js",
	format: "cjs",
	target: "es2022",
	platform: "browser",
	external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
	logLevel: "info",
});

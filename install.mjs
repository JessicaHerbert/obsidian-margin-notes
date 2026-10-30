import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const vault = resolve(process.argv[2] ?? join(homedir(), "tools-and-projects"));
if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`${vault} is not an Obsidian vault (no .obsidian folder). Usage: npm run install-plugin -- /path/to/vault`);
	process.exit(1);
}
const target = join(vault, ".obsidian", "plugins", "margin-notes");
mkdirSync(target, { recursive: true });
for (const f of ["dist/main.js", "manifest.json", "styles.css"]) copyFileSync(f, join(target, f.split("/").pop()));
console.log(`Installed to ${target}`);

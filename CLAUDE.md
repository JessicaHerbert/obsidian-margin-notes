# Margin Notes (Obsidian plugin)

Notion-style margin comments stored in the note. `npm run install-plugin -- <vault>` builds and copies into `<vault>/.obsidian/plugins/margin-notes/` (defaults to `~/tools-and-projects`).

- `src/core.ts` is pure text logic (parse, add, update, remove). Keep it free of Obsidian imports and covered by `src/core.test.ts`.
- `src/main.ts` is the Obsidian side: CodeMirror decorations hide markers and highlight anchors, a right-side ItemView lists threads, a selection tooltip offers "💬 Comment".
- Editor edits go through one `diffChange` dispatch so undo works. Files not open in an editor are edited with `vault.process`.
- Use npm, not pnpm: corepack on Jess's Mac fails its signature check.

## Answering comments in a note

Find threads with `grep '<!--cmt ' <file>`. For each open thread, make the fix in the text, then add a reply `{"by":"Claude","at":<ISO time>,"text":"what changed"}` and set `"status":"resolved"`. Leave a thread open with a reply when it needs a human decision. Never delete someone's threads; they clear resolved ones themselves. Strip every `<!--c:`, `<!--/c:` and `<!--cmt` marker before publishing a note anywhere.

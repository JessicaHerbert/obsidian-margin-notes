# Margin Notes

Notion-style margin comments for Obsidian. Comments are stored inside the note itself, so an AI assistant reading the file (Claude Code, for example) can see each comment, the text it points at, and reply.

- Select text and click **💬 Comment**, right-click and choose **Add comment**, or use the command palette.
- Comments appear in the **Comments** panel on the right. Click a card to jump to its highlight, or click a highlight to open its card.
- Each card has Reply, Resolve/Reopen and Delete. **Show resolved** brings resolved threads back, and the command "Delete resolved comments in this note" clears them.
- Set your display name under Settings → Margin Notes. It defaults to your computer's user name.
- No network calls. Desktop only.

## Install

The plugin is not in Obsidian's community directory, so it installs from source:

```
git clone https://github.com/JessicaHerbert/obsidian-margin-notes.git
cd obsidian-margin-notes
npm install
npm run install-plugin -- /path/to/your/vault
```

Then in Obsidian: Settings → Community plugins → turn on community plugins → enable **Margin Notes**. Run the same `install-plugin` command after a `git pull` to update, then toggle the plugin off and on.

## Storage format

```
The <!--c:k3f9a-->highlighted text<!--/c:k3f9a--> stays in place.

<!--cmt {"id":"k3f9a","by":"Jess","at":"2026-10-30T15:00:00.000Z","status":"open","quote":"highlighted text","text":"comment","replies":[{"by":"Claude","at":"...","text":"reply"}]}-->
```

Anchor markers wrap the commented text, and one `<!--cmt {json}-->` line per thread sits at the end of the file. `--` inside the JSON is escaped as `--` so the HTML comment never closes early. Markdown renderers hide all of it. Strip the markers before publishing a note somewhere else.

## Working with an AI assistant

Tell the assistant to find threads with `grep '<!--cmt ' note.md`, fix what each open thread asks for, then add a reply and set `"status":"resolved"`. The replies show up in the panel.

## Development

```
npm test                 # core parse and edit logic (vitest)
npm run build            # type-check and bundle to dist/main.js
```

`src/core.ts` holds the text logic with no Obsidian imports. `src/main.ts` holds the editor highlights, the panel and the commands.

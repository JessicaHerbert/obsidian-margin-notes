import { ItemView, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { EditorState, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, Tooltip, showTooltip } from "@codemirror/view";
import { Change, Thread, addComment, applyChanges, parse, removeComment, updateThread } from "./core";

const VIEW_TYPE = "margin-notes-panel";

interface Settings {
	author: string;
	showResolved: boolean;
}

function systemUser(): string {
	try {
		const os = (window as unknown as { require?: (m: string) => { userInfo(): { username: string } } }).require?.("os");
		return os?.userInfo().username || "Me";
	} catch {
		return "Me";
	}
}

const DEFAULTS: Settings = { author: systemUser(), showResolved: false };

export default class MarginNotes extends Plugin {
	settings: Settings = DEFAULTS;
	activeId: string | null = null;

	async onload() {
		this.settings = Object.assign({}, DEFAULTS, await this.loadData());
		this.registerView(VIEW_TYPE, (leaf) => new CommentsView(leaf, this));
		this.registerEditorExtension(this.editorExtension());
		this.addRibbonIcon("message-square", "Margin notes", () => this.openPanel());

		this.addCommand({
			id: "add-comment",
			name: "Add comment to selection",
			editorCheckCallback: (checking, editor, view) => {
				if (!editor.somethingSelected()) return false;
				if (!checking && view instanceof MarkdownView) this.promptAdd(cmOf(view));
				return true;
			},
		});
		this.addCommand({ id: "open-panel", name: "Open comments panel", callback: () => this.openPanel() });
		this.addCommand({
			id: "clear-resolved",
			name: "Delete resolved comments in this note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.clearResolved(file);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				if (!editor.somethingSelected() || !(view instanceof MarkdownView)) return;
				menu.addItem((item) => item.setTitle("Add comment").setIcon("message-square").onClick(() => this.promptAdd(cmOf(view))));
			}),
		);

		this.addSettingTab(new MarginNotesSettings(this));
		this.app.workspace.onLayoutReady(() => this.openPanel(false));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshPanels();
	}

	async openPanel(reveal = true) {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			const right = this.app.workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: VIEW_TYPE, active: reveal });
			leaf = right;
		}
		if (reveal) this.app.workspace.revealLeaf(leaf);
	}

	refreshPanels() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) (leaf.view as CommentsView).render();
	}

	focusComment(id: string) {
		this.activeId = id;
		void this.openPanel();
		this.refreshPanels();
	}

	promptAdd(cm: EditorView | null) {
		if (!cm) return;
		const sel = cm.state.selection.main;
		if (sel.empty) return;
		new AddCommentModal(this, (body) => {
			const text = cm.state.doc.toString();
			const { id, changes } = addComment(text, sel.from, sel.to, this.settings.author, body, now());
			cm.dispatch({ changes: diffChange(text, applyChanges(text, changes)) });
			this.focusComment(id);
		}).open();
	}

	/** Applies changes to the open editor for the file when there is one, so undo works, otherwise to the file on disk. */
	async edit(file: TFile, make: (text: string) => Change[]) {
		const cm = this.editorFor(file);
		if (cm) {
			const text = cm.state.doc.toString();
			const changes = make(text);
			if (changes.length) cm.dispatch({ changes: diffChange(text, applyChanges(text, changes)) });
		} else {
			await this.app.vault.process(file, (text) => applyChanges(text, make(text)));
		}
		this.refreshPanels();
	}

	async readFile(file: TFile): Promise<string> {
		const cm = this.editorFor(file);
		return cm ? cm.state.doc.toString() : this.app.vault.cachedRead(file);
	}

	editorFor(file: TFile): EditorView | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as MarkdownView;
			if (view.file?.path === file.path) return cmOf(view);
		}
		return null;
	}

	jumpTo(file: TFile, id: string) {
		this.activeId = id;
		const cm = this.editorFor(file);
		if (!cm) return;
		const anchor = parse(cm.state.doc.toString()).anchors.find((a) => a.id === id);
		if (!anchor) return;
		cm.dispatch({ selection: { anchor: anchor.openTo, head: anchor.closeFrom }, effects: EditorView.scrollIntoView(anchor.openTo, { y: "center" }) });
		cm.focus();
		this.refreshPanels();
	}

	async clearResolved(file: TFile) {
		const text = await this.readFile(file);
		const ids = parse(text).threads.filter((t) => t.thread.status === "resolved").map((t) => t.thread.id);
		for (const id of ids) await this.edit(file, (t) => removeComment(t, id));
		new Notice(`Deleted ${ids.length} resolved comment${ids.length === 1 ? "" : "s"}.`);
	}

	editorExtension() {
		const plugin = this;
		const hidden = Decoration.replace({});
		const build = (view: EditorView): DecorationSet => {
			const text = view.state.doc.toString();
			const parsed = parse(text);
			const status = new Map(parsed.threads.map((t) => [t.thread.id, t.thread.status]));
			const ranges: { from: number; to: number; deco: Decoration }[] = [];
			for (const a of parsed.anchors) {
				const resolved = status.get(a.id) === "resolved";
				ranges.push({ from: a.openFrom, to: a.openTo, deco: hidden });
				if (a.closeFrom > a.openTo) {
					const cls = `mn-highlight${resolved ? " mn-resolved" : ""}${plugin.activeId === a.id ? " mn-active" : ""}`;
					ranges.push({ from: a.openTo, to: a.closeFrom, deco: Decoration.mark({ class: cls, attributes: { "data-mn-id": a.id } }) });
				}
				ranges.push({ from: a.closeFrom, to: a.closeTo, deco: hidden });
			}
			for (const t of parsed.threads) ranges.push({ from: t.from, to: t.to, deco: hidden });
			return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)), true);
		};
		const markers = ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				constructor(view: EditorView) {
					this.decorations = build(view);
				}
				update(u: ViewUpdate) {
					if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
					if (u.docChanged) plugin.refreshPanels();
				}
			},
			{
				decorations: (v) => v.decorations,
				eventHandlers: {
					mousedown(e) {
						const el = (e.target as HTMLElement).closest("[data-mn-id]");
						if (el) plugin.focusComment(el.getAttribute("data-mn-id")!);
					},
				},
				provide: (p) =>
					EditorView.atomicRanges.of((view) => {
						const out: ReturnType<Decoration["range"]>[] = [];
						view.plugin(p)?.decorations.between(0, view.state.doc.length, (from, to, deco) => {
							if (deco === hidden) out.push(hidden.range(from, to));
						});
						return Decoration.set(out, true);
					}),
			},
		);
		const button = StateField.define<readonly Tooltip[]>({
			create: (s) => selectionTooltip(s, plugin),
			update: (tips, tr) => (tr.docChanged || tr.selection ? selectionTooltip(tr.state, plugin) : tips),
			provide: (f) => showTooltip.computeN([f], (s) => s.field(f)),
		});
		return [markers, button];
	}
}

function selectionTooltip(state: EditorState, plugin: MarginNotes): readonly Tooltip[] {
	const sel = state.selection.main;
	if (sel.empty) return [];
	return [
		{
			pos: sel.head,
			above: sel.head < sel.anchor,
			strictSide: true,
			arrow: false,
			create: (view) => {
				const dom = createDiv({ cls: "mn-float" });
				const btn = dom.createEl("button", { text: "💬 Comment" });
				btn.addEventListener("mousedown", (e) => {
					e.preventDefault();
					plugin.promptAdd(view);
				});
				return { dom };
			},
		},
	];
}

/** One change covering only the span that differs, so the editor keeps undo history and cursor position. */
function diffChange(before: string, after: string) {
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) start++;
	let endB = before.length;
	let endA = after.length;
	while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
		endB--;
		endA--;
	}
	return { from: start, to: endB, insert: after.slice(start, endA) };
}

function cmOf(view: MarkdownView): EditorView | null {
	return ((view.editor as unknown as { cm?: EditorView }).cm) ?? null;
}

function now(): string {
	return new Date().toISOString();
}

function when(iso: string): string {
	return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

class AddCommentModal extends Modal {
	constructor(private plugin: MarginNotes, private onSave: (body: string) => void, private heading = "Add comment") {
		super(plugin.app);
	}

	onOpen() {
		this.titleEl.setText(this.heading);
		const area = this.contentEl.createEl("textarea", { cls: "mn-input", attr: { rows: "4", placeholder: "Comment… (Cmd+Enter to save)" } });
		const save = () => {
			const body = area.value.trim();
			if (!body) return;
			this.close();
			this.onSave(body);
		};
		area.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
		});
		new Setting(this.contentEl).addButton((b) => b.setButtonText("Comment").setCta().onClick(save));
		window.setTimeout(() => area.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class CommentsView extends ItemView {
	file: TFile | null = null;
	private pending = 0;

	constructor(leaf: WorkspaceLeaf, private plugin: MarginNotes) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}
	getDisplayText() {
		return "Comments";
	}
	getIcon() {
		return "message-square";
	}

	async onOpen() {
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.trackActive()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.trackActive()));
		this.registerEvent(this.app.vault.on("modify", (f) => f === this.file && this.render()));
		this.trackActive();
	}

	trackActive() {
		const f = this.app.workspace.getActiveFile();
		if (f && f.extension === "md" && f !== this.file) {
			this.file = f;
			this.plugin.activeId = null;
		}
		this.render();
	}

	render() {
		const ticket = ++this.pending;
		window.setTimeout(() => {
			if (ticket === this.pending) void this.draw();
		}, 50);
	}

	async draw() {
		const root = this.contentEl;
		root.empty();
		root.addClass("mn-panel");
		const file = this.file;
		if (!file) {
			root.createDiv({ cls: "mn-empty", text: "Open a note to see its comments." });
			return;
		}
		const text = await this.plugin.readFile(file);
		const parsed = parse(text);
		const order = new Map(parsed.anchors.map((a, i) => [a.id, i]));
		const all = parsed.threads.map((t) => t.thread).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
		const open = all.filter((t) => t.status === "open");
		const shown = this.plugin.settings.showResolved ? all : open;

		const head = root.createDiv({ cls: "mn-head" });
		head.createDiv({ cls: "mn-title", text: file.basename });
		const meta = head.createDiv({ cls: "mn-meta" });
		meta.createSpan({ text: `${open.length} open · ${all.length - open.length} resolved` });
		const toggle = meta.createEl("button", { cls: "mn-link", text: this.plugin.settings.showResolved ? "Hide resolved" : "Show resolved" });
		toggle.onclick = async () => {
			this.plugin.settings.showResolved = !this.plugin.settings.showResolved;
			await this.plugin.saveSettings();
		};

		if (!shown.length) {
			root.createDiv({ cls: "mn-empty", text: "No comments yet. Select text and click 💬 Comment." });
			return;
		}
		for (const t of shown) this.card(root, file, t);
	}

	card(root: HTMLElement, file: TFile, t: Thread) {
		const card = root.createDiv({ cls: `mn-card${t.status === "resolved" ? " mn-card-resolved" : ""}${this.plugin.activeId === t.id ? " mn-card-active" : ""}` });
		card.onclick = (e) => {
			if ((e.target as HTMLElement).closest("button, textarea")) return;
			this.plugin.jumpTo(file, t.id);
		};
		card.createDiv({ cls: "mn-quote", text: t.quote.length > 140 ? `${t.quote.slice(0, 140)}…` : t.quote });
		this.entry(card, t.by, t.at, t.text);
		for (const r of t.replies) this.entry(card, r.by, r.at, r.text);

		const actions = card.createDiv({ cls: "mn-actions" });
		const reply = actions.createEl("button", { text: "Reply" });
		const resolve = actions.createEl("button", { text: t.status === "open" ? "Resolve" : "Reopen" });
		const del = actions.createEl("button", { cls: "mn-danger", text: "Delete" });

		reply.onclick = () => {
			const box = card.createDiv({ cls: "mn-reply" });
			const area = box.createEl("textarea", { cls: "mn-input", attr: { rows: "2", placeholder: "Reply… (Cmd+Enter)" } });
			const send = async () => {
				const body = area.value.trim();
				if (!body) return;
				await this.plugin.edit(file, (text) => updateThread(text, { ...t, replies: [...t.replies, { by: this.plugin.settings.author, at: now(), text: body }] }));
			};
			area.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
			});
			box.createEl("button", { text: "Send" }).onclick = () => void send();
			area.focus();
		};
		resolve.onclick = () => void this.plugin.edit(file, (text) => updateThread(text, { ...t, status: t.status === "open" ? "resolved" : "open" }));
		del.onclick = () => {
			if (window.confirm("Delete this comment and its replies?")) void this.plugin.edit(file, (text) => removeComment(text, t.id));
		};
	}

	entry(parent: HTMLElement, by: string, at: string, text: string) {
		const e = parent.createDiv({ cls: "mn-entry" });
		const top = e.createDiv({ cls: "mn-entry-top" });
		top.createSpan({ cls: "mn-author", text: by });
		top.createSpan({ cls: "mn-time", text: when(at) });
		e.createDiv({ cls: "mn-text", text });
	}
}

class MarginNotesSettings extends PluginSettingTab {
	constructor(private plugin: MarginNotes) {
		super(plugin.app, plugin);
	}

	display() {
		this.containerEl.empty();
		new Setting(this.containerEl)
			.setName("Your name")
			.setDesc("Shown as the author on comments and replies you write.")
			.addText((t) =>
				t.setValue(this.plugin.settings.author).onChange(async (v) => {
					this.plugin.settings.author = v.trim() || systemUser();
					await this.plugin.saveSettings();
				}),
			);
	}
}

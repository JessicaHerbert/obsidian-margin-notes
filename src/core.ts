export interface Reply {
	by: string;
	at: string;
	text: string;
}

export interface Thread {
	id: string;
	by: string;
	at: string;
	status: "open" | "resolved";
	quote: string;
	text: string;
	replies: Reply[];
}

export interface Anchor {
	id: string;
	openFrom: number;
	openTo: number;
	closeFrom: number;
	closeTo: number;
}

export interface ThreadLine {
	thread: Thread;
	from: number;
	to: number;
}

export interface Change {
	from: number;
	to: number;
	insert: string;
}

export interface Parsed {
	anchors: Anchor[];
	threads: ThreadLine[];
}

const OPEN_RE = /<!--c:([a-z0-9]+)-->/g;
const CLOSE_RE = /<!--\/c:([a-z0-9]+)-->/g;
const THREAD_RE = /<!--cmt (\{.*?\})-->/g;

export const openMarker = (id: string) => `<!--c:${id}-->`;
export const closeMarker = (id: string) => `<!--/c:${id}-->`;

export function encodeThread(t: Thread): string {
	return `<!--cmt ${JSON.stringify(t).replace(/--/g, "-\\u002d")}-->`;
}

export function parse(text: string): Parsed {
	const opens = new Map<string, { from: number; to: number }>();
	for (const m of text.matchAll(OPEN_RE)) {
		opens.set(m[1], { from: m.index!, to: m.index! + m[0].length });
	}
	const anchors: Anchor[] = [];
	for (const m of text.matchAll(CLOSE_RE)) {
		const o = opens.get(m[1]);
		if (!o || o.to > m.index!) continue;
		anchors.push({ id: m[1], openFrom: o.from, openTo: o.to, closeFrom: m.index!, closeTo: m.index! + m[0].length });
	}
	anchors.sort((a, b) => a.openFrom - b.openFrom);
	const threads: ThreadLine[] = [];
	for (const m of text.matchAll(THREAD_RE)) {
		try {
			threads.push({ thread: JSON.parse(m[1]) as Thread, from: m.index!, to: m.index! + m[0].length });
		} catch {
			// A hand-edited line that no longer parses is skipped rather than breaking the panel.
		}
	}
	return { anchors, threads };
}

export function newId(existing: Set<string>): string {
	let id = "";
	do {
		id = Math.random().toString(36).slice(2, 7);
	} while (!id || existing.has(id));
	return id;
}

function threadInsert(text: string, line: string): Change {
	const hasThreads = /<!--cmt \{/.test(text);
	const end = text.length;
	let prefix = "";
	if (!text.endsWith("\n")) prefix = "\n";
	if (!hasThreads) prefix += "\n";
	return { from: end, to: end, insert: `${prefix}${line}\n` };
}

export function addComment(text: string, from: number, to: number, by: string, body: string, at: string): { id: string; changes: Change[] } {
	const parsed = parse(text);
	const id = newId(new Set(parsed.threads.map((t) => t.thread.id)));
	const thread: Thread = { id, by, at, status: "open", quote: text.slice(from, to), text: body, replies: [] };
	return {
		id,
		changes: [
			threadInsert(text, encodeThread(thread)),
			{ from: to, to, insert: closeMarker(id) },
			{ from, to: from, insert: openMarker(id) },
		],
	};
}

export function updateThread(text: string, thread: Thread): Change[] {
	const line = parse(text).threads.find((t) => t.thread.id === thread.id);
	if (!line) return [];
	return [{ from: line.from, to: line.to, insert: encodeThread(thread) }];
}

export function removeComment(text: string, id: string): Change[] {
	const parsed = parse(text);
	const changes: Change[] = [];
	const line = parsed.threads.find((t) => t.thread.id === id);
	if (line) {
		const to = text[line.to] === "\n" ? line.to + 1 : line.to;
		const lastThread = parsed.threads.length === 1;
		const from = lastThread && text[line.from - 1] === "\n" && text[line.from - 2] === "\n" ? line.from - 1 : line.from;
		changes.push({ from, to, insert: "" });
	}
	const anchor = parsed.anchors.find((a) => a.id === id);
	if (anchor) {
		changes.push({ from: anchor.closeFrom, to: anchor.closeTo, insert: "" });
		changes.push({ from: anchor.openFrom, to: anchor.openTo, insert: "" });
	}
	return changes.sort((a, b) => b.from - a.from);
}

export function applyChanges(text: string, changes: Change[]): string {
	let out = text;
	for (const c of [...changes].sort((a, b) => b.from - a.from)) {
		out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	}
	return out.replace(/\n{3,}$/, "\n");
}

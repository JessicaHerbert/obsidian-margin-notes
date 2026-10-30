import { describe, expect, it } from "vitest";
import { addComment, applyChanges, encodeThread, parse, removeComment, updateThread } from "./core";

const AT = "2026-10-30T15:00:00.000Z";

describe("addComment", () => {
	it("wraps the selection and appends a thread line", () => {
		const text = "On Track rose from 28 to 31.\n";
		const from = text.indexOf("28 to 31");
		const { id, changes } = addComment(text, from, from + 8, "Jess", "Check this", AT);
		const out = applyChanges(text, changes);
		expect(out).toContain(`<!--c:${id}-->28 to 31<!--/c:${id}-->`);
		const p = parse(out);
		expect(p.anchors).toHaveLength(1);
		expect(p.threads[0].thread).toMatchObject({ id, by: "Jess", quote: "28 to 31", text: "Check this", status: "open" });
	});

	it("handles a selection that ends the file", () => {
		const text = "last words";
		const { id, changes } = addComment(text, 5, 10, "Jess", "x", AT);
		const out = applyChanges(text, changes);
		expect(out.startsWith(`last <!--c:${id}-->words<!--/c:${id}-->\n\n<!--cmt `)).toBe(true);
	});

	it("keeps comment text containing a closing sequence intact", () => {
		const text = "abc\n";
		const { id, changes } = addComment(text, 0, 3, "Jess", "a --> b -- c", AT);
		const out = applyChanges(text, changes);
		expect(parse(out).threads.find((t) => t.thread.id === id)?.thread.text).toBe("a --> b -- c");
	});
});

describe("updateThread and removeComment", () => {
	const base = "The launch date is set.\n";
	const { id, changes } = addComment(base, 0, 6, "Jess", "Confirm the date", AT);
	const text = applyChanges(base, changes);

	it("adds a reply and resolves", () => {
		const t = parse(text).threads[0].thread;
		const next = { ...t, status: "resolved" as const, replies: [{ by: "Claude", at: AT, text: "Confirmed" }] };
		const out = applyChanges(text, updateThread(text, next));
		expect(parse(out).threads[0].thread.replies[0].text).toBe("Confirmed");
		expect(parse(out).threads[0].thread.status).toBe("resolved");
	});

	it("removes markers and the thread line", () => {
		const out = applyChanges(text, removeComment(text, id));
		expect(out).toBe(base);
	});
});

describe("parse", () => {
	it("skips a thread line that no longer parses", () => {
		const good = encodeThread({ id: "aaaaa", by: "Jess", at: AT, status: "open", quote: "q", text: "t", replies: [] });
		const p = parse(`x\n<!--cmt {broken-->\n${good}\n`);
		expect(p.threads.map((t) => t.thread.id)).toEqual(["aaaaa"]);
	});
});

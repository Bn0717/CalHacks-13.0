// The lesson screen's pure logic (src/app/ui/lesson-model.js): words, buttons, keys, the progress strip and the card's place.
import { beforeAll, describe, expect, it } from "vitest";
import type { LessonStepView, LessonView } from "../../src/app/protocol.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any;
beforeAll(async () => {
  // @ts-expect-error: a plain browser script, loaded for its side effect (globalThis.StrideLessonModel).
  await import("../../src/app/ui/lesson-model.js");
  M = (globalThis as any).StrideLessonModel;
});

const progress = {
  chapters: [{ id: "a", title: "Get ready" }, { id: "b", title: "Write the page" }],
  steps: [{ chapter: "a", mark: "done" as const }, { chapter: "b", mark: "hinted" as const }, { chapter: "b", mark: "todo" as const }],
  index: 2,
};

function step(over: Partial<LessonStepView> = {}, s: Partial<LessonStepView["step"]> = {}): LessonStepView {
  return {
    screen: "step",
    lessonTitle: "A page about me",
    progress,
    step: { id: "intro", number: 3, total: 3, title: "Say hi", instruction: "Inside <body>, add a heading.", why: "It's read first.", who: "learner", chapterTitle: "Write the page", file: "index.html", ...s },
    status: "your-turn",
    hints: [],
    hintOffered: false,
    canShowMe: false,
    doneForMe: false,
    pace: "learn",
    ...over,
  };
}

const STATUSES = ["your-turn", "typing", "checking", "passed", "partial", "stuck", "showing", "stride-working", "stride-failed", "watch"] as const;

describe("lesson model: words", () => {
  it("says times plainly", () => {
    expect(M.minutesText(22)).toBe("About 22 min");
    expect(M.minutesText(60)).toBe("About 1 hour");
    expect(M.minutesText(95)).toBe("About 1 hour 35 min");
    expect(M.minutesText(120)).toBe("About 2 hours");
    expect(M.sizeText({ minutes: 5, linesToType: 1, steps: 1 })).toBe("1 line to type · 1 step");
    expect(M.clock(95)).toBe("1:35");
  });

  it("tells code hints from sentences that mention a tag", () => {
    expect(M.isCode("<ul>\n  <li>...</li>\n</ul>")).toBe(true);
    expect(M.isCode('<link rel="stylesheet" href="...">')).toBe(true);
    expect(M.isCode("h1 { color: ...; }")).toBe(true);
    expect(M.isCode("Put three <li> items inside one <ul>.")).toBe(false);
    expect(M.isCode("Every page starts with <!DOCTYPE html>.")).toBe(false);
  });

  it("finds jargon as whole words only", () => {
    expect(M.findJargon("The selector didn't parse")).toEqual(["selector", "parse"]);
    expect(M.findJargon("Checkout the checklist")).toEqual([]);
  });

  it("every step status, hint level and error has short, jargon-free words", () => {
    const views: LessonView[] = [];
    for (const status of STATUSES) {
      for (const who of ["learner", "stride", "watch"] as const) {
        views.push(step({ status }, { who }));
        views.push(step({ status, hintOffered: true, hints: [] }, { who }));
        views.push(step({ status, hints: ["a", "b", "c"], canShowMe: true, doneForMe: status === "showing" }, { who, video: { start: 1, end: 9 } }));
      }
    }
    for (const kind of ["no-key", "no-internet", "video-unreadable", "other"] as const) views.push({ screen: "error", kind, saved: true });
    for (const v of views) {
      const text = M.allText(v);
      expect(M.findJargon(text), text).toEqual([]);
      if (v.screen === "step") {
        const st = M.stepStatus(v);
        expect(st.title.length).toBeLessThanOrEqual(30);
        expect(st.line.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it("errors say what happened and what to do next", () => {
    for (const kind of ["no-key", "no-internet", "video-unreadable", "other"] as const) {
      const e = M.errorCopy({ screen: "error", kind });
      expect(e.title.length).toBeGreaterThan(5);
      expect(e.line).toMatch(/\b(tap|try|tell|adds|Settings)\b/i);
      expect(e.actions.filter((a: any) => a.kind === "primary")).toHaveLength(1);
      // The same layout on every error: the fix first, then one way out.
      expect(e.actions.map((a: any) => a.kind)).toEqual(["primary", "secondary"]);
    }
    expect(M.errorCopy({ screen: "error", kind: "no-internet", saved: true }).line).toContain("progress is saved");
  });

  it("while Stride types it for them, the badge says Watch me, and the line is plain", () => {
    const v = step({ status: "showing", doneForMe: true });
    expect(M.whoBadge(v.step.who, v.status).text).toBe("Watch me");
    expect(M.whoBadge("learner", "typing").text).toBe("Your turn");
    expect(M.stepStatus(v).line).toBe("Watch it appear in index.html. Next time, you try.");
  });

  it("never praises wrong code: 'Still typing?', 'Getting closer', 'Almost there' only at half right, else 'Not quite yet'", () => {
    const typing = M.stepStatus(step({ status: "partial", partial: "typing", note: "Still typing? The <ul> you started still needs its closing </ul> (line 12)." }));
    expect(typing).toMatchObject({ title: "Still typing?", line: "The <ul> you started still needs its closing </ul> (line 12).", tone: "calm" });
    const closer = M.stepStatus(step({ status: "partial", partial: "closer", parts: { done: 1, total: 2 }, note: "Almost there. I see 1 list item (<li>), but this step needs 3." }));
    expect(closer).toMatchObject({ title: "Getting closer", line: "I see 1 list item (<li>), but this step needs 3.", parts: { text: "1 of 2 parts right" } });
    const half = M.stepStatus(step({ status: "stuck", parts: { done: 1, total: 2 }, note: "Almost there. One list item (<li>) is missing its closing </li>." }));
    expect(half).toMatchObject({ title: "Almost there", line: "One list item (<li>) is missing its closing </li>.", tone: "warn", parts: { done: 1, total: 2 } });
    const little = M.stepStatus(step({ status: "stuck", parts: { done: 1, total: 4 }, note: 'I can\'t see a description line (<meta name="description">) yet.' }));
    expect(little).toMatchObject({ title: "Not quite yet", parts: { text: "1 of 4 parts right" } });
    expect(M.stepStatus(step({ status: "stuck", parts: { done: 0, total: 4 } }))).toMatchObject({ title: "Not quite yet", parts: undefined });
    for (const v of [typing, closer, half, little]) expect(v.title).not.toMatch(/right track/i);
    // "Want a hint?" still says what's wrong.
    expect(M.stepStatus(step({ status: "stuck", hintOffered: true, note: "The <ul> you started still needs its closing </ul>." })).line).toBe("The <ul> you started still needs its closing </ul>.");
  });

  it("labels read-more links plainly and starts every chip with a capital letter", () => {
    expect(M.linkLabel("MDN: The ul element")).toBe("Read more: The ul element");
    expect(M.linkLabel("Read more: Lists")).toBe("Read more: Lists");
    expect(M.linkLabel("CSS basics")).toBe("Read more: CSS basics");
    expect(M.chipText("the parts of an HTML page")).toBe("The parts of an HTML page");
    expect(M.chipText("Lists")).toBe("Lists");
  });

  it("adds a few plain words after tricky ones, once, and never inside code", () => {
    expect(M.explainTerms("Type the doctype, then <html>.")).toBe("Type the doctype (the first line, which tells the browser it's a web page), then <html>.");
    expect(M.explainTerms("Every page starts with <!DOCTYPE html>.")).toBe("Every page starts with <!DOCTYPE html> (the line that tells the browser it's a web page).");
    expect(M.explainTerms("Testing it in a hidden browser")).toContain("a web browser you can't see");
    expect(M.explainTerms("Use `doctype` here")).toBe("Use `doctype` here");
    const once = M.explainTerms("the doctype and the doctype");
    expect(once.match(/web page/g)).toHaveLength(1);
  });

  it("the building screen works from stage labels and the one running now", () => {
    expect(M.buildingStages({ screen: "building", what: "x", labels: ["a", "b", "c"], stage: 1 }).map((s: any) => s.status)).toEqual(["done", "running", "todo"]);
    expect(M.buildingStages({ screen: "building", what: "x", labels: ["a", "b"], stage: 2 }).map((s: any) => s.status)).toEqual(["done", "done"]);
    const sent = [{ label: "a", status: "done" }];
    expect(M.buildingStages({ screen: "building", what: "x", stages: sent })).toEqual(sent);
  });
});

describe("lesson model: buttons and keys", () => {
  const ids = (v: LessonStepView) => M.stepActions(v).map((a: any) => a.id);
  const primary = (v: LessonStepView) => M.stepActions(v).filter((a: any) => a.kind === "primary").map((a: any) => a.id);

  it("has at most one primary button on every step card", () => {
    for (const status of STATUSES) {
      for (const hints of [[], ["a"], ["a", "b", "c"]]) {
        for (const extra of [{}, { hintOffered: true }, { canShowMe: true }, { doneForMe: true }]) {
          expect(primary(step({ status, hints, ...extra })).length).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("offers Hint, then Another hint, then Show me as the main button", () => {
    expect(ids(step())).toEqual(["hint", "skip"]);
    expect(M.stepActions(step({ hints: ["a"] }))[0].label).toBe("Another hint");
    expect(primary(step({ status: "stuck" }))).toEqual(["hint"]);
    expect(primary(step({ status: "stuck", hintOffered: true }))).toEqual(["hint"]);
    expect(M.stepActions(step({ hintOffered: true }))[0].label).toBe("Yes, give me a hint");
    expect(ids(step({ hints: ["a", "b", "c"], canShowMe: true }))).toEqual(["show-me", "skip"]);
    expect(primary(step({ hints: ["a", "b", "c"], canShowMe: true }))).toEqual(["show-me"]);
  });

  it("keeps the ✅ and Stride's typing calm: no buttons, or only Let me try", () => {
    expect(ids(step({ status: "passed" }))).toEqual([]);
    expect(ids(step({ status: "showing" }))).toEqual([]);
    expect(ids(step({ status: "showing", doneForMe: true }))).toEqual(["let-me-try"]);
    expect(ids(step({ status: "stride-working" }, { who: "stride" }))).toEqual([]);
    expect(primary(step({ status: "stride-failed" }, { who: "stride" }))).toEqual(["retry"]);
  });

  it("watch steps: Watch this part first, then Done watching", () => {
    const v = step({ status: "watch" }, { who: "watch", video: { start: 0, end: 35 } });
    expect(ids(v)).toEqual(["watch", "continue"]);
    expect(M.stepActions(v)[0]).toMatchObject({ channel: "lesson-watch", data: { start: 0, end: 35 }, key: "W" });
    expect(primary(step({ status: "watch" }, { who: "watch" }))).toEqual(["continue"]);
  });

  it("puts the video part on a chip for typing steps", () => {
    expect(M.videoChip(step())).toBeNull();
    expect(M.videoChip(step({}, { video: { start: 42, end: 95 } }))).toMatchObject({ id: "watch", key: "W", data: { start: 42, end: 95 } });
    expect(M.videoChip(step({ status: "passed" }, { video: { start: 42, end: 95 } }))).toBeNull();
  });

  it("maps H, S and N to their buttons, but never while typing in a box or with Cmd", () => {
    const acts = M.stepActions(step({ hints: ["a", "b", "c"], canShowMe: true }));
    const key = (k: string, extra: object = {}) => M.actionForKey({ key: k, target: { tagName: "BUTTON" }, ...extra }, acts);
    expect(key("s").id).toBe("show-me");
    expect(key("N").id).toBe("skip");
    expect(key("h")).toBeNull(); // no hints left
    expect(key("s", { metaKey: true })).toBeNull();
    expect(key("s", { target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(key("Escape")).toBeNull();
  });

  it("lists each key once, with Esc", () => {
    const keys = M.keyList([{ key: "H", label: "Hint" }, { key: "H", label: "Again" }, { key: "D", label: "Move to the other side", keyLabel: "Move the card" }]);
    expect(keys).toEqual([{ key: "H", label: "Hint" }, { key: "D", label: "Move the card" }, { key: "Esc", label: "Close this panel" }]);
  });
});

describe("lesson model: the progress strip and the buddy", () => {
  it("groups steps by chapter and marks the current one", () => {
    const g = M.segments(progress);
    expect(g.map((x: any) => [x.title, x.steps.length, x.current])).toEqual([["Get ready", 1, false], ["Write the page", 2, true]]);
    expect(g[1].steps[1]).toMatchObject({ current: true, number: 3 });
    expect(M.progressText(progress)).toBe("Step 3 of 3, Write the page. 2 done.");
  });

  it("the buddy watches while typing, thinks while checking, cheers on ✅ and points when stuck", () => {
    expect(M.buddyFor(step({ status: "typing" }))).toMatchObject({ pose: "idle", look: 1 });
    expect(M.buddyFor(step({ status: "checking" })).pose).toBe("think");
    expect(M.buddyFor(step({ status: "passed" })).pose).toBe("celebrate");
    expect(M.buddyFor(step({ status: "stuck" })).pose).toBe("point");
    expect(M.buddyFor(step({}, { line: 9 })).pose).toBe("point");
    expect(M.buddyFor({ screen: "error", kind: "other" }).pose).toBe("sad");
    expect(M.buddyFor({ screen: "finished" } as LessonView).pose).toBe("celebrate");
  });
});

describe("lesson model: where the card sits", () => {
  it("swaps sides, opens and closes", () => {
    let l = M.layoutReduce(undefined, { type: "noop" });
    expect(l).toEqual({ dock: "right", expanded: false });
    l = M.layoutReduce(l, { type: "toggle" });
    expect(l.expanded).toBe(true);
    l = M.layoutReduce(l, { type: "swap" });
    expect(l).toEqual({ dock: "left", expanded: true });
    expect(M.layoutReduce(l, { type: "close" })).toEqual({ dock: "left", expanded: false });
    expect(M.layoutReduce(l, { type: "set", layout: { dock: "sideways", expanded: "yes" } })).toEqual({ dock: "right", expanded: false });
  });

  it("remembers it, and copes with storage that's missing or throws", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(M.writeLayout(storage, { dock: "left", expanded: true })).toBe(true);
    expect(M.readLayout(storage)).toEqual({ dock: "left", expanded: true });
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(M.readLayout(broken)).toEqual({ dock: "right", expanded: false });
    expect(M.writeLayout(broken, { dock: "left", expanded: false })).toBe(false);
    expect(M.readLayout(null)).toEqual({ dock: "right", expanded: false });
    mem.set(M.LAYOUT_KEY, "{not json");
    expect(M.readLayout(storage)).toEqual({ dock: "right", expanded: false });
  });

  it("opens the card by itself only once per step, when the app asks", () => {
    expect(M.autoOpen(null, step({ open: "concept" }))).toBe(true);
    expect(M.autoOpen("intro", step({ open: "concept" }))).toBe(false);
    expect(M.autoOpen(null, step())).toBe(false);
  });
});

describe("lesson model: screen reader news", () => {
  it("announces a new step, a new hint and the ✅, but not repeats", () => {
    const a = step();
    expect(M.announce(null, a)).toBe("Step 3 of 3. Your turn. Say hi. Inside <body>, add a heading.");
    expect(M.announce(a, a)).toBe("");
    expect(M.announce(a, step({ hints: ["Use <h1>."] }))).toBe("Hint 1: Use <h1>.");
    expect(M.announce(a, step({ status: "passed" }))).toBe("Nice, that works! Next step coming up.");
    expect(M.announce(null, { screen: "error", kind: "no-internet" })).toContain("You're offline");
  });
});

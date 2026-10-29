// Wrong code is never praised, and half-typed code is never called wrong (A6/B7 in docs/learn/GOAL.md).
// The real checker and the real lesson runner on the about-me fixture, with a fake clock and the student's files in memory.
import { describe, expect, it } from "vitest";
import { insertAtAnchor } from "../../src/learn/anchor.js";
import { checkStep } from "../../src/learn/check/index.js";
import type { Lesson, ProjectFile, Step } from "../../src/learn/lesson.js";
import { LessonRunner, TIMING, type Effect } from "../../src/learn/runner.js";
import { stepView } from "../../src/learn/view.js";
import { aboutMe, fakeClock, START } from "./runner-fakes.js";

const lesson = aboutMe();

// The project when this step opens: every step before it typed.
function before(step: Step): Map<string, string> {
  const files = new Map<string, string>();
  for (const s of lesson.steps) {
    if (s === step) break;
    if (s.file && s.expected) files.set(s.file, insertAtAnchor(files.get(s.file) ?? "", s.anchor, s.expected).content);
  }
  return files;
}

// A runner on one step, with the real checker reading `files`.
function onStep(id: string) {
  const index = lesson.steps.findIndex((s) => s.id === id);
  const step = lesson.steps[index]!;
  const start = before(step);
  let files: ProjectFile[] = [...start].map(([path, content]) => ({ path, content }));
  const clock = fakeClock();
  const effects: Effect[] = [];
  const done = Object.fromEntries(lesson.steps.slice(0, index).map((s) => [s.id, { status: "done" as const, hintsUsed: 0 }]));
  const runner = new LessonRunner(lesson as Lesson, { lessonId: lesson.id, stepIndex: index, steps: done, pace: "learn", updatedAt: new Date(START).toISOString() }, {
    clock,
    check: (s) => checkStep(s, files),
    runStrideAction: async () => ({ ok: true }),
    onEffect: (e) => effects.push(e),
  });
  runner.start();
  const wait = async (ms: number) => {
    for (let left = ms; left > 0; left -= TIMING.tickMs) {
      clock.advance(Math.min(TIMING.tickMs, left));
      await runner.settle();
    }
  };
  // The student types `code` at the step's place (or replaces the whole file with `whole`), then stops.
  const type = async (code: string, whole?: string) => {
    const content = whole ?? insertAtAnchor(start.get(step.file!) ?? "", step.anchor, code).content;
    files = [...start].map(([path, c]) => ({ path, content: path === step.file ? content : c }));
    if (!start.has(step.file!)) files.push({ path: step.file!, content });
    runner.send({ type: "edit" });
    await wait(TIMING.settleMs);
  };
  const hints = () => effects.flatMap((e) => (e.type === "showHint" ? [e] : []));
  const view = () => stepView(lesson, runner.state)!;
  return { runner, type, wait, hints, view, step };
}

const TYPO = "    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing<li>\n      <li>Basketball</li>\n      <li>Cooking</li>\n    </ul>\n";

describe("judging the student's code", () => {
  it.each([
    {
      name: "<li>Drawing<li> on the hobbies step is wrong, and hint 1 comes 10 s later",
      step: "hobbies",
      code: TYPO,
      phase: "stuck",
      status: "stuck",
      hintAfter10s: true,
    },
    {
      name: "an empty index.html on the skeleton step is still 'your turn', with no hint",
      step: "skeleton",
      code: "",
      phase: "waiting",
      status: "your-turn",
      hintAfter10s: false,
    },
    {
      name: "a half-typed <ul><li>A</li> is 'still typing', never wrong",
      step: "hobbies",
      code: "    <h2>Things I like</h2>\n    <ul><li>A</li>\n",
      phase: "settled",
      status: "partial",
      hintAfter10s: false,
    },
    {
      name: "the quiz's wrong answer on 'Finish the head' is wrong from the start",
      step: "link-css",
      code: "    <style>style.css</style>\n",
      phase: "stuck",
      status: "stuck",
      hintAfter10s: true,
    },
  ])("$name", async ({ step, code, phase, status, hintAfter10s }) => {
    const s = onStep(step);
    await s.type(code);
    expect(s.runner.state.phase).toBe(phase);
    expect(s.view().status).toBe(status);
    await s.wait(TIMING.firstHintMs);
    expect(s.hints().length > 0).toBe(hintAfter10s);
  });

  it("a second try that fixes one of two problems is 'getting closer', then stuck when nothing more changes", async () => {
    const s = onStep("hobbies");
    await s.type("    <ul>\n      <li>Drawing</li>\n    </ul>\n"); // no heading, 1 of 3 list items
    expect(s.runner.state.phase).toBe("stuck");
    await s.type("    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing</li>\n    </ul>\n"); // the heading fixed
    expect(s.runner.state.phase).toBe("settled");
    expect(s.view()).toMatchObject({ status: "partial", partial: "closer", parts: { done: 1, total: 2 } });
    // The same code again is no progress: stuck, and hint 1 comes (10 s after the first wrong try has passed).
    await s.type("    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing</li>\n    </ul>\n");
    expect(s.runner.state.phase).toBe("stuck");
    await s.wait(TIMING.firstHintMs);
    expect(s.hints().map((h) => h.level)).toEqual([1]);
  });

  it("'getting closer' left alone for 30 s becomes stuck, so hints still come", async () => {
    const s = onStep("hobbies");
    await s.type("    <ul>\n      <li>Drawing</li>\n    </ul>\n");
    await s.type("    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing</li>\n    </ul>\n");
    expect(s.runner.state.phase).toBe("settled");
    await s.wait(TIMING.settledStuckMs);
    expect(s.runner.state.phase).toBe("stuck");
    expect(s.hints().map((h) => h.level)).toEqual([1]);
  });

  it("half-typed code left alone for 30 s becomes stuck and offers a hint", async () => {
    const s = onStep("hobbies");
    await s.type("    <h2>Things I like</h2>\n    <ul><li>A</li>\n");
    await s.wait(TIMING.settledStuckMs - TIMING.tickMs);
    expect(s.runner.state.phase).toBe("settled");
    await s.wait(TIMING.tickMs);
    expect(s.view()).toMatchObject({ status: "stuck", hintOffered: true });
  });

  it("going back to an old wrong try never counts as progress", async () => {
    const s = onStep("hobbies");
    await s.type(TYPO);
    await s.type("    <h2>Things I like</h2>\n    <ul><li>A</li>\n"); // half-typed: waits quietly
    expect(s.runner.state.phase).toBe("settled");
    await s.type(TYPO); // the same slip again
    expect(s.runner.state.phase).toBe("stuck");
  });

  it("hint 1 comes with what's wrong right now, about the first failing part", async () => {
    const s = onStep("link-css");
    await s.type("    <style>style.css</style>\n");
    await s.wait(TIMING.firstHintMs);
    const [hint] = s.hints();
    expect(hint).toMatchObject({ level: 1, reason: 'I can\'t see a description line (<meta name="description">) yet.' });
    expect(hint!.text).toMatch(/<meta>/); // the hint talks about the same thing
  });
});

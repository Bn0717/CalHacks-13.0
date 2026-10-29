import { describe, expect, it } from "vitest";
import type { Lesson, Step } from "../../src/learn/lesson.js";
import { TIMING, canShowMe, initialState, newProgress, reduce, whoLabel, type CheckOutcome, type RunnerDeps } from "../../src/learn/runner.js";
import { LessonRunner } from "../../src/learn/runner.js";
import { lessonSummary } from "../../src/learn/summary.js";
import { START, aboutMe, fail, fakeClock, harness, partial, pass } from "./runner-fakes.js";

const stepIndexOf = (lesson: Lesson, id: string) => lesson.steps.findIndex((s) => s.id === id);

describe("lesson runner: the about-me lesson from start to finish", () => {
  it("walks every step with fake check results", async () => {
    const lesson = aboutMe();
    const h = harness(lesson);
    const { runner } = h;
    const status = (id: string) => runner.state.progress.steps[id]?.status;

    // Step 1 is Stride's: it opens VS Code through the injected tool runner.
    runner.start();
    expect(h.toolCalls).toEqual([{ tool: "open_app", input: { app_name: "Visual Studio Code" } }]);
    await runner.settle();
    expect(runner.state.phase).toBe("passed");
    expect(status("open-editor")).toBe("done");
    await h.wait(TIMING.cheerMs);
    expect(runner.step?.id).toBe("skeleton");

    // Skeleton: no check while typing, a check 2 s after the last edit; partial keeps waiting, then a pass.
    h.queue("skeleton", partial, pass);
    for (let i = 0; i < 5; i++) {
      runner.send({ type: "edit" });
      await h.wait(1_000);
    }
    expect(h.checked).toEqual([]);
    expect(runner.state.phase).toBe("typing");
    await h.wait(1_000);
    expect(h.checked).toEqual(["skeleton"]);
    expect(runner.state.phase).toBe("settled");
    expect(h.hints()).toEqual([]);
    runner.send({ type: "edit" });
    await h.wait(TIMING.settleMs);
    expect(h.checked).toEqual(["skeleton", "skeleton"]);
    expect(runner.state.phase).toBe("passed");
    expect(status("skeleton")).toBe("done");
    await h.wait(TIMING.cheerMs);
    expect(runner.step?.id).toBe("intro");

    // Intro: stuck → hint 1 after 10 s → no new hint on a quick second fail → hint 2 after 30 s → hint 3 → show me.
    h.queue("intro", fail, fail);
    runner.send({ type: "edit" });
    await h.wait(TIMING.settleMs);
    expect(runner.state.phase).toBe("stuck");
    expect(h.hints()).toEqual([]);
    await h.wait(TIMING.firstHintMs - TIMING.tickMs);
    expect(h.hints()).toEqual([]);
    await h.wait(TIMING.tickMs);
    expect(h.hints()).toEqual([1]);
    expect(status("intro")).toBe("hinted");
    expect(runner.canShowMe).toBe(false);
    runner.send({ type: "showMe" }); // learn mode: not yet
    expect(h.typed).toEqual([]);

    runner.send({ type: "edit" });
    await h.wait(TIMING.settleMs);
    expect(runner.state.phase).toBe("stuck");
    expect(h.hints()).toEqual([1]); // too soon after hint 1

    await h.wait(TIMING.nextHintMs);
    expect(h.hints()).toEqual([1, 2]);
    runner.send({ type: "hintRequested" });
    expect(h.hints()).toEqual([1, 2, 3]);
    expect(runner.state.progress.steps.intro.hintsUsed).toBe(3);
    expect(runner.canShowMe).toBe(true);
    const hintTexts = h.effects.flatMap((e) => (e.type === "showHint" ? [e.text] : []));
    expect(hintTexts).toEqual(lesson.steps[stepIndexOf(lesson, "intro")].hints);

    runner.send({ type: "showMe" });
    await runner.settle();
    expect(h.typed).toEqual(["intro"]);
    expect(status("intro")).toBe("shown");
    await h.wait(TIMING.cheerMs);
    expect(runner.step?.id).toBe("hobbies");

    // Hobbies: "do this one for me", then "let me try" undoes it; a save checks right away.
    runner.send({ type: "doForMe" });
    expect(status("hobbies")).toBe("shown");
    runner.send({ type: "letMeTry" });
    await runner.settle();
    expect(h.typed).toEqual(["intro", "hobbies"]);
    expect(h.reverted).toEqual(["hobbies"]);
    expect(status("hobbies")).toBe("todo");
    expect(runner.step?.id).toBe("hobbies"); // the check of Stride's code was ignored
    runner.send({ type: "edit" });
    runner.send({ type: "save" });
    await runner.settle();
    expect(status("hobbies")).toBe("done");
    await h.wait(TIMING.cheerMs);

    // Link CSS: one asked-for hint, then a pass → hinted.
    expect(runner.step?.id).toBe("link-css");
    runner.send({ type: "hintRequested" });
    runner.send({ type: "edit" });
    await h.wait(TIMING.settleMs);
    expect(status("link-css")).toBe("hinted");
    expect(runner.state.progress.steps["link-css"].hintsUsed).toBe(1);
    await h.wait(TIMING.cheerMs);

    // Style: skipped. That's the last step.
    expect(runner.step?.id).toBe("style");
    runner.send({ type: "skip" });
    expect(status("style")).toBe("skipped");
    expect(runner.state.finished).toBe(true);
    expect(h.count("finished")).toBe(1);
    expect(h.saves.at(-1)?.stepIndex).toBe(lesson.steps.length);

    // Every step has times.
    for (const s of lesson.steps) {
      expect(runner.state.progress.steps[s.id].startedAt).toBeDefined();
      expect(runner.state.progress.steps[s.id].doneAt).toBeDefined();
    }

    // The finish summary.
    const summary = lessonSummary(lesson, runner.state.progress);
    expect(summary).toMatchObject({ steps: 5, alone: 2, hinted: 1, shown: 1, skipped: 1 });
    expect(summary.concepts).toEqual(["The parts of an HTML page", "Lists", "Linking CSS"]);
    expect(summary.minutes).toBeGreaterThan(0);
  });
});

describe("lesson runner rules", () => {
  // A lesson that starts on a learner step, so tests don't need to get past Stride's step first.
  const fromSkeleton = () => {
    const lesson = aboutMe();
    lesson.steps = lesson.steps.slice(1);
    return lesson;
  };

  it("offers a hint after 30 s without progress, once", async () => {
    const h = harness(fromSkeleton());
    h.runner.start();
    await h.wait(TIMING.offerHintMs - TIMING.tickMs);
    expect(h.count("offerHint")).toBe(0);
    await h.wait(TIMING.tickMs);
    expect(h.count("offerHint")).toBe(1);
    await h.wait(TIMING.offerHintMs * 2);
    expect(h.count("offerHint")).toBe(1);
    expect(h.hints()).toEqual([]); // only offered, not shown
  });

  it("never checks or hints while the student keeps typing", async () => {
    const h = harness(fromSkeleton());
    h.runner.start();
    for (let i = 0; i < 60; i++) {
      h.runner.send({ type: "edit" });
      await h.wait(1_000);
    }
    expect(h.checked).toEqual([]);
    expect(h.hints()).toEqual([]);
    expect(h.count("offerHint")).toBe(0);
  });

  it("ignores a check result that an edit made out of date", () => {
    const lesson = fromSkeleton();
    let s = initialState(lesson, newProgress(lesson, "learn", START), START);
    s = reduce(lesson, s, { type: "start" }, START).state;
    const saved = reduce(lesson, s, { type: "save" }, START);
    const run = saved.effects.find((e) => e.type === "runCheck");
    expect(run).toBeDefined();
    s = reduce(lesson, saved.state, { type: "edit" }, START + 100).state;
    const id = run?.type === "runCheck" ? run.checkId : -1;
    const after = reduce(lesson, s, { type: "checkResult", checkId: id, outcome: pass }, START + 200);
    expect(after.state.phase).toBe("typing");
    expect(after.state.progress.steps.skeleton.status).toBe("todo");
  });

  it("gives the next hint on a further fail once 10 s have passed since the last one", async () => {
    const h = harness(fromSkeleton());
    h.queue("skeleton", fail, fail, fail);
    h.runner.start();
    h.runner.send({ type: "save" });
    await h.runner.settle();
    await h.wait(TIMING.firstHintMs);
    expect(h.hints()).toEqual([1]);
    await h.wait(TIMING.firstHintMs);
    h.runner.send({ type: "save" });
    await h.runner.settle();
    expect(h.hints()).toEqual([1, 2]);
  });

  it("Go faster shows 'Show me' straight away; Learn more hides it until hint 3", async () => {
    const h = harness(fromSkeleton());
    h.runner.start();
    expect(h.runner.canShowMe).toBe(false);
    h.runner.send({ type: "paceChanged", pace: "fast" });
    expect(h.runner.canShowMe).toBe(true);
    expect(h.saves.at(-1)?.pace).toBe("fast");
    h.runner.send({ type: "paceChanged", pace: "learn" });
    expect(h.runner.canShowMe).toBe(false);
    for (let i = 0; i < 3; i++) h.runner.send({ type: "hintRequested" });
    expect(h.runner.canShowMe).toBe(true);
    h.runner.send({ type: "hintRequested" }); // no hint 4
    expect(h.hints()).toEqual([1, 2, 3]);
  });

  it("shows 'Show me' only on learner steps", () => {
    const lesson = aboutMe();
    const s = initialState(lesson, newProgress(lesson, "fast", START), START);
    expect(canShowMe(lesson, s)).toBe(false); // step 1 is Stride's
  });

  it("labels each step by who does it", () => {
    const lesson = aboutMe();
    expect(lesson.steps.map(whoLabel).slice(0, 2)).toEqual(["🤖 Stride", "🧑 Your turn"]);
    expect(whoLabel({ ...lesson.steps[0], who: "watch" } as Step)).toBe("👀 Watch");
  });

  it("a watch step ignores typing and moves on when the student continues", async () => {
    const lesson = aboutMe();
    lesson.steps[0] = { ...lesson.steps[0], who: "watch", strideAction: undefined };
    const h = harness(lesson);
    h.runner.start();
    h.runner.send({ type: "edit" });
    await h.wait(TIMING.settleMs * 2);
    expect(h.checked).toEqual([]);
    expect(h.toolCalls).toEqual([]);
    h.runner.send({ type: "continue" });
    expect(h.runner.state.progress.steps["open-editor"].status).toBe("done");
    expect(h.runner.step?.id).toBe("skeleton");
  });

  it("when Stride's tool fails, it says so and the student can skip", async () => {
    const h = harness(aboutMe(), { strideOk: false });
    h.runner.start();
    await h.runner.settle();
    expect(h.runner.state.phase).toBe("stuck");
    expect(h.effects.some((e) => e.type === "say" && e.text.includes("isn't installed"))).toBe(true);
    h.runner.send({ type: "skip" });
    expect(h.runner.state.progress.steps["open-editor"].status).toBe("skipped");
    expect(h.runner.step?.id).toBe("skeleton");
  });

  it("a stride step can move on with continue once it's done", async () => {
    const h = harness(aboutMe());
    h.runner.start();
    await h.runner.settle();
    h.runner.send({ type: "continue" });
    expect(h.runner.step?.id).toBe("skeleton");
  });

  it("a check that throws counts as a fail, not a crash", async () => {
    const lesson = fromSkeleton();
    const clock = fakeClock();
    const deps: RunnerDeps = {
      clock,
      check: async (): Promise<CheckOutcome> => {
        throw new Error("browser broke");
      },
      runStrideAction: async () => ({ ok: true }),
    };
    const runner = new LessonRunner(lesson, newProgress(lesson, "learn", START), deps);
    runner.start();
    runner.send({ type: "save" });
    await runner.settle();
    expect(runner.state.phase).toBe("stuck");
  });

  it("checks right when the quiet time ends after the last edit, not on the next half-second tick", async () => {
    const h = harness(fromSkeleton());
    h.runner.start();
    await h.runner.settle();
    h.clock.advance(130); // an edit between two ticks
    h.runner.send({ type: "edit" });
    h.clock.advance(TIMING.settleMs - 1);
    await h.runner.settle();
    expect(h.checked).toEqual([]); // still quiet time: never looked at while typing
    h.clock.advance(1);
    await h.runner.settle();
    expect(h.checked).toEqual(["skeleton"]);
    expect(h.runner.state.phase).toBe("passed");
  });

  it("counts the quiet time from when the edit really happened, and starts again on every edit", async () => {
    const h = harness(fromSkeleton());
    h.runner.start();
    await h.runner.settle();
    h.runner.send({ type: "edit" });
    h.clock.advance(1_000);
    h.runner.send({ type: "edit" }); // typed again: the timer starts over
    h.clock.advance(1_000);
    await h.runner.settle();
    expect(h.checked).toEqual([]);
    h.clock.advance(TIMING.settleMs - 1_000);
    await h.runner.settle();
    expect(h.checked).toEqual(["skeleton"]);

    const late = harness(fromSkeleton());
    late.runner.start();
    await late.runner.settle();
    const at = late.clock.now();
    late.clock.advance(200); // the folder watcher noticed the change 200 ms late
    late.runner.send({ type: "edit", at });
    late.clock.advance(TIMING.settleMs - 200);
    await late.runner.settle();
    expect(late.checked).toEqual(["skeleton"]);
  });

  it("keeps all timing rules in one object", () => {
    expect(TIMING).toMatchObject({ settleMs: 1_500, firstHintMs: 10_000, nextHintMs: 30_000, offerHintMs: 30_000 });
  });
});

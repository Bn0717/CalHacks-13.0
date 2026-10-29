// What the lesson screen is sent: runner state → LessonView (src/learn/view.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILD_STAGES, BUILD_TIME_TEXT, STAGE_LABELS } from "../../src/learn/stages.js";
import { TIMING, initialState, newProgress, reduce, type RunnerEvent, type RunnerState } from "../../src/learn/runner.js";
import { lessonSummary } from "../../src/learn/summary.js";
import { buildingView, estimateView, finishedView, pausedView, progressView, quizView, simplerLearns, stepStatus, stepView } from "../../src/learn/view.js";
import { START, aboutMe, fail, partial, pass } from "./runner-fakes.js";

const lesson = aboutMe();

// Plays events through the pure runner, returning the state after each.
function play(events: (RunnerEvent | { wait: number })[], from?: RunnerState): RunnerState {
  let now = START;
  let state = from ?? initialState(lesson, newProgress(lesson, "learn", now), now);
  for (const e of events) {
    if ("wait" in e) {
      now += e.wait;
      state = reduce(lesson, state, { type: "tick" }, now).state;
    } else state = reduce(lesson, state, e, now).state;
  }
  return state;
}
const atStep = (id: string): RunnerState => {
  const s = initialState(lesson, { ...newProgress(lesson, "learn", START), stepIndex: lesson.steps.findIndex((x) => x.id === id) }, START);
  return reduce(lesson, s, { type: "start" }, START).state;
};

describe("lesson view: the step card", () => {
  it("a Stride step shows Stride working, then passed", () => {
    const s = play([{ type: "start" }]);
    expect(stepStatus(lesson, s)).toBe("stride-working");
    const done = reduce(lesson, s, { type: "strideResult", ok: true }, START).state;
    expect(stepStatus(lesson, done)).toBe("passed");
    const failed = reduce(lesson, s, { type: "strideResult", ok: false }, START).state;
    expect(stepStatus(lesson, failed)).toBe("stride-failed");
  });

  it("follows a typing step: your turn → typing → checking → partial → stuck → passed", () => {
    let s = atStep("intro");
    expect(stepStatus(lesson, s)).toBe("your-turn");
    s = play([{ type: "edit" }], s);
    expect(stepStatus(lesson, s)).toBe("typing");
    s = play([{ type: "save" }], s);
    expect(stepStatus(lesson, s)).toBe("checking");
    const id = s.checkId;
    expect(stepStatus(lesson, reduce(lesson, s, { type: "checkResult", checkId: id, outcome: partial }, START).state)).toBe("partial");
    expect(stepStatus(lesson, reduce(lesson, s, { type: "checkResult", checkId: id, outcome: fail }, START).state)).toBe("stuck");
    expect(stepStatus(lesson, reduce(lesson, s, { type: "checkResult", checkId: id, outcome: pass }, START).state)).toBe("passed");
  });

  it("carries the step, the hints shown so far, Show me and the progress strip", () => {
    let s = atStep("hobbies");
    s = play([{ type: "hintRequested" }, { type: "hintRequested" }], s);
    const v = stepView(lesson, s, { line: 12, note: "One list item isn't closed yet." })!;
    expect(v.step).toMatchObject({ id: "hobbies", number: 4, total: 6, who: "learner", file: "index.html", line: 12, chapterTitle: "Write the page" });
    expect(v.step.concept?.title).toBe("Lists");
    expect(v.hints).toEqual(lesson.steps[3].hints.slice(0, 2));
    expect(v.canShowMe).toBe(false);
    expect(v.note).toBe("One list item isn't closed yet.");
    expect(v.progress.index).toBe(3);
    expect(v.progress.steps[3].mark).toBe("hinted");
    s = play([{ type: "hintRequested" }], s);
    expect(stepView(lesson, s)!.canShowMe).toBe(true);
  });

  it("shows Stride typing it as 'showing', and marks the step shown", () => {
    const s = play([{ type: "paceChanged", pace: "fast" }, { type: "showMe" }], atStep("intro"));
    const v = stepView(lesson, s)!;
    expect(v.status).toBe("showing");
    expect(v.progress.steps[2].mark).toBe("shown");
    const forMe = stepView(lesson, play([{ type: "doForMe" }], atStep("intro")))!;
    expect(forMe.doneForMe).toBe(true);
  });

  it("offers a hint after a quiet spell, and only before any hint", () => {
    const s = play([{ wait: TIMING.offerHintMs + TIMING.tickMs }], atStep("intro"));
    expect(stepView(lesson, s)!.hintOffered).toBe(true);
    expect(stepView(lesson, play([{ type: "hintRequested" }], s))!.hintOffered).toBe(false);
  });

  it("is null once the lesson is finished", () => {
    const s = initialState(lesson, { ...newProgress(lesson, "learn", START), stepIndex: lesson.steps.length }, START);
    expect(stepView(lesson, s)).toBeNull();
  });
});

describe("lesson view: the other screens", () => {
  it("estimate: the honest numbers, and the simpler version when there is one", () => {
    expect(estimateView(lesson)).toMatchObject({ screen: "estimate", estimate: lesson.estimate });
    expect(estimateView(lesson)).not.toHaveProperty("simpler");
    const big = { ...lesson, simpler: { title: "Just a hello", why: "Quick win first.", estimate: { minutes: 8, linesToType: 6, steps: 3 } } };
    expect(estimateView(big)).toMatchObject({ simpler: { title: "Just a hello", estimate: { minutes: 8 } } });
  });

  it("estimate: the simple option lists what the simple version teaches, not the whole lesson's list", () => {
    // From the simple version's own steps: skeleton, intro and hobbies bring their new ideas (in step order).
    const core = { ...lesson, simpler: { title: "Just a hello", why: "Quick win first.", estimate: { minutes: 8, linesToType: 6, steps: 3 }, stepIds: ["open-editor", "skeleton", "intro", "hobbies"] } };
    const ideas = ["skeleton", "intro", "hobbies"].map((id) => lesson.steps.find((s) => s.id === id)!.concept!.title);
    const v = estimateView(core) as Extract<ReturnType<typeof estimateView>, { screen: "estimate" }>;
    expect(v.simpler?.learns).toEqual(ideas);
    expect(v.simpler?.learns).not.toContain(lesson.learns[2]); // "linking a CSS file" is only in the full lesson
    expect(v.learns).toEqual(lesson.learns); // the full lesson keeps its own list
    // A list written for the simple version wins.
    expect(simplerLearns({ ...core, simpler: { ...core.simpler, learns: ["a big heading"] } })).toEqual(["a big heading"]);
    // No list and no steps: nothing, rather than a list that promises too much.
    expect(simplerLearns({ ...core, simpler: { ...core.simpler, stepIds: undefined } })).toEqual([]);
  });

  it("building: the builder's real stages in order, ticked up to the one running now, with the honest time", () => {
    const labels = BUILD_STAGES.idea.map((s) => STAGE_LABELS[s]);
    const v = buildingView("A page about me", "idea", "browser");
    expect(v).toMatchObject({ screen: "building", stage: 2, labels, time: BUILD_TIME_TEXT });
    expect((v as { stages: { status: string }[] }).stages.map((s) => s.status)).toEqual(["done", "done", "running", "todo", "todo", "todo"]);
    const done = buildingView("x", "video", "done") as { stages: { status: string }[]; labels: string[] };
    expect(done.labels).toEqual(BUILD_STAGES.video.map((s) => STAGE_LABELS[s]));
    expect(done.stages.every((s) => s.status === "done")).toBe(true);
    // The preview page shows the same stages and time, so its screenshots match what the app will send.
    const preview = readFileSync(new URL("../../src/app/ui/lesson-preview.js", import.meta.url), "utf8");
    for (const label of labels) expect(preview).toContain(JSON.stringify(label));
    expect(preview).toContain(JSON.stringify(BUILD_TIME_TEXT));
  });

  it("welcome back: the same step, and only this step's hints (the ones still on screen)", () => {
    const progress = { ...newProgress(lesson, "learn", START), stepIndex: 3, steps: { intro: { status: "hinted" as const, hintsUsed: 2 }, hobbies: { status: "hinted" as const, hintsUsed: 1 } } };
    expect(pausedView(lesson, progress, "welcome-back")).toMatchObject({ screen: "paused", reason: "welcome-back", step: { number: 4, total: 6, title: "Things you like" }, hintsUsed: 1 });
    expect(progressView(lesson, progress).steps[2].mark).toBe("hinted");
  });

  it("quiz: the question first, the answer only after a pick", () => {
    const progress = newProgress(lesson, "learn", START);
    const before = quizView(lesson, progress, "style")!;
    expect(before).toMatchObject({ screen: "quiz", chapterTitle: "Make it look nice" });
    expect(before).not.toHaveProperty("answer");
    expect(quizView(lesson, progress, "style", 0)).toMatchObject({ picked: 0, answer: 1 });
    expect(quizView(lesson, progress, "intro")).toBeNull();
  });

  it("finished: what they built, what they learned, and how each step went", () => {
    const steps = Object.fromEntries(lesson.steps.map((s) => [s.id, { status: "done" as const, hintsUsed: 0, startedAt: new Date(START).toISOString(), doneAt: new Date(START + 20 * 60_000).toISOString() }]));
    steps.intro = { ...steps.intro, status: "hinted" as never, hintsUsed: 1 };
    const progress = { ...newProgress(lesson, "learn", START), stepIndex: lesson.steps.length, steps };
    const v = finishedView(lesson, lessonSummary(lesson, progress), "data:image/png;base64,AAAA");
    expect(v).toMatchObject({ screen: "finished", steps: 5, alone: 4, hinted: 1, shown: 0, minutes: 20, picture: "data:image/png;base64,AAAA" });
    expect((v as { learned: string[] }).learned).toContain("Lists");
  });
});

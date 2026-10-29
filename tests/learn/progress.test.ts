import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Progress } from "../../src/learn/lesson.js";
import {
  createProgressStore,
  defaultProgressDir,
  progressFileName,
  resumeRunner,
  welcomeBackText,
} from "../../src/learn/progress.js";
import { TIMING, type Effect, type RunnerDeps } from "../../src/learn/runner.js";
import { START, aboutMe, fakeClock, pass } from "./runner-fakes.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stride-progress-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const progress = (over: Partial<Progress> = {}): Progress => ({
  lessonId: "about-me",
  stepIndex: 2,
  steps: { "open-editor": { status: "done", hintsUsed: 0 } },
  pace: "learn",
  updatedAt: new Date(START).toISOString(),
  ...over,
});

describe("progress store", () => {
  it("saves and loads progress", async () => {
    const store = createProgressStore(dir);
    expect(await store.load("about-me")).toBeNull();
    await store.save(progress());
    expect(await store.load("about-me")).toEqual(progress());
    expect(readdirSync(dir)).toEqual(["about-me.json"]);
    await store.clear("about-me");
    expect(await store.load("about-me")).toBeNull();
  });

  it("starts fresh when the file is broken or doesn't match", async () => {
    const store = createProgressStore(dir);
    writeFileSync(join(dir, "about-me.json"), "{ not json");
    expect(await store.load("about-me")).toBeNull();
    writeFileSync(join(dir, "about-me.json"), JSON.stringify({ ...progress(), stepIndex: -3 }));
    expect(await store.load("about-me")).toBeNull();
    writeFileSync(join(dir, "about-me.json"), JSON.stringify(progress({ lessonId: "other" })));
    expect(await store.load("about-me")).toBeNull();
  });

  it("refuses to save progress that isn't valid", async () => {
    const store = createProgressStore(dir);
    await expect(store.save({ ...progress(), pace: "turbo" } as unknown as Progress)).rejects.toThrow();
  });

  it("keeps the latest of several quick saves", async () => {
    const store = createProgressStore(dir);
    await Promise.all([1, 2, 3, 4].map((i) => store.save(progress({ stepIndex: i }))));
    expect((await store.load("about-me"))?.stepIndex).toBe(4);
  });

  it("makes safe file names", () => {
    expect(progressFileName("about-me")).toBe("about-me.json");
    const evil = progressFileName("../../etc/passwd");
    expect(evil).toMatch(/^[a-zA-Z0-9_-]+\.json$/);
    expect(progressFileName("a/b")).not.toBe(progressFileName("a_b"));
    expect(progressFileName("")).toMatch(/^lesson-[0-9a-f]{8}\.json$/);
    expect(defaultProgressDir()).toMatch(/Library\/Application Support\/Stride\/progress$/);
  });

  it("says welcome back with the step to resume", () => {
    const lesson = aboutMe();
    expect(welcomeBackText(lesson, progress())).toBe("Welcome back! Step 3: Say hi.");
    expect(welcomeBackText(lesson, progress({ stepIndex: 0, steps: {} }))).toBeNull();
  });
});

describe("resume after reload", () => {
  it("a new runner from saved progress opens the same step", async () => {
    const lesson = aboutMe();
    const store = createProgressStore(dir);
    const clock = fakeClock();
    const effects: Effect[] = [];
    const deps: Omit<RunnerDeps, "saveProgress"> = {
      clock,
      check: async () => pass,
      runStrideAction: async () => ({ ok: true }),
      onEffect: (e) => effects.push(e),
    };

    // First session: Stride's step, the skeleton, then a hint on "Say hi". Then the laptop closes.
    const first = await resumeRunner(lesson, store, deps);
    first.start();
    await first.settle();
    first.send({ type: "continue" });
    first.send({ type: "save" });
    await first.settle();
    clock.advance(TIMING.cheerMs);
    await first.settle();
    expect(first.step?.id).toBe("intro");
    first.send({ type: "paceChanged", pace: "fast" });
    first.send({ type: "hintRequested" });
    await first.settle();
    first.stop();
    expect(effects[0]).toMatchObject({ type: "openStep", index: 0, welcomeBack: false });

    // Next day: a new store and runner read it back.
    const second = await resumeRunner(lesson, createProgressStore(dir), deps);
    expect(second.step?.id).toBe("intro");
    expect(second.state.progress.pace).toBe("fast");
    expect(second.state.hintLevel).toBe(1);
    expect(second.state.progress.steps.skeleton.status).toBe("done");
    effects.length = 0;
    second.start();
    expect(effects[0]).toMatchObject({ type: "openStep", index: 2, welcomeBack: true });
    expect(welcomeBackText(lesson, second.state.progress)).toBe("Welcome back! Step 3: Say hi.");

    // The next hint carries on from where it was.
    second.send({ type: "hintRequested" });
    expect(effects.filter((e) => e.type === "showHint").map((e) => (e.type === "showHint" ? e.level : 0))).toEqual([2]);
    second.stop();
  });

  it("starts fresh when nothing is saved, or the saved step is past the lesson", async () => {
    const lesson = aboutMe();
    const store = createProgressStore(dir);
    const deps = { clock: fakeClock(), check: async () => pass, runStrideAction: async () => ({ ok: true }) };
    expect((await resumeRunner(lesson, store, deps, "fast")).state.progress).toMatchObject({ stepIndex: 0, pace: "fast" });
    await store.save(progress({ stepIndex: 99 }));
    expect((await resumeRunner(lesson, store, deps)).state.progress.stepIndex).toBe(0);
  });
});

// Shared fakes for the runner tests: a fake clock, a fake checker and a fake Stride tool runner. Nothing real runs.
import { readFileSync } from "node:fs";
import type { Lesson, Step } from "../../src/learn/lesson.js";
import { LessonRunner, TIMING, type CheckOutcome, type Clock, type Effect, type RunnerDeps } from "../../src/learn/runner.js";

const fixtureText = readFileSync(new URL("./fixtures/about-me.lesson.json", import.meta.url), "utf8");
export const aboutMe = (): Lesson => JSON.parse(fixtureText) as Lesson;

export const START = Date.parse("2026-10-29T12:00:00.000Z");

export interface FakeClock extends Clock {
  advance(ms: number): void;
}

export function fakeClock(start = START): FakeClock {
  let t = start;
  const timers: { ms: number; fn: () => void; next: number; live: boolean }[] = [];
  return {
    now: () => t,
    every(ms, fn) {
      const timer = { ms, fn, next: t + ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.live && x.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        t = due.next;
        due.next += due.ms;
        due.fn();
      }
      t = end;
    },
  };
}

export const pass: CheckOutcome = { status: "pass", failed: [], message: "Nice!" };
export const partial: CheckOutcome = { status: "partial", failed: [{ type: "parses" }], message: "Getting there", passed: 0, total: 1 };
export const fail: CheckOutcome = { status: "fail", failed: [{ type: "parses" }, { type: "parses" }], message: "Not yet", passed: 0, total: 2 };

// A runner on fakes. Queue check results per step id; anything not queued passes.
export function harness(lesson: Lesson, opts: { progress?: LessonRunner["state"]["progress"]; strideOk?: boolean } = {}) {
  const clock = fakeClock();
  const results = new Map<string, CheckOutcome[]>();
  const effects: Effect[] = [];
  const checked: string[] = [];
  const typed: string[] = [];
  const reverted: string[] = [];
  const toolCalls: { tool: string; input: Record<string, unknown> }[] = [];
  const saves: LessonRunner["state"]["progress"][] = [];
  const deps: RunnerDeps = {
    clock,
    check: async (step: Step) => {
      checked.push(step.id);
      return results.get(step.id)?.shift() ?? pass;
    },
    runStrideAction: async (tool, input) => {
      toolCalls.push({ tool, input });
      return opts.strideOk === false ? { ok: false, message: "VS Code isn't installed." } : { ok: true };
    },
    saveProgress: (p) => {
      saves.push(p);
    },
    typeCode: (step) => {
      typed.push(step.id);
    },
    revertCode: (step) => {
      reverted.push(step.id);
    },
    onEffect: (e) => effects.push(e),
  };
  const progress = opts.progress ?? { lessonId: lesson.id, stepIndex: 0, steps: {}, pace: "learn" as const, updatedAt: new Date(START).toISOString() };
  const runner = new LessonRunner(lesson, progress, deps);

  // Let time pass a tick at a time, letting fake checks finish in between.
  const wait = async (ms: number) => {
    for (let left = ms; left > 0; left -= TIMING.tickMs) {
      clock.advance(Math.min(TIMING.tickMs, left));
      await runner.settle();
    }
  };
  const queue = (stepId: string, ...outcomes: CheckOutcome[]) => results.set(stepId, [...(results.get(stepId) ?? []), ...outcomes]);
  const hints = () => effects.flatMap((e) => (e.type === "showHint" ? [e.level] : []));
  const count = (type: Effect["type"]) => effects.filter((e) => e.type === type).length;
  return { runner, clock, deps, effects, checked, typed, reverted, toolCalls, saves, wait, queue, hints, count };
}

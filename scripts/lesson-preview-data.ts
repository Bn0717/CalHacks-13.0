// Makes the lesson preview's "partial", "stuck" and hint states from the real product, so the screenshots show what a
// student really reads: the about-me fixture, a pretend student's code, the real checker (src/learn/check), the real
// lesson runner (src/learn/runner.ts) and the real step card builder (src/learn/view.ts). Nothing is hand-written.
//   npx tsx scripts/lesson-preview-data.ts          writes src/app/ui/lesson-preview-data.js
// tests/learn/preview-data.test.ts fails when the saved file is out of date.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LessonStepView } from "../src/app/protocol.js";
import { insertAtAnchor } from "../src/learn/anchor.js";
import { checkStep } from "../src/learn/check/index.js";
import { parseLesson, type Lesson, type ProjectFile, type Step } from "../src/learn/lesson.js";
import { initialState, reduce, TIMING, type CheckOutcome, type RunnerEvent, type RunnerState } from "../src/learn/runner.js";
import { stepView } from "../src/learn/view.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE = join(REPO, "tests/learn/fixtures/about-me.lesson.json");
export const OUT = join(REPO, "src/app/ui/lesson-preview-data.js");

export type PreviewState = { step: string; typed: string; view: LessonStepView };

// The pretend student's tries. Each state replays them through the runner and keeps the last view.
type Try = { typed: string; wait?: number; hints?: number };
type Scenario = { step: string; tries: Try[] };

const SCENARIOS: Record<string, Scenario> = {
  // Stopped half-way through the list: never judged.
  partial: { step: "hobbies", tries: [{ typed: "    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing</li>\n" }] },
  // A first try with one list item and no heading, then the heading added: closer than before.
  closer: {
    step: "hobbies",
    tries: [
      { typed: "    <ul>\n      <li>Drawing</li>\n    </ul>\n" },
      { typed: "    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing</li>\n    </ul>\n" },
    ],
  },
  // "<li>Drawing<li>": wrong even though the heading is right. Hint 1 comes 10 s later.
  stuck: { step: "hobbies", tries: [{ typed: typo() }] },
  "hint-1": { step: "hobbies", tries: [{ typed: typo(), wait: TIMING.firstHintMs }] },
  "hint-2": { step: "hobbies", tries: [{ typed: typo(), wait: TIMING.firstHintMs, hints: 1 }] },
  "hint-3": { step: "hobbies", tries: [{ typed: typo(), wait: TIMING.firstHintMs, hints: 2 }] },
  // Half-typed, then left alone: it becomes stuck and "Want a hint?" comes up.
  "want-hint": { step: "hobbies", tries: [{ typed: "    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing</li>\n", wait: TIMING.settledStuckMs }] },
  // Nothing right yet (the quiz's wrong answer), with hint 1: the problem and the hint are shown together.
  "stuck-wrong": { step: "link-css", tries: [{ typed: "    <style>style.css</style>\n", wait: TIMING.firstHintMs }] },
};

function typo(): string {
  return "    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing<li>\n      <li>Basketball</li>\n      <li>Cooking</li>\n    </ul>\n";
}

// The project as it is when this step opens (every step before it typed), plus what the student typed for it.
export function projectAt(lesson: Lesson, step: Step, typed: string): ProjectFile[] {
  const files = new Map<string, string>();
  for (const s of lesson.steps) {
    if (s === step) break;
    if (s.file && s.expected) files.set(s.file, insertAtAnchor(files.get(s.file) ?? "", s.anchor, s.expected).content);
  }
  if (step.file) files.set(step.file, insertAtAnchor(files.get(step.file) ?? "", step.anchor, typed).content);
  return [...files].map(([path, content]) => ({ path, content }));
}

async function play(lesson: Lesson, scenario: Scenario): Promise<PreviewState> {
  const index = lesson.steps.findIndex((s) => s.id === scenario.step);
  const step = lesson.steps[index]!;
  let now = Date.parse("2026-10-29T12:00:00.000Z");
  const done = Object.fromEntries(lesson.steps.slice(0, index).map((s) => [s.id, { status: "done" as const, hintsUsed: 0 }]));
  let state: RunnerState = initialState(lesson, { lessonId: lesson.id, stepIndex: index, steps: done, pace: "learn", updatedAt: new Date(now).toISOString() }, now);
  let note: string | undefined;
  const send = (event: RunnerEvent) => {
    const t = reduce(lesson, state, event, now);
    state = t.state;
    return t.effects;
  };
  const tick = (ms: number) => {
    for (let left = ms; left > 0; left -= TIMING.tickMs) {
      now += Math.min(TIMING.tickMs, left);
      send({ type: "tick" });
    }
  };
  send({ type: "start" });
  let typed = "";
  for (const t of scenario.tries) {
    typed = t.typed;
    now += 1_000;
    send({ type: "edit" });
    now += TIMING.settleMs;
    const run = send({ type: "tick" }).find((e) => e.type === "runCheck");
    if (!run || run.type !== "runCheck") throw new Error("The runner didn't start a check.");
    const outcome: CheckOutcome = await checkStep(step, projectAt(lesson, step, typed));
    if (outcome.status !== "pass" && !outcome.untouched) note = outcome.message; // what the session shows (session.ts)
    send({ type: "checkResult", checkId: run.checkId, outcome });
    if (t.wait) tick(t.wait);
    for (let i = 0; i < (t.hints ?? 0); i++) send({ type: "hintRequested" });
  }
  const view = stepView(lesson, state, { line: 12, ...(note ? { note } : {}) });
  if (!view) throw new Error("No step card.");
  return { step: step.id, typed, view };
}

export async function buildPreviewData(): Promise<Record<string, PreviewState>> {
  const lesson = parseLesson(await readFile(FIXTURE, "utf8"));
  const out: Record<string, PreviewState> = {};
  for (const [name, scenario] of Object.entries(SCENARIOS)) out[name] = await play(lesson, scenario);
  return out;
}

export function previewDataSource(data: Record<string, PreviewState>): string {
  return [
    "// Made by scripts/lesson-preview-data.ts from the real checker, runner and step card builder. Don't edit by hand:",
    "// run `npx tsx scripts/lesson-preview-data.ts` after changing them (tests/learn/preview-data.test.ts checks it's current).",
    `window.StrideLessonPreviewData = ${JSON.stringify(data, null, 2)};`,
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(OUT, previewDataSource(await buildPreviewData()));
  console.log(`Saved ${OUT}`);
}

// Automatic grading of a built lesson against docs/learn/GOAL.md (A3-A7), without any model.
// Each criterion passes or fails and lists its worst examples, so a report can show exactly what to fix.
// The check runner is passed in: the real checker with the hidden browser in the eval, a fake in tests.
import type { TooBig } from "./build-from-idea.js";
import { JARGON } from "./check/words.js";
import { estimateFor, linesIn, parseLesson, LessonError, type Lesson, type Step } from "./lesson.js";
import { hintGivesAway, looksLikeCode, normCode, stepRuleProblems } from "./rules.js";
import { describeProblems, selfValidateSteps, type CheckRunner } from "./validate.js";

export type CriterionId =
  | "valid"
  | "checks"
  | "stepSize"
  | "whoTypes"
  | "estimate"
  | "concepts"
  | "hints"
  | "video"
  | "tooBig";

export type Criterion = {
  id: CriterionId;
  title: string;
  pass: boolean;
  examples: string[]; // the worst offenders first, at most MAX_EXAMPLES
  skipped?: string; // why it doesn't apply to this lesson (then it counts as a pass)
};

export type Grade = { name: string; kind: "lesson" | "tooBig"; lessonId?: string; criteria: Criterion[]; passed: number; total: number };

export type GradeDeps = {
  runCheck: CheckRunner;
  videoSeconds?: number; // how long the video is (video lessons), so timestamps can be checked against it
};

export const MAX_EXAMPLES = 3;
export const STEP_LINES = { min: 3, max: 10 } as const;
// Concept wording: one sentence of at most this many words.
export const CONCEPT_MAX_WORDS = 30;

const TITLES: Record<CriterionId, string> = {
  valid: "Valid lesson",
  checks: "Every check passes on the finished project; the first fails on an empty one",
  stepSize: `Every 🧑 step adds ${STEP_LINES.min}-${STEP_LINES.max} lines`,
  whoTypes: "🧑 steps hold all the code to learn; 🤖/👀 steps add none",
  estimate: "Estimate matches the steps and is in a sensible range",
  concepts: "Each concept: one plain sentence, no jargon, with a link",
  hints: "Hints get stronger, and hint 3 isn't the whole answer",
  video: "Video steps link to a real part of the video",
  tooBig: "A huge ask gets a small offer, not a flat no",
};

function criterion(id: CriterionId, bad: { score: number; text: string }[], skipped?: string): Criterion {
  const examples = [...bad].sort((a, b) => b.score - a.score).slice(0, MAX_EXAMPLES).map((b) => b.text);
  return { id, title: TITLES[id], pass: bad.length === 0, examples, ...(skipped ? { skipped } : {}) };
}

function finish(name: string, kind: Grade["kind"], criteria: Criterion[], lessonId?: string): Grade {
  return { name, kind, ...(lessonId ? { lessonId } : {}), criteria, passed: criteria.filter((c) => c.pass).length, total: criteria.length };
}

// Grades one lesson (a parsed Lesson or raw JSON). An invalid lesson only gets the "valid" criterion.
export async function gradeLesson(name: string, raw: unknown, deps: GradeDeps): Promise<Grade> {
  let lesson: Lesson;
  try {
    lesson = parseLesson(raw);
  } catch (e) {
    const problems = e instanceof LessonError && e.problems.length ? e.problems : [(e as Error).message];
    return finish(name, "lesson", [criterion("valid", problems.map((p, i) => ({ score: -i, text: p })))]);
  }
  return finish(
    name,
    "lesson",
    [
      criterion("valid", []),
      await gradeChecks(lesson, deps.runCheck),
      gradeStepSize(lesson),
      gradeWhoTypes(lesson),
      gradeEstimate(lesson),
      gradeConcepts(lesson),
      gradeHints(lesson),
      gradeVideo(lesson, deps.videoSeconds),
    ],
    lesson.id,
  );
}

// A "too big" answer ("make me Instagram") must offer something small, kindly.
export function gradeTooBig(name: string, result: TooBig | { kind: string }): Grade {
  const bad: { score: number; text: string }[] = [];
  if (result.kind !== "tooBig") bad.push({ score: 3, text: `Came back as "${result.kind}", not tooBig with a small offer.` });
  else {
    const r = result as TooBig;
    if (!r.smaller.request.trim()) bad.push({ score: 2, text: "No smaller version is offered." });
    if (!/how about/i.test(r.smaller.say)) bad.push({ score: 1, text: `The offer doesn't suggest anything: "${r.smaller.say}"` });
    if (/\b(sorry|can't help|cannot|refuse|not possible|won't)\b/i.test(r.smaller.say)) bad.push({ score: 1, text: `Sounds like a flat no: "${r.smaller.say}"` });
    if (r.smaller.request.length > 120) bad.push({ score: 0, text: "The smaller version is described at great length." });
  }
  return finish(name, "tooBig", [criterion("tooBig", bad)]);
}

// ---------- Criteria ----------

async function gradeChecks(lesson: Lesson, runCheck: CheckRunner): Promise<Criterion> {
  const r = await selfValidateSteps(lesson.steps, lesson.files, runCheck);
  const bad = r.problems.map((p) => ({ score: p.reason === "passesOnEmpty" ? 2 : 1, text: describeProblems([p]) }));
  for (const id of r.needsFix) bad.push({ score: 3, text: `Step ${id} has no check that works.` });
  return criterion("checks", bad);
}

function gradeStepSize(lesson: Lesson): Criterion {
  const bad = learnerSteps(lesson)
    .map((s) => ({ s, n: linesIn(s.expected) }))
    .filter(({ n }) => n < STEP_LINES.min || n > STEP_LINES.max)
    .map(({ s, n }) => ({ score: n > STEP_LINES.max ? n - STEP_LINES.max : STEP_LINES.min - n, text: `Step ${s.id} adds ${n} line${n === 1 ? "" : "s"}.` }));
  return criterion("stepSize", bad);
}

// 🤖/👀 steps add no code; 🧑 steps add code; and the 🧑 steps between them type (nearly) the whole finished project.
function gradeWhoTypes(lesson: Lesson): Criterion {
  const bad: { score: number; text: string }[] = [];
  for (const s of lesson.steps) {
    if (s.who !== "learner") {
      for (const p of stepRuleProblems(s)) bad.push({ score: 3, text: p });
    } else if (linesIn(s.expected) === 0) bad.push({ score: 1, text: `Step ${s.id} is a 🧑 step that adds no code.` });
  }
  const typed = new Map<string, number>();
  for (const s of learnerSteps(lesson)) for (const line of codeLines(s.expected)) typed.set(line, (typed.get(line) ?? 0) + 1);
  for (const f of lesson.files) {
    const lines = codeLines(f.content);
    const missing = lines.filter((line) => {
      const left = typed.get(line) ?? 0;
      if (left > 0) typed.set(line, left - 1);
      return left === 0;
    });
    const share = lines.length ? missing.length / lines.length : 0;
    if (share > 0.1) {
      bad.push({ score: 2 + share, text: `${f.path}: ${missing.length} of ${lines.length} lines are never typed by the student, e.g. "${missing[0]}".` });
    }
  }
  return criterion("whoTypes", bad);
}

// The estimate must be the one code works out from the steps, and between a fast and a slow beginner's pace.
export function sensibleMinutes(lines: number, steps: number): { min: number; max: number } {
  return { min: Math.floor(lines * 0.3 + steps * 0.25), max: Math.ceil(lines * 1.5 + steps * 2 + 5) };
}

function gradeEstimate(lesson: Lesson): Criterion {
  const bad: { score: number; text: string }[] = [];
  const real = estimateFor(lesson.steps);
  const e = lesson.estimate;
  if (e.steps !== real.steps) bad.push({ score: 3, text: `Says ${e.steps} steps, but has ${real.steps}.` });
  if (e.linesToType !== real.linesToType) bad.push({ score: 3, text: `Says ${e.linesToType} lines to type, but the steps add ${real.linesToType}.` });
  const range = sensibleMinutes(real.linesToType, real.steps);
  if (e.minutes < range.min || e.minutes > range.max) {
    bad.push({ score: 2, text: `${e.minutes} min for ${real.linesToType} lines in ${real.steps} steps is outside ${range.min}-${range.max} min.` });
  }
  if (e.minutes > 60 && !lesson.simpler) bad.push({ score: 1, text: `${e.minutes} min with no smaller version offered first.` });
  return criterion("estimate", bad);
}

function gradeConcepts(lesson: Lesson): Criterion {
  const bad: { score: number; text: string }[] = [];
  const concepts = lesson.steps.filter((s) => s.concept).map((s) => ({ id: s.id, c: s.concept! }));
  if (concepts.length === 0) bad.push({ score: 3, text: "No step explains a new idea." });
  for (const { id, c } of concepts) {
    const n = sentences(c.explain);
    const words = c.explain.split(/\s+/).filter(Boolean).length;
    const jargon = c.explain.match(JARGON);
    if (n > 1) bad.push({ score: n, text: `${id} "${c.title}": ${n} sentences: "${c.explain}"` });
    else if (words > CONCEPT_MAX_WORDS) bad.push({ score: 1, text: `${id} "${c.title}": ${words} words is long for one plain sentence.` });
    if (jargon) bad.push({ score: 2, text: `${id} "${c.title}": uses the jargon word "${jargon[0]}".` });
    if (!c.links.some((l) => /^https?:\/\//.test(l.url))) bad.push({ score: 2, text: `${id} "${c.title}": no link.` });
  }
  return criterion("concepts", bad);
}

// How much of the answer a hint gives: the share of the answer's code pieces (names and symbols) that the hint shows.
export function hintStrength(hint: string, expected: string): number {
  const pieces = (text: string) => text.toLowerCase().match(/[a-z][a-z0-9-]*|[<>{}:;="\/]/g) ?? [];
  const want = pieces(expected);
  if (want.length === 0) return 0;
  const left = new Map<string, number>();
  for (const p of want) left.set(p, (left.get(p) ?? 0) + 1);
  let shown = 0;
  for (const p of pieces(hint)) {
    const n = left.get(p) ?? 0;
    if (n > 0) {
      shown++;
      left.set(p, n - 1);
    }
  }
  return Math.round((shown / want.length) * 100) / 100;
}

function gradeHints(lesson: Lesson): Criterion {
  const bad: { score: number; text: string }[] = [];
  for (const s of learnerSteps(lesson)) {
    const [a, b, c] = s.hints.map((h) => hintStrength(h, s.expected)) as [number, number, number];
    if (hintGivesAway(s.hints[2], s.expected)) bad.push({ score: 3, text: `Step ${s.id}: hint 3 is the whole answer.` });
    else if (sharedLines(s.hints[2], s.expected) >= 0.9 && linesIn(s.expected) >= 3) {
      bad.push({ score: 2, text: `Step ${s.id}: hint 3 repeats nearly every line of the answer.` });
    }
    if (new Set(s.hints.map((h) => h.trim())).size < 3) bad.push({ score: 2, text: `Step ${s.id}: two hints are the same.` });
    // Hints 1 and 2 are both mostly words (a nudge, then where), so only hint 3 has to show clearly more of the answer.
    if (!(c > a && c >= b)) {
      bad.push({ score: 1, text: `Step ${s.id}: hint 3 isn't the strongest (shows ${pct(a)} → ${pct(b)} → ${pct(c)} of the answer's code).` });
    }
    if (looksLikeCode(s.hints[0]) && !looksLikeCode(s.hints[2])) bad.push({ score: 1, text: `Step ${s.id}: hint 1 shows code but hint 3 doesn't.` });
  }
  return criterion("hints", bad);
}

function gradeVideo(lesson: Lesson, videoSeconds?: number): Criterion {
  if (lesson.source.kind !== "video") return criterion("video", [], "Not a video lesson.");
  const bad: { score: number; text: string }[] = [];
  let last = -1;
  for (const s of lesson.steps) {
    if (!s.video) {
      if (s.who === "learner") bad.push({ score: 2, text: `Step ${s.id} has no video part.` });
      continue;
    }
    if (s.video.start >= s.video.end) bad.push({ score: 3, text: `Step ${s.id}: video part ${s.video.start}-${s.video.end} s doesn't move forward.` });
    if (videoSeconds !== undefined && s.video.end > videoSeconds + 5) {
      bad.push({ score: 3, text: `Step ${s.id}: video part ends at ${s.video.end} s, after the video ends (${videoSeconds} s).` });
    }
    if (s.video.start < last - 30) bad.push({ score: 1, text: `Step ${s.id}: jumps back in the video (${s.video.start} s after ${last} s).` });
    last = Math.max(last, s.video.start);
  }
  return criterion("video", bad);
}

// ---------- Helpers ----------

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function learnerSteps(lesson: Lesson): Step[] {
  return lesson.steps.filter((s) => s.who === "learner");
}

// Non-blank lines with spacing ignored.
function codeLines(code: string): string[] {
  return code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map(normCode);
}

// Share of the answer's lines that appear word for word in the hint.
function sharedLines(hint: string, expected: string): number {
  const want = codeLines(expected);
  if (want.length === 0) return 0;
  const have = new Set(codeLines(hint));
  return want.filter((l) => have.has(l)).length / want.length;
}

// Sentences in a short text. Dots inside code or names (style.css, e.g.) don't end a sentence.
export function sentences(text: string): number {
  const plain = text.replace(/<[^>]*>/g, "x").replace(/\b(e\.g|i\.e|etc)\./gi, "x").replace(/\b\w+\.\w+/g, "x");
  return plain.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim() !== "").length;
}

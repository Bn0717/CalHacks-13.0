// Turns a public YouTube coding tutorial into a Stride lesson.
// Gemini watches the video and writes notes (chapters, what happens, the code on screen). Claude turns those notes into the
// finished project and small steps with timestamps. Every check is then tried against the finished project before a
// student ever sees it. The video itself is never downloaded.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { askJson } from "../ai/json.js";
import { lessonCache, videoCacheKey, type LessonCache } from "./cache.js";
import { readVideo, type VideoNotes } from "./gemini.js";
import { CheckSchema, estimateFor, LESSON_VERSION, LessonError, lessonJsonSchema, parseLesson, type Lesson, type Step } from "./lesson.js";
import { repairSteps } from "./rebuild.js";
import { lessonRuleProblems, strongerHints } from "./rules.js";
import type { OnStage } from "./stages.js";
import { describeProblems, selfValidateSteps, type CheckRunner } from "./validate.js";

export const LEARN_MODEL = () => process.env.CALHACK_LEARN_MODEL || "claude-opus-5-5";

// The structured-answer call, shaped like `askJson` so tests can pass a fake.
export type AskJson = <T>(o: {
  model: string;
  system: string;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, unknown>;
  maxTokens?: number;
}) => Promise<T>;

export type VideoBuildDeps = {
  runCheck: CheckRunner; // runs one check (the real checker, or a fake in tests)
  readVideo?: (url: string) => Promise<VideoNotes>; // defaults to Gemini
  ask?: AskJson; // defaults to askJson
  cache?: LessonCache | null; // defaults to the lessons folder; null turns caching off
  model?: string;
  now?: () => Date;
  onStage?: OnStage; // told as each real phase of the build starts (see stages.ts)
};

export class VideoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoUrlError";
  }
}

const NOT_YOUTUBE = "Stride can only make lessons from YouTube videos for now. Paste a YouTube link, like https://www.youtube.com/watch?v=…";

// Finds the 11-character video id in the usual YouTube link forms: watch?v=, youtu.be/, shorts/, embed/, live/.
export function parseYouTubeId(input: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new VideoUrlError(NOT_YOUTUBE);
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "watch") id = url.searchParams.get("v");
    else if (first && ["shorts", "embed", "live", "v"].includes(first)) id = second ?? null;
  } else {
    throw new VideoUrlError(NOT_YOUTUBE);
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    throw new VideoUrlError("That YouTube link doesn't point at a video. Open the video and copy its link again.");
  }
  return id;
}

// One clean link per video, so the same tutorial always reads and caches the same way.
export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// Builds (or loads from the cache) the lesson for one YouTube video.
export async function buildFromVideo(url: string, deps: VideoBuildDeps): Promise<Lesson> {
  const videoId = parseYouTubeId(url);
  const watchUrl = youTubeWatchUrl(videoId);
  const key = videoCacheKey(videoId);
  const cache = deps.cache === undefined ? lessonCache() : deps.cache;

  const cached = await cache?.load(key);
  if (cached) return cached;

  deps.onStage?.("video");
  const all = await (deps.readVideo ?? ((u: string) => readVideo(u)))(watchUrl);
  // A long video becomes a lesson on its first part: a whole 300-line tutorial doesn't fit in one answer or one sitting.
  const part = firstPart(all);
  const notes = part.notes;
  const ask: AskJson = deps.ask ?? askJson;
  const model = deps.model ?? LEARN_MODEL();
  const now = deps.now ?? (() => new Date());
  const source = { kind: "video" as const, url: watchUrl, videoId, title: notes.title };
  const assemble = (draft: Draft) => draftToLesson(draft, `video-${videoId}`, source, now(), notesEnd(notes));

  // 1. Notes -> finished project + steps. One retry if the answer isn't a valid lesson.
  deps.onStage?.("steps");
  const firstAsk =
    `Here are notes on a YouTube tutorial (${watchUrl}).` +
    (part.trimmed
      ? ` The video is long, so this lesson covers only its first part, up to ${clock(part.until)} (the chapters below). ` +
        `Build the project as it is at that point, and say in the summary that the lesson covers the video up to ${clock(part.until)}.`
      : "") +
    `\n\n${JSON.stringify(notes, null, 2)}`;
  let lesson: Lesson;
  try {
    lesson = assemble(await ask<Draft>({ model, system: BUILD_SYSTEM, content: firstAsk, schema: draftJsonSchema(), maxTokens: 32000 }));
  } catch (error) {
    if (!(error instanceof LessonError)) throw error;
    const retry = `${firstAsk}\n\nYour last answer had these problems, fix them:\n${error.problems.join("\n") || error.message}`;
    lesson = assemble(await ask<Draft>({ model, system: BUILD_SYSTEM, content: retry, schema: draftJsonSchema(), maxTokens: 32000 }));
  }

  // Steps typed in order must rebuild the finished project: code fixes late closing tags and works out every anchor.
  lesson = { ...lesson, steps: repairSteps(lesson.steps, lesson.files).steps };

  // 2. Try every check against the finished project. Ask once to fix learner steps left with no usable check; drop the rest.
  deps.onStage?.("checks");
  let checked = await selfValidateSteps(lesson.steps, lesson.files, deps.runCheck);
  if (checked.needsFix.length > 0) {
    const broken = checked.steps.filter((s) => checked.needsFix.includes(s.id));
    const fixes = await ask<{ steps?: unknown[] }>({
      model,
      system: FIX_SYSTEM,
      content:
        `Finished project:\n${JSON.stringify(lesson.files, null, 2)}\n\n` +
        `These checks didn't work:\n${describeProblems(checked.problems.filter((p) => checked.needsFix.includes(p.stepId)))}\n\n` +
        `Steps to fix (give back the same ids):\n${JSON.stringify(broken, null, 2)}`,
      schema: fixJsonSchema(),
      maxTokens: 8000,
    });
    const replaced = mergeFixes(checked.steps, fixes.steps ?? [], new Set(checked.needsFix));
    checked = await selfValidateSteps(replaced, lesson.files, deps.runCheck);
  }
  const steps = checked.steps.filter((s) => !checked.needsFix.includes(s.id));
  if (!steps.some((s) => s.who === "learner")) {
    throw new LessonError("Stride couldn't make reliable steps from this video. Try another tutorial.");
  }

  // 3. Final lesson: fresh estimate, only chapters that still have steps.
  deps.onStage?.("estimate");
  const used = new Set(steps.map((s) => s.chapter));
  const final = parseLesson({
    ...lesson,
    source,
    chapters: lesson.chapters.filter((c) => used.has(c.id)),
    steps,
    estimate: estimateFor(steps),
    createdAt: now().toISOString(),
  });
  await cache?.save(key, final);
  return final;
}

// Turns Claude's draft into a full lesson and validates it (throws a LessonError listing problems).
// The lesson rules code enforces (see rules.ts), plus video parts that must sit inside the video, are checked here too.
function draftToLesson(draft: Draft, id: string, source: Lesson["source"], at: Date, videoEnd: number): Lesson {
  const rawSteps = fillParts(Array.isArray(draft?.steps) ? draft.steps.map(fixHints).map((st) => clampPart(st, videoEnd)) : [], videoEnd);
  const lesson = parseLesson({
    ...draft,
    id,
    source,
    steps: rawSteps,
    estimate: { minutes: 0, linesToType: 0, steps: rawSteps.length },
    createdAt: at.toISOString(),
    version: LESSON_VERSION,
  });
  const problems = [...lessonRuleProblems(lesson.steps), ...videoPartProblems(lesson.steps, videoEnd)];
  if (problems.length > 0) throw new LessonError("The lesson breaks Stride's step rules.", problems);
  return lesson;
}

// Every learner step links to its part of the video: start before end, and inside the video.
export function videoPartProblems(steps: Step[], videoEnd: number): string[] {
  const problems: string[] = [];
  for (const s of steps) {
    if (!s.video) {
      if (s.who === "learner") problems.push(`Step ${s.id} needs a video part (start and end in seconds).`);
      continue;
    }
    if (s.video.start >= s.video.end) problems.push(`Step ${s.id}: the video part must end after it starts.`);
    if (videoEnd > 0 && s.video.end > videoEnd + 5) problems.push(`Step ${s.id}: the video part ends at ${s.video.end} s, after the video ends (${videoEnd} s).`);
  }
  return problems;
}

// The last second the notes mention, a stand-in for the video's length.
export function notesEnd(notes: VideoNotes): number {
  return Math.max(0, ...notes.chapters.map((c) => c.end), ...notes.segments.map((s) => s.end));
}

// ---------- Prompts and answer shapes ----------

const BUILD_SYSTEM = `You turn notes on a beginner coding tutorial into a hands-on Stride lesson.
1. Rebuild the finished project from the code segments: the full final content of every file (files). Use the last version
   of each file shown in the video. Fill obvious gaps so it works, but don't add features the video doesn't build.
   No code comments the video doesn't type.
2. Cut it into steps that each add 3-10 non-blank lines (never more than 10), in the video's order, grouped into chapters
   (chapter ids are short slugs). When the video types a big chunk at once, split it into several steps.
   - who: "learner" for code the student types, "watch" for parts with nothing to type (a watch step adds no code:
     expected is ""). Don't use "stride". Every line of the finished files is typed in some learner step.
   - expected: the exact code the step adds, copied from the finished files. Each step's code closes every tag it opens:
     a wrapper like <main> is typed with its first contents and its closing tag, and later steps add more inside it.
   - video: {start, end} in seconds from the notes' segment times, the part of the video that shows this step. Every
     learner step has one; start is before end; both are inside the video (never after the last chapter's end); in order.
   - instruction: plain English for a 14-year-old who has never coded: what to add and where, in words. Say exactly what
     to type when a beginner can't guess it (a value, a file name). Each step brings in at most 2 tags or CSS properties the
     student hasn't typed before, and names and explains each one in plain words in the instruction or why.
   - checks: behaviour checks that pass on the finished project; the first must fail on an empty project.
     Prefer selectorExists, textIncludes, attribute and cssProperty. Never compare exact text. Use "ai" only as a last resort.
     A check may have "say": what Stride tells the student while it isn't done, in plain words, never code words.
   - hints: exactly 3, each stronger than the last, about the whole step: (1) a nudge in words, no code; (2) words that point
     at the exact spot and name every tag or property, but no code lines (never the answer itself); (3) the code's outline with what the
     student writes themselves (text inside tags, values) left as … to fill in. Hint 3 never contains the whole "expected".
   - why: one plain-English line. Add a concept card when a new idea comes up for the first time: explain is ONE short
     plain sentence (under 25 words), no jargon ("DOM", "selector", "parse", "element", "render", "syntax"), and links
     has at least one MDN page.
3. title, summary, outcome and learns are short and plain English, for someone who has never coded.`;

const FIX_SYSTEM = `Some steps in a Stride lesson have checks that don't work on the finished project, or pass before the student
types anything. Rewrite only those steps' checks so every check passes on the finished project and the first check fails on an
empty project. Keep each step's id and everything else the same. Behaviour checks only, never exact text.`;

type Draft = Record<string, unknown> & { steps?: unknown[] };

// The lesson schema minus the fields Stride fills in itself.
function draftJsonSchema(): Record<string, unknown> {
  const schema = lessonJsonSchema() as { properties: Record<string, unknown>; required: string[] };
  const own = ["id", "source", "estimate", "simpler", "createdAt", "version"];
  for (const k of own) delete schema.properties[k];
  schema.required = schema.required.filter((k) => !own.includes(k));
  return schema;
}

function fixJsonSchema(): Record<string, unknown> {
  const steps = (lessonJsonSchema() as { properties: Record<string, unknown> }).properties.steps;
  return { type: "object", properties: { steps }, required: ["steps"], additionalProperties: false };
}

// Structured output sends hints as a plain list; a lesson needs exactly 3.
function fixHints(step: unknown): unknown {
  if (!step || typeof step !== "object") return step;
  const s = step as { hints?: unknown };
  if (!Array.isArray(s.hints)) return step;
  const hints = s.hints.filter((h): h is string => typeof h === "string" && h.trim() !== "");
  while (hints.length > 0 && hints.length < 3) hints.push(hints[hints.length - 1]!);
  const three = hints.slice(0, 3);
  // Hints that don't get stronger are fixed in code (cheaper than asking again): see strongerHints.
  const expected = (s as { expected?: unknown }).expected;
  return { ...s, hints: typeof expected === "string" ? strongerHints(three, expected) : three };
}

// A video part that runs a little past the video's end (the notes' last time is only a stand-in for its length) is cut
// at the end, instead of sending the whole lesson back.
function clampPart(step: unknown, videoEnd: number): unknown {
  const v = (step as { video?: { start?: unknown; end?: unknown } } | null)?.video;
  if (!v || videoEnd <= 0 || typeof v.start !== "number" || typeof v.end !== "number") return step;
  if (v.end <= videoEnd || v.start >= videoEnd) return step;
  return { ...(step as object), video: { start: v.start, end: videoEnd } };
}

// A learner step the model left without its part of the video gets the stretch between its neighbours' parts (steps
// follow the video in order), so the whole lesson isn't sent back for one missing timestamp.
function fillParts(steps: unknown[], videoEnd: number): unknown[] {
  type Part = { start: number; end: number };
  const partOf = (st: unknown): Part | null => {
    const v = (st as { video?: Partial<Part> } | null)?.video;
    return v && typeof v.start === "number" && typeof v.end === "number" ? (v as Part) : null;
  };
  return steps.map((st, i) => {
    if ((st as { who?: unknown } | null)?.who !== "learner" || partOf(st)) return st;
    const prev = steps.slice(0, i).reverse().map(partOf).find((p) => p !== null) ?? null;
    const next = steps.slice(i + 1).map(partOf).find((p) => p !== null) ?? null;
    const start = prev ? prev.end : 0;
    const end = next ? next.start : videoEnd > 0 ? videoEnd : start + 60;
    const video = start < end ? { start, end } : prev ? { ...prev } : next ? { ...next } : null;
    return video ? { ...(st as object), video } : st;
  });
}

// "4:05"
function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// About how much on-screen code one video lesson can cover (one answer, one sitting): the lines of code the notes show,
// added up over the parts. Real runs: 145 lines built well; 284 lines ran past 32,000 tokens without finishing.
export const VIDEO_LINES_LIMIT = 150;

// The notes for the video's first chapters, as many as keep the code shown within VIDEO_LINES_LIMIT (at least one
// chapter). `until` is where the lesson stops in the video.
export function firstPart(notes: VideoNotes, limit = VIDEO_LINES_LIMIT): { notes: VideoNotes; trimmed: boolean; until: number } {
  const lines = (code: string) => code.split("\n").filter((l) => l.trim() !== "").length;
  const inChapter = (sg: VideoNotes["segments"][number], ch: VideoNotes["chapters"][number]) =>
    sg.chapter === ch.title || (!notes.chapters.some((c) => c.title === sg.chapter) && sg.start >= ch.start && sg.start < ch.end);
  let total = 0;
  let kept = 0;
  for (const [i, ch] of notes.chapters.entries()) {
    total += notes.segments.filter((sg) => inChapter(sg, ch)).reduce((n, sg) => n + lines(sg.code), 0);
    if (i > 0 && total > limit) break;
    kept = i + 1;
  }
  if (kept >= notes.chapters.length) {
    // Even one chapter can be too long: then keep its first parts, up to the limit.
    const segs = notes.segments;
    if (segs.reduce((n, sg) => n + lines(sg.code), 0) <= limit) return { notes, trimmed: false, until: notesEnd(notes) };
    let sum = 0;
    const keep = segs.filter((sg, i) => (sum += lines(sg.code)) <= limit || i === 0);
    const until = keep[keep.length - 1]!.end;
    const chapters = notes.chapters.filter((c) => c.start < until).map((c) => ({ ...c, end: Math.min(c.end, until) }));
    return { notes: { ...notes, chapters, segments: keep }, trimmed: true, until };
  }
  const chapters = notes.chapters.slice(0, kept);
  const until = chapters[chapters.length - 1]!.end;
  const segments = notes.segments.filter((sg) => chapters.some((ch) => inChapter(sg, ch)));
  return { notes: { ...notes, chapters, segments }, trimmed: true, until };
}

// Swaps in fixed steps by id, keeping the original when a fix is missing or doesn't fit the step format.
function mergeFixes(steps: Step[], fixes: unknown[], wanted: Set<string>): Step[] {
  const byId = new Map<string, Step>();
  for (const raw of fixes) {
    const fixed = fixHints(raw) as Step;
    if (!fixed || typeof fixed !== "object" || !wanted.has(fixed.id)) continue;
    byId.set(fixed.id, fixed);
  }
  return steps.map((s) => {
    const fixed = byId.get(s.id);
    if (!fixed) return s;
    // Only the checks change; the rest of the step stays as it was, so a fix can't break the lesson.
    const checks = z.array(CheckSchema).safeParse(fixed.checks);
    return checks.success ? { ...s, checks: checks.data } : s;
  });
}

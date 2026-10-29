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

  const notes = await (deps.readVideo ?? ((u: string) => readVideo(u)))(watchUrl);
  const ask: AskJson = deps.ask ?? askJson;
  const model = deps.model ?? LEARN_MODEL();
  const now = deps.now ?? (() => new Date());
  const source = { kind: "video" as const, url: watchUrl, videoId, title: notes.title };
  const assemble = (draft: Draft) => draftToLesson(draft, `video-${videoId}`, source, now());

  // 1. Notes -> finished project + steps. One retry if the answer isn't a valid lesson.
  const firstAsk = `Here are notes on a YouTube tutorial (${watchUrl}).\n\n${JSON.stringify(notes, null, 2)}`;
  let lesson: Lesson;
  try {
    lesson = assemble(await ask<Draft>({ model, system: BUILD_SYSTEM, content: firstAsk, schema: draftJsonSchema(), maxTokens: 16000 }));
  } catch (error) {
    if (!(error instanceof LessonError)) throw error;
    const retry = `${firstAsk}\n\nYour last answer had these problems, fix them:\n${error.problems.join("\n") || error.message}`;
    lesson = assemble(await ask<Draft>({ model, system: BUILD_SYSTEM, content: retry, schema: draftJsonSchema(), maxTokens: 16000 }));
  }

  // 2. Try every check against the finished project. Ask once to fix learner steps left with no usable check; drop the rest.
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
function draftToLesson(draft: Draft, id: string, source: Lesson["source"], at: Date): Lesson {
  const rawSteps = Array.isArray(draft?.steps) ? draft.steps.map(fixHints) : [];
  return parseLesson({
    ...draft,
    id,
    source,
    steps: rawSteps,
    estimate: { minutes: 0, linesToType: 0, steps: rawSteps.length },
    createdAt: at.toISOString(),
    version: LESSON_VERSION,
  });
}

// ---------- Prompts and answer shapes ----------

const BUILD_SYSTEM = `You turn notes on a beginner coding tutorial into a hands-on Stride lesson.
1. Rebuild the finished project from the code segments: the full final content of every file (files). Use the last version
   of each file shown in the video. Fill obvious gaps so it works, but don't add features the video doesn't build.
2. Cut it into steps of 3-10 lines each, in the video's order, grouped into chapters (chapter ids are short slugs).
   - who: "learner" for code the student types, "watch" for parts with nothing to type. Don't use "stride".
   - expected: the exact code the step adds, copied from the finished files.
   - video: {start, end} in seconds, the part of the video that shows this step.
   - checks: behaviour checks that pass on the finished project; the first must fail on an empty project.
     Prefer selectorExists, textIncludes, attribute and cssProperty. Never compare exact text. Use "ai" only as a last resort.
   - hints: exactly 3, gentlest first (a nudge, then pointing at the spot, then part of the code).
   - why: one plain-English line. Add a concept card when a new idea comes up for the first time.
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
  return { ...s, hints: hints.slice(0, 3) };
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

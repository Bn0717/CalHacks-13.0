// The words and layout of the terminal lesson (npm run learn): reading what the student typed on the command line,
// and turning lessons, steps, hints and the finish into short, friendly text. Pure: nothing here prints or reads files.
import { homedir } from "node:os";
import { join } from "node:path";
import { dollars, type CostTotal } from "./cost.js";
import type { Anchor, Estimate, Lesson, Step } from "./lesson.js";
import type { Question } from "./questions.js";
import { whoLabel, type Pace } from "./runner.js";
import type { LessonSummary } from "./summary.js";

// ---------- The command line ----------

export type CliArgs =
  | { mode: "help" }
  | { mode: "idea"; idea: string; picture?: string; dir?: string; pace: Pace; editor: boolean }
  | { mode: "video"; url: string; dir?: string; pace: Pace; editor: boolean }
  | { mode: "lesson"; file: string; dir?: string; pace: Pace; editor: boolean }
  | { mode: "resume"; dir?: string; pace: Pace; editor: boolean };

export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgsError";
  }
}

export const USAGE = `Learn to make a website, one small step at a time.

  npm run learn -- "a page about me"                  start from an idea
  npm run learn -- --picture ./ref.png "a page like this"   an idea and a picture
  npm run learn -- --video https://youtu.be/...       learn from a YouTube video
  npm run learn -- --resume                           carry on with your last lesson

Extras:
  --dir <folder>      where to put your project (default: ~/stride-lessons/<name>)
  --lesson <file>     use a lesson file that's already made
  --fast              start in "Go faster" mode (Show me is ready any time)
  --no-editor         don't connect to Stride's VS Code helper`;

export function parseArgs(argv: string[]): CliArgs {
  let picture: string | undefined;
  let url: string | undefined;
  let file: string | undefined;
  let dir: string | undefined;
  let resume = false;
  let pace: Pace = "learn";
  let editor = true;
  const words: string[] = [];

  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new ArgsError(`${flag} needs something after it.`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") return { mode: "help" };
    else if (a === "--picture") picture = value(i++, a);
    else if (a === "--video") url = value(i++, a);
    else if (a === "--lesson") file = value(i++, a);
    else if (a === "--dir") dir = value(i++, a);
    else if (a === "--resume") resume = true;
    else if (a === "--fast") pace = "fast";
    else if (a === "--no-editor") editor = false;
    else if (a.startsWith("--")) throw new ArgsError(`I don't know "${a}".`);
    else words.push(a);
  }
  const idea = words.join(" ").trim();
  const common = { ...(dir ? { dir } : {}), pace, editor };

  const picked = [resume && "--resume", url && "--video", file && "--lesson"].filter(Boolean);
  if (picked.length > 1) throw new ArgsError(`Pick one of ${picked.join(" and ")}, not both.`);
  if (picture && (url || resume)) throw new ArgsError("A picture goes with an idea, not with a video or --resume.");

  if (resume) return { mode: "resume", ...common };
  if (url) return { mode: "video", url, ...common };
  if (file) return { mode: "lesson", file, ...common };
  if (!idea) throw new ArgsError(picture ? "Say what you'd like to make too, e.g. \"a page like this\"." : "Tell me what you'd like to make.");
  return { mode: "idea", idea, ...(picture ? { picture } : {}), ...common };
}

// ---------- Folders ----------

// Where lesson folders go: ~/stride-lessons (STRIDE_LESSONS_DIR overrides, handy for tests).
export function lessonsRoot(env: Record<string, string | undefined> = process.env): string {
  return env.STRIDE_LESSONS_DIR || join(homedir(), "stride-lessons");
}

// "A page about me!" -> "a-page-about-me"
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "my-lesson"
  );
}

// ---------- Before the lesson ----------

export function questionText(q: Question, n: number, total: number): string {
  const lines = [`${n}/${total} · ${q.question}`];
  q.options.forEach((o, i) => lines.push(`  ${i + 1}) ${o}`));
  lines.push(q.multi ? "Type the numbers you like (e.g. 1 3), or press Enter to skip:" : "Type a number, or press Enter to skip:");
  return lines.join("\n");
}

// What the student typed for a question -> the answers they picked ([] = skipped, null = didn't make sense).
export function parseChoice(input: string, q: Pick<Question, "options" | "multi">): string[] | null {
  const text = input.trim();
  if (text === "") return [];
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const picks: string[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > q.options.length) return null;
    const option = q.options[n - 1]!;
    if (!picks.includes(option)) picks.push(option);
  }
  if (!q.multi && picks.length > 1) return null;
  return picks;
}

// "About 22 minutes · you'll type about 25 lines · 6 steps"
export function estimateLine(e: Estimate): string {
  const mins = e.minutes >= 90 ? `about ${Math.round((e.minutes / 60) * 2) / 2} hours` : `about ${e.minutes} minutes`;
  return `${cap(mins)} · you'll type about ${e.linesToType} lines · ${e.steps} steps`;
}

export function estimateText(lesson: Lesson): string {
  const lines = [`📚 ${lesson.title}`, lesson.summary, "", `⏱  ${estimateLine(lesson.estimate)}`];
  if (lesson.learns.length > 0) lines.push(`🧠 You'll learn: ${lesson.learns.join(", ")}`);
  lines.push(`🎯 At the end: ${lesson.outcome}`);
  return lines.join("\n");
}

// ---------- During the lesson ----------

export const KEYS_LINE = "Keys: h hint · s show me · n skip · p pace · q quit";

// Where to type, in plain words.
export function whereText(step: Step): string | null {
  if (!step.file) return null;
  const a: Anchor | undefined = step.anchor;
  if (!a) return `In ${step.file}`;
  if (a.afterLine !== undefined) return a.afterLine === 0 ? `In ${step.file}, at the top` : `In ${step.file}, after line ${a.afterLine}`;
  if (a.after !== undefined) return `In ${step.file}, under ${firstLine(a.after)}`;
  if (a.inside !== undefined) {
    const name = a.inside.trim().replace(/^<|>$/g, "");
    return /^[a-z][a-z0-9-]*$/i.test(name) ? `In ${step.file}, between <${name}> and </${name}>` : `In ${step.file}, inside ${name} { }`;
  }
  return `In ${step.file}`;
}

export function videoLink(videoId: string, start: number): string {
  return `https://youtu.be/${videoId}?t=${Math.max(0, Math.floor(start))}`;
}

// The step card: "Step 3/6 · 🧑 Your turn", what to do, why, where, the new idea and the video part.
export function stepCard(lesson: Lesson, index: number, opts: { newFile?: string } = {}): string {
  const step = lesson.steps[index]!;
  const chapter = lesson.chapters.find((c) => c.id === step.chapter);
  const lines = [
    "─".repeat(48),
    `Step ${index + 1}/${lesson.steps.length} · ${whoLabel(step)}${chapter ? ` · ${chapter.title}` : ""}`,
    `${step.title}`,
    "",
    step.instruction,
    `Why: ${step.why}`,
  ];
  if (step.who === "learner") {
    if (opts.newFile) lines.push(`📄 First make a new file called ${opts.newFile} in your project folder.`);
    const where = whereText(step);
    if (where) lines.push(`📍 ${where}`);
  }
  if (step.concept) {
    lines.push("", `💡 New idea · ${step.concept.title}: ${oneLine(step.concept.explain)}`);
    const link = step.concept.links[0];
    if (link) lines.push(`   Read more: ${link.url}`);
  }
  if (step.video && lesson.source.kind === "video") {
    lines.push(`▶  Watch this part: ${videoLink(lesson.source.videoId, step.video.start)}`);
  }
  lines.push("");
  if (step.who === "learner") lines.push("Type it in, then stop for a moment. I'll check it by myself.", KEYS_LINE);
  else if (step.who === "watch") lines.push("Press Enter when you're ready to go on.  (n skip · q quit)");
  return lines.join("\n");
}

export function hintText(level: number, text: string): string {
  const body = text.includes("\n") ? `\n${indent(text, "     ")}` : ` ${text}`;
  return `💡 Hint ${level}/3:${body}`;
}

export function paceText(pace: Pace): string {
  return pace === "fast"
    ? "⏩ Go faster: Show me (s) is ready any time."
    : "🐢 Learn more: you type everything. Show me (s) opens after the 3 hints.";
}

// ---------- The finish ----------

export function summaryText(summary: LessonSummary, lesson: Lesson): string {
  const lines = [
    "═".repeat(48),
    `🎉 You finished "${summary.title}"!`,
    `You made: ${lesson.outcome}`,
    "",
    `Your steps: ${summary.steps} · on your own ${summary.alone} · with hints ${summary.hinted} · shown ${summary.shown}` +
      (summary.skipped ? ` · skipped ${summary.skipped}` : ""),
  ];
  if (summary.concepts.length > 0) lines.push(`What you learned: ${summary.concepts.join(", ")}`);
  lines.push(`Time: ${summary.minutes < 1 ? "under a minute" : `${summary.minutes} min`}`);
  lines.push("", `Next idea: ${summary.next.title}${summary.next.minutes ? ` (about ${summary.next.minutes} min)` : ""}. ${summary.next.why}`);
  return lines.join("\n");
}

export function costText(run: CostTotal, allTime: CostTotal, file: string): string {
  if (allTime.calls === 0) return `💸 AI cost: $0 (no AI calls). Saved in ${file}`;
  const thisRun = `${dollars(run.usd)} this time (${run.calls} AI call${run.calls === 1 ? "" : "s"})`;
  const ever = allTime.calls !== run.calls ? ` · ${dollars(allTime.usd)} for this lesson so far` : "";
  return `💸 AI cost: ${thisRun}${ever}. Saved in ${file}`;
}

// ---------- Helpers ----------

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function firstLine(text: string): string {
  return text.split("\n")[0]!.trim();
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

// The quality test for lesson building (task C2): which lessons to build, a hard spending cap, and the report.
// The CLI (src/cli/learn-eval.ts) does the real calls; everything here is pure so tests can check it.
import type { AskModel } from "./build-from-idea.js";
import { dollars, type CostLog } from "./cost.js";
import type { Grade } from "./grade.js";
import type { LessonJudgement } from "./judge-lesson.js";
import type { VideoNotes } from "./gemini.js";
import { linesIn, type Estimate } from "./lesson.js";

// Stop when real spend for this test passes this (US dollars, all runs saved in the eval's cost.json).
export const SPEND_CAP_USD = 8;

export type IdeaCase = {
  kind: "idea";
  name: string;
  request: string;
  answers: { question: string; answer: string }[];
  picture?: string; // a reference picture, relative to the project folder
  expect?: "tooBig";
};
export type VideoCase = { kind: "video"; name: string; url: string; videoId: string; title: string; minutes: number };
export type EvalCase = IdeaCase | VideoCase;

export const MOCKUP_PATH = "tests/learn/fixtures/mockup.png";

// Fixed answers to the starting questions, so every run builds the same thing.
export const EVAL_CASES: EvalCase[] = [
  {
    kind: "idea",
    name: "a page about me",
    request: "a page about me",
    answers: [
      { question: "What's it for?", answer: "Just for me, to show friends" },
      { question: "What should it have?", answer: "My name, a few things I like, a photo spot" },
    ],
  },
  {
    kind: "idea",
    name: "a website for my small bakery",
    request: "a website for my small bakery",
    answers: [
      { question: "What's it for?", answer: "So people find my shop" },
      { question: "What should it have?", answer: "Our cakes and prices, opening hours, where we are, a contact page" },
    ],
  },
  { kind: "idea", name: "make me Instagram", request: "make me Instagram", answers: [], expect: "tooBig" },
  { kind: "idea", name: "a page like this picture", request: "a page like this picture", answers: [], picture: MOCKUP_PATH },
  { kind: "video", name: "Create Your First HTML/CSS Project", url: "https://www.youtube.com/watch?v=wzWmZYi4qMg", videoId: "wzWmZYi4qMg", title: "Create Your First HTML/CSS Project", minutes: 19 },
  { kind: "video", name: "HTML Tutorial for Beginners", url: "https://www.youtube.com/watch?v=WOvg00FnmsU", videoId: "WOvg00FnmsU", title: "HTML Tutorial for Beginners – Build a Website Step by Step", minutes: 24 },
  { kind: "video", name: "How to Code Your First Website", url: "https://www.youtube.com/watch?v=zMTId2CUClw", videoId: "zMTId2CUClw", title: "How to Code Your First Website", minutes: 24 },
];

// ---------- The spending cap ----------

export class BudgetError extends Error {
  constructor(readonly spent: number, readonly cap: number) {
    super(`Stopped: spending reached ${dollars(spent)}, past the ${dollars(cap)} cap for this test.`);
    this.name = "BudgetError";
  }
}

// Throws before a call once spend (this run plus earlier saved runs) has passed the cap.
export function assertBudget(log: CostLog, cap = SPEND_CAP_USD): void {
  const spent = log.allTime().usd;
  if (spent >= cap) throw new BudgetError(spent, cap);
}

// Any model call, checked against the cap before it runs and again after it answers.
export function capped<A extends unknown[], R>(log: CostLog, call: (...args: A) => Promise<R>, cap = SPEND_CAP_USD): (...args: A) => Promise<R> {
  return async (...args) => {
    assertBudget(log, cap);
    const out = await call(...args);
    assertBudget(log, cap);
    return out;
  };
}

export const cappedLearnModel = (log: CostLog, ask: AskModel, cap = SPEND_CAP_USD): AskModel => capped(log, ask, cap);

// ---------- The report ----------

export type VideoNotesResult = {
  videoId: string;
  url: string;
  status: "recorded" | "reused" | "error" | "skipped";
  title?: string;
  model?: string;
  chapters?: number;
  segments?: number;
  codeSegments?: number;
  codeLines?: number;
  endSeconds?: number;
  inputTokens?: number;
  outputTokens?: number; // answer + thinking
  usd?: number;
  error?: string;
};

export type CaseResult = {
  name: string;
  kind: EvalCase["kind"];
  status: "graded" | "blocked" | "error";
  source?: "built" | "cached" | "fixture" | "file";
  grade?: Grade;
  judgement?: LessonJudgement;
  estimate?: Estimate;
  usd?: number; // what building this lesson cost (real calls only)
  note?: string;
};

export type EvalReport = {
  ranAt: string;
  claude: { usable: boolean; note: string };
  geminiPrice: string;
  cases: CaseResult[];
  videoNotes: VideoNotesResult[];
  spend: { thisRun: number; allRuns: number; cap: number };
  findings: string[]; // plain notes worked out from the real results (see findingsFor)
  messageExamples: { before: string; after: string }[];
  promptChanges: { where: string; change: string; why: string }[];
  hintChecks?: HintCheckCost[]; // real Haiku check calls made while a student is stuck (GOAL C3: under $0.01 each)
  before?: BeforeRun; // the earlier run these results are compared with
  summary?: string[]; // a hand-written account of the runs (EVAL_SUMMARY), shown first
};

// One real Haiku check call, the kind made when a step needs the AI to decide (an 'ai' check, or levels 1-2 can't).
export type HintCheckCost = { lesson: string; stepId: string; answer: string; inputTokens: number; outputTokens: number; usd: number };

// The scores of an earlier run, for the before/after table.
export type BeforeRun = { ranAt: string; cases: Pick<CaseResult, "name" | "status" | "note" | "grade" | "judgement" | "usd" | "estimate">[] };

// The before part of an earlier report.json (only what the comparison needs).
export function beforeRunFrom(r: Pick<EvalReport, "ranAt" | "cases">): BeforeRun {
  return {
    ranAt: r.ranAt,
    cases: r.cases.map((c) => ({ name: c.name, status: c.status, ...(c.note ? { note: c.note } : {}), ...(c.grade ? { grade: c.grade } : {}), ...(c.judgement ? { judgement: c.judgement } : {}), ...(c.usd !== undefined ? { usd: c.usd } : {}), ...(c.estimate ? { estimate: c.estimate } : {}) })),
  };
}

// The average of the five Opus scores, or undefined when the lesson wasn't reviewed.
export function averageScore(j: LessonJudgement | undefined): number | undefined {
  if (!j) return undefined;
  const s = Object.values(j.scores);
  return s.reduce((n, x) => n + x, 0) / s.length;
}

export const GEMINI_PRICE_NOTE =
  "Gemini priced at $1.50 per million input tokens and $9.00 per million output + thinking tokens (Google Cloud's published " +
  "'Global' price for Gemini 3.5 Flash, Oct 2026; ai.google.dev was blocked from here, so the Gemini API's own page wasn't checked). " +
  "Gemini actually served gemini-3.6-flash, which the same price list shows at an introductory $0.75 / $3.75 until 31 Dec 2026, " +
  "so the real bill is likely about half of what is shown. Treat these as upper-bound estimates.";

// The builder prompt changes made in this task, and why (the effect is measured on the next run with a working key).
export const PROMPT_CHANGES: EvalReport["promptChanges"] = [
  { where: "idea: project", change: "No code comments in the finished site.", why: "Every line is typed by the student; comments are lines typed for nothing and inflate the estimate." },
  { where: "idea + video: steps", change: "3-10 non-blank lines, never more than 10; split long parts.", why: "A4 / grader 'stepSize'. Now also enforced in code: steps over 12 lines are sent back." },
  { where: "idea: steps", change: "Explicit teaching order: skeleton, then HTML content, then CSS, then JS; one new idea per step.", why: "Judge 'teaching order'; A4." },
  { where: "idea + video: steps", change: "'watch' steps add no code; every line of the finished project is typed in some learner step.", why: "A4 '🤖 steps are only setup'; grader 'whoTypes'. Enforced in code too." },
  { where: "idea + video: steps", change: "Instructions say what to add and where in words, for a 14-year-old who never coded.", why: "B1 / judge 'beginner wording'." },
  { where: "idea + video: hints", change: "Each hint stronger: words only, then the spot + tag name, then part of the code with … gaps; hint 3 never the whole 'expected'.", why: "A6. Enforced in code: a hint 3 holding the whole answer is sent back." },
  { where: "idea + video: concepts", change: "ONE plain sentence under 25 words, banned jargon list, at least one MDN link.", why: "A7; the about-me fixture's concepts are all 2 sentences. Links are now required by the schema." },
  { where: "idea + video: checks", change: "Optional plain 'say' wording per check, no code words.", why: "B1: the student never sees a CSS selector. The checker words one itself when it's missing." },
  { where: "video: timestamps", change: "Every learner step has a video part from the notes' times, start < end, inside the video, in order.", why: "A7 'video steps link to the right timestamp'. Enforced in code: parts past the video's end are sent back." },
  { where: "checker: Haiku judge", change: "Reasons in plain words for a 14-year-old, never DOM/selector/element/parse.", why: "B1." },
  // Round 2: from the first real run (report-before.json).
  { where: "idea: project (round 2)", change: "First projects of 30-70 lines (up to ~120 for big asks); only what the student asked for, no surprise JavaScript or extras; few common tags/properties; the <head> is just charset, title and the CSS link.", why: "Run 1: 'a page about me' came back at 116 lines / 102 min with a face-switcher nobody asked for; the picture page at 139 lines / 113 min; bakery so big its steps were cut off." },
  { where: "idea + video: steps (round 2)", change: "At most 2 new tags or CSS properties per step, each named and explained in plain words; long CSS rules split over steps; say exactly what to type when a beginner can't guess it.", why: "Run 1 Opus review: 'faces: arrays, let, if, functions, addEventListener… all at once', 'flex, vh, line-height never explained', 'viewport would mean nothing'." },
  { where: "idea + video: hints (round 2)", change: "Hints about the whole step; hint 2 names every tag/property with values a beginner can't guess; hint 3 is the outline with the student's own parts as …", why: "Run 1 review: 'hints only cover the <link>', 'hint 3 is basically the full answer'." },
  { where: "idea + video: steps (round 2)", change: "Each step closes every tag it opens; an idea lesson gets a 'look at your page' step after the HTML.", why: "The real C1 run: a step opened <main> whose </main> came later, so the right answer stayed 'Still typing?'. Also fixed in code (rebuild.ts)." },
  { where: "code, not prompt (round 2)", change: "Late closing tags, drifting anchors, a give-away hint 3 and a video part past the end are repaired in code; checks are proven on the files as they are right after each step.", why: "Asking Opus again costs $0.20-0.50 a time; run 1 lost $1.06 on three failed builds." },
];

// What happened over the real runs (2026-10-29), in words. Numbers come from report-before.json, this report and cost.json.
export const EVAL_SUMMARY: string[] = [
  "Four real runs with Opus 5.5 (builder and separate reviewer) and Haiku 5.5 (checks): run 1 = the C2 prompts (report-before.json); " +
    "runs 2-4 = the round-2 prompt and code changes below, run 3 only the 3 videos, run 4 only 'Create Your First HTML/CSS Project' " +
    "(run 2's rebuild of it had failed, so run 3 still graded its run-1 lesson). Spend: run 1 $2.35, run 2 $3.52, run 3 $0.65, " +
    "run 4 $0.53, plus $0.74 of Gemini notes = $7.79 of the $8 cap. Nothing else can run without passing the cap.",
  "Before: 3 of 6 real builds failed (bakery and the 24-minute video cut off at the token limit, one video broke the step rules twice: " +
    "$1.06 lost). After: all 6 build. Opus review average (wording, step size, order, hints, fidelity): about me 3.2 → 3.4, " +
    "picture 3.4 → 4.0, 'Create Your First HTML/CSS Project' 2.8 → 3.6; bakery, 'HTML Tutorial' and 'How to Code Your First " +
    "Website' failed before and score 4.2, 3.8 and 3.4 now.",
  "Biggest fixes came from code, not prompts: the lesson answer shape broke the API's structured-output limits (400), steps left " +
    "tags open across steps and anchors drifted (found by the real C1 run), and small rule breaks (a give-away hint 3, a missing or " +
    "late video part) sent a whole $0.20-0.50 lesson back to Opus. All are repaired in code now (schema-limit.ts, rebuild.ts, rules.ts).",
  "Worst left (Opus review): hint 2 often gave the full code in the run-2 idea lessons, so 'hints' scored 2-3 (fixed in prompt and " +
    "code after run 2 — strongerHints — but not re-measured: no budget left); steps that need exact values a beginner can't guess " +
    "(meta viewport) with hint 3 blanking them out; some steps still bring in 3+ new tags; idea lessons still run 68-100 min, so " +
    "the smaller version is offered first; 2 video lessons don't rebuild their files exactly ('buildsUp').",
  "Cost per lesson build (Opus, real): idea lessons $0.46-$0.51, video lessons $0.19-$0.45 for Opus plus $0.22-$0.29 of Gemini " +
    "notes ($0.42-$0.67 in all). GOAL C3 '< $0.50' holds for 2 of 3 idea builds and 1 of 3 video builds. Cost per hint: the hint " +
    "text is part of the lesson (free); a check the code can't decide calls Haiku: $0.0001-$0.0002 each (every call in cost.json), " +
    "well under $0.01.",
];

// What a set of video notes holds, for the report.
export function summarizeNotes(notes: VideoNotes): Pick<VideoNotesResult, "title" | "chapters" | "segments" | "codeSegments" | "codeLines" | "endSeconds"> {
  const withCode = notes.segments.filter((s) => s.code.trim() !== "");
  return {
    title: notes.title,
    chapters: notes.chapters.length,
    segments: notes.segments.length,
    codeSegments: withCode.length,
    codeLines: withCode.reduce((n, s) => n + linesIn(s.code), 0),
    endSeconds: Math.max(0, ...notes.chapters.map((c) => c.end), ...notes.segments.map((s) => s.end)),
  };
}

// Notes worked out from the real results only. Anything that is a projection says so.
export function findingsFor(r: Pick<EvalReport, "cases" | "videoNotes" | "claude"> & Pick<Partial<EvalReport>, "hintChecks">): string[] {
  const out: string[] = [];
  // Every real build with a measured cost: built in this run, or saved from an earlier one (its cost was kept).
  const built = r.cases.filter((c) => (c.source === "built" || c.source === "cached") && c.grade?.kind === "lesson" && c.usd !== undefined);
  if (built.length > 0) {
    const worst = built.reduce((a, b) => (b.usd! > a.usd! ? b : a));
    const avg = built.reduce((n, c) => n + c.usd!, 0) / built.length;
    const over = built.filter((c) => c.usd! >= 0.5).map((c) => `${c.name} ${dollars(c.usd!)}`);
    out.push(
      `GOAL C3 (build under $0.50): ${built.length} real build(s), average ${dollars(avg)}, most expensive ${dollars(worst.usd!)} (${worst.name}) — ` +
        `${over.length === 0 ? "passes" : `FAILS for ${over.join(", ")}`}. Video builds add the Gemini notes on top (below).`,
    );
  } else {
    out.push(
      "GOAL C3 (build under $0.50, hint under $0.01): no real Claude call ran, so there is no real lesson-build or hint cost yet. " +
        "The about-me fixture is hand-written, so it has no cost data at all; it only gives the estimate shown above.",
    );
  }
  if (r.hintChecks && r.hintChecks.length > 0) {
    const worst = Math.max(...r.hintChecks.map((h) => h.usd));
    const avg = r.hintChecks.reduce((n, h) => n + h.usd, 0) / r.hintChecks.length;
    out.push(
      `GOAL C3 (hint under $0.01): ${r.hintChecks.length} real Haiku check call(s), average ${dollars(avg)}, most expensive ${dollars(worst)} — ` +
        `${worst < 0.01 ? "passes" : "FAILS"}. The hint text itself is written into the lesson when it's built, so showing a hint costs nothing; ` +
        "only a check the code can't decide calls Haiku.",
    );
  }
  const notes = r.videoNotes.filter((v) => v.usd !== undefined);
  if (notes.length > 0) {
    const avg = notes.reduce((n, v) => n + v.usd!, 0) / notes.length;
    out.push(
      `Reading one 19-24 minute video with Gemini (low resolution) cost ${dollars(Math.min(...notes.map((v) => v.usd!)))}-${dollars(Math.max(...notes.map((v) => v.usd!)))} ` +
        `(average ${dollars(avg)}, upper-bound price). That is part of a video lesson's build, so it leaves about ${dollars(Math.max(0, 0.5 - avg))} ` +
        "of the $0.50 budget for the Opus steps call (projection, not measured).",
    );
  }
  for (const v of r.videoNotes) {
    if (v.codeLines !== undefined && v.codeSegments !== undefined && v.codeLines < 3 * Math.max(1, v.codeSegments)) {
      out.push(
        `${v.videoId}: Gemini copied only ${v.codeLines} code lines across ${v.codeSegments} code parts — low media resolution may be missing ` +
          "on-screen code. Check this lesson's fidelity on the first real build; try CALHACK_GEMINI_MEDIA_RESOLUTION=medium if it's thin.",
      );
    }
  }
  return out;
}

function scoreLine(j: LessonJudgement): string {
  const s = j.scores;
  return `wording ${s.wording} · step size ${s.stepSize} · order ${s.order} · hints ${s.hints} · fidelity ${s.fidelity}`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function reportMarkdown(r: EvalReport): string {
  const out: string[] = [];
  out.push("# Stride Learn: lesson quality test (C2)", "");
  out.push(`Ran ${r.ranAt} with \`npm run learn:eval\`. The raw results are in \`report.json\` next to this file.`, "");
  out.push(`**Claude:** ${r.claude.usable ? "working" : "not usable"}: ${r.claude.note}`, "");
  if (r.summary && r.summary.length > 0) {
    out.push("## Summary", "");
    for (const line of r.summary) out.push(`- ${line}`);
    out.push("");
  }

  out.push("## Lessons", "");
  out.push("| Lesson | Source | Status | Automatic grade | Opus scores (1-5) | Estimate | Build cost |", "|---|---|---|---|---|---|---|");
  for (const c of r.cases) {
    const grade = c.grade ? `${c.grade.passed}/${c.grade.total} pass` : "—";
    const judged = c.judgement ? scoreLine(c.judgement) : c.grade?.kind === "tooBig" ? "n/a" : r.claude.usable ? "—" : "blocked (no Claude key)";
    const est = c.estimate ? `${c.estimate.minutes} min · ${c.estimate.linesToType} lines · ${c.estimate.steps} steps` : "—";
    const cost = c.usd !== undefined ? dollars(c.usd) : "—";
    out.push(`| ${cell(c.name)} | ${c.source ?? "—"} | ${c.status}${c.note ? `: ${cell(c.note)}` : ""} | ${grade} | ${judged} | ${est} | ${cost} |`);
  }
  out.push("");

  for (const c of r.cases.filter((x) => x.grade)) {
    out.push(`### ${c.name} (${c.source})`, "");
    for (const k of c.grade!.criteria) {
      const mark = k.skipped ? "➖" : k.pass ? "✅" : "❌";
      out.push(`- ${mark} ${k.title}${k.skipped ? ` — ${k.skipped}` : ""}`);
      for (const e of k.examples) out.push(`  - ${e}`);
    }
    if (c.judgement) {
      out.push("", `Opus review: ${scoreLine(c.judgement)}. ${c.judgement.summary}`);
      for (const w of c.judgement.worst) out.push(`  - ${w.stepId}: ${w.problem}`);
    }
    out.push("");
  }

  if (r.findings.length > 0) {
    out.push("## Findings", "");
    for (const f of r.findings) out.push(`- ${f}`);
    out.push("");
  }

  if (!r.claude.usable) {
    out.push("## Blocked: no working Claude key", "");
    out.push(
      "These need the Claude API and did not run. Nothing below is faked; run `npm run learn:eval` with a valid",
      "`ANTHROPIC_API_KEY` (or `STRIDE_ANTHROPIC_API_KEY`) in `.env` to fill them in:",
      "",
      "- Building real lessons (Opus) for: \"a page about me\", \"a website for my small bakery\", \"a page like this picture\"",
      `  (reads \`${MOCKUP_PATH}\` first), and the 3 videos (Gemini notes are already recorded, so only Opus runs).`,
      "  Expected: each comes back as a valid lesson, graded on every criterion above; the bakery lesson over 60 min carries a",
      "  smaller offer; build cost per lesson under $0.50 (GOAL C3), logged per call in `docs/learn/eval/cost.json`.",
      "- The separate Opus grading call (`src/learn/judge-lesson.ts`) for each lesson: scores 1-5 on wording, step size,",
      "  order, hints and fidelity, plus the worst steps.",
      "- Haiku hint/check calls (`ai` checks) and their cost per hint (GOAL C3: under $0.01).",
      "- Before/after for the prompt changes: compare this report with the first run's.",
      "- Already done without Claude: \"make me Instagram\" (code-only scope check), the about-me fixture's automatic grade",
      "  with the real hidden-browser checker, and the Gemini notes for all 3 videos.",
      "",
    );
  }

  out.push("## Video notes (Gemini, real calls)", "");
  out.push("| Video | Status | Title Gemini read | Chapters · segments · with code | Code lines | Last second | Tokens in / out | Cost |", "|---|---|---|---|---|---|---|---|");
  let geminiTotal = 0;
  for (const v of r.videoNotes) {
    geminiTotal += v.usd ?? 0;
    const counts = v.segments !== undefined ? `${v.chapters} · ${v.segments} · ${v.codeSegments}` : "—";
    const tokens = v.inputTokens !== undefined ? `${v.inputTokens.toLocaleString("en-US")} / ${v.outputTokens!.toLocaleString("en-US")}` : "—";
    out.push(
      `| [${v.videoId}](${v.url}) | ${v.status}${v.error ? `: ${cell(v.error)}` : ""} | ${cell(v.title ?? "—")} | ${counts} | ${v.codeLines ?? "—"} | ${v.endSeconds ?? "—"} | ${tokens} | ${v.usd !== undefined ? dollars(v.usd) : "—"} |`,
    );
  }
  out.push("", `Gemini total for these notes: ${dollars(geminiTotal)} (low media resolution). ${r.geminiPrice}`, "");

  out.push("## Spend", "");
  out.push(`This run: ${dollars(r.spend.thisRun)}. All eval runs so far (cost.json): ${dollars(r.spend.allRuns)}. Hard cap: ${dollars(r.spend.cap)}.`, "");

  if (r.hintChecks && r.hintChecks.length > 0) {
    out.push("## Hint-time checks (Haiku, real calls)", "");
    out.push("| Lesson | Step | Haiku said | Tokens in / out | Cost |", "|---|---|---|---|---|");
    for (const h of r.hintChecks) out.push(`| ${cell(h.lesson)} | ${cell(h.stepId)} | ${cell(h.answer)} | ${h.inputTokens} / ${h.outputTokens} | ${dollars(h.usd)} |`);
    out.push("");
  }

  out.push("## Prompt changes", "");
  if (r.before) {
    out.push(`Before = the run of ${r.before.ranAt}; after = this run. Opus scores are wording · step size · order · hints · fidelity (1-5), then their average.`, "");
    out.push("| Lesson | Automatic grade before → after | Opus scores before | Opus scores after | Average before → after | Build cost before → after |", "|---|---|---|---|---|---|");
    const short = (j?: LessonJudgement) => (j ? `${j.scores.wording} · ${j.scores.stepSize} · ${j.scores.order} · ${j.scores.hints} · ${j.scores.fidelity}` : "—");
    const avg = (j?: LessonJudgement) => (averageScore(j) === undefined ? "—" : averageScore(j)!.toFixed(1));
    const g = (x?: Grade) => (x ? `${x.passed}/${x.total}` : "—");
    const usd = (x?: number) => (x === undefined ? "—" : dollars(x));
    for (const c of r.cases.filter((x) => x.grade?.kind === "lesson")) {
      const b = r.before.cases.find((x) => x.name === c.name);
      if (!b) continue;
      if (!b.grade) {
        const why = `build failed${b.note ? `: ${b.note.split(" (")[0]}` : ""}`;
        out.push(`| ${cell(c.name)} | ${cell(why)} → ${c.grade!.passed}/${c.grade!.total} | — | ${c.judgement ? short(c.judgement) : "—"} | — → ${avg(c.judgement)} | ${usd(b.usd)} lost → ${usd(c.usd)} |`);
        continue;
      }
      out.push(`| ${cell(c.name)} | ${g(b.grade)} → ${g(c.grade)} | ${short(b.judgement)} | ${short(c.judgement)} | ${avg(b.judgement)} → ${avg(c.judgement)} | ${usd(b.usd)} → ${usd(c.usd)} |`);
    }
    out.push("");
  } else {
    out.push("Before/after: this is the first run with these prompts; the next run compares against it (`--before`).", "");
  }
  out.push("| Where | Change | Why |", "|---|---|---|");
  for (const p of r.promptChanges) out.push(`| ${cell(p.where)} | ${cell(p.change)} | ${cell(p.why)} |`);
  out.push("");

  out.push("## Checker messages, before → after", "");
  for (const m of r.messageExamples) out.push(`- ${m.before} → **${m.after}**`);
  out.push("");
  return `${out.join("\n")}\n`;
}

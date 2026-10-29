// The lesson quality test (task C2): builds real lessons for the test ideas and videos, grades each one automatically
// and with a separate Opus review, and writes docs/learn/eval/report.md (+ report.json, cost.json).
//   npm run learn:eval                      build what's missing (needs the Claude key), grade everything
//   npm run learn:eval -- --video-notes     also read the 3 videos with Gemini (reuses recordings unless --refresh-notes)
//   npm run learn:eval -- --lesson a.json   grade extra lesson files too
//   npm run learn:eval -- --rebuild "a page about me"   build that case again instead of using the saved lesson (or --rebuild all)
//   npm run learn:eval -- --before old-report.json      show before/after scores against an earlier run
//   npm run learn:eval -- --render          write report.md again from report.json (no model calls, nothing spent)
// Every call is metered, and the run stops once real spend for this test passes $8 (see SPEND_CAP_USD).
import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { friendlyError, hasApiKey, loadEnv } from "../ai/client.js";
import { askJson } from "../ai/json.js";
import { buildFromIdea, playwrightReference, type AskModel } from "../learn/build-from-idea.js";
import { buildFromVideo, firstPart, notesEnd } from "../learn/build-from-video.js";
import { lessonCache } from "../learn/cache.js";
import { checkRunner, haikuJudge, playwrightRenderer } from "../learn/check/index.js";
import { reasons } from "../learn/check/hint.js";
import { CostLog, costOf, dollars, geminiUsage, meteredAskJson, meteredLearnModel, readCostFile } from "../learn/cost.js";
import {
  beforeRunFrom,
  BudgetError,
  capped,
  EVAL_CASES,
  EVAL_SUMMARY,
  findingsFor,
  GEMINI_PRICE_NOTE,
  MOCKUP_PATH,
  PROMPT_CHANGES,
  reportMarkdown,
  SPEND_CAP_USD,
  summarizeNotes,
  type BeforeRun,
  type CaseResult,
  type HintCheckCost,
  type EvalReport,
  type VideoCase,
  type VideoNotesResult,
} from "../learn/eval.js";
import { readVideo, type GeminiUsage, type VideoNotes } from "../learn/gemini.js";
import { gradeLesson, gradeTooBig } from "../learn/grade.js";
import { judgeLesson } from "../learn/judge-lesson.js";
import { LessonError, parseLesson, type Lesson } from "../learn/lesson.js";
import { readPicture } from "../learn/picture.js";

const ROOT = process.env.CALHACK_ROOT ?? process.cwd();
loadEnv(ROOT);

const say = (text: string): void => void process.stdout.write(`${text}\n`);

type Args = { videoNotes: boolean; refreshNotes: boolean; lessons: string[]; out: string; rebuild: string[]; before?: string; render: boolean };

function parseArgs(argv: string[]): Args {
  const a: Args = { videoNotes: false, refreshNotes: false, lessons: [], out: join(ROOT, "docs/learn/eval"), rebuild: [], render: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x === "--video-notes") a.videoNotes = true;
    else if (x === "--refresh-notes") a.videoNotes = a.refreshNotes = true;
    else if (x === "--lesson" && argv[i + 1]) a.lessons.push(resolve(argv[++i]!));
    else if (x === "--out" && argv[i + 1]) a.out = resolve(argv[++i]!);
    else if (x === "--rebuild" && argv[i + 1]) a.rebuild.push(argv[++i]!);
    else if (x === "--before" && argv[i + 1]) a.before = resolve(argv[++i]!);
    else if (x === "--render") a.render = true;
    else throw new Error(`I don't know "${x}". Try: --video-notes, --refresh-notes, --lesson <file>, --out <folder>, --rebuild <name|all>, --before <report.json>`);
  }
  return a;
}

// ---------- The reference picture: a plain mockup made here, so the test never depends on a download ----------

async function ensureMockup(path: string): Promise<void> {
  if (existsSync(path)) return;
  const { default: sharp } = await import("sharp");
  const card = (x: number, title: string) =>
    `<rect x="${x}" y="470" width="320" height="260" rx="18" fill="#ffffff" stroke="#d9d4cc" stroke-width="2"/>` +
    `<rect x="${x + 20}" y="490" width="280" height="120" rx="10" fill="#f3c6a5"/>` +
    `<text x="${x + 20}" y="650" font-family="Arial" font-size="28" font-weight="bold" fill="#3b2f2f">${title}</text>` +
    `<rect x="${x + 20}" y="670" width="240" height="14" rx="7" fill="#d9d4cc"/><rect x="${x + 20}" y="694" width="180" height="14" rx="7" fill="#d9d4cc"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
<rect width="1200" height="900" fill="#faf7f2"/>
<rect width="1200" height="80" fill="#3b2f2f"/>
<text x="40" y="52" font-family="Arial" font-size="30" font-weight="bold" fill="#ffffff">My Site</text>
<text x="760" y="50" font-family="Arial" font-size="24" fill="#ffffff">Home    About    Work    Contact</text>
<rect y="80" width="1200" height="340" fill="#e07a5f"/>
<text x="600" y="250" text-anchor="middle" font-family="Arial" font-size="72" font-weight="bold" fill="#ffffff">Big Title Here</text>
<text x="600" y="310" text-anchor="middle" font-family="Arial" font-size="30" fill="#ffffff">A short line under the title</text>
${card(60, "Card one")}${card(440, "Card two")}${card(820, "Card three")}
<rect y="800" width="1200" height="100" fill="#3b2f2f"/>
<text x="600" y="858" text-anchor="middle" font-family="Arial" font-size="24" fill="#ffffff">Footer · made by me</text>
</svg>`;
  await mkdir(dirname(path), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(path);
  say(`🖼  Made the test picture: ${path}`);
}

// ---------- Video notes: recorded once with Gemini, then reused ----------

type NotesRecording = { videoId: string; url: string; mediaResolution: string; recordedAt: string; usage?: GeminiUsage; usd?: number; response: unknown };

function notesPath(videoId: string): string {
  return join(ROOT, "tests/learn/fixtures/video-notes", `${videoId}.json`);
}

async function loadRecording(videoId: string): Promise<NotesRecording | null> {
  try {
    return JSON.parse(await readFile(notesPath(videoId), "utf8")) as NotesRecording;
  } catch {
    return null;
  }
}

// The notes inside a recording, read through the real Gemini client (so the same checks apply).
async function notesFrom(rec: NotesRecording): Promise<VideoNotes> {
  return readVideo(rec.url, { env: { GEMINI_API_KEY: "recorded" }, fetch: (async () => new Response(JSON.stringify(rec.response))) as typeof fetch });
}

async function recordNotes(v: VideoCase, log: CostLog): Promise<{ rec: NotesRecording; notes: VideoNotes }> {
  let raw: unknown;
  let usage: GeminiUsage | undefined;
  const read = capped(log, () =>
    readVideo(v.url, {
      mediaResolution: "low",
      onRaw: (r) => (raw = r),
      onUsage: (u) => {
        usage = u;
        log.record(`video-notes:${v.videoId}`, geminiUsage(u));
      },
    }),
  );
  let notes: VideoNotes | undefined;
  let lastError: unknown;
  for (const wait of [2, 4, 8, 16, 0]) {
    try {
      notes = await read();
      break;
    } catch (e) {
      lastError = e;
      if (e instanceof BudgetError || !/busy|\(50\d\)/i.test((e as Error).message) || wait === 0) throw e;
      say(`   Gemini is busy, trying again in ${wait} s…`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  if (!notes) throw lastError;
  const u = usage ? geminiUsage(usage) : undefined;
  const rec: NotesRecording = {
    videoId: v.videoId,
    url: v.url,
    mediaResolution: "low",
    recordedAt: new Date().toISOString(),
    ...(usage ? { usage } : {}),
    ...(u ? { usd: costOf(u.model, u.usage.input_tokens, u.usage.output_tokens) } : {}),
    response: raw,
  };
  await mkdir(dirname(notesPath(v.videoId)), { recursive: true });
  await writeFile(notesPath(v.videoId), `${JSON.stringify(rec, null, 2)}\n`, "utf8");
  return { rec, notes };
}

// What couldn't be checked about the test videos from here.
const VIDEO_NOTES_CAVEATS = [
  "The 3 videos were picked as beginner HTML/CSS step-by-step builds; youtube.com is blocked here, so view counts and captions " +
    "couldn't be checked. Gemini read two titles differently from the ones noted when picking them (\"HTML Tutorial for Beginners - " +
    "Full Course\", \"How to Code Your FIRST Website (in 10 minutes)\"); the report shows what Gemini read.",
  "Found by this test: in wzWmZYi4qMg's real notes Gemini escaped the code twice (every line break arrived as a typed \\\\n, so " +
    "each file was one long line). src/learn/gemini.ts now turns that back into real lines (unescapeCode); without it that " +
    "video's lesson would have been built from 11 one-line code blobs.",
];

// ---------- Checker messages, before and after the plain-English rewrite ----------

function messageExamples(): EvalReport["messageExamples"] {
  return [
    { before: 'I can\'t find "body h1" yet.', after: reasons.notFound("body h1") },
    { before: 'I see 2 "ul li", but this step needs 3.', after: reasons.wrongCount("ul li", 2, 3) },
    { before: '"title" should say "about me".', after: reasons.wrongText("title", "about me") },
    { before: '"head link" needs href="style.css".', after: reasons.missingAttr("head link", "href", "style.css") },
    { before: '"img" needs a alt attribute.', after: reasons.missingAttr("img", "alt") },
    { before: '"h1" doesn\'t have the right color yet.', after: reasons.wrongStyle("h1", "color") },
    { before: 'I can\'t find ".card h3" yet.', after: reasons.notFound(".card h3") },
    { before: "style.css doesn't exist yet.", after: reasons.missingFile("style.css") },
    { before: "The <ul> isn't closed yet.", after: "The <ul> you started still needs its closing </ul>." },
    { before: "The page also shows an error: Uncaught ReferenceError: x is not defined", after: "Your page also shows a problem when it opens, so check the code you just typed for a typo." },
  ];
}

// ---------- The run ----------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  if (args.render) {
    // The saved results with today's wording (prompt-change list, findings); the numbers are the saved ones.
    const saved = JSON.parse(await readFile(join(args.out, "report.json"), "utf8")) as EvalReport;
    const report: EvalReport = {
      ...saved,
      promptChanges: PROMPT_CHANGES,
      summary: EVAL_SUMMARY,
      findings: [...findingsFor({ ...saved, hintChecks: saved.hintChecks ?? [] }), ...VIDEO_NOTES_CAVEATS],
      ...(args.before ? { before: beforeRunFrom(JSON.parse(await readFile(args.before, "utf8")) as EvalReport) } : {}),
    };
    await writeFile(join(args.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(join(args.out, "report.md"), reportMarkdown(report), "utf8");
    say(`📄 ${join(args.out, "report.md")} (from the saved results)`);
    return;
  }
  const costFile = join(args.out, "cost.json");
  const log = new CostLog();
  await log.attach(costFile);
  const earlier = await readCostFile(costFile);

  let claudeUsable = hasApiKey();
  let claudeNote = claudeUsable ? "a key is set" : "no Claude key is set (ANTHROPIC_API_KEY / STRIDE_ANTHROPIC_API_KEY)";
  if (!claudeUsable) {
    say("🔑 There's no Claude key here, so I can't build new lessons or ask Opus to review them.");
    say("   I'll still grade the lessons I already have, check the Instagram case, and read the videos with Gemini if you pass --video-notes.");
  }

  await ensureMockup(join(ROOT, MOCKUP_PATH));
  const renderer = playwrightRenderer();
  const judge = claudeUsable ? haikuJudge(capped(log, meteredAskJson(log, "check", askJson)) as typeof askJson) : undefined;
  const runCheck = checkRunner({ renderer, ...(judge ? { judge } : {}) });
  const cache = lessonCache(join(args.out, "lessons"));
  const learnAsk: AskModel = capped(log, meteredLearnModel(log, askJson));
  const results: CaseResult[] = [];
  const videoNotes: VideoNotesResult[] = [];
  const notesById = new Map<string, VideoNotes>();
  let stopped: string | undefined;

  // Claude said the key is wrong: stop asking it for the rest of the run.
  const claudeFailed = (e: unknown): boolean => {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      claudeUsable = false;
      claudeNote = `the key was rejected (${friendlyError(e)})`;
      say(`🔑 ${friendlyError(e)} I'll grade what I can without it.`);
      return true;
    }
    return false;
  };

  const grade = async (name: string, kind: CaseResult["kind"], source: CaseResult["source"], lesson: Lesson, usd?: number, notes?: VideoNotes) => {
    say(`📝 Grading "${name}"…`);
    const g = await gradeLesson(name, lesson, { runCheck, ...(notes ? { videoSeconds: notesEnd(notes) } : {}) });
    const saved = (memo[`${lesson.id}@${lesson.createdAt}`] ??= {}); // a rebuilt lesson keeps its id but not its date
    if (usd !== undefined) saved.usd = usd;
    const cost = usd ?? saved.usd;
    const result: CaseResult = { name, kind, status: "graded", source, grade: g, estimate: lesson.estimate, ...(cost !== undefined ? { usd: cost } : {}) };
    if (saved.judgement) result.judgement = saved.judgement;
    else if (claudeUsable && !stopped) {
      try {
        // A long video's lesson covers its first part only (firstPart): judge its fidelity against that part.
        const seen = notes ? firstPart(notes).notes : undefined;
        result.judgement = await judgeLesson(lesson, { ask: capped(log, meteredAskJson(log, `judge:${name}`, askJson)), ...(seen ? { notes: seen } : {}) });
        saved.judgement = result.judgement;
      } catch (e) {
        if (e instanceof BudgetError) stopped = e.message;
        else if (!claudeFailed(e)) result.note = `Opus review failed: ${friendlyError(e)}`;
      }
    }
    await saveMemo();
    if (source !== "fixture") await hintCheck(name, lesson);
    results.push(result);
  };

  // Saved per lesson: what its build cost and its Opus review, so grading a saved lesson again doesn't pay for a new review.
  const memoFile = join(args.out, "memo.json");
  const memo: Record<string, { usd?: number; judgement?: CaseResult["judgement"] }> = await readFile(memoFile, "utf8").then((t) => JSON.parse(t), () => ({}));
  const saveMemo = () => writeFile(memoFile, `${JSON.stringify(memo, null, 2)}\n`, "utf8");
  const hintChecks: HintCheckCost[] = [];
  const before: BeforeRun | undefined = args.before ? beforeRunFrom(JSON.parse(await readFile(args.before, "utf8")) as EvalReport) : undefined;

  // A real Haiku check, the kind made while a student is stuck: the finished project with this step's code still missing.
  const hintCheck = async (name: string, lesson: Lesson) => {
    if (!claudeUsable || stopped) return;
    const step = lesson.steps.find((s) => s.who === "learner" && s.file?.endsWith(".html") && s.expected.trim());
    if (!step) return;
    const code = lesson.files.map((f) => `=== ${f.path} ===\n${f.path === step.file ? f.content.replace(step.expected, "") : f.content}`).join("\n\n");
    const from = log.entries.length;
    try {
      const verdict = await haikuJudge(capped(log, meteredAskJson(log, `hint-check:${name}`, askJson)) as typeof askJson)({
        stepTitle: step.title,
        instruction: step.instruction,
        question: `Has the student done this: ${step.instruction}`,
        file: step.file!,
        code,
        reference: step.expected,
      });
      const e = log.entries[from];
      if (e) hintChecks.push({ lesson: name, stepId: step.id, answer: `${verdict.answer}: ${verdict.reason}`, inputTokens: e.inputTokens, outputTokens: e.outputTokens, usd: e.usd });
    } catch (e) {
      if (e instanceof BudgetError) stopped = e.message;
    }
  };

  // What one build cost: the calls recorded while it ran.
  const spentSince = (from: number) => log.entries.slice(from).reduce((n, e) => n + e.usd, 0);

  try {
    // 1. The hand-written about-me fixture, with the real hidden-browser checker.
    const fixture = parseLesson(await readFile(join(ROOT, "tests/learn/fixtures/about-me.lesson.json"), "utf8"));
    await grade("about-me fixture (hand-written)", "idea", "fixture", fixture);
    for (const file of args.lessons) await grade(file, "idea", "file", parseLesson(await readFile(file, "utf8")));

    // 2. Video notes: recorded with Gemini, or reused from the recording (its earlier spend still counts toward the cap).
    for (const v of EVAL_CASES.filter((c): c is VideoCase => c.kind === "video")) {
      const rec = args.refreshNotes ? null : await loadRecording(v.videoId);
      try {
        if (rec) {
          const notes = await notesFrom(rec);
          notesById.set(v.videoId, notes);
          if (rec.usage && !earlier.some((e) => e.job === `video-notes:${v.videoId}`)) log.record(`video-notes:${v.videoId}`, geminiUsage(rec.usage));
          videoNotes.push({ videoId: v.videoId, url: v.url, status: "reused", model: rec.usage?.model, ...summarizeNotes(notes), ...tokens(rec.usage), usd: rec.usd });
        } else if (args.videoNotes) {
          say(`🎬 Reading "${v.title}" with Gemini…`);
          const { rec: fresh, notes } = await recordNotes(v, log);
          notesById.set(v.videoId, notes);
          videoNotes.push({ videoId: v.videoId, url: v.url, status: "recorded", model: fresh.usage?.model, ...summarizeNotes(notes), ...tokens(fresh.usage), usd: fresh.usd });
        } else {
          videoNotes.push({ videoId: v.videoId, url: v.url, status: "skipped", error: "no recording; pass --video-notes" });
        }
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        videoNotes.push({ videoId: v.videoId, url: v.url, status: "error", error: (e as Error).message });
      }
    }

    // 3. The test ideas and videos.
    for (const c of EVAL_CASES) {
      if (c.kind === "idea" && c.expect === "tooBig") {
        // The scope check is code, so this runs without any key. A model call here would be a bug.
        const noModel: AskModel = () => Promise.reject(new Error("The scope check should have answered without a model."));
        const r = await buildFromIdea({ request: c.request, answers: c.answers }, { ask: noModel, browser: playwrightReference, runCheck });
        results.push({ name: c.name, kind: "idea", status: "graded", source: "built", grade: gradeTooBig(c.name, r), usd: 0, ...(r.kind === "tooBig" ? { note: r.smaller.say } : {}) });
        continue;
      }
      const notes = c.kind === "video" ? notesById.get(c.videoId) : undefined;
      const rebuild = args.rebuild.includes(c.name) || args.rebuild.includes("all");
      const cached = rebuild ? null : await cache.load(c.name);
      if (cached) {
        await grade(c.name, c.kind, "cached", cached, undefined, notes);
        continue;
      }
      if (stopped) {
        results.push({ name: c.name, kind: c.kind, status: "blocked", note: stopped });
        continue;
      }
      if (!claudeUsable) {
        results.push({ name: c.name, kind: c.kind, status: "blocked", note: "needs a working Claude key" });
        continue;
      }
      if (c.kind === "video" && !notes) {
        results.push({ name: c.name, kind: c.kind, status: "blocked", note: "no video notes (run with --video-notes)" });
        continue;
      }
      const from = log.entries.length;
      say(`🛠  Building "${c.name}"…`);
      try {
        let lesson: Lesson;
        if (c.kind === "video") {
          lesson = await buildFromVideo(c.url, { runCheck, readVideo: async () => notes!, ask: capped(log, meteredAskJson(log, `video:${c.name}`, askJson)) as typeof askJson, cache: null });
        } else {
          const picture = c.picture ? await readPicture(join(ROOT, c.picture), { ask: capped(log, meteredAskJson(log, "picture", askJson)) }) : undefined;
          const r = await buildFromIdea(
            { request: c.request, answers: c.answers, ...(picture ? { picture } : {}) },
            { ask: learnAsk, browser: playwrightReference, runCheck, onStage: (s) => say(`   · ${s}`) },
          );
          if (r.kind === "tooBig") {
            results.push({ name: c.name, kind: "idea", status: "error", note: `unexpectedly too big: ${r.smaller.say}`, usd: spentSince(from) });
            continue;
          }
          lesson = r.lesson;
        }
        await cache.save(c.name, lesson);
        await grade(c.name, c.kind, "built", lesson, spentSince(from), notes);
      } catch (e) {
        if (e instanceof BudgetError) {
          stopped = e.message;
          results.push({ name: c.name, kind: c.kind, status: "blocked", note: e.message, usd: spentSince(from) });
        } else if (claudeFailed(e)) {
          results.push({ name: c.name, kind: c.kind, status: "blocked", note: claudeNote });
        } else {
          const why = e instanceof LessonError && e.problems.length ? ` (${e.problems.slice(0, 3).join("; ")})` : "";
          results.push({ name: c.name, kind: c.kind, status: "error", note: `${friendlyError(e)}${why}`, usd: spentSince(from) });
        }
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetError)) throw e;
    stopped = e.message;
  } finally {
    await renderer.close().catch(() => {});
  }
  if (stopped) say(`🛑 ${stopped}`);

  await log.flush();
  const report: EvalReport = {
    ranAt: new Date().toISOString(),
    claude: { usable: claudeUsable, note: claudeNote },
    geminiPrice: GEMINI_PRICE_NOTE,
    cases: results,
    videoNotes,
    spend: { thisRun: log.total().usd, allRuns: log.allTime().usd, cap: SPEND_CAP_USD },
    findings: [...findingsFor({ cases: results, videoNotes, claude: { usable: claudeUsable, note: claudeNote }, hintChecks }), ...VIDEO_NOTES_CAVEATS],
    messageExamples: messageExamples(),
    promptChanges: PROMPT_CHANGES,
    hintChecks,
    summary: EVAL_SUMMARY,
    ...(before ? { before } : {}),
  };
  await writeFile(join(args.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(args.out, "report.md"), reportMarkdown(report), "utf8");
  for (const r of results) say(`${r.status === "graded" ? "✅" : r.status === "blocked" ? "⏸ " : "❌"} ${r.name}: ${r.grade ? `${r.grade.passed}/${r.grade.total} criteria pass` : r.note ?? r.status}`);
  say(`💰 This run ${dollars(log.total().usd)}, all eval runs ${dollars(log.allTime().usd)} (cap ${dollars(SPEND_CAP_USD)}).`);
  say(`📄 ${join(args.out, "report.md")}`);
}

function tokens(u: GeminiUsage | undefined): Pick<VideoNotesResult, "inputTokens" | "outputTokens"> {
  return u ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens + u.thoughtsTokens } : {};
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    say(`😕 ${friendlyError(e)}`);
    process.exit(1);
  },
);

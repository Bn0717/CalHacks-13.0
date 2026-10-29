// Stride Learn in the terminal: a whole lesson without the Mac app.
//   npm run learn -- "a page about me"
//   npm run learn -- --picture ./ref.png "a page like this"
//   npm run learn -- --video https://youtu.be/...
//   npm run learn -- --resume
// The student types in their own editor; this window shows the steps, checks their work by itself and gives hints.
import { randomUUID } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { askJson } from "../ai/json.js";
import { friendlyError, hasApiKey, loadEnv } from "../ai/client.js";
import { lessonCache, ideaCacheKey, videoCacheKey } from "../learn/cache.js";
import { buildFromIdea, playwrightReference, scopeCheck, type AskModel } from "../learn/build-from-idea.js";
import { buildFromVideo, parseYouTubeId, VideoUrlError } from "../learn/build-from-video.js";
import { checkRunner, checkStep, haikuJudge, playwrightRenderer, type Judge, type Renderer } from "../learn/check/index.js";
import { CostLog, dollars, geminiUsage, meteredAskJson, meteredLearnModel } from "../learn/cost.js";
import { hasGeminiKey, MISSING_KEY_MESSAGE, readVideo } from "../learn/gemini.js";
import { BUILD_TIME_TEXT, STAGE_LABELS, type BuildStage } from "../learn/stages.js";
import { LessonError, parseLesson, smallerLesson, type Lesson } from "../learn/lesson.js";
import { applyCorrection, describeForStudent, readPicture, type PictureReading } from "../learn/picture.js";
import { createProgressStore } from "../learn/progress.js";
import { questionsFor } from "../learn/questions.js";
import type { Clock } from "../learn/runner.js";
import { LessonSession, type EditorLink, type FolderWatcher, type KeySource } from "../learn/session.js";
import { ArgsError, costText, estimateText, lessonsRoot, parseArgs, parseChoice, questionText, slugify, summaryText, USAGE, type CliArgs } from "../learn/terminal.js";
import { startBridge, type Bridge } from "../learn/bridge.js";

loadEnv(process.env.CALHACK_ROOT ?? process.cwd());

const NO_CLAUDE_KEY =
  "Building a new lesson needs the Claude key (ANTHROPIC_API_KEY, or STRIDE_ANTHROPIC_API_KEY). Add it to the .env file in the Stride folder, then try again.\n" +
  "Lessons you've made before still work without it, and so does: npm run learn -- --lesson <lesson file>";

const say = (text: string): void => void process.stdout.write(`${text}\n`);
// When the window reading our output goes away (e.g. piped into `head`), just stop quietly.
process.stdout.on("error", () => process.exit(0));

// ---------- Reading what the student types ----------

// Lines for questions, single keys during the lesson. Works in a real terminal and when the input is piped in.
class Input implements KeySource {
  private buffer = "";
  private waiting: ((line: string | null) => void) | undefined;
  private keyFns = new Set<(key: string) => void>();
  private closed = false;

  constructor(private readonly stdin: NodeJS.ReadStream = process.stdin) {
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => this.feed(chunk));
    stdin.on("end", () => {
      this.closed = true;
      this.waiting?.(this.buffer || null);
      this.waiting = undefined;
    });
  }

  ask(prompt: string): Promise<string | null> {
    process.stdout.write(`${prompt} `);
    if (this.closed && !this.buffer.includes("\n")) return Promise.resolve(null);
    return new Promise((resolveLine) => {
      this.waiting = resolveLine;
      this.feed("");
    });
  }

  onKey(fn: (key: string) => void): () => void {
    if (this.keyFns.size === 0 && this.stdin.isTTY) this.stdin.setRawMode(true);
    // Keys typed ahead (e.g. piped in with the last answer) still count.
    const ahead = this.buffer;
    this.buffer = "";
    this.keyFns.add(fn);
    if (ahead) queueMicrotask(() => this.feed(ahead));
    return () => {
      this.keyFns.delete(fn);
      if (this.keyFns.size === 0 && this.stdin.isTTY) this.stdin.setRawMode(false);
    };
  }

  close(): void {
    if (this.stdin.isTTY) this.stdin.setRawMode(false);
    this.stdin.pause();
  }

  private feed(chunk: string): void {
    if (this.keyFns.size > 0) {
      for (const ch of chunk.replace(/\r\n/g, "\n")) for (const fn of this.keyFns) fn(ch === "\r" ? "\n" : ch);
      return;
    }
    this.buffer += chunk;
    const at = this.buffer.indexOf("\n");
    if (at >= 0 && this.waiting) {
      const line = this.buffer.slice(0, at).replace(/\r$/, "");
      this.buffer = this.buffer.slice(at + 1);
      const w = this.waiting;
      this.waiting = undefined;
      w(line);
    }
  }
}

// Asks a numbered question until the answer makes sense. Returns the picked options (empty = skipped).
async function choose(input: Input, text: string, options: string[], multi = false): Promise<string[] | null> {
  say(text);
  options.forEach((o, i) => say(`  ${i + 1}) ${o}`));
  for (;;) {
    const line = await input.ask(multi ? "Type the numbers you like:" : "Type a number:");
    if (line === null) return null;
    const picks = parseChoice(line, { options, multi });
    if (picks && picks.length > 0) return picks;
    say(`Type a number from 1 to ${options.length}.`);
  }
}

// ---------- The real helpers ----------

const realClock: Clock = {
  now: () => Date.now(),
  every(ms, fn) {
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
  },
};

const folderWatcher: FolderWatcher = {
  watch(dir, onChange) {
    const watcher = watch(dir, { recursive: true }, (_event, name) => onChange(name ? name.toString().split("\\").join("/") : null));
    watcher.on("error", () => {});
    return () => watcher.close();
  },
};

function editorLink(bridge: Bridge): EditorLink {
  return {
    get connected() {
      return bridge.connected;
    },
    highlight(path, line, message) {
      bridge.send({ type: "highlight", id: randomUUID(), path, startLine: line, endLine: line, message: message.slice(0, 300) });
    },
    async insert(path, text, afterLine) {
      const done = await bridge.request({ type: "insert", id: randomUUID(), path, text, anchor: { afterLine } });
      return done?.ok === true;
    },
    onEdit(fn) {
      const change = (e: { path: string; text: string }) => fn({ path: e.path, text: e.text, saved: false });
      const save = (e: { path: string; text: string }) => fn({ path: e.path, text: e.text, saved: true });
      bridge.on("change", change);
      bridge.on("save", save);
      return () => {
        bridge.off("change", change);
        bridge.off("save", save);
      };
    },
  };
}

type Tools = { log: CostLog; renderer: Renderer; judge: Judge | undefined; learnAsk: AskModel };

// ---------- Getting a lesson ----------

async function ideaLesson(args: Extract<CliArgs, { mode: "idea" }>, input: Input, tools: Tools): Promise<Lesson | null> {
  let request = args.idea;
  const tooBig = scopeCheck(request);
  if (tooBig) {
    const pick = await choose(input, `🤔 ${tooBig.smaller.say}`, ["Yes, let's make that", "No thanks"]);
    if (!pick || pick[0] === "No thanks") {
      say('No problem! Try something small to start, like "a page about me".');
      return null;
    }
    request = tooBig.smaller.request;
  }

  let picture: PictureReading | undefined;
  if (args.picture) {
    if (!hasApiKey()) return missing(NO_CLAUDE_KEY);
    say("🖼  Looking at your picture…");
    picture = await readPicture(resolve(args.picture), { ask: meteredAskJson(tools.log, "picture", askJson) });
    const pick = await choose(input, `I see: ${describeForStudent(picture)}. Is that right?`, ["Yes", "Not quite"]);
    if (pick?.[0] === "Not quite") {
      const fix = await input.ask("What's different? (e.g. \"there are 4 cards, not 3\")\n>");
      if (fix) picture = await applyCorrection(picture, fix, { ask: meteredAskJson(tools.log, "picture", askJson) });
      say(`Got it: ${describeForStudent(picture)}.`);
    }
  }

  const noModel: AskModel = () => Promise.reject(new Error("no key"));
  const questions = await questionsFor(request, { ask: hasApiKey() ? tools.learnAsk : noModel });
  say("A few quick questions first.");
  const answers: { question: string; answer: string }[] = [];
  for (const [i, q] of questions.entries()) {
    say("");
    say(questionText(q, i + 1, questions.length));
    for (;;) {
      const line = await input.ask(">");
      if (line === null) break;
      const picks = parseChoice(line, q);
      if (picks === null) {
        say(`Type ${q.multi ? "one or more numbers" : "a number"} from 1 to ${q.options.length}, or press Enter to skip.`);
        continue;
      }
      if (picks.length > 0) answers.push({ question: q.question, answer: picks.join(", ") });
      break;
    }
  }

  const cache = lessonCache();
  const key = ideaCacheKey({ request, answers, ...(picture ? { pictureSummary: picture.summary } : {}) });
  const cached = await cache.load(key);
  if (cached) {
    say("⚡ This lesson was made before, so it's ready right away.");
    return cached;
  }
  if (!hasApiKey()) return missing(NO_CLAUDE_KEY);

  say(`\n🛠  Building your lesson. I make the finished website first, test it, then cut it into small steps. This takes ${BUILD_TIME_TEXT}.`);
  const result = await buildFromIdea(
    { request, answers, ...(picture ? { picture } : {}) },
    {
      ask: tools.learnAsk,
      browser: playwrightReference,
      runCheck: checkRunner({ renderer: tools.renderer, ...(tools.judge ? { judge: tools.judge } : {}) }),
      onStage: sayStage,
    },
  );
  if (result.kind === "tooBig") {
    say(`🤔 ${result.smaller.say}`);
    return null;
  }
  await cache.save(key, result.lesson);
  return result.lesson;
}

async function videoLesson(url: string, tools: Tools): Promise<Lesson | null> {
  let videoId: string;
  try {
    videoId = parseYouTubeId(url);
  } catch (e) {
    if (e instanceof VideoUrlError) return missing(e.message);
    throw e;
  }
  const cached = await lessonCache().load(videoCacheKey(videoId));
  if (cached) {
    say("⚡ This video's lesson was made before, so it's ready right away.");
    return cached;
  }
  if (!hasApiKey()) return missing(NO_CLAUDE_KEY);
  if (!hasGeminiKey()) return missing(MISSING_KEY_MESSAGE);
  say(`🎬 Watching the video and turning it into small steps. This takes ${BUILD_TIME_TEXT}.`);
  return buildFromVideo(url, {
    runCheck: checkRunner({ renderer: tools.renderer, ...(tools.judge ? { judge: tools.judge } : {}) }),
    ask: meteredAskJson(tools.log, "video", askJson),
    readVideo: (u) => readVideo(u, { onUsage: (usage) => tools.log.record("video-notes", geminiUsage(usage)) }),
    onStage: sayStage,
  });
}

// Each real phase of the build, as it starts: "  · Writing the finished website…"
function sayStage(stage: BuildStage): void {
  say(`  · ${STAGE_LABELS[stage]}…`);
}

function missing(message: string): null {
  say(`🔑 ${message}`);
  process.exitCode = 1;
  return null;
}

// ---------- Folders ----------

type Last = { dir: string };

async function readLast(root: string): Promise<Last | null> {
  try {
    const data = JSON.parse(await readFile(join(root, ".last.json"), "utf8")) as Partial<Last>;
    return typeof data.dir === "string" ? { dir: data.dir } : null;
  } catch {
    return null;
  }
}

async function loadSavedLesson(dir: string): Promise<Lesson | null> {
  try {
    return parseLesson(await readFile(join(dir, ".stride", "lesson.json"), "utf8"));
  } catch {
    return null;
  }
}

// ~/stride-lessons/<name>, or <name>-2, -3… when that folder already holds a different lesson.
async function pickDir(root: string, lesson: Lesson): Promise<string> {
  const base = join(root, slugify(lesson.title));
  for (let n = 1; ; n++) {
    const dir = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(dir)) return dir;
    if ((await loadSavedLesson(dir))?.id === lesson.id) return dir;
  }
}

// ---------- The lesson ----------

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof ArgsError)) throw e;
    say(`${e.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (args.mode === "help") return say(USAGE);

  const input = new Input();
  const log = new CostLog();
  const renderer = playwrightRenderer();
  const judge = hasApiKey() ? haikuJudge(meteredAskJson(log, "check", askJson)) : undefined;
  const tools: Tools = { log, renderer, judge, learnAsk: meteredLearnModel(log, askJson) };
  const root = lessonsRoot();
  let bridge: Bridge | undefined;

  try {
    let lesson: Lesson | null = null;
    let dir = args.dir ? resolve(args.dir) : undefined;

    if (args.mode === "resume") {
      dir ??= (await readLast(root))?.dir;
      lesson = dir ? await loadSavedLesson(dir) : null;
      if (!lesson || !dir) {
        say('There\'s no lesson to carry on yet. Start one with: npm run learn -- "a page about me"');
        return;
      }
    } else if (args.mode === "lesson") {
      try {
        lesson = parseLesson(await readFile(resolve(args.file), "utf8"));
      } catch (e) {
        say(e instanceof LessonError ? `😕 That lesson file has a problem. ${e.message}` : `😕 I couldn't open ${args.file}.`);
        process.exitCode = 1;
        return;
      }
    } else if (args.mode === "video") {
      lesson = await videoLesson(args.url, tools);
    } else {
      lesson = await ideaLesson(args, input, tools);
    }
    if (!lesson) return;

    if (args.mode !== "resume") {
      // The honest estimate first, and the smaller version when the lesson is long.
      say("");
      say(estimateText(lesson));
      const smaller = smallerLesson(lesson);
      if (lesson.simpler && smaller) {
        const s = lesson.simpler;
        const pick = await choose(input, `\nThat's a big one. ${s.why}`, [
          `The smaller version first: ${s.title} (about ${s.estimate.minutes} min, ${s.estimate.steps} steps)`,
          `The whole thing (about ${lesson.estimate.minutes} min, ${lesson.estimate.steps} steps)`,
        ]);
        if (!pick) return;
        if (pick[0]!.startsWith("The smaller")) lesson = smaller;
      }
      const go = await input.ask("\nPress Enter to start (or type q to stop):");
      if (go === null || go.trim().toLowerCase() === "q") return say("OK, see you next time!");
    }

    dir ??= await pickDir(root, lesson);
    await mkdir(join(dir, ".stride"), { recursive: true });
    await writeFile(join(dir, ".stride", "lesson.json"), `${JSON.stringify(lesson, null, 2)}\n`, "utf8");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, ".last.json"), `${JSON.stringify({ dir }, null, 2)}\n`, "utf8");
    const costFile = join(dir, "cost.json");
    await log.attach(costFile);

    say(`\n📁 Your project folder: ${dir}`);
    say("Open it in VS Code (or any code editor) and keep this window next to it. Save your file and I'll check it.");

    if (args.editor) {
      bridge = await startBridge().catch(() => undefined);
      bridge?.on("connected", () => say("🔗 VS Code is connected: I'll point at the line to type on."));
    }

    const session = new LessonSession({
      lesson,
      dir,
      store: createProgressStore(join(dir, ".stride")),
      clock: realClock,
      print: say,
      keys: input,
      watcher: folderWatcher,
      check: (step, files, start) => checkStep(step, files, { renderer, ...(judge ? { judge } : {}), ...(start ? { start } : {}) }),
      ...(bridge ? { editor: editorLink(bridge) } : {}),
      pace: args.pace,
    });
    // Warm up the hidden browser while the student reads the first step, so their first check is quick.
    void renderer.warm?.().catch(() => {});
    await session.start();
    const end = await session.ended;
    await session.settle();
    if (end.how === "finished") say(`\n${summaryText(end.summary, lesson)}`);
    await log.flush();
    say(costText(log.total(), log.allTime(), costFile));
  } catch (e) {
    say(`😕 ${e instanceof LessonError ? e.message : friendlyError(e)} Try again in a moment, or try a different idea.`);
    // Calls made before the problem still cost money: say how much.
    if (log.total().calls > 0) say(`💸 AI cost so far: ${dollars(log.total().usd)} (${log.total().calls} calls).`);
    process.exitCode = 1;
  } finally {
    input.close();
    await bridge?.stop().catch(() => {});
    await renderer.close().catch(() => {});
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    say(`😕 ${friendlyError(e)}`);
    process.exit(1);
  },
);

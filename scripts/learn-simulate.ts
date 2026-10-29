// Plays a pretend student through a terminal lesson, for an end-to-end run without a person.
//   npx tsx scripts/learn-simulate.ts [lesson.json] [transcript.md]           a lesson file (no AI call)
//   npx tsx scripts/learn-simulate.ts --idea "a page about me" [transcript.md]  a real AI build (needs the Claude key)
// It starts the real terminal CLI (`src/cli/learn.ts`: runner, checker, hidden browser), reads what it prints, and "types"
// each step by writing the step's expected code into the file at its anchor. Two steps get a wrong try first (a typo made
// from the step's own code, see src/learn/pretend-student.ts) to bring out the hints, one of them asks for all 3 hints, and
// one step gets a half-typed save first, to show half-typed code isn't called wrong.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { insertAtAnchor } from "../src/learn/anchor.js";
import { parseLesson, type Lesson, type Step } from "../src/learn/lesson.js";
import { halfTyped, mistakePlan, wrongTry } from "../src/learn/pretend-student.js";
import { rebuildSteps } from "../src/learn/rebuild.js";
import { normCode } from "../src/learn/rules.js";

const argv = process.argv.slice(2);
const ideaAt = argv.indexOf("--idea");
const idea = ideaAt >= 0 ? argv.splice(ideaAt, 2)[1] : undefined;
const lessonFile = idea ? undefined : resolve(argv.shift() ?? "tests/learn/fixtures/about-me.lesson.json");
const transcriptFile = argv[0] ? resolve(argv[0]) : undefined;
// The answers to the questions before an idea build: the first option, and the first two for "pick several".
const ANSWERS = (process.env.SIM_ANSWERS ?? "1|1 2|2").split("|");

const work = await mkdtemp(join(tmpdir(), "stride-sim-"));
const dir = join(work, "lesson");
const started = Date.now();
const log: string[] = [];
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s`;
const student = (text: string) => {
  log.push(`${stamp()} 🧪 [student] ${text}`);
  process.stdout.write(`\x1b[36m🧪 [student] ${text}\x1b[0m\n`);
};

const cliArgs = idea ? [idea] : ["--lesson", lessonFile!];
const child = spawn("npx", ["tsx", "src/cli/learn.ts", ...cliArgs, "--dir", dir, "--no-editor"], {
  env: { ...process.env, STRIDE_LESSONS_DIR: work, FORCE_COLOR: "0" },
  stdio: ["pipe", "pipe", "pipe"],
});
let output = "";
let cursor = 0;
let partial = "";
// When the student last wrote a file, and when each ✅ line arrived (A5: within ~2 s of stopping typing).
let lastWriteAt = 0;
let lastTickAt = 0;
const onOut = (chunk: Buffer) => {
  const text = chunk.toString("utf8");
  output += text;
  process.stdout.write(text);
  partial += text;
  const lines = partial.split("\n");
  partial = lines.pop()!;
  for (const l of lines) {
    log.push(`${stamp()} ${l}`);
    if (l.includes("✅ Nice, that works!")) lastTickAt = Date.now();
  }
};
child.stdout.on("data", onOut);
child.stderr.on("data", onOut);
const exited = new Promise<number>((r) => child.on("exit", (code) => r(code ?? 1)));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Waits until the CLI prints something matching `re` after the cursor, and moves the cursor past it.
async function waitFor(re: RegExp, timeoutMs = 60_000): Promise<RegExpExecArray> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const m = re.exec(output.slice(cursor));
    if (m) {
      cursor += m.index + m[0].length;
      return m;
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${re}`);
    await sleep(20);
  }
}

const press = (key: string) => {
  student(key === "\n" ? "presses Enter" : `presses ${key.trim() || key}`);
  child.stdin.write(key);
};

async function writeStep(step: Step, before: string, code: string, what: string) {
  const file = join(dir, step.file!);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, insertAtAnchor(before, step.anchor, code).content);
  lastWriteAt = Date.now();
  student(`${what} in ${step.file}`);
}

const stats = { steps: 0, wrong: 0, half: 0, hintsSeen: 0, wrongAccepted: 0 };
const delays: { step: string; ms: number }[] = []; // last write -> ✅
let lesson: Lesson | undefined = lessonFile ? parseLesson(await readFile(lessonFile, "utf8")) : undefined;
let buildSeconds: number | undefined;

try {
  if (idea) {
    // The questions before the build, then the estimate (and the smaller-version offer, if any).
    let asked = 0;
    for (;;) {
      const m = await waitFor(/(\d+)\/(\d+) · [^\n]*\n|That's a big one|Press Enter to start|😕|🔑|🤔/, 20 * 60_000);
      if (m[0].startsWith("😕") || m[0].startsWith("🔑") || m[0].startsWith("🤔")) throw new Error("the CLI stopped before the lesson");
      if (m[0] === "Press Enter to start") break;
      if (m[0] === "That's a big one") {
        await waitFor(/Type a number:/);
        press("1\n");
        continue;
      }
      await waitFor(/> $/m, 10_000);
      await sleep(300);
      const answer = ANSWERS[asked++] ?? "";
      if (asked === Number(m[2])) buildSeconds = Date.now();
      press(`${answer}\n`);
    }
    if (buildSeconds) buildSeconds = (Date.now() - buildSeconds) / 1000;
  } else {
    await waitFor(/Press Enter to start/);
  }
  await sleep(300);
  press("\n");
  await waitFor(/📁 Your project folder/);
  lesson ??= parseLesson(await readFile(join(dir, ".stride", "lesson.json"), "utf8"));
  const plan = mistakePlan(lesson);
  let askedAllHints = false;

  for (;;) {
    const m = await waitFor(/Step (\d+)\/(\d+) · (🧑 Your turn|🤖 Stride|👀 Watch)|🎉 You finished/, 120_000);
    if (m[0].startsWith("🎉")) break;
    const step = lesson.steps.find((s, i) => i === Number(m[1]) - 1 && s)!;
    if (step.who !== "learner") {
      if (step.who === "watch") {
        await sleep(500);
        press("\n");
      }
      continue;
    }
    stats.steps++;
    await waitFor(/q quit/);
    await sleep(800); // reads the card
    const before = await readFile(join(dir, step.file!), "utf8").catch(() => "");
    if (plan.half.includes(step.id)) {
      stats.half++;
      await writeStep(step, before, halfTyped(step)!, "saves half-typed code (stops mid-tag)");
      await waitFor(/⏳|🤔|✅/, 20_000);
      await sleep(4000); // stays away a bit: no hint should come for half-typed code
    }
    if (plan.wrong.includes(step.id)) {
      stats.wrong++;
      await writeStep(step, before, wrongTry(step)!, "types a wrong first try (a typo)");
      let r = await waitFor(/💡 Hint 1\/3|✅ Nice, that works!|Want a hint\?/, 45_000);
      if (r[0].startsWith("Want")) {
        // "Almost there" (part of it is right) brings an offer instead of a hint: take it.
        await sleep(500);
        press("h");
        r = await waitFor(/💡 Hint 1\/3/, 10_000);
      }
      if (r[0].startsWith("✅")) {
        stats.wrongAccepted++;
        log.push(`${stamp()} ⚠️ simulator: the wrong try was accepted`);
        if (step.quiz) await answerQuiz(step);
        continue;
      }
      stats.hintsSeen++;
      if (!askedAllHints) {
        // Asks for every hint, to see that hint 3 still leaves part of the code to type.
        askedAllHints = true;
        for (const level of [2, 3]) {
          await sleep(1000);
          press("h");
          await waitFor(new RegExp(`💡 Hint ${level}/3`), 10_000);
          stats.hintsSeen++;
        }
      }
      await sleep(1000);
    }
    await writeStep(step, before, step.expected, "types the step's code");
    await waitFor(/✅ Nice, that works!|💡 Hint|🤔/, 60_000).then(async (r) => {
      if (!r[0].startsWith("✅")) {
        log.push(`${stamp()} ⚠️ simulator: the step's own expected code didn't pass first time`);
        await waitFor(/✅ Nice, that works!/, 90_000);
      }
    });
    delays.push({ step: step.id, ms: lastTickAt - lastWriteAt });
    if (step.quiz) await answerQuiz(step);
  }
  await waitFor(/💸 AI cost/, 30_000);
} catch (e) {
  log.push(`${stamp()} ❌ simulator: ${(e as Error).message}`);
  child.kill();
}

async function answerQuiz(step: Step) {
  await waitFor(/Quick question/);
  await sleep(500);
  press(String(step.quiz!.answer + 1));
}

const code = await exited;
if (partial) log.push(`${stamp()} ${partial}`);
const finished = new Map<string, string>();
for (const f of lesson?.files ?? []) finished.set(f.path, await readFile(join(dir, f.path), "utf8").catch(() => "(missing)"));
const progress = lesson ? await readFile(join(dir, ".stride", `${lesson.id}.json`), "utf8").catch(() => "(missing)") : "(missing)";
const cost = await readFile(join(dir, "cost.json"), "utf8").catch(() => "(missing)");
// What typing every step of the lesson the student took gives (the smaller version types only part of the project).
const want = lesson ? rebuildSteps(lesson.steps, lesson.files).files : [];
const matches = !!lesson && want.length > 0 && want.every((f) => normCode(finished.get(f.path) ?? "") === normCode(f.content));
const wholeProject = !!lesson && lesson.files.every((f) => finished.get(f.path) === f.content);
const costUsd = (() => {
  try {
    return (JSON.parse(cost) as { total: { usd: number } }).total.usd;
  } catch {
    return undefined;
  }
})();
const avg = delays.length ? delays.reduce((n, d) => n + d.ms, 0) / delays.length : 0;

process.stdout.write(
  `\nexit code ${code} · learner steps ${stats.steps} · wrong tries ${stats.wrong} · hints seen ${stats.hintsSeen} · finished files match what the steps build: ${matches}\n`,
);

if (transcriptFile && lesson) {
  const title = idea ? `"${idea}" (real AI build)` : `"${lesson.title}"`;
  const note = idea
    ? [
        "> This lesson was built by the real AI (Opus 5.5 builders, the lesson cache, the real checker with the hidden Chromium",
        "> render). Only the student is pretend: `scripts/learn-simulate.ts` answers the questions, then writes each 🧑 step's",
        "> `expected` code into the file at its anchor, with a typo first on two steps (to bring out the hints, asking for all",
        "> three on one of them) and a half-typed save on one step (to show half-typed code isn't called wrong).",
      ]
    : [
        "> This lesson came from a lesson file (no AI call). Only the student is pretend: `scripts/learn-simulate.ts` writes each",
        "> 🧑 step's `expected` code into the file at its anchor, with a typo first on two steps and a half-typed save on one.",
      ];
  const md = [
    `# Terminal lesson run: ${title}`,
    "",
    ...note,
    "",
    `Run: \`npx tsx scripts/learn-simulate.ts ${idea ? `--idea "${idea}"` : relativeToRepo(lessonFile!)} ${transcriptFile ? relativeToRepo(transcriptFile) : ""}\` on ${new Date(started).toISOString().slice(0, 10)}.`,
    "",
    "## Result",
    "",
    `- CLI exit code: ${code}`,
    `- 🧑 steps typed: ${stats.steps}, wrong first tries: ${stats.wrong}${stats.wrongAccepted ? ` (${stats.wrongAccepted} wrongly accepted)` : ""}, half-typed saves: ${stats.half}, hints shown: ${stats.hintsSeen}`,
    `- Finished files match what this lesson's steps build: ${matches ? "yes" : "no"}` +
      (lesson.id.endsWith("-core") ? ` (the smaller version: the whole project ${wholeProject ? "too" : "isn't typed, by design"})` : ""),
    ...(buildSeconds !== undefined ? [`- Lesson build (questions answered → estimate shown): ${buildSeconds.toFixed(0)} s`] : []),
    `- AI cost (cost.json total): ${costUsd === undefined ? "n/a" : `$${costUsd.toFixed(4)}`}`,
    `- ✅ delay after the last write (correct code): average ${(avg / 1000).toFixed(2)} s, ` +
      `min ${(Math.min(...delays.map((d) => d.ms)) / 1000).toFixed(2)} s, max ${(Math.max(...delays.map((d) => d.ms)) / 1000).toFixed(2)} s ` +
      `(${delays.map((d) => `${d.step} ${(d.ms / 1000).toFixed(2)}`).join(", ")})`,
    `- Total time: ${((Date.now() - started) / 1000).toFixed(0)} s`,
    "",
    "## Transcript",
    "",
    "Seconds since start on the left. Lines marked 🧪 are the pretend student; everything else is what the CLI printed.",
    "",
    "```text",
    ...log.map((l) => l.replaceAll(work, "<tmp>")),
    "```",
    "",
    "## The student's finished files",
    "",
    ...[...finished].flatMap(([path, text]) => [`\`${path}\``, "", "```" + (path.split(".").pop() ?? ""), text.trimEnd(), "```", ""]),
    "## Saved progress (`.stride/" + `${lesson.id}.json` + "`)",
    "",
    "```json",
    progress.trimEnd(),
    "```",
    "",
    "## cost.json",
    "",
    "```json",
    cost.trimEnd(),
    "```",
    "",
  ].join("\n");
  await mkdir(dirname(transcriptFile), { recursive: true });
  await writeFile(transcriptFile, md);
  process.stdout.write(`Transcript saved to ${transcriptFile}\n`);
}
process.exit(code === 0 && matches ? 0 : 1);

function relativeToRepo(path: string): string {
  const cwd = process.cwd();
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
}

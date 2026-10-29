// Plays a pretend student through a terminal lesson, for an end-to-end run without a person.
//   npx tsx scripts/learn-simulate.ts [lesson.json] [transcript.md]
// It starts `npm run learn -- --lesson <file>` (the real runner, checker and hidden browser), reads what it prints, and
// "types" each step by writing the step's expected code into the file at its anchor. Two steps get a wrong try first,
// to bring out the hints, one an almost-right try (so the hidden browser looks twice), and one gets a half-typed save
// first, to show half-typed code isn't called wrong.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { insertAtAnchor } from "../src/learn/anchor.js";
import { parseLesson, type Step } from "../src/learn/lesson.js";

const lessonFile = resolve(process.argv[2] ?? "tests/learn/fixtures/about-me.lesson.json");
const transcriptFile = process.argv[3] ? resolve(process.argv[3]) : undefined;

// Wrong first tries (a plausible beginner mistake each), and a half-typed save.
const WRONG: Record<string, string> = {
  intro: "    <h2>Hi, I'm Sam</h2>\n", // a smaller heading, and no paragraph yet
  "link-css": "    <style>style.css</style>\n", // the tag from the quiz's wrong answer
};
// An almost-right first try: the hidden browser has to look at the page, then looks again (warm) when it's fixed.
const ALMOST: Record<string, string> = {
  style: "h1 {\n  color: blue;\n}\n", // the wrong colour
};
const HALF: Record<string, string> = {
  hobbies: "    <h2>Things I like</h2>\n    <ul>\n      <li>Drawing</li>\n      <li", // stopped mid-tag
};

const lesson = parseLesson(await readFile(lessonFile, "utf8"));
const work = await mkdtemp(join(tmpdir(), "stride-sim-"));
const dir = join(work, "about-me");
const started = Date.now();
const log: string[] = [];
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s`;
const student = (text: string) => {
  log.push(`${stamp()} 🧪 [student] ${text}`);
  process.stdout.write(`\x1b[36m🧪 [student] ${text}\x1b[0m\n`);
};

const child = spawn("npx", ["tsx", "src/cli/learn.ts", "--lesson", lessonFile, "--dir", dir, "--no-editor"], {
  env: { ...process.env, STRIDE_LESSONS_DIR: work, FORCE_COLOR: "0" },
  stdio: ["pipe", "pipe", "pipe"],
});
let output = "";
let cursor = 0;
let partial = "";
// How long after the student's last write each ✅ came (A5: within ~2 s, without pressing anything).
let lastWriteAt = 0;
let lastWriteStep = "";
const confirmed: { step: string; ms: number }[] = [];
const onOut = (chunk: Buffer) => {
  const text = chunk.toString("utf8");
  output += text;
  process.stdout.write(text);
  partial += text;
  const lines = partial.split("\n");
  partial = lines.pop()!;
  for (const l of lines) {
    log.push(`${stamp()} ${l}`);
    if (l.includes("✅ Nice, that works!") && lastWriteAt) confirmed.push({ step: lastWriteStep, ms: Date.now() - lastWriteAt });
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
    await sleep(50);
  }
}

const press = (key: string) => {
  student(key === "\n" ? "presses Enter" : `presses ${key}`);
  child.stdin.write(key);
};

async function writeStep(step: Step, before: string, code: string, what: string) {
  const file = join(dir, step.file!);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, insertAtAnchor(before, step.anchor, code).content);
  lastWriteAt = Date.now();
  lastWriteStep = step.id;
  student(`${what} in ${step.file}`);
}

const stats = { steps: 0, wrong: 0, half: 0, hintsSeen: 0 };

try {
  await waitFor(/Press Enter to start/);
  await sleep(300);
  press("\n");

  for (;;) {
    const m = await waitFor(/Step (\d+)\/(\d+) · (🧑 Your turn|🤖 Stride|👀 Watch)|🎉 You finished/, 120_000);
    if (m[0].startsWith("🎉")) break;
    const step = lesson.steps[Number(m[1]) - 1]!;
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
    if (HALF[step.id]) {
      stats.half++;
      await writeStep(step, before, HALF[step.id]!, "saves half-typed code (stops mid-tag)");
      await waitFor(/⏳|🤔/, 20_000);
      await sleep(4000); // stays away a bit: no hint should come for half-typed code
    }
    if (ALMOST[step.id]) {
      stats.wrong++;
      await writeStep(step, before, ALMOST[step.id]!, "types an almost-right first try (the wrong colour)");
      await waitFor(/⏳|🤔/, 20_000);
      await sleep(2000);
    }
    if (WRONG[step.id]) {
      stats.wrong++;
      await writeStep(step, before, WRONG[step.id]!, "types a wrong first try");
      await waitFor(/💡 Hint 1\/3/, 30_000);
      stats.hintsSeen++;
      if (step.id === "link-css") {
        await sleep(500);
        press("h");
        await waitFor(/💡 Hint 2\/3/, 10_000);
        stats.hintsSeen++;
      }
      await sleep(1000);
    }
    await writeStep(step, before, step.expected, "types the step's code");
    await waitFor(/✅ Nice, that works!/, 30_000);
    if (step.quiz) {
      await waitFor(/Quick question/);
      await sleep(500);
      press(String(step.quiz.answer + 1));
    }
  }
  await waitFor(/💸 AI cost/, 30_000);
} catch (e) {
  log.push(`${stamp()} ❌ simulator: ${(e as Error).message}`);
  child.kill();
}
const code = await exited;
if (partial) log.push(`${stamp()} ${partial}`);
const final = await readFile(join(dir, "index.html"), "utf8").catch(() => "(missing)");
const css = await readFile(join(dir, "style.css"), "utf8").catch(() => "(missing)");
const progress = await readFile(join(dir, ".stride", `${lesson.id}.json`), "utf8").catch(() => "(missing)");
const cost = await readFile(join(dir, "cost.json"), "utf8").catch(() => "(missing)");
const matches = lesson.files.every((f) => (f.path === "index.html" ? final : f.path === "style.css" ? css : "") === f.content);

process.stdout.write(`\nexit code ${code} · learner steps ${stats.steps} · wrong tries ${stats.wrong} · hints seen ${stats.hintsSeen} · finished files match the reference: ${matches}\n`);

if (transcriptFile) {
  const md = [
    "# Terminal lesson run: \"a page about me\"",
    "",
    "> **Note:** this lesson came from the hand-written fixture `tests/learn/fixtures/about-me.lesson.json`, because",
    "> `ANTHROPIC_API_KEY` was missing in the cloud session, so the real-AI lesson build couldn't run. **The real-AI run",
    "> (`npm run learn -- \"a page about me\"` with the key set) is still to do.** Everything else below is real: the terminal",
    "> CLI (`src/cli/learn.ts`), the lesson runner, the checker with the hidden Chromium render, the folder watcher, progress",
    "> saving and the cost log. Only the student is pretend: `scripts/learn-simulate.ts` writes each 🧑 step's `expected`",
    "> code into the file at its anchor, with a wrong first try on two steps (to bring out the hints), an almost-right try",
    "> on one (so the hidden browser looks twice) and a half-typed save on one step (to show half-typed code isn't called",
    "> wrong). No AI call was made, so the cost is $0; hint level 3",
    "> (Haiku) wasn't needed because this lesson has no `ai` checks.",
    "",
    `Run: \`npx tsx scripts/learn-simulate.ts ${relativeToRepo(lessonFile)} docs/learn/runs/about-me.md\` on ${new Date(started).toISOString().slice(0, 10)}.`,
    "",
    "## Result",
    "",
    `- CLI exit code: ${code}`,
    `- 🧑 steps typed: ${stats.steps}, wrong first tries: ${stats.wrong}, half-typed saves: ${stats.half}, hints shown: ${stats.hintsSeen}`,
    `- Finished files match the lesson's reference project: ${matches ? "yes" : "no"}`,
    `- ✅ came this long after the student's last write (no key pressed): ${confirmed.map((c) => `${c.step} ${(c.ms / 1000).toFixed(2)} s`).join(", ")}`,
    "  (1.5 s of quiet time, then the look itself. The first look that opens the hidden browser to try the page also",
    "  starts that browser, about 0.7 s once per lesson; after that a look in the browser takes about 0.2 s.)",
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
    "`index.html`",
    "",
    "```html",
    final.trimEnd(),
    "```",
    "",
    "`style.css`",
    "",
    "```css",
    css.trimEnd(),
    "```",
    "",
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

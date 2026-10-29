// One lesson in a project folder, without the Mac app: the glue between the student's files and the lesson runner.
// It watches the folder, tells the runner when the student typed, reads the files for the checker, types the code for
// "Show me", does the setup steps that only make files or folders, and prints what happens.
// Everything from outside (the clock, the folder watcher, the keys, the checker, the editor) is passed in, so tests fake it.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseShell } from "shell-quote";
import { hasCode, insertAtAnchor, pointLine } from "./anchor.js";
import type { Lesson, ProjectFile, Progress, Step } from "./lesson.js";
import { resumeRunner, welcomeBackText, type ProgressStore } from "./progress.js";
import type { CheckOutcome, Clock, Effect, LessonRunner, Pace, StrideResult } from "./runner.js";
import { lessonSummary, type LessonSummary } from "./summary.js";
import { hintText, KEYS_LINE, paceText, stepCard } from "./terminal.js";

// ---------- What the session needs from outside ----------

export interface KeySource {
  onKey(fn: (key: string) => void): () => void;
}

// Calls `onChange` with a path relative to the folder (or null when the system doesn't say which file).
export interface FolderWatcher {
  watch(dir: string, onChange: (path: string | null) => void): () => void;
}

// Stride's VS Code helper, when one is connected.
export interface EditorLink {
  readonly connected: boolean;
  highlight(path: string, line: number, message: string): void;
  // Types code after a line in the open file. Resolves false when it couldn't.
  insert?(path: string, text: string, afterLine: number): Promise<boolean>;
  // Every change (typed, not saved yet) and save, with the file's full text. `path` is absolute.
  onEdit(fn: (e: { path: string; text: string; saved: boolean }) => void): () => void;
}

export type StepChecker = (step: Step, files: ProjectFile[]) => Promise<CheckOutcome>;

export interface SessionDeps {
  lesson: Lesson;
  dir: string; // the project folder
  store: ProgressStore;
  clock: Clock;
  print: (text: string) => void;
  keys: KeySource;
  watcher: FolderWatcher;
  check: StepChecker;
  editor?: EditorLink;
  pace?: Pace;
  debounceMs?: number; // wait this long after the last file change before telling the runner (default 200)
}

export type SessionEnd = { how: "finished" | "quit"; progress: Progress; summary: LessonSummary };

export const MAC_ONLY = "Stride would do this on the Mac app.";

// Files and folders the session itself keeps in the project folder, which aren't the student's work.
const OWN = new Set(["cost.json", ".stride"]);
const TEXT_FILES = /\.(html?|css|m?js|json|svg|txt)$/i;
const MAX_FILE_BYTES = 1_000_000;

// ---------- The session ----------

export class LessonSession {
  readonly ended: Promise<SessionEnd>;
  private finish!: (end: SessionEnd) => void;
  private runner!: LessonRunner;
  private stops: (() => void)[] = [];
  private pending = new Set<string>(); // changed files not yet passed on
  private lastChangeAt = 0;
  private work = new Set<Promise<unknown>>();
  private selfWrites = new Map<string, string>(); // what Stride itself last wrote, so its own writes aren't "typing"
  private live = new Map<string, string>(); // unsaved text from the editor
  private lastMessage: string | undefined;
  private quiz: Step["quiz"] | undefined;
  private done = false;

  constructor(private readonly deps: SessionDeps) {
    this.ended = new Promise((r) => (this.finish = r));
  }

  get state(): LessonRunner["state"] {
    return this.runner.state;
  }

  async start(): Promise<void> {
    const { lesson, store, clock } = this.deps;
    await mkdir(this.deps.dir, { recursive: true });
    this.runner = await resumeRunner(
      lesson,
      store,
      {
        clock,
        check: (step) => this.check(step),
        runStrideAction: (tool, input) => this.strideAction(tool, input),
        typeCode: (step) => this.typeCode(step),
        onEffect: (effect) => this.onEffect(effect),
      },
      this.deps.pace ?? "learn",
    );
    this.stops.push(this.deps.watcher.watch(this.deps.dir, (path) => this.fileChanged(path)));
    this.stops.push(this.deps.keys.onKey((key) => this.key(key)));
    this.stops.push(clock.every(50, () => this.flushChanges()));
    if (this.deps.editor) this.stops.push(this.deps.editor.onEdit((e) => this.editorEdit(e)));
    if (this.runner.state.finished) {
      this.print("You've already finished this lesson. 🎉");
      this.end("finished");
      return;
    }
    this.runner.start();
  }

  // Waits for everything started so far (file reads, checks, saves). Handy in tests.
  async settle(): Promise<void> {
    for (;;) {
      if (this.work.size > 0) await Promise.allSettled([...this.work]);
      await this.runner.settle();
      if (this.work.size === 0) return;
    }
  }

  // A key the student pressed.
  key(key: string): void {
    if (this.done) return;
    const step = this.runner.step;
    const k = key.toLowerCase();
    if (k === "q" || key === "\u0003") return void this.quit();
    if (this.quiz && /^[1-9]$/.test(k)) return this.answerQuiz(Number(k) - 1);
    if (!step) return;
    switch (k) {
      case "h":
        if (step.who !== "learner") return;
        if (this.runner.state.hintLevel >= 3 && !this.runner.canShowMe) return this.print("That's all 3 hints. Press p to go faster, then s and I'll type it.");
        this.runner.send({ type: "hintRequested" });
        return;
      case "s":
        if (step.who !== "learner") return;
        if (!this.runner.canShowMe) return this.print(`Try a hint first: press h. Show me opens after hint 3 (${3 - this.runner.state.hintLevel} to go), or press p to go faster.`);
        this.runner.send({ type: "showMe" });
        return;
      case "n":
        this.print("⏭  Skipped this one.");
        this.runner.send({ type: "skip" });
        return;
      case "p": {
        const pace: Pace = this.runner.state.progress.pace === "fast" ? "learn" : "fast";
        this.runner.send({ type: "paceChanged", pace });
        this.print(paceText(pace));
        return;
      }
      case "\r":
      case "\n":
      case "c":
        if (step.who === "watch") this.runner.send({ type: "continue" });
        return;
      case "?":
        this.print(KEYS_LINE);
        return;
      default:
        return;
    }
  }

  // Stop now and keep the student's place.
  async quit(): Promise<void> {
    if (this.done) return;
    this.runner.stop();
    await this.settle();
    await this.deps.store.save(this.runner.state.progress);
    this.print("👋 Saved! Carry on any time with: npm run learn -- --resume");
    this.end("quit");
  }

  // ---------- Files ----------

  fileChanged(path: string | null): void {
    if (this.done) return;
    if (path !== null && isOwn(path)) return;
    this.pending.add(path ?? "");
    this.lastChangeAt = this.deps.clock.now();
  }

  private flushChanges(): void {
    if (this.pending.size === 0 || this.deps.clock.now() - this.lastChangeAt < (this.deps.debounceMs ?? 200)) return;
    const paths = [...this.pending];
    this.pending.clear();
    this.track(
      (async () => {
        let typed = false;
        for (const p of paths) {
          if (p === "") {
            typed = true;
            continue;
          }
          const mine = this.selfWrites.get(p);
          if (mine !== undefined) {
            const now = await readFile(this.inside(p), "utf8").catch(() => undefined);
            if (now === mine) continue; // just Stride's own write coming back
            this.selfWrites.delete(p);
          }
          typed = true;
        }
        if (typed && !this.done) this.runner.send({ type: "edit" });
      })(),
    );
  }

  private editorEdit(e: { path: string; text: string; saved: boolean }): void {
    if (this.done) return;
    const rel = this.relativeInside(e.path);
    if (rel === null || isOwn(rel)) return;
    if (e.saved) this.live.delete(rel);
    else this.live.set(rel, e.text);
    this.runner.send({ type: e.saved ? "save" : "edit" });
  }

  // The student's project as it is right now (with unsaved editor text on top).
  async readProject(): Promise<ProjectFile[]> {
    const files = new Map<string, string>();
    const walk = async (rel: string): Promise<void> => {
      const entries = await readdir(join(this.deps.dir, rel), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.name.startsWith(".") || entry.name === "node_modules" || isOwn(path)) continue;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && TEXT_FILES.test(entry.name)) {
          const full = join(this.deps.dir, path);
          if ((await stat(full)).size > MAX_FILE_BYTES) continue;
          files.set(path, await readFile(full, "utf8"));
        }
      }
    };
    await walk("");
    for (const [path, text] of this.live) files.set(path, text);
    return [...files].map(([path, content]) => ({ path, content }));
  }

  private async check(step: Step): Promise<CheckOutcome> {
    const outcome = await this.deps.check(step, await this.readProject());
    if (outcome.status !== "pass" && outcome.message && outcome.message !== this.lastMessage && !this.done) {
      this.lastMessage = outcome.message;
      this.print(`${outcome.status === "partial" ? "⏳" : "🤔"} ${outcome.message}`);
    }
    return outcome;
  }

  // "Show me": type the step's code at its anchor.
  private async typeCode(step: Step): Promise<void> {
    const file = step.file ?? "index.html";
    const path = this.inside(file);
    const current = this.live.get(file) ?? (await readFile(path, "utf8").catch(() => ""));
    if (hasCode(current, step.expected)) {
      this.print(`✍️  It's already in ${file}. Have a look!`);
      return;
    }
    const placed = insertAtAnchor(current, step.anchor, step.expected);
    const editor = this.deps.editor;
    if (editor?.connected && editor.insert && (await editor.insert(path, step.expected, placed.line - 1))) {
      this.print(`✍️  I typed it into ${file} for you (line ${placed.line}). Read it through so it makes sense.`);
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    this.selfWrites.set(file, placed.content);
    await writeFile(path, placed.content, "utf8");
    this.live.delete(file);
    this.print(`✍️  I typed it into ${file} for you (line ${placed.line}). Read it through so it makes sense.`);
  }

  // A 🤖 step: only steps that make files or folders run here. Everything else is for the Mac app.
  private async strideAction(tool: string, input: Record<string, unknown>): Promise<StrideResult> {
    const actions = fileOnlyAction(tool, input);
    if (!actions) return { ok: false, message: MAC_ONLY };
    for (const a of actions) {
      const path = this.inside(a.path);
      if (a.kind === "folder") await mkdir(path, { recursive: true });
      else {
        await mkdir(dirname(path), { recursive: true });
        const exists = await stat(path).then(() => true, () => false);
        if (!exists) {
          this.selfWrites.set(a.path, a.content ?? "");
          await writeFile(path, a.content ?? "", "utf8");
        }
      }
    }
    this.print(`🤖 Made ${actions.map((a) => (a.kind === "folder" ? `the ${a.path} folder` : a.path)).join(", ")}.`);
    return { ok: true };
  }

  // ---------- What the runner says ----------

  private onEffect(effect: Effect): void {
    if (this.done) return;
    switch (effect.type) {
      case "openStep":
        this.lastMessage = undefined;
        this.quiz = undefined;
        if (effect.welcomeBack) {
          const back = welcomeBackText(this.deps.lesson, this.runner.state.progress);
          if (back) this.print(`👋 ${back}`);
        }
        this.track(this.openStep(effect.index, effect.step, effect.welcomeBack));
        break;
      case "showHint":
        this.print(hintText(effect.level, effect.text));
        if (effect.level === 3) this.print(this.runner.state.progress.pace === "fast" ? "Still stuck? Press s and I'll type it." : "Still stuck? Press s and I'll type it for you.");
        break;
      case "offerHint":
        this.print("Want a hint? Press h.");
        break;
      case "cheer":
        this.print(effect.step.who === "stride" ? "✅ Done." : "✅ Nice, that works!");
        if (effect.step.quiz) {
          this.quiz = effect.step.quiz;
          const q = effect.step.quiz;
          this.print([`❓ Quick question (just for fun): ${q.question}`, ...q.options.map((o, i) => `  ${i + 1}) ${o}`)].join("\n"));
        }
        break;
      case "say":
        if (effect.text === MAC_ONLY) {
          this.print(`🤖 ${MAC_ONLY} Skipping it here.`);
          queueMicrotask(() => !this.done && this.runner.send({ type: "skip" }));
        } else this.print(effect.text.replace("Press Show me", "Press s"));
        break;
      case "finished":
        this.end("finished");
        break;
      default:
        break;
    }
  }

  private async openStep(index: number, step: Step, welcomeBack = false): Promise<void> {
    let newFile: string | undefined;
    if (step.who === "learner" && step.file) {
      const path = this.inside(step.file);
      const exists = await stat(path).then(() => true, () => false);
      if (!exists) {
        // A step that checks the file exists is teaching the student to make it; otherwise Stride makes it empty.
        if (step.checks.some((c) => c.type === "fileExists" && same(c.file, step.file!))) newFile = step.file;
        else {
          await mkdir(dirname(path), { recursive: true });
          this.selfWrites.set(step.file, "");
          await writeFile(path, "", "utf8");
        }
      }
    }
    this.print(stepCard(this.deps.lesson, index, newFile ? { newFile } : {}));
    // Back after a break: the hints they'd already seen on this step, so nothing is lost.
    const seen = welcomeBack && step.who === "learner" ? this.runner.state.hintLevel : 0;
    for (let level = 1; level <= seen; level++) this.print(hintText(level, step.hints[level - 1]));
    const editor = this.deps.editor;
    if (editor?.connected && step.who === "learner" && step.file) {
      const content = this.live.get(step.file) ?? (await readFile(this.inside(step.file), "utf8").catch(() => ""));
      editor.highlight(this.inside(step.file), pointLine(content, step.anchor), step.title);
    }
  }

  private answerQuiz(choice: number): void {
    const q = this.quiz!;
    if (choice >= q.options.length) return;
    this.quiz = undefined;
    this.print(choice === q.answer ? `🎯 Yes! ${q.explain}` : `Not quite: it's "${q.options[q.answer]}". ${q.explain}`);
  }

  // ---------- Helpers ----------

  private end(how: SessionEnd["how"]): void {
    if (this.done) return;
    this.done = true;
    for (const stop of this.stops) stop();
    this.runner.stop();
    const progress = structuredClone(this.runner.state.progress);
    this.finish({ how, progress, summary: lessonSummary(this.deps.lesson, progress) });
  }

  private print(text: string): void {
    this.deps.print(text);
  }

  private track(p: Promise<unknown>): void {
    const t = p
      .catch((e: unknown) => this.print(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => this.work.delete(t));
    this.work.add(t);
  }

  // A path in the project folder. Refuses anything that would land outside it.
  private inside(rel: string): string {
    const full = resolve(this.deps.dir, rel);
    const root = resolve(this.deps.dir);
    if (isAbsolute(rel) || (full !== root && !full.startsWith(root + sep))) throw new Error(`"${rel}" isn't inside the project folder.`);
    return full;
  }

  private relativeInside(abs: string): string | null {
    const rel = relative(resolve(this.deps.dir), resolve(abs));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
    return rel.split(sep).join("/");
  }
}

function isOwn(path: string): boolean {
  const first = path.replace(/\\/g, "/").replace(/^\.\/+/, "").split("/")[0] ?? "";
  return OWN.has(first) || first.endsWith(".tmp");
}

function same(a: string | undefined, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  return a !== undefined && n(a) === n(b);
}

// ---------- Setup steps that only make files or folders ----------

export type FileAction = { kind: "file" | "folder"; path: string; content?: string };

const SAFE_REL = /^(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9_][A-Za-z0-9_. -]*(\/[A-Za-z0-9_][A-Za-z0-9_. -]*)*\/?$/;

// The files and folders a 🤖 step makes, when that's all it does (null when it does anything else).
// Understands simple file/folder tools and a run_command that is only `mkdir` and `touch` inside the project.
export function fileOnlyAction(tool: string, input: Record<string, unknown>): FileAction[] | null {
  const str = (...keys: string[]) => keys.map((k) => input[k]).find((v): v is string => typeof v === "string" && v.trim() !== "");
  const safe = (p: string | undefined) => (p && SAFE_REL.test(p.trim()) ? p.trim().replace(/\/$/, "") : null);

  if (["create_folder", "make_folder", "mkdir"].includes(tool)) {
    const path = safe(str("path", "folder", "name"));
    return path ? [{ kind: "folder", path }] : null;
  }
  if (["create_file", "make_file", "write_file"].includes(tool)) {
    const path = safe(str("path", "file", "name"));
    if (!path) return null;
    const content = typeof input.content === "string" ? input.content : undefined;
    return [{ kind: "file", path, ...(content !== undefined ? { content } : {}) }];
  }
  if (tool === "run_command") {
    const command = str("command");
    if (!command) return null;
    let tokens: ReturnType<typeof parseShell>;
    try {
      tokens = parseShell(command);
    } catch {
      return null;
    }
    const out: FileAction[] = [];
    let words: string[] = [];
    const take = (): boolean => {
      if (words.length === 0) return true;
      const [cmd, ...rest] = words;
      words = [];
      const args = rest.filter((a) => a !== "-p");
      if ((cmd !== "mkdir" && cmd !== "touch") || args.length === 0) return false;
      for (const a of args) {
        const path = safe(a);
        if (!path) return false;
        out.push({ kind: cmd === "mkdir" ? "folder" : "file", path });
      }
      return true;
    };
    for (const t of tokens) {
      if (typeof t === "string") words.push(t);
      else if ("op" in t && (t.op === "&&" || t.op === ";")) {
        if (!take()) return null;
      } else return null; // pipes, redirects, globs, comments: not just making files
    }
    if (!take() || out.length === 0) return null;
    return out;
  }
  return null;
}

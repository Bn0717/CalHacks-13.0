// Saves where a student is in each lesson, so closing the laptop and coming back opens the same step.
// One small JSON file per lesson. A missing or broken file just means "start fresh".
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProgressSchema, type Lesson, type Progress } from "./lesson.js";
import { LessonRunner, newProgress, type Pace, type RunnerDeps } from "./runner.js";

export function defaultProgressDir(): string {
  return join(homedir(), "Library", "Application Support", "Stride", "progress");
}

// A safe file name for a lesson id: only letters, numbers, - and _. A short hash keeps different ids apart.
export function progressFileName(lessonId: string): string {
  const safe = lessonId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "lesson";
  if (safe === lessonId) return `${safe}.json`;
  const hash = createHash("sha256").update(lessonId).digest("hex").slice(0, 8);
  return `${safe}-${hash}.json`;
}

export interface ProgressStore {
  load(lessonId: string): Promise<Progress | null>;
  save(progress: Progress): Promise<void>;
  clear(lessonId: string): Promise<void>;
}

export function createProgressStore(dir: string = defaultProgressDir()): ProgressStore {
  const fileFor = (lessonId: string) => join(dir, progressFileName(lessonId));
  let queue: Promise<unknown> = Promise.resolve(); // saves run one at a time, in order
  return {
    async load(lessonId) {
      let text: string;
      try {
        text = await readFile(fileFor(lessonId), "utf8");
      } catch {
        return null; // never started
      }
      try {
        const result = ProgressSchema.safeParse(JSON.parse(text));
        if (!result.success || result.data.lessonId !== lessonId) return null;
        return result.data;
      } catch {
        return null; // broken file: start fresh
      }
    },
    save(progress) {
      const write = queue.then(async () => {
        const valid = ProgressSchema.parse(progress);
        await mkdir(dir, { recursive: true });
        const file = fileFor(valid.lessonId);
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(valid, null, 2), "utf8");
        await rename(temp, file); // a crash mid-write never leaves half a file
      });
      queue = write.catch(() => undefined);
      return write;
    },
    async clear(lessonId) {
      await rm(fileFor(lessonId), { force: true });
    },
  };
}

// "Welcome back! Step 4: Connect a style file."
export function welcomeBackText(lesson: Lesson, progress: Progress): string | null {
  const step = lesson.steps[progress.stepIndex];
  if (!step || (progress.stepIndex === 0 && Object.keys(progress.steps).length === 0)) return null;
  return `Welcome back! Step ${progress.stepIndex + 1}: ${step.title}.`;
}

// Makes a runner that picks up where the student left off (or starts fresh) and saves as they go.
// Call `start()` on it to open the step.
export async function resumeRunner(
  lesson: Lesson,
  store: ProgressStore,
  deps: Omit<RunnerDeps, "saveProgress">,
  pace: Pace = "learn",
): Promise<LessonRunner> {
  const saved = await store.load(lesson.id);
  const fits = saved && saved.stepIndex <= lesson.steps.length;
  const progress = fits ? saved : newProgress(lesson, pace, deps.clock.now());
  return new LessonRunner(lesson, progress, { ...deps, saveProgress: (p) => store.save(p) });
}

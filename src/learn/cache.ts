// Saves built lessons so the next student who asks for the same video or idea gets it instantly and for free.
// One JSON file per lesson. A file that's missing, unreadable or no longer a valid lesson simply counts as "not cached".
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseLesson, type Lesson } from "./lesson.js";

export type LessonCache = {
  load(key: string): Promise<Lesson | null>;
  save(key: string, lesson: Lesson): Promise<void>;
};

// Where lessons live on the Mac.
export function defaultLessonDir(): string {
  return join(homedir(), "Library", "Application Support", "Stride", "lessons");
}

// The cache key for a YouTube video.
export function videoCacheKey(videoId: string): string {
  return `video:${videoId}`;
}

// The cache key for an idea: the same request, answers and picture always give the same key.
// Spacing and capital letters don't matter, so "My Bakery" and "my  bakery" share a lesson.
export function ideaCacheKey(idea: {
  request: string;
  answers?: { question: string; answer: string }[];
  pictureSummary?: string;
}): string {
  const tidy = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const parts = {
    request: tidy(idea.request),
    answers: (idea.answers ?? []).map((a) => [tidy(a.question), tidy(a.answer)]),
    picture: tidy(idea.pictureSummary ?? ""),
  };
  return `idea:${sha256(JSON.stringify(parts))}`;
}

// A safe file name for any key: readable letters kept, everything else swapped out, plus a short hash so two keys never clash.
export function cacheFileName(key: string): string {
  const readable = key.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80) || "lesson";
  return `${readable}-${sha256(key).slice(0, 12)}.json`;
}

export function lessonCache(baseDir: string = defaultLessonDir()): LessonCache {
  return {
    async load(key) {
      let text: string;
      try {
        text = await readFile(join(baseDir, cacheFileName(key)), "utf8");
      } catch {
        return null;
      }
      try {
        return parseLesson(text);
      } catch {
        return null; // a broken or outdated file is just a miss; it gets rebuilt and overwritten
      }
    },
    async save(key, lesson) {
      const checked = parseLesson(lesson); // never save a lesson that wouldn't load back
      await mkdir(baseDir, { recursive: true });
      const path = join(baseDir, cacheFileName(key));
      // Write to a temporary file first, then swap it in, so a crash never leaves half a lesson behind.
      const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, JSON.stringify(checked, null, 2), "utf8");
      await rename(temp, path);
    },
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

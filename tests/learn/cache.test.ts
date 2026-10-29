import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheFileName, defaultLessonDir, ideaCacheKey, lessonCache, videoCacheKey } from "../../src/learn/cache.js";
import { parseLesson } from "../../src/learn/lesson.js";

const lesson = parseLesson(readFileSync(new URL("./fixtures/about-me.lesson.json", import.meta.url), "utf8"));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "stride-cache-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("lesson cache", () => {
  it("round-trips a lesson", async () => {
    const cache = lessonCache(dir);
    await cache.save("video:abc123DEF45", lesson);
    expect(await cache.load("video:abc123DEF45")).toEqual(lesson);
    expect(await readdir(dir)).toHaveLength(1); // no temporary files left behind
  });

  it("misses when nothing is saved", async () => {
    expect(await lessonCache(dir).load("video:nothingHere")).toBeNull();
    expect(await lessonCache(join(dir, "not-made-yet")).load("video:x")).toBeNull();
  });

  it("treats a corrupt or invalid file as a miss", async () => {
    const cache = lessonCache(dir);
    await writeFile(join(dir, cacheFileName("video:broken")), "{ not json", "utf8");
    expect(await cache.load("video:broken")).toBeNull();
    await writeFile(join(dir, cacheFileName("video:wrong")), JSON.stringify({ ...lesson, steps: [] }), "utf8");
    expect(await cache.load("video:wrong")).toBeNull();
  });

  it("refuses to save an invalid lesson", async () => {
    await expect(lessonCache(dir).save("k", { ...lesson, steps: [] })).rejects.toThrow(/problems/);
  });

  it("makes safe, distinct file names", () => {
    const a = cacheFileName("video:abc");
    expect(a).toMatch(/^video-abc-[0-9a-f]{12}\.json$/);
    expect(cacheFileName("../../etc/passwd")).not.toContain("/");
    expect(cacheFileName("video:abc")).not.toBe(cacheFileName("video-abc"));
    expect(cacheFileName("x".repeat(500)).length).toBeLessThan(110);
  });

  it("defaults to the Stride lessons folder", () => {
    expect(defaultLessonDir()).toMatch(/Library\/Application Support\/Stride\/lessons$/);
  });
});

describe("cache keys", () => {
  it("keys videos by id", () => {
    expect(videoCacheKey("dQw4w9WgXcQ")).toBe("video:dQw4w9WgXcQ");
  });

  it("hashes ideas, ignoring spacing and capitals", () => {
    const a = ideaCacheKey({ request: "A site for my Bakery", answers: [{ question: "For?", answer: "Customers" }] });
    const b = ideaCacheKey({ request: "  a site  for my bakery ", answers: [{ question: "for?", answer: "customers" }] });
    expect(a).toMatch(/^idea:[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("gives different keys for different answers or pictures", () => {
    const base = { request: "a site for my bakery", answers: [{ question: "For?", answer: "Customers" }] };
    const k = ideaCacheKey(base);
    expect(ideaCacheKey({ ...base, answers: [{ question: "For?", answer: "Friends" }] })).not.toBe(k);
    expect(ideaCacheKey({ ...base, pictureSummary: "a top menu and 3 cards" })).not.toBe(k);
  });
});

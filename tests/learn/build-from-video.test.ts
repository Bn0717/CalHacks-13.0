import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFromVideo, parseYouTubeId, VideoUrlError, type AskJson } from "../../src/learn/build-from-video.js";
import { lessonCache, videoCacheKey } from "../../src/learn/cache.js";
import { readVideo, type VideoNotes } from "../../src/learn/gemini.js";
import { estimateFor, parseLesson, type Check, type ProjectFile } from "../../src/learn/lesson.js";
import type { CheckRunner } from "../../src/learn/validate.js";

const ID = "dQw4w9WgXcQ";
const URL_ = `https://youtu.be/${ID}`;
const recorded = readFileSync(new URL("./fixtures/gemini-video.response.json", import.meta.url), "utf8");
const draftText = readFileSync(new URL("./fixtures/video-lesson.draft.json", import.meta.url), "utf8");
const draft = () => JSON.parse(draftText) as Record<string, unknown> & { steps: Record<string, unknown>[] };

// Gemini, faked with the recorded reply (goes through the real client and its Zod check).
const fakeGemini = (url: string): Promise<VideoNotes> =>
  readVideo(url, {
    env: { GEMINI_API_KEY: "k" },
    fetch: (async () => new Response(recorded, { status: 200 })) as typeof fetch,
  });

// A fake checker: nothing passes on an empty project; on the finished one, a check passes unless its selector says "nope".
const fakeCheck: CheckRunner = async (check: Check, _step, files: ProjectFile[]) => {
  if (files.length === 0) return false;
  return !("selector" in check && check.selector.includes("nope"));
};

// A fake Claude: answers the build call with the draft, and the fix call with a working check for "link-css".
function fakeClaude(o: { draft?: () => unknown; fix?: unknown } = {}) {
  const calls: { system: string; content: unknown; schema: Record<string, unknown> }[] = [];
  const ask = (async (req: Parameters<AskJson>[0]) => {
    calls.push(req);
    if (/Rewrite only those steps/.test(req.system)) {
      return (
        o.fix ?? {
          steps: [{ id: "link-css", checks: [{ type: "selectorExists", file: "index.html", selector: "link[href='style.css']" }] }],
        }
      );
    }
    return (o.draft ?? draft)();
  }) as AskJson;
  return { ask, calls };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "stride-video-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const now = () => new Date("2026-10-29T12:00:00.000Z");

describe("parseYouTubeId", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/embed/${ID}?start=10`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`youtube.com/watch?v=${ID}`],
  ])("finds the id in %s", (url) => {
    expect(parseYouTubeId(url)).toBe(ID);
  });

  it.each([["https://vimeo.com/123456"], ["https://notyoutube.com/watch?v=dQw4w9WgXcQ"], ["not a link at all"]])(
    "rejects non-YouTube links (%s) with a friendly error",
    (url) => {
      expect(() => parseYouTubeId(url)).toThrow(VideoUrlError);
      expect(() => parseYouTubeId(url)).toThrow(/YouTube videos/);
    },
  );

  it("rejects YouTube links that aren't a video", () => {
    expect(() => parseYouTubeId("https://www.youtube.com/@somechannel")).toThrow(/doesn't point at a video/);
    expect(() => parseYouTubeId("https://www.youtube.com/watch?v=short")).toThrow(/doesn't point at a video/);
  });
});

describe("buildFromVideo", () => {
  it("builds a valid lesson from the recorded Gemini notes, fixing a broken check once", async () => {
    const { ask, calls } = fakeClaude();
    const lesson = await buildFromVideo(URL_, { readVideo: fakeGemini, ask, runCheck: fakeCheck, cache: lessonCache(dir), now });

    expect(() => parseLesson(lesson)).not.toThrow();
    expect(lesson.id).toBe(`video-${ID}`);
    expect(lesson.source).toEqual({
      kind: "video",
      url: `https://www.youtube.com/watch?v=${ID}`,
      videoId: ID,
      title: "Build Your First Web Page in 10 Minutes",
    });
    expect(lesson.createdAt).toBe("2026-10-29T12:00:00.000Z");
    expect(lesson.steps.map((s) => s.id)).toEqual(["intro", "skeleton", "content", "link-css", "colour"]);
    expect(lesson.steps.every((s) => s.video !== undefined)).toBe(true);
    expect(lesson.steps[2]!.video).toEqual({ start: 120, end: 245 });
    expect(lesson.steps[2]!.hints).toHaveLength(3); // the draft gave only 2
    expect(lesson.steps[3]!.checks).toEqual([{ type: "selectorExists", file: "index.html", selector: "link[href='style.css']" }]);
    expect(lesson.estimate).toEqual(estimateFor(lesson.steps));

    // The build call carries the notes; the fix call explains the broken check.
    expect(calls).toHaveLength(2);
    expect(String(calls[0]!.content)).toContain("<h1>Hello, I'm Alex</h1>");
    expect(calls[0]!.schema.properties).not.toHaveProperty("id");
    expect(calls[0]!.schema.properties).toHaveProperty("steps");
    expect(String(calls[1]!.content)).toContain("fails on the finished project");
  });

  it("drops a step whose checks still don't work after the fix", async () => {
    const { ask } = fakeClaude({ fix: { steps: [{ id: "link-css", checks: [{ type: "selectorExists", selector: "nope" }] }] } });
    const lesson = await buildFromVideo(URL_, { readVideo: fakeGemini, ask, runCheck: fakeCheck, cache: null, now });
    expect(lesson.steps.map((s) => s.id)).toEqual(["intro", "skeleton", "content", "colour"]);
    expect(lesson.estimate.steps).toBe(4);
  });

  it("asks once more when the first answer isn't a valid lesson", async () => {
    let n = 0;
    const { ask, calls } = fakeClaude({
      draft: () => {
        n++;
        const d = draft();
        if (n === 1) d.steps[1]!.chapter = "missing-chapter";
        return d;
      },
    });
    const lesson = await buildFromVideo(URL_, { readVideo: fakeGemini, ask, runCheck: fakeCheck, cache: null, now });
    expect(lesson.steps).toHaveLength(5);
    expect(String(calls[1]!.content)).toContain("missing-chapter");
  });

  it("saves to the cache and returns the cached lesson next time without calling anyone", async () => {
    const cache = lessonCache(dir);
    const first = fakeClaude();
    const built = await buildFromVideo(URL_, { readVideo: fakeGemini, ask: first.ask, runCheck: fakeCheck, cache, now });
    expect(await cache.load(videoCacheKey(ID))).toEqual(built);

    const never = async (): Promise<never> => {
      throw new Error("should not be called");
    };
    const again = await buildFromVideo(`https://www.youtube.com/watch?v=${ID}`, {
      readVideo: never,
      ask: never as unknown as AskJson,
      runCheck: never,
      cache,
    });
    expect(again).toEqual(built);
  });

  it("rejects non-YouTube links before calling anything", async () => {
    const { ask, calls } = fakeClaude();
    await expect(buildFromVideo("https://vimeo.com/1", { readVideo: fakeGemini, ask, runCheck: fakeCheck, cache: null })).rejects.toThrow(
      VideoUrlError,
    );
    expect(calls).toHaveLength(0);
  });

  it("passes on the missing-key error from Gemini", async () => {
    const { ask } = fakeClaude();
    const noKey = (url: string) => readVideo(url, { env: {}, fetch: (async () => new Response("{}")) as typeof fetch });
    await expect(buildFromVideo(URL_, { readVideo: noKey, ask, runCheck: fakeCheck, cache: null })).rejects.toThrow(
      /video lessons need GEMINI_API_KEY/i,
    );
  });
});

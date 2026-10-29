// Lessons the real AI built (saved from real runs), so later tests and screens can use them without spending anything.
// Checks they are valid, follow the lesson rules, build up step by step, and that every check holds with the real
// hidden browser right after its step (skipped when no browser can start).
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { checkStep, playwrightRenderer } from "../../src/learn/check/index.js";
import { videoPartProblems } from "../../src/learn/build-from-video.js";
import { parseLesson } from "../../src/learn/lesson.js";
import { rebuildProblems, rebuildSteps } from "../../src/learn/rebuild.js";
import { lessonRuleProblems, normCode, strongerHints } from "../../src/learn/rules.js";
import type { Judge } from "../../src/learn/check/index.js";

// Stands in for Haiku on "ai" checks: yes once the step's own code is in the student's files.
const judge: Judge = async (r) => ({ answer: normCode(r.code).includes(normCode(r.reference)) ? "yes" : "no", reason: "fake" });

const dir = new URL("./fixtures/real/", import.meta.url);
const lessons = readdirSync(dir)
  .filter((f) => f.endsWith(".lesson.json"))
  .map((f) => ({ file: f, lesson: parseLesson(readFileSync(new URL(f, dir), "utf8")) }));

const renderer = playwrightRenderer();
const canLaunch = await renderer
  .render({ page: "index.html", files: [{ path: "index.html", content: "<p>hi</p>" }], probes: [{ kind: "count", selector: "p" }] })
  .then(() => true)
  .catch(() => false);
afterAll(() => renderer.close());

describe("real-AI lesson fixtures", () => {
  it("has an idea lesson and a video lesson", () => {
    expect(lessons.map((l) => l.lesson.source.kind).sort()).toEqual(expect.arrayContaining(["idea", "video"]));
  });

  for (const { file, lesson } of lessons) {
    it(`${file}: follows the rules and builds up step by step to the finished project`, () => {
      // Hint rules got stricter after these were built; the builders' own code repair (strongerHints) brings them in line.
      const steps = lesson.steps.map((s) => ({ ...s, hints: strongerHints(s.hints, s.expected) as [string, string, string] }));
      expect(lessonRuleProblems(steps)).toEqual([]);
      expect(rebuildProblems(lesson.steps, lesson.files)).toEqual([]);
      expect(rebuildSteps(lesson.steps, lesson.files).matches).toBe(true);
      // A7: every new idea has a one-sentence explanation and a link; video steps have their part of the video.
      for (const s of lesson.steps.filter((x) => x.concept)) expect(s.concept!.links.length, s.id).toBeGreaterThan(0);
      if (lesson.source.kind === "video") expect(videoPartProblems(lesson.steps, 0)).toEqual([]);
    });

    it.skipIf(!canLaunch)(`${file}: every step passes right after it's typed, and not before`, async () => {
      const built = rebuildSteps(lesson.steps, lesson.files);
      let before: { path: string; content: string }[] = [];
      for (const s of lesson.steps) {
        const after = built.after.get(s.id)!;
        if (s.who === "learner") {
          const r = await checkStep(s, after, { renderer, judge });
          expect(r.status, `${s.id}: ${r.message}`).toBe("pass");
          expect((await checkStep(s, before, { renderer, judge })).status, `${s.id} passes before it's typed`).not.toBe("pass");
        }
        before = after;
      }
    }, 60_000);
  }
});

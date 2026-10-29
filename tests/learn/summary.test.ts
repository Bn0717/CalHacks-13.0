import { describe, expect, it } from "vitest";
import type { Lesson, Progress, StepProgress } from "../../src/learn/lesson.js";
import { NEXT_LESSON_MINUTES, lessonSummary, suggestNext, unusedPictureSections } from "../../src/learn/summary.js";
import { aboutMe } from "./runner-fakes.js";

const at = (min: number) => new Date(Date.parse("2026-10-29T12:00:00.000Z") + min * 60_000).toISOString();
const sp = (status: StepProgress["status"], start: number, end?: number, hintsUsed = 0): StepProgress => ({
  status,
  hintsUsed,
  startedAt: at(start),
  doneAt: end === undefined ? undefined : at(end),
});

function finished(steps: Record<string, StepProgress>): Progress {
  return { lessonId: "about-me", stepIndex: 6, steps, pace: "learn", updatedAt: at(30) };
}

const withPicture = (sections: { name: string; description: string }[]): Lesson => {
  const lesson = aboutMe();
  if (lesson.source.kind === "idea") lesson.source.picture = { summary: "a simple page", sections };
  return lesson;
};

describe("finish summary", () => {
  it("counts steps done alone, hinted, shown and skipped, with concepts and time", () => {
    const summary = lessonSummary(
      aboutMe(),
      finished({
        "open-editor": sp("done", 0, 1),
        skeleton: sp("done", 1, 5),
        intro: sp("hinted", 5, 9, 2),
        hobbies: sp("shown", 9, 14, 3),
        "link-css": sp("skipped", 14, 15),
        style: sp("done", 15, 24),
      }),
    );
    expect(summary).toMatchObject({ lessonId: "about-me", steps: 5, alone: 2, hinted: 1, shown: 1, skipped: 1, minutes: 24 });
    // "Linking CSS" was skipped, so it doesn't count as learned.
    expect(summary.concepts).toEqual(["The parts of an HTML page", "Lists"]);
  });

  it("handles a lesson with no progress", () => {
    const summary = lessonSummary(aboutMe(), finished({}));
    expect(summary).toMatchObject({ alone: 0, hinted: 0, shown: 0, skipped: 0, minutes: 0, concepts: [] });
  });

  it("suggests a part of their picture the lesson didn't build", () => {
    const lesson = withPicture([
      { name: "List", description: "things I like" },
      { name: "Footer", description: "A footer with your email" },
    ]);
    expect(unusedPictureSections(lesson).map((s) => s.name)).toEqual(["Footer"]);
    expect(suggestNext(lesson, { steps: 5, shown: 0, skipped: 0 })).toEqual({
      title: "Add the footer from your picture",
      why: "A footer with your email",
      minutes: NEXT_LESSON_MINUTES,
    });
  });

  it("suggests the smaller version when Stride had to show most steps", () => {
    const lesson = aboutMe();
    lesson.simpler = { title: "Just your name", estimate: { minutes: 8, linesToType: 6, steps: 3 }, why: "Start small." };
    expect(suggestNext(lesson, { steps: 5, shown: 2, skipped: 1 })).toEqual({ title: "Just your name", why: "Start small.", minutes: 8 });
    lesson.simpler = undefined;
    expect(suggestNext(lesson, { steps: 5, shown: 3, skipped: 0 }).title).toBe("A page about me, one more time");
  });

  it("falls back to a simple 'one more part' idea", () => {
    const next = suggestNext(aboutMe(), { steps: 5, shown: 0, skipped: 0 });
    expect(next.title).toBe("Add one more part to a page about me");
    expect(next.minutes).toBe(NEXT_LESSON_MINUTES);
  });
});

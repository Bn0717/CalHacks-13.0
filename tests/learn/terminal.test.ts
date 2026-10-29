import { describe, expect, it } from "vitest";
import { smallerLesson, type Lesson } from "../../src/learn/lesson.js";
import { lessonSummary } from "../../src/learn/summary.js";
import {
  ArgsError,
  costText,
  estimateLine,
  estimateText,
  hintText,
  lessonsRoot,
  parseArgs,
  parseChoice,
  questionText,
  slugify,
  stepCard,
  summaryText,
  videoLink,
  whereText,
} from "../../src/learn/terminal.js";
import { aboutMe } from "./runner-fakes.js";

describe("parseArgs", () => {
  it("reads an idea", () => {
    expect(parseArgs(["a page about me"])).toEqual({ mode: "idea", idea: "a page about me", pace: "learn", editor: true });
    expect(parseArgs(["a", "page", "about", "me"])).toMatchObject({ mode: "idea", idea: "a page about me" });
  });

  it("reads a picture with an idea, a video, a lesson file and resume, with --dir", () => {
    expect(parseArgs(["--picture", "./ref.png", "a page like this"])).toMatchObject({ mode: "idea", picture: "./ref.png", idea: "a page like this" });
    expect(parseArgs(["--video", "https://youtu.be/abcdefghijk"])).toMatchObject({ mode: "video", url: "https://youtu.be/abcdefghijk" });
    expect(parseArgs(["--lesson", "l.json", "--dir", "/tmp/x"])).toMatchObject({ mode: "lesson", file: "l.json", dir: "/tmp/x" });
    expect(parseArgs(["--resume"])).toMatchObject({ mode: "resume" });
    expect(parseArgs(["--fast", "--no-editor", "x"])).toMatchObject({ pace: "fast", editor: false });
    expect(parseArgs(["--help"])).toEqual({ mode: "help" });
  });

  it("explains mistakes in plain words", () => {
    expect(() => parseArgs([])).toThrow(ArgsError);
    expect(() => parseArgs(["--video"])).toThrow(/needs something after it/);
    expect(() => parseArgs(["--resume", "--video", "u"])).toThrow(/Pick one/);
    expect(() => parseArgs(["--picture", "p.png"])).toThrow(/Say what you'd like to make/);
    expect(() => parseArgs(["--wat"])).toThrow(/I don't know "--wat"/);
  });
});

describe("folders", () => {
  it("makes a simple folder name", () => {
    expect(slugify("A page about me!")).toBe("a-page-about-me");
    expect(slugify("Café Crème")).toBe("cafe-creme");
    expect(slugify("???")).toBe("my-lesson");
  });

  it("puts lessons in ~/stride-lessons unless told otherwise", () => {
    expect(lessonsRoot({ STRIDE_LESSONS_DIR: "/x" })).toBe("/x");
    expect(lessonsRoot({})).toMatch(/stride-lessons$/);
  });
});

describe("questions", () => {
  const q = { id: "contents", question: "What should it have?", options: ["A", "B", "C"], multi: true };

  it("numbers the choices", () => {
    expect(questionText(q, 2, 3)).toBe("2/3 · What should it have?\n  1) A\n  2) B\n  3) C\nType the numbers you like (e.g. 1 3), or press Enter to skip:");
  });

  it("reads the picked numbers", () => {
    expect(parseChoice("1 3", q)).toEqual(["A", "C"]);
    expect(parseChoice("3,3", q)).toEqual(["C"]);
    expect(parseChoice("", q)).toEqual([]);
    expect(parseChoice("4", q)).toBeNull();
    expect(parseChoice("x", q)).toBeNull();
    expect(parseChoice("1 2", { ...q, multi: false })).toBeNull();
  });
});

describe("the estimate", () => {
  it("is shown in plain words", () => {
    expect(estimateLine({ minutes: 22, linesToType: 25, steps: 6 })).toBe("About 22 minutes · you'll type about 25 lines · 6 steps");
    expect(estimateLine({ minutes: 130, linesToType: 150, steps: 32 })).toBe("About 2 hours · you'll type about 150 lines · 32 steps");
    const text = estimateText(aboutMe());
    expect(text).toContain("A page about me");
    expect(text).toContain("You'll learn: the parts of an HTML page");
  });
});

describe("step cards", () => {
  it("shows the step number, who, what, why, where and the new idea", () => {
    const card = stepCard(aboutMe(), 1);
    expect(card).toContain("Step 2/6 · 🧑 Your turn · Write the page");
    expect(card).toContain("In index.html, type the basic parts");
    expect(card).toContain("Why: Browsers need this skeleton");
    expect(card).toContain("📍 In index.html, at the top");
    expect(card).toContain("💡 New idea · The parts of an HTML page:");
    expect(card).toContain("Read more: https://developer.mozilla.org/");
    expect(card).toContain("h hint · s show me · n skip · p pace · q quit");
  });

  it("asks for a new file when the step teaches making one", () => {
    expect(stepCard(aboutMe(), 5, { newFile: "style.css" })).toContain("First make a new file called style.css");
  });

  it("links to the right moment of the video", () => {
    const lesson = aboutMe();
    lesson.source = { kind: "video", url: "https://www.youtube.com/watch?v=abcdefghijk", videoId: "abcdefghijk", title: "HTML" };
    lesson.steps[2]!.video = { start: 83.7, end: 120 };
    expect(stepCard(lesson, 2)).toContain("▶  Watch this part: https://youtu.be/abcdefghijk?t=83");
    expect(videoLink("abcdefghijk", -3)).toBe("https://youtu.be/abcdefghijk?t=0");
  });

  it("says where to type in plain words", () => {
    const steps = aboutMe().steps;
    expect(whereText(steps[2]!)).toBe("In index.html, between <body> and </body>");
    expect(whereText(steps[4]!)).toBe("In index.html, under </title>");
    expect(whereText(steps[0]!)).toBeNull();
  });

  it("never uses words a beginner wouldn't know", () => {
    const lesson = aboutMe();
    const all = lesson.steps.map((_, i) => stepCard(lesson, i)).join("\n") + estimateText(lesson);
    expect(all).not.toMatch(/\b(DOM|selector|parse|runner)\b/i);
  });

  it("indents code hints", () => {
    expect(hintText(1, "Use <h1>.")).toBe("💡 Hint 1/3: Use <h1>.");
    expect(hintText(3, "<ul>\n  <li>")).toBe("💡 Hint 3/3:\n     <ul>\n       <li>");
  });
});

describe("the finish", () => {
  it("shows what they made, the counts and what they learned", () => {
    const lesson = aboutMe();
    const t = (m: number) => new Date(Date.UTC(2026, 9, 29, 12, m)).toISOString();
    const summary = lessonSummary(lesson, {
      lessonId: lesson.id,
      stepIndex: 6,
      pace: "learn",
      updatedAt: t(9),
      steps: {
        skeleton: { status: "done", hintsUsed: 0, startedAt: t(0), doneAt: t(2) },
        intro: { status: "hinted", hintsUsed: 1, doneAt: t(4) },
        hobbies: { status: "done", hintsUsed: 0, doneAt: t(5) },
        "link-css": { status: "shown", hintsUsed: 3, doneAt: t(7) },
        style: { status: "done", hintsUsed: 0, doneAt: t(9) },
      },
    });
    const text = summaryText(summary, lesson);
    expect(text).toContain('🎉 You finished "A page about me"!');
    expect(text).toContain("You made: A web page about you");
    expect(text).toContain("Your steps: 5 · on your own 3 · with hints 1 · shown 1");
    expect(text).toContain("What you learned: The parts of an HTML page, Headings and paragraphs, Lists, Linking CSS");
    expect(text).toContain("Time: 9 min");
  });

  it("prints the cost", () => {
    const zero = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    expect(costText(zero, zero, "/p/cost.json")).toBe("💸 AI cost: $0 (no AI calls). Saved in /p/cost.json");
    const one = { calls: 1, inputTokens: 10, outputTokens: 10, usd: 0.0006 };
    expect(costText(one, { ...one, calls: 3, usd: 0.31 }, "/p/cost.json")).toBe(
      "💸 AI cost: $0.0006 this time (1 AI call) · $0.31 for this lesson so far. Saved in /p/cost.json",
    );
  });
});

describe("smallerLesson", () => {
  const withOffer = (stepIds?: string[]): Lesson => ({
    ...aboutMe(),
    simpler: { title: "Just the words", why: "Start small.", estimate: { minutes: 9, linesToType: 12, steps: 3 }, ...(stepIds ? { stepIds } : {}) },
  });

  it("makes the smaller version from the offer's steps", () => {
    const small = smallerLesson(withOffer(["skeleton", "intro", "hobbies"]))!;
    expect(small.id).toBe("about-me-core");
    expect(small.title).toBe("Just the words");
    expect(small.steps.map((s) => s.id)).toEqual(["skeleton", "intro", "hobbies"]);
    expect(small.chapters.map((c) => c.id)).toEqual(["html"]);
    expect(small.estimate.steps).toBe(3);
    expect(small.simpler).toBeUndefined();
  });

  it("is null without an offer that names its steps", () => {
    expect(smallerLesson(aboutMe())).toBeNull();
    expect(smallerLesson(withOffer())).toBeNull();
    expect(smallerLesson(withOffer(["nope"]))).toBeNull();
  });
});

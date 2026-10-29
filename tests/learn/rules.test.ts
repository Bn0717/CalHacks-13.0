// Lesson rules enforced in code (not only asked for in prompts), and honest build stages.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFromIdea, type AskModel, type ModelJob } from "../../src/learn/build-from-idea.js";
import { buildFromVideo, firstPart, notesEnd, videoPartProblems, type AskJson } from "../../src/learn/build-from-video.js";
import { readVideo, type VideoNotes } from "../../src/learn/gemini.js";
import { ConceptSchema, LessonError, parseLesson, type Lesson, type Step } from "../../src/learn/lesson.js";
import { codeStructure, hintGivesAway, hintStrength, lessonRuleProblems, looksLikeCode, nameHint, outlineHint, stepRuleProblems, strongerHints, structureShare } from "../../src/learn/rules.js";
import { BUILD_STAGES, BUILD_TIME_TEXT, STAGE_LABELS, type BuildStage } from "../../src/learn/stages.js";

const fixture = parseLesson(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/about-me.lesson.json"), "utf8"))) as Lesson;
const learner = fixture.steps.filter((s) => s.who === "learner");
const intro = learner.find((s) => s.id === "intro")!;
const project = { title: fixture.title, summary: fixture.summary, outcome: fixture.outcome, learns: fixture.learns, files: fixture.files };
const chapters = fixture.chapters.filter((c) => c.id !== "setup");
const stepsAnswer = (steps: Step[]) => ({ chapters, steps: steps.map((s) => ({ ...s, hints: [...s.hints] })) });

function fakeModel(answers: Partial<Record<ModelJob, unknown[]>>) {
  const calls: { job: ModelJob; prompt: string }[] = [];
  const ask: AskModel = async (o) => {
    calls.push({ job: o.job, prompt: o.prompt });
    const q = answers[o.job]!;
    return q.length > 1 ? q.shift() : q[0];
  };
  return { ask, calls };
}

// Passes once the step's own code is in the files, fails before that.
const runCheck = async (_c: unknown, s: { expected: string }, files: { content: string }[]) =>
  files.length > 0 && (s.expected.trim() === "" || files.some((f) => f.content.replace(/\s+/g, "").includes(s.expected.replace(/\s+/g, ""))));
const ideaDeps = (ask: AskModel, onStage?: (s: BuildStage) => void) => ({ ask, browser: { render: async () => [] }, runCheck, ...(onStage ? { onStage } : {}) });
const aboutMe = { request: "a page about me", answers: [] };

describe("rule tests", () => {
  it("spot a hint 3 that gives the whole answer, ignoring spacing and case", () => {
    expect(hintGivesAway("<h1>Hi, I'm Sam</h1>\n<P>I'm learning to make websites.</P>\n<p>This page is  all about me.</p>", intro.expected)).toBe(true);
    expect(hintGivesAway(intro.hints[2], intro.expected)).toBe(false);
    expect(hintGivesAway("<br>", "<br>")).toBe(false); // too small to give away
  });

  it("spot a hint 3 with the same tags and properties but other words (80% or more of the shape)", () => {
    // Every tag of the answer, with "..." for the words: the whole answer in all but name.
    expect(hintGivesAway("<h1>...</h1>\n<p>...</p>\n<p>...</p>", intro.expected)).toBe(true);
    const hobbies = learner.find((s) => s.id === "hobbies")!;
    expect(structureShare("<h2>...</h2>\n<ul>\n  <li>...</li>\n  <li>...</li>\n  <li>...</li>\n</ul>", hobbies.expected)).toBe(1);
    expect(structureShare("<ul>\n  <li>...</li>\n  <li>...</li>\n  <li>...</li>\n</ul>", hobbies.expected)).toBe(0.8); // 4 of 5: too much
    expect(hintGivesAway("<ul>\n  <li>...</li>\n  <li>...</li>\n  <li>...</li>\n</ul>", hobbies.expected)).toBe(true);
    // CSS: the rules and properties count, the values don't.
    const style = learner.find((s) => s.id === "style")!;
    expect(hintGivesAway("body {\n  font-family: ...;\n  margin: ...;\n}\nh1 {\n  color: ...;\n}", style.expected)).toBe(true);
    expect(codeStructure('<link rel="stylesheet" href="style.css">\nh1 { color: red; }')).toEqual(["link", "link@rel", "link@href", "rule:h1", "color"]);
    // The fixture's hint 3s show only part of the shape.
    for (const s of learner) expect(structureShare(s.hints[2], s.expected), s.id).toBeLessThan(0.8);
    expect(stepRuleProblems({ ...intro, hints: [intro.hints[0], intro.hints[1], "<h1>...</h1><p>...</p><p>...</p>"] })[0]).toMatch(/hint 3 contains the whole answer/);
  });

  it("tell code from plain words", () => {
    expect(looksLikeCode("<h1>Hi</h1>")).toBe(true);
    expect(looksLikeCode("h1 { color: red; }")).toBe(true);
    expect(looksLikeCode("const x = 1;")).toBe(true);
    expect(looksLikeCode("Visual Studio Code")).toBe(false);
    expect(looksLikeCode("~/stride-lessons/about-me")).toBe(false);
  });

  it("pass the about-me fixture", () => {
    expect(lessonRuleProblems(fixture.steps)).toEqual([]);
  });

  it("flag big steps, give-away hints and Stride steps that add code", () => {
    const big = { ...intro, expected: Array.from({ length: 13 }, (_, i) => `<p>${i}</p>`).join("\n") };
    expect(stepRuleProblems(big)[0]).toMatch(/adds 13 lines/);
    const giveAway = { ...intro, hints: [intro.hints[0], intro.hints[1], intro.expected] as [string, string, string] };
    expect(stepRuleProblems(giveAway)[0]).toMatch(/hint 3 contains the whole answer/);
    const strideCode: Step = { ...fixture.steps[0]!, expected: "<h1>Hi</h1>" };
    expect(stepRuleProblems(strideCode)[0]).toMatch(/"stride" step but adds code/);
    const strideWrites: Step = { ...fixture.steps[0]!, strideAction: { tool: "write_file", input: JSON.stringify({ path: "index.html", content: "<h1>Hi</h1>" }) } };
    expect(stepRuleProblems(strideWrites)[0]).toMatch(/Stride's action writes code/);
    expect(stepRuleProblems(fixture.steps[0]!)).toEqual([]);
  });

  it("need at least one link on every concept", () => {
    expect(ConceptSchema.safeParse({ title: "Lists", explain: "A list.", links: [] }).success).toBe(false);
    expect(ConceptSchema.safeParse({ title: "Lists", explain: "A list.", links: [{ title: "MDN", url: "https://developer.mozilla.org/" }] }).success).toBe(true);
  });
});

describe("the idea builder enforces the rules", () => {
  it("turns a hint 3 that gives the whole answer into the code's outline, without asking again", async () => {
    const bad = learner.map((s) => (s.id === "intro" ? { ...s, hints: [s.hints[0], s.hints[1], s.expected] as [string, string, string] } : s));
    const model = fakeModel({ project: [project], steps: [stepsAnswer(bad)] });
    const r = await buildFromIdea(aboutMe, ideaDeps(model.ask));
    if (r.kind !== "lesson") throw new Error("expected a lesson");
    expect(model.calls.filter((c) => c.job === "steps")).toHaveLength(1);
    const intro = r.lesson.steps.find((s) => s.id === "intro")!;
    expect(intro.hints[2]).toBe(outlineHint(intro.expected));
    expect(lessonRuleProblems(r.lesson.steps)).toEqual([]);
  });

  it("outlines code by blanking out what the student writes, and never gives the answer's whole shape", () => {
    const css = "h1 {\n  color: tomato;\n  margin: 0;\n  padding: 4px;\n}\n";
    const html = '    <h1>Hi, I\'m Sam</h1>\n    <p>I like <b>art</b></p>\n    <img src="me.png" alt="Me">\n';
    for (const code of [css, html, "<ul>\n</ul>\n<ol>\n</ol>\n"]) {
      const hint = outlineHint(code);
      expect(hintGivesAway(hint, code), hint).toBe(false);
      expect(hint).toContain("…");
    }
    expect(outlineHint(html).split("\n")[0]).toBe("    <h1>…</h1>");
    expect(outlineHint(css)).toMatch(/^h1 \{\n  color: …;/);
  });

  it("gives up when the steps still break the rules", async () => {
    const big = learner.map((s) => (s.id === "hobbies" ? { ...s, expected: Array.from({ length: 14 }, (_, i) => `<li>${i}</li>`).join("\n") } : s));
    const model = fakeModel({ project: [project], steps: [stepsAnswer(big)] });
    await expect(buildFromIdea(aboutMe, ideaDeps(model.ask))).rejects.toBeInstanceOf(LessonError);
  });

  it("reports its stages in order", async () => {
    const seen: BuildStage[] = [];
    const model = fakeModel({ project: [project], steps: [stepsAnswer(learner)] });
    await buildFromIdea(aboutMe, ideaDeps(model.ask, (s) => seen.push(s)));
    expect(seen).toEqual([...BUILD_STAGES.idea]);
  });

  it("stops after the scope stage for a huge ask", async () => {
    const seen: BuildStage[] = [];
    await buildFromIdea({ request: "make me Instagram", answers: [] }, ideaDeps(fakeModel({}).ask, (s) => seen.push(s)));
    expect(seen).toEqual(["scope"]);
  });
});

describe("the video builder enforces the rules", () => {
  const recorded = readFileSync(new URL("./fixtures/gemini-video.response.json", import.meta.url), "utf8");
  const draft = () => JSON.parse(readFileSync(new URL("./fixtures/video-lesson.draft.json", import.meta.url), "utf8")) as { steps: Record<string, unknown>[] };
  const notes = (url: string): Promise<VideoNotes> =>
    readVideo(url, { env: { GEMINI_API_KEY: "k" }, fetch: (async () => new Response(recorded, { status: 200 })) as typeof fetch });

  it("reports its stages in order", async () => {
    const seen: BuildStage[] = [];
    const ask = (async () => draft()) as AskJson;
    await buildFromVideo("https://youtu.be/dQw4w9WgXcQ", { runCheck, readVideo: notes, ask, cache: null, onStage: (s) => seen.push(s) });
    expect(seen).toEqual([...BUILD_STAGES.video]);
  });

  it("cuts a part running past the video's end and outlines a give-away hint 3, without asking again", async () => {
    let calls = 0;
    const ask = (async () => {
      calls++;
      const d = draft();
      const first = d.steps.find((s) => s.who === "learner")!;
      first.video = { start: 10, end: 99_999 };
      first.hints = [(first.hints as string[])[0], (first.hints as string[])[1], first.expected];
      return d;
    }) as AskJson;
    const lesson = await buildFromVideo("https://youtu.be/dQw4w9WgXcQ", { runCheck, readVideo: notes, ask, cache: null });
    expect(calls).toBe(1);
    const first = lesson.steps.find((s) => s.who === "learner")!;
    expect(first.video).toEqual({ start: 10, end: 410 });
    expect(lessonRuleProblems(lesson.steps)).toEqual([]);
  });

  it("asks again when a video part starts after the video ends", async () => {
    const calls: string[] = [];
    const ask = (async (req: { content: unknown }) => {
      calls.push(String(req.content));
      const d = draft();
      if (calls.length === 1) d.steps.find((s) => s.who === "learner")!.video = { start: 99_000, end: 99_999 };
      return d;
    }) as AskJson;
    const lesson = await buildFromVideo("https://youtu.be/dQw4w9WgXcQ", { runCheck, readVideo: notes, ask, cache: null });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/after the video ends/);
    expect(lessonRuleProblems(lesson.steps)).toEqual([]);
  });

  it("checks video parts sit inside the video", async () => {
    const n = await notes("https://youtu.be/dQw4w9WgXcQ");
    expect(notesEnd(n)).toBe(410);
    const s = { ...intro, video: { start: 30, end: 30 } };
    expect(videoPartProblems([s], 410)[0]).toMatch(/end after it starts/);
    expect(videoPartProblems([{ ...intro }], 410)[0]).toMatch(/needs a video part/);
    expect(videoPartProblems([{ ...intro, video: { start: 0, end: 40 } }], 410)).toEqual([]);
  });
});

describe("stages", () => {
  it("have a plain label each, and one honest build time phrase", () => {
    for (const s of [...BUILD_STAGES.idea, ...BUILD_STAGES.video]) expect(STAGE_LABELS[s]).toMatch(/^[A-Z][a-z]/);
    expect(BUILD_TIME_TEXT).toBe("about 3 minutes");
  });
});

describe("long videos and missing video parts", () => {
  const recorded = readFileSync(new URL("./fixtures/gemini-video.response.json", import.meta.url), "utf8");
  const draft = () => JSON.parse(readFileSync(new URL("./fixtures/video-lesson.draft.json", import.meta.url), "utf8")) as { steps: Record<string, unknown>[] };
  const notes = (url: string): Promise<VideoNotes> =>
    readVideo(url, { env: { GEMINI_API_KEY: "k" }, fetch: (async () => new Response(recorded, { status: 200 })) as typeof fetch });

  it("gives a learner step with no video part the stretch between its neighbours, without asking again", async () => {
    let calls = 0;
    let gap: { before: { end: number }; after: { start: number } } | undefined;
    const ask = (async () => {
      calls++;
      const d = draft();
      const learners = d.steps.filter((s) => s.who === "learner");
      const i = d.steps.indexOf(learners[1]!);
      delete d.steps[i]!.video;
      const prev = d.steps.slice(0, i).reverse().find((s) => s.video)!.video as { end: number };
      const next = d.steps.slice(i + 1).find((s) => s.video)!.video as { start: number };
      gap = { before: prev, after: next };
      return d;
    }) as AskJson;
    const lesson = await buildFromVideo("https://youtu.be/dQw4w9WgXcQ", { runCheck, readVideo: notes, ask, cache: null });
    expect(calls).toBe(1);
    const filled = lesson.steps.filter((s) => s.who === "learner")[1]!;
    expect(filled.video).toBeDefined();
    if (gap!.before.end < gap!.after.start) expect(filled.video).toEqual({ start: gap!.before.end, end: gap!.after.start });
    expect(lessonRuleProblems(lesson.steps)).toEqual([]);
  });

  it("builds a long video's lesson from its first chapters, and says where it stops", async () => {
    const seg = (start: number, chapter: string, lines: number) => ({ start, end: start + 30, chapter, action: "types", file: "index.html", code: Array.from({ length: lines }, (_, i) => `<p>${i}</p>`).join("\n") });
    const long: VideoNotes = {
      title: "Long",
      summary: "s",
      chapters: [
        { title: "One", start: 0, end: 300 },
        { title: "Two", start: 300, end: 600 },
        { title: "Three", start: 600, end: 900 },
      ],
      segments: [seg(10, "One", 60), seg(100, "One", 60), seg(320, "Two", 20), seg(620, "Three", 80)],
    };
    const part = firstPart(long);
    expect(part.trimmed).toBe(true);
    expect(part.until).toBe(600);
    expect(part.notes.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(part.notes.segments).toHaveLength(3);
    expect(firstPart({ ...long, segments: long.segments.slice(0, 1) }).trimmed).toBe(false);

    let prompt = "";
    const ask = (async (req: { content: unknown }) => ((prompt = String(req.content)), draft())) as AskJson;
    await buildFromVideo("https://youtu.be/dQw4w9WgXcQ", { runCheck, readVideo: async () => long, ask, cache: null }).catch(() => {});
    expect(prompt).toMatch(/covers only its first part, up to 10:00/);
    expect(prompt).not.toContain('"Three"');
  });
});

describe("hints that get stronger", () => {
  const expected = '    <meta charset="utf-8">\n    <title>About me</title>\n    <link rel="stylesheet" href="style.css">\n';

  it("turns a hint 2 that shows more than hint 3 into the names of what to use", () => {
    const fixed = strongerHints(["Your page needs a few hidden lines.", expected, outlineHint(expected)], expected);
    expect(fixed[1]).toBe("Here you need <meta>, <title> and <link>.");
    expect(fixed[2]).toBe(outlineHint(expected));
    expect(hintStrength(fixed[1]!, expected)).toBeLessThan(hintStrength(fixed[2]!, expected));
  });

  it("outlines a give-away hint 3 first, and leaves good hints alone", () => {
    expect(strongerHints(["a", "b", expected], expected)[2]).toBe(outlineHint(expected));
    const good = ["Add the hidden info.", "Inside <head>, add a meta, a title and a link.", outlineHint(expected)];
    expect(strongerHints(good, expected)).toEqual(good);
    expect(nameHint("h1 {\n  color: red;\n}\n")).toBe("Here you need the property color.");
    expect(nameHint("  color: red;\n  margin: 0;\n")).toBe("Here you need the properties color and margin.");
  });
});

describe("review fixes", () => {
  it("one-line CSS rules still get useful hints", () => {
    const code = "h1 { color: #c0392b; }\n";
    expect(outlineHint(code)).toBe("h1 { color: …; }");
    expect(nameHint(code)).toBe("Here you need the property color.");
  });

  it("hint 2 keeps the values a beginner can't guess when it has to be rewritten", () => {
    const expected = '<meta charset="utf-8">\n<title>Me</title>\n<link rel="stylesheet" href="style.css">\n';
    const fixed = strongerHints(["Add the hidden info.", expected, outlineHint(expected)], expected);
    expect(hintStrength(fixed[1]!, expected)).toBeLessThanOrEqual(hintStrength(fixed[2]!, expected));
    expect(nameHint(expected)).toBe('Here you need <meta>, <title> and <link>, with charset "utf-8", rel "stylesheet" and href "style.css".');
  });

  it("trims a video whose only chapter is already too long", () => {
    const seg = (start: number, n: number) => ({ start, end: start + 30, chapter: "All", action: "a", file: "index.html", code: Array.from({ length: n }, (_, i) => `<p>${i}</p>`).join("\n") });
    const one: VideoNotes = { title: "t", summary: "s", chapters: [{ title: "All", start: 0, end: 900 }], segments: [seg(0, 80), seg(100, 60), seg(200, 90)] };
    const part = firstPart(one);
    expect(part.trimmed).toBe(true);
    expect(part.notes.segments).toHaveLength(2);
    expect(part.until).toBe(130);
    expect(part.notes.chapters[0]!.end).toBe(130);
  });
});

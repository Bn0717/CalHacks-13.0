// Lesson rules enforced in code (not only asked for in prompts), and honest build stages.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFromIdea, type AskModel, type ModelJob } from "../../src/learn/build-from-idea.js";
import { buildFromVideo, notesEnd, videoPartProblems, type AskJson } from "../../src/learn/build-from-video.js";
import { readVideo, type VideoNotes } from "../../src/learn/gemini.js";
import { ConceptSchema, LessonError, parseLesson, type Lesson, type Step } from "../../src/learn/lesson.js";
import { hintGivesAway, lessonRuleProblems, looksLikeCode, stepRuleProblems } from "../../src/learn/rules.js";
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
  it("asks again when hint 3 gives the whole answer, and uses the fixed steps", async () => {
    const bad = learner.map((s) => (s.id === "intro" ? { ...s, hints: [s.hints[0], s.hints[1], s.expected] as [string, string, string] } : s));
    const model = fakeModel({ project: [project], steps: [stepsAnswer(bad), stepsAnswer(learner)] });
    const r = await buildFromIdea(aboutMe, ideaDeps(model.ask));
    expect(r.kind).toBe("lesson");
    const stepCalls = model.calls.filter((c) => c.job === "steps");
    expect(stepCalls).toHaveLength(2);
    expect(stepCalls[1]!.prompt).toMatch(/hint 3 contains the whole answer/);
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

  it("asks again when a video part is past the end of the video or a hint gives the answer away", async () => {
    const calls: string[] = [];
    const ask = (async (req: { content: unknown }) => {
      calls.push(String(req.content));
      const d = draft();
      if (calls.length === 1) {
        const first = d.steps.find((s) => s.who === "learner")!;
        first.video = { start: 10, end: 99_999 };
        first.hints = [(first.hints as string[])[0], (first.hints as string[])[1], first.expected];
      }
      return d;
    }) as AskJson;
    const lesson = await buildFromVideo("https://youtu.be/dQw4w9WgXcQ", { runCheck, readVideo: notes, ask, cache: null });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/after the video ends/);
    expect(calls[1]).toMatch(/hint 3 contains the whole answer/);
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
    expect(BUILD_TIME_TEXT).toBe("usually a minute or two");
  });
});

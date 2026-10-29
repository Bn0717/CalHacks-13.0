import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scopeCheck } from "../../src/learn/build-from-idea.js";
import { gradeLesson, gradeTooBig, hintStrength, sensibleMinutes, sentences, type Grade } from "../../src/learn/grade.js";
import { judgeLesson, LessonJudgementSchema, type JudgeAsk } from "../../src/learn/judge-lesson.js";
import { parseLesson, type Lesson, type Step } from "../../src/learn/lesson.js";
import type { CheckRunner } from "../../src/learn/validate.js";

const raw = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/about-me.lesson.json"), "utf8"));
const fixture = parseLesson(raw);
const clone = (): Lesson => structuredClone(fixture);

// Passes on the finished project, fails on an empty one.
const honest: CheckRunner = async (_c, _s, files) => files.length > 0;
const deps = { runCheck: honest };
const crit = (g: Grade, id: string) => g.criteria.find((c) => c.id === id)!;
const withStep = (l: Lesson, id: string, change: Partial<Step>): Lesson => ({ ...l, steps: l.steps.map((s) => (s.id === id ? { ...s, ...change } : s)) as Step[] });

describe("gradeLesson", () => {
  it("grades the about-me fixture on every criterion", async () => {
    const g = await gradeLesson("about me", raw, deps);
    expect(g.criteria.map((c) => c.id)).toEqual(["valid", "checks", "stepSize", "whoTypes", "estimate", "concepts", "hints", "video"]);
    // Every rule but the video one passes: steps of 3-10 lines, one-sentence concepts with links.
    for (const id of ["valid", "checks", "stepSize", "whoTypes", "estimate", "concepts", "hints"]) expect(crit(g, id).pass, id).toBe(true);
    expect(crit(g, "video").skipped).toMatch(/Not a video/);
    expect(g.passed).toBeLessThanOrEqual(g.total);
  });

  it("stops at 'valid' for a broken lesson, listing its problems", async () => {
    const g = await gradeLesson("broken", { ...raw, steps: [] }, deps);
    expect(g.criteria).toHaveLength(1);
    expect(crit(g, "valid").pass).toBe(false);
    expect(crit(g, "valid").examples[0]).toMatch(/steps/);
  });

  it("fails checks that pass on an empty project or fail on the finished one", async () => {
    const always: CheckRunner = async () => true;
    const g = await gradeLesson("x", fixture, { runCheck: always });
    expect(crit(g, "checks").pass).toBe(false);
    expect(crit(g, "checks").examples.join(" ")).toMatch(/no check that works/);
  });

  it("fails steps that are too big or too small, worst first", async () => {
    const big = Array.from({ length: 15 }, (_, i) => `<p>${i}</p>`).join("\n");
    let l = withStep(clone(), "intro", { expected: big });
    l = withStep(l, "link-css", { expected: "<link rel=\"stylesheet\" href=\"style.css\">" });
    const g = await gradeLesson("x", { ...l, estimate: { ...l.estimate } }, deps);
    expect(crit(g, "stepSize").pass).toBe(false);
    expect(crit(g, "stepSize").examples[0]).toBe("Step intro adds 15 lines.");
    expect(crit(g, "stepSize").examples[1]).toBe("Step link-css adds 1 line.");
  });

  it("fails a Stride step that adds code, and code the student never types", async () => {
    const l = withStep(clone(), "open-editor", { expected: "<h1>Hi</h1>" });
    const g = await gradeLesson("x", l, deps);
    expect(crit(g, "whoTypes").examples.join(" ")).toMatch(/"stride" step but adds code/);
    const l2 = clone();
    l2.files[1]!.content += "\nfooter {\n  color: gray;\n  padding: 4px;\n  margin: 2px;\n}\n";
    expect(crit(await gradeLesson("x", l2, deps), "whoTypes").examples.join(" ")).toMatch(/style\.css: \d+ of \d+ lines are never typed/);
  });

  it("fails an estimate that doesn't match the steps or is out of range", async () => {
    const g = await gradeLesson("x", { ...clone(), estimate: { minutes: 500, linesToType: 3, steps: 2 } }, deps);
    const ex = crit(g, "estimate").examples.join(" ");
    expect(ex).toMatch(/Says 2 steps/);
    expect(ex).toMatch(/Says 3 lines/);
    expect(ex).toMatch(/500 min/);
    expect(sensibleMinutes(25, 6)).toEqual({ min: 9, max: 55 });
  });

  it("fails concepts that are long, use jargon or have no link", async () => {
    const l = withStep(clone(), "intro", {
      concept: { title: "Headings", explain: "The h1 element is a DOM node. Browsers parse it.", links: [{ title: "MDN", url: "https://developer.mozilla.org/" }] },
    });
    const ex = crit(await gradeLesson("x", l, deps), "concepts").examples.join(" ");
    expect(ex).toMatch(/2 sentences/);
    expect(ex).toMatch(/jargon word "element"|jargon word "DOM"/);
    expect(sentences("Open style.css and type it, e.g. like this.")).toBe(1);
  });

  it("fails hints that give the answer away or don't get stronger", async () => {
    const intro = fixture.steps.find((s) => s.id === "intro")!;
    let l = withStep(clone(), "intro", { hints: ["A big heading.", "Inside the body.", intro.expected] });
    l = withStep(l, "hobbies", { hints: ["<ul>\n  <li>Drawing</li>\n</ul>", "Use a list.", "A list."] });
    const ex = crit(await gradeLesson("x", l, deps), "hints").examples;
    expect(ex[0]).toBe("Step intro: hint 3 is the whole answer.");
    expect(ex.join(" ")).toMatch(/hobbies: hint 3 isn't the strongest/);
    expect(hintStrength("<h1>Hi</h1>", intro.expected)).toBeGreaterThan(hintStrength("A big heading", intro.expected));
  });

  it("checks video steps against the video", async () => {
    const l = clone();
    l.source = { kind: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", title: "A video" };
    l.steps = l.steps.map((s, i) => (s.who === "learner" ? { ...s, video: i === 2 ? { start: 50, end: 50 } : i === 3 ? { start: 100, end: 900 } : { start: i * 10, end: i * 10 + 9 } } : s));
    const ex = crit(await gradeLesson("x", l, { runCheck: honest, videoSeconds: 410 }), "video").examples.join(" ");
    expect(ex).toMatch(/doesn't move forward/);
    expect(ex).toMatch(/after the video ends/);
  });
});

describe("gradeTooBig", () => {
  it("passes a kind small offer, fails anything else", () => {
    expect(gradeTooBig("instagram", scopeCheck("make me Instagram")!).criteria[0]!.pass).toBe(true);
    expect(gradeTooBig("x", { kind: "lesson" }).criteria[0]!.pass).toBe(false);
    const flat = { kind: "tooBig" as const, why: "x", smaller: { request: "", say: "Sorry, I can't help with that." } };
    expect(gradeTooBig("x", flat).criteria[0]!.examples.length).toBeGreaterThanOrEqual(2);
  });
});

describe("judgeLesson", () => {
  const answer = { scores: { wording: 4, stepSize: 5, order: 4, hints: 3, fidelity: 4 }, worst: [{ stepId: "style", problem: "Hint 1 uses the word selector." }], summary: "Clear and small." };

  it("asks a separate model call with the lesson (and video notes) and checks the answer", async () => {
    const calls: Parameters<JudgeAsk>[0][] = [];
    const ask: JudgeAsk = async (o) => (calls.push(o), answer);
    const j = await judgeLesson(fixture, { ask, model: "claude-opus-5-5", notes: { title: "T", summary: "S", chapters: [{ title: "c", start: 0, end: 9 }], segments: [] } as never });
    expect(j).toEqual(answer);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe("claude-opus-5-5");
    expect(String(calls[0]!.content)).toContain('"id": "skeleton"');
    expect(String(calls[0]!.content)).toContain("Notes on the video");
    expect(calls[0]!.schema).toMatchObject({ type: "object" });
  });

  it("rejects scores outside 1-5", async () => {
    const ask: JudgeAsk = async () => ({ ...answer, scores: { ...answer.scores, hints: 9 } });
    await expect(judgeLesson(fixture, { ask })).rejects.toThrow();
    expect(LessonJudgementSchema.safeParse(answer).success).toBe(true);
  });
});

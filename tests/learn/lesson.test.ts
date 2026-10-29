import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ESTIMATE,
  LessonError,
  ProgressSchema,
  estimateFor,
  estimateMinutes,
  lessonJsonSchema,
  linesIn,
  parseLesson,
  strideActionInput,
  type Lesson,
  type Step,
} from "../../src/learn/lesson.js";

const fixtureText = readFileSync(new URL("./fixtures/about-me.lesson.json", import.meta.url), "utf8");
const fixture = (): Lesson => JSON.parse(fixtureText) as Lesson;

function errorOf(fn: () => unknown): LessonError {
  try {
    fn();
  } catch (e) {
    if (e instanceof LessonError) return e;
    throw e;
  }
  throw new Error("expected a LessonError");
}

function step(over: Partial<Step>): Step {
  return {
    id: "s",
    chapter: "c",
    title: "t",
    instruction: "i",
    why: "w",
    who: "learner",
    expected: "",
    checks: [{ type: "parses" }],
    hints: ["a", "b", "c"],
    ...over,
  };
}

describe("the about-me fixture", () => {
  it("is a valid 6-step lesson", () => {
    const lesson = parseLesson(fixtureText);
    expect(lesson.steps).toHaveLength(6);
    expect(lesson.source.kind).toBe("idea");
  });

  it("accepts an already parsed object too", () => {
    expect(parseLesson(fixture()).id).toBe("about-me");
  });

  it("has an estimate that matches its steps", () => {
    const lesson = parseLesson(fixtureText);
    expect(estimateFor(lesson.steps)).toEqual(lesson.estimate);
  });

  it("only uses code from the finished project", () => {
    const lesson = parseLesson(fixtureText);
    for (const s of lesson.steps) {
      if (!s.file || !s.expected) continue;
      const file = lesson.files.find((f) => f.path === s.file);
      const fileLines = new Set(file?.content.split("\n").map((l) => l.trim()));
      for (const line of s.expected.split("\n").filter((l) => l.trim())) expect(fileLines.has(line.trim()), `${s.id}: ${line}`).toBe(true);
    }
  });

  it("gives the stride step a tool input Stride can use", () => {
    const stride = parseLesson(fixtureText).steps.find((s) => s.who === "stride");
    expect(stride?.strideAction?.tool).toBe("open_app");
    expect(strideActionInput(stride!.strideAction!)).toEqual({ app_name: "Visual Studio Code" });
  });
});

describe("parseLesson rejects bad shapes with readable errors", () => {
  it("not JSON", () => {
    expect(errorOf(() => parseLesson("{nope")).message).toBe("This lesson isn't valid JSON.");
  });

  it("missing fields", () => {
    const bad = fixture() as Partial<Lesson>;
    delete bad.title;
    const err = errorOf(() => parseLesson(bad));
    expect(err.message).toMatch(/^This lesson has problems: title:/);
    expect(err.problems.some((p) => p.startsWith("title:"))).toBe(true);
  });

  it("wrong number of hints, with the step's position in the path", () => {
    const bad = fixture();
    (bad.steps[2] as { hints: string[] }).hints = ["only one"];
    expect(errorOf(() => parseLesson(bad)).problems.some((p) => p.startsWith("steps[2].hints"))).toBe(true);
  });

  it("an unknown check type", () => {
    const bad = fixture();
    (bad.steps[1].checks as unknown[]).push({ type: "exactText", text: "<h1>" });
    expect(errorOf(() => parseLesson(bad)).problems.some((p) => p.startsWith("steps[1].checks[3]"))).toBe(true);
  });

  it("a step in a chapter that doesn't exist", () => {
    const bad = fixture();
    bad.steps[3].chapter = "nowhere";
    expect(errorOf(() => parseLesson(bad)).problems).toContain('steps[3].chapter: Chapter "nowhere" doesn\'t exist.');
  });

  it("a step for a file that isn't in the project", () => {
    const bad = fixture();
    bad.steps[2].file = "missing.html";
    expect(errorOf(() => parseLesson(bad)).problems).toContain('steps[2].file: File "missing.html" isn\'t in the finished project.');
  });

  it("duplicate step ids", () => {
    const bad = fixture();
    bad.steps[2].id = bad.steps[1].id;
    expect(errorOf(() => parseLesson(bad)).problems).toContain('steps[2].id: Step id "skeleton" is used twice.');
  });

  it("a stride step without an action, and a learner step without checks", () => {
    const bad = fixture();
    delete bad.steps[0].strideAction;
    bad.steps[1].checks = [];
    const problems = errorOf(() => parseLesson(bad)).problems;
    expect(problems).toContain("steps[0].strideAction: A 'stride' step needs a strideAction.");
    expect(problems).toContain("steps[1].checks: A 'learner' step needs at least one check.");
  });

  it("a stride action whose input isn't a JSON object", () => {
    const bad = fixture();
    bad.steps[0].strideAction!.input = "open vs code";
    expect(errorOf(() => parseLesson(bad)).problems.some((p) => p.startsWith("steps[0].strideAction.input"))).toBe(true);
  });

  it("a video part that ends before it starts", () => {
    const bad = fixture();
    bad.steps[2].video = { start: 30, end: 10 };
    expect(errorOf(() => parseLesson(bad)).problems).toContain("steps[2].video.end: The video part must end after it starts.");
  });

  it("a quiz answer that isn't one of the options", () => {
    const bad = fixture();
    bad.steps[5].quiz!.answer = 7;
    expect(errorOf(() => parseLesson(bad)).problems).toContain("steps[5].quiz.answer: The quiz answer must point at one of its options.");
  });

  it("lists at most 5 problems in the message", () => {
    const bad = fixture();
    for (const s of bad.steps) s.chapter = "nowhere";
    const err = errorOf(() => parseLesson(bad));
    expect(err.problems).toHaveLength(6);
    expect(err.message).toMatch(/\(and 1 more\)$/);
  });
});

describe("estimate maths", () => {
  it("counts lines typed, ignoring blank lines", () => {
    expect(linesIn("a\n\n  \nb\n")).toBe(2);
    expect(estimateMinutes([step({ expected: "1\n2\n3\n4\n5\n" })])).toBe(Math.ceil(5 * ESTIMATE.minutesPerLine));
  });

  it("adds time per new concept, counting a repeated concept once", () => {
    const concept = { title: "Lists", explain: "x", links: [] };
    const steps = [step({ concept }), step({ concept: { ...concept, title: " lists " } }), step({ concept: { ...concept, title: "CSS" } })];
    expect(estimateMinutes(steps)).toBe(2 * ESTIMATE.minutesPerConcept);
  });

  it("adds a little for stride and watch steps, and doesn't count their code as typing", () => {
    const steps = [step({ who: "stride", expected: "lots\nof\ncode" }), step({ who: "watch" })];
    expect(estimateMinutes(steps)).toBe(Math.ceil(2 * ESTIMATE.minutesPerStrideOrWatchStep));
    expect(estimateFor(steps).linesToType).toBe(0);
  });

  it("rounds up to whole minutes", () => {
    expect(estimateMinutes([step({ expected: "one line" })])).toBe(1);
    expect(estimateMinutes([])).toBe(0);
  });
});

describe("progress", () => {
  it("validates a saved progress record", () => {
    const progress = {
      lessonId: "about-me",
      stepIndex: 2,
      steps: { skeleton: { status: "done", hintsUsed: 0, startedAt: "2026-10-29T12:00:00.000Z", doneAt: "2026-10-29T12:03:00.000Z" }, intro: { status: "hinted", hintsUsed: 2 } },
      pace: "learn",
      updatedAt: "2026-10-29T12:05:00.000Z",
    };
    expect(ProgressSchema.parse(progress)).toEqual(progress);
    expect(ProgressSchema.safeParse({ ...progress, pace: "slow" }).success).toBe(false);
  });
});

describe("lessonJsonSchema", () => {
  it("is a strict schema that askJson's structured output accepts", () => {
    const schema = lessonJsonSchema();
    const text = JSON.stringify(schema);
    expect(schema.type).toBe("object");
    expect(text).not.toContain("prefixItems");
    expect(text).not.toContain('"$schema"');
    // Every object closes its properties.
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      if (o.type === "object") expect(o.additionalProperties).toBe(false);
      Object.values(o).forEach(walk);
    };
    walk(schema);
  });

  it("sends the 3 hints as a list of strings", () => {
    const schema = lessonJsonSchema() as any;
    expect(schema.properties.steps.items.properties.hints.items).toMatchObject({ type: "string" });
  });
});

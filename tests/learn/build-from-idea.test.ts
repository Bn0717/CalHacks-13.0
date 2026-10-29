import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFromIdea, proveChecks, scopeCheck, type AskModel, type IdeaDeps, type ModelJob } from "../../src/learn/build-from-idea.js";
import { LessonError, parseLesson, type Check, type Lesson, type ProjectFile, type Step } from "../../src/learn/lesson.js";
import type { CheckRunner } from "../../src/learn/validate.js";

const fixture = parseLesson(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/about-me.lesson.json"), "utf8"))) as Lesson;

const project = {
  title: fixture.title,
  summary: fixture.summary,
  outcome: fixture.outcome,
  learns: fixture.learns,
  files: fixture.files,
};
// Idea lessons don't use "stride" steps (setup is done separately), and the model sends hints as a plain list.
const learnerSteps = fixture.steps.filter((s) => s.who !== "stride");
const stepsAnswer = { chapters: fixture.chapters.filter((c) => c.id !== "setup"), steps: learnerSteps.map((s) => ({ ...s, hints: [...s.hints] })) };

type Call = { job: ModelJob; prompt: string; schema: Record<string, unknown> };

// A fake model: each job answers from a queue (the last answer repeats), and every call is recorded.
function fakeModel(answers: Partial<Record<ModelJob, unknown[]>>): { ask: AskModel; calls: Call[] } {
  const calls: Call[] = [];
  const ask: AskModel = async (o) => {
    calls.push({ job: o.job, prompt: o.prompt, schema: o.schema });
    const queue = answers[o.job];
    if (!queue || queue.length === 0) throw new Error(`no fake answer for ${o.job}`);
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  return { ask, calls };
}

// A fake checker: every check passes on the finished project and fails on an empty one, except the ones `bad` names.
function fakeChecker(bad: { failsOnFinished?: string[]; passesOnEmpty?: string[] } = {}): CheckRunner {
  return async (check, _step, files) => {
    const key = "selector" in check ? check.selector : check.type;
    if (files.length === 0) return (bad.passesOnEmpty ?? []).includes(key);
    return !(bad.failsOnFinished ?? []).includes(key);
  };
}

const cleanBrowser = { render: async () => [] as string[] };

function deps(over: Partial<IdeaDeps> & { ask: AskModel }): IdeaDeps {
  return { browser: cleanBrowser, runCheck: fakeChecker(), now: () => new Date("2026-10-29T12:00:00.000Z"), ...over };
}

const aboutMe = { request: "I want to make a page about me", answers: [{ question: "What's it for?", answer: "Just for me" }] };

describe("scopeCheck", () => {
  it("offers a small version of huge asks", () => {
    const r = scopeCheck("make me Instagram");
    expect(r?.kind).toBe("tooBig");
    expect(r?.smaller.request).toMatch(/profile page with a grid of photos/i);
    expect(r?.smaller.say).toMatch(/Instagram/);
    expect(r?.smaller.say).toMatch(/How about/);
  });

  it("catches servers, accounts and payments", () => {
    expect(scopeCheck("a site where people log in to their accounts")?.kind).toBe("tooBig");
    expect(scopeCheck("a bakery site that takes payments")?.smaller.request).toMatch(/no real payments/);
    expect(scopeCheck("a website with a database of my books")?.kind).toBe("tooBig");
  });

  it("lets ordinary asks through", () => {
    expect(scopeCheck("I want to make a page about me")).toBeNull();
    expect(scopeCheck("a website for my accounting business")).toBeNull();
    expect(scopeCheck("a page for my bakery with opening hours")).toBeNull();
  });
});

describe("buildFromIdea", () => {
  it("turns 'a page about me' into a valid lesson", async () => {
    const model = fakeModel({ project: [project], steps: [stepsAnswer] });
    const r = await buildFromIdea(aboutMe, deps({ ask: model.ask }));
    expect(r.kind).toBe("lesson");
    if (r.kind !== "lesson") return;
    expect(() => parseLesson(r.lesson)).not.toThrow();
    expect(r.lesson.source).toEqual({ kind: "idea", ...aboutMe });
    expect(r.lesson.files).toEqual(fixture.files);
    expect(r.lesson.steps.map((s) => s.id)).toEqual(learnerSteps.map((s) => s.id));
    expect(r.lesson.estimate.steps).toBe(learnerSteps.length);
    expect(r.lesson.estimate.minutes).toBeLessThanOrEqual(60);
    expect(r.lesson.simpler).toBeUndefined();
    expect(r.lesson.createdAt).toBe("2026-10-29T12:00:00.000Z");
    expect(r.lesson.id).toMatch(/^idea-a-page-about-me-[0-9a-f]{8}$/);
    expect(model.calls.map((c) => c.job)).toEqual(["project", "steps"]);
  });

  it("keeps the picture notes and sends them to the model", async () => {
    const model = fakeModel({ project: [project], steps: [stepsAnswer] });
    // T2's richer picture result: extra fields are fine, only summary and sections are stored.
    const picture = { summary: "A top menu and a big title", sections: [{ name: "menu", description: "links at the top" }], style: { mood: "calm" } };
    const r = await buildFromIdea({ ...aboutMe, picture }, deps({ ask: model.ask }));
    if (r.kind !== "lesson") throw new Error("expected a lesson");
    expect(r.lesson.source).toMatchObject({ picture: { summary: picture.summary, sections: picture.sections } });
    expect(r.lesson.source.kind === "idea" && r.lesson.source.picture).not.toHaveProperty("style");
    expect(model.calls[0]!.prompt).toContain("links at the top");
  });

  it("answers 'make me Instagram' with a small alternative, without calling the model", async () => {
    const model = fakeModel({});
    const r = await buildFromIdea({ request: "make me Instagram", answers: [] }, deps({ ask: model.ask }));
    expect(r.kind).toBe("tooBig");
    if (r.kind !== "tooBig") return;
    expect(r.smaller.request.length).toBeGreaterThan(0);
    expect(model.calls).toHaveLength(0);
  });

  it("sends browser errors back once and uses the fixed project", async () => {
    const broken = { ...project, files: [{ path: "index.html", content: "<script>oops()</script>" }, fixture.files[1]!] };
    const model = fakeModel({ project: [broken, project], steps: [stepsAnswer] });
    const rendered: ProjectFile[][] = [];
    const browser = {
      render: async (files: ProjectFile[]) => {
        rendered.push(files);
        return files[0]!.content.includes("oops") ? ["index.html: script error: oops is not defined"] : [];
      },
    };
    const r = await buildFromIdea(aboutMe, deps({ ask: model.ask, browser }));
    expect(r.kind).toBe("lesson");
    expect(rendered).toHaveLength(2);
    const retry = model.calls.filter((c) => c.job === "project")[1]!;
    expect(retry.prompt).toContain("oops is not defined");
    expect(retry.prompt).toContain("<script>oops()</script>");
  });

  it("gives up with a clear error when the fixed project still fails", async () => {
    const model = fakeModel({ project: [project], steps: [stepsAnswer] });
    const browser = { render: async () => ["index.html: console error: boom"] };
    await expect(buildFromIdea(aboutMe, deps({ ask: model.ask, browser }))).rejects.toThrow(LessonError);
    expect(model.calls.filter((c) => c.job === "project")).toHaveLength(2);
  });

  it("asks again when the model's answer doesn't fit the shape", async () => {
    const noIndex = { ...project, files: [{ path: "home.html", content: "<h1>Hi</h1>" }] };
    const model = fakeModel({ project: [noIndex, project], steps: [stepsAnswer] });
    const r = await buildFromIdea(aboutMe, deps({ ask: model.ask }));
    expect(r.kind).toBe("lesson");
    expect(model.calls[1]!.prompt).toMatch(/needs an index\.html/);
  });

  it("evens out a hint list that isn't exactly 3 long", async () => {
    const steps = stepsAnswer.steps.map((s, i) => (i === 0 ? { ...s, hints: ["only one"] } : i === 1 ? { ...s, hints: ["a", "b", "c", "d"] } : s));
    const model = fakeModel({ project: [project], steps: [{ ...stepsAnswer, steps }] });
    const r = await buildFromIdea(aboutMe, deps({ ask: model.ask }));
    if (r.kind !== "lesson") throw new Error("expected a lesson");
    expect(r.lesson.steps[0]!.hints).toEqual(["only one", "only one", "only one"]);
    expect(r.lesson.steps[1]!.hints).toEqual(["a", "b", "c"]);
  });

  it("adds a simpler offer when the lesson is over 60 minutes", async () => {
    // 6 steps of 25 lines each: 6 × 25 × 0.6 = 90 minutes of typing.
    const big = Array.from({ length: 6 }, (_, i) => `.box-${i} { color: red; }`);
    const css = Array.from({ length: 150 }, (_, i) => `.l${i} { margin: ${i}px; }`).join("\n");
    const longSteps = Array.from({ length: 6 }, (_, i) => ({
      id: `part-${i}`,
      chapter: "html",
      title: `Part ${i}`,
      instruction: "Type these lines.",
      why: "Practice.",
      who: "learner" as const,
      file: "style.css",
      expected: css.split("\n").slice(i * 25, i * 25 + 25).join("\n"),
      checks: [{ type: "selectorExists" as const, selector: big[i]! }],
      hints: ["a", "b", "c"],
    }));
    const longProject = { ...project, files: [fixture.files[0]!, { path: "style.css", content: css }] };
    const simpler = { title: "Just the top of the page", why: "Start small and grow it later.", stepIds: ["part-0", "part-1"] };
    const model = fakeModel({ project: [longProject], steps: [{ chapters: [{ id: "html", title: "Build it" }], steps: longSteps }], simpler: [simpler] });
    const r = await buildFromIdea(aboutMe, deps({ ask: model.ask }));
    if (r.kind !== "lesson") throw new Error("expected a lesson");
    expect(r.lesson.estimate.minutes).toBe(90);
    expect(r.lesson.simpler).toEqual({ title: simpler.title, why: simpler.why, estimate: { minutes: 30, linesToType: 50, steps: 2 } });
    expect(() => parseLesson(r.lesson)).not.toThrow();
  });

  it("still returns the long lesson when the simpler offer can't be made", async () => {
    const css = Array.from({ length: 120 }, (_, i) => `.l${i} { margin: ${i}px; }`).join("\n");
    const step = { ...stepsAnswer.steps[4]!, id: "all", expected: css, checks: [{ type: "parses" as const }] };
    const model = fakeModel({
      project: [{ ...project, files: [fixture.files[0]!, { path: "style.css", content: css }] }],
      steps: [{ chapters: stepsAnswer.chapters, steps: [step] }],
      simpler: [{ title: "x", why: "y", stepIds: ["nope"] }],
    });
    const r = await buildFromIdea(aboutMe, deps({ ask: model.ask }));
    if (r.kind !== "lesson") throw new Error("expected a lesson");
    expect(r.lesson.estimate.minutes).toBeGreaterThan(60);
    expect(r.lesson.simpler).toBeUndefined();
  });

  it("drops a bad check and keeps the step when its other checks hold", async () => {
    // "head title" fails on the finished code: dropped. The fix round sends nothing new for it.
    const model = fakeModel({ project: [project], steps: [stepsAnswer], fixChecks: [{ steps: [] }] });
    const r = await buildFromIdea(aboutMe, deps({ ask: model.ask, runCheck: fakeChecker({ failsOnFinished: ["head title"] }) }));
    if (r.kind !== "lesson") throw new Error("expected a lesson");
    const skeleton = r.lesson.steps.find((s) => s.id === "skeleton")!;
    expect(skeleton.checks.map((c) => c.type)).toEqual(["parses", "textIncludes"]);
    const fix = model.calls.find((c) => c.job === "fixChecks")!;
    expect(fix.prompt).toContain("fails on the finished project");
  });

  it("fixes a step left with no working check using the model's new check", async () => {
    // Both of "intro"'s checks are bad: "body h1" fails on the finished code, "body p" already passes on an empty project.
    const intro = { ...stepsAnswer.steps.find((s) => s.id === "intro")! };
    const runCheck = fakeChecker({ failsOnFinished: ["body h1"], passesOnEmpty: ["body p"] });
    const fixed: Check = { type: "textIncludes", selector: "h1", text: "hi" };
    const model = fakeModel({ project: [project], steps: [{ ...stepsAnswer, steps: [intro] }], fixChecks: [{ steps: [{ id: "intro", checks: [fixed] }] }] });
    const r = await buildFromIdea(aboutMe, deps({ ask: model.ask, runCheck }));
    if (r.kind !== "lesson") throw new Error("expected a lesson");
    expect(r.lesson.steps[0]!.checks).toEqual([fixed]);
    expect(model.calls.find((c) => c.job === "fixChecks")!.prompt).toMatch(/no working check: intro/);
  });
});

describe("proveChecks", () => {
  const files = fixture.files;
  const step = (checks: Check[]): Step => ({ ...learnerSteps[1]!, id: "s", checks });

  it("doesn't call the model when every check is good", async () => {
    const model = fakeModel({});
    const out = await proveChecks([step([{ type: "selectorExists", selector: "h1" }])], files, { ask: model.ask, runCheck: fakeChecker() });
    expect(out[0]!.checks).toHaveLength(1);
    expect(model.calls).toHaveLength(0);
  });

  it("drops a model fix that is bad too, then falls back to an ai check", async () => {
    const model = fakeModel({ fixChecks: [{ steps: [{ id: "s", checks: [{ type: "selectorExists", selector: "still-bad" }] }] }] });
    const runCheck = fakeChecker({ failsOnFinished: ["h1", "still-bad"] });
    const out = await proveChecks([step([{ type: "selectorExists", selector: "h1" }])], files, { ask: model.ask, runCheck });
    expect(out[0]!.checks).toHaveLength(1);
    expect(out[0]!.checks[0]).toMatchObject({ type: "ai", file: "index.html" });
  });

  it("stops the build when a learner step has no check that holds up", async () => {
    const model = fakeModel({ fixChecks: [{ steps: [] }] });
    const runCheck = fakeChecker({ failsOnFinished: ["h1", "ai"] });
    await expect(proveChecks([step([{ type: "selectorExists", selector: "h1" }])], files, { ask: model.ask, runCheck })).rejects.toThrow(/no check Stride can trust/);
  });

  it("survives a fix round that fails outright", async () => {
    const model = fakeModel({}); // every model call throws
    const out = await proveChecks(
      [step([{ type: "selectorExists", selector: "missing" }, { type: "selectorExists", selector: "h1" }])],
      files,
      { ask: model.ask, runCheck: fakeChecker({ failsOnFinished: ["missing"] }) },
    );
    expect(out[0]!.checks).toEqual([{ type: "selectorExists", selector: "h1" }]);
  });
});

describe("model schemas", () => {
  it("sends the 3 hints as a plain list the model can fill", async () => {
    const model = fakeModel({ project: [project], steps: [stepsAnswer] });
    await buildFromIdea(aboutMe, deps({ ask: model.ask }));
    const text = JSON.stringify(model.calls.find((c) => c.job === "steps")!.schema);
    expect(text).not.toContain("prefixItems");
  });
});

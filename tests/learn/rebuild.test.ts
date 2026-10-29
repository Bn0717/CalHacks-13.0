import { describe, expect, it } from "vitest";
import { checkStep } from "../../src/learn/check/index.js";
import type { ProjectFile, Step } from "../../src/learn/lesson.js";
import { rebuildProblems, rebuildSteps, repairSteps } from "../../src/learn/rebuild.js";
import { selfValidateSteps, type CheckRunner } from "../../src/learn/validate.js";

const step = (id: string, file: string, expected: string, anchor?: Step["anchor"]): Step => ({
  id,
  chapter: "c",
  title: id,
  instruction: "i",
  why: "w",
  who: "learner",
  file,
  ...(anchor ? { anchor } : {}),
  expected,
  checks: [{ type: "parses" }],
  hints: ["a", "b", "c"],
});

const page = (body: string): ProjectFile => ({ path: "index.html", content: `<body>\n${body}</body>\n` });

describe("rebuilding a lesson step by step", () => {
  const finished = [page("  <main>\n    <h2>Hobbies</h2>\n    <p>Fun</p>\n  </main>\n  <footer>Me</footer>\n")];

  it("finds a step that leaves a tag open until a later step", () => {
    const steps = [
      step("shell", "index.html", "<body>\n</body>\n"),
      step("hobbies", "index.html", "  <main>\n    <h2>Hobbies</h2>\n", { inside: "body" }),
      step("end", "index.html", "    <p>Fun</p>\n  </main>\n  <footer>Me</footer>\n", { after: "<h2>Hobbies</h2>" }),
    ];
    expect(rebuildSteps(steps, finished).matches).toBe(true);
    expect(rebuildProblems(steps, finished)).toEqual([expect.stringContaining("Step hobbies leaves <main> open")]);
  });

  it("moves the late closing tag into the step that opened it, when the later step stays in one piece", () => {
    const steps = [
      step("shell", "index.html", "<body>\n</body>\n"),
      step("hobbies", "index.html", "  <main>\n    <h2>Hobbies</h2>\n    <p>Fun</p>\n", { inside: "body" }),
      step("end", "index.html", "  </main>\n  <footer>Me</footer>\n", { afterLine: 4 }),
    ];
    const r = repairSteps(steps, finished);
    expect(r.changes).toContain("Step hobbies now closes its <main> (the </main> was in step end).");
    expect(r.steps.find((s) => s.id === "hobbies")!.expected).toBe("  <main>\n    <h2>Hobbies</h2>\n    <p>Fun</p>\n  </main>\n");
    expect(r.steps.find((s) => s.id === "end")!.expected).toBe("  <footer>Me</footer>\n");
    expect(rebuildProblems(r.steps, finished)).toEqual([]);
  });

  it("notes the tag as left open on purpose when moving it would split a later step, and the checker accepts it", async () => {
    const steps = [
      step("shell", "index.html", "<body>\n</body>\n"),
      step("hobbies", "index.html", "  <main>\n    <h2>Hobbies</h2>\n", { inside: "body" }),
      step("end", "index.html", "    <p>Fun</p>\n  </main>\n  <footer>Me</footer>\n", { after: "<h2>Hobbies</h2>" }),
    ];
    const r = repairSteps(steps, finished);
    const hobbies = r.steps.find((s) => s.id === "hobbies")!;
    expect(hobbies.leavesOpen).toEqual(["main"]);
    expect(rebuildProblems(r.steps, finished)).toEqual([]);
    // The student's right answer for that step isn't "still typing" any more.
    const after = rebuildSteps(r.steps, finished).after.get("hobbies")!;
    const withCheck = { ...hobbies, checks: [{ type: "selectorExists" as const, selector: "main h2" }] };
    expect((await checkStep(withCheck, after)).status).toBe("pass");
    expect((await checkStep({ ...withCheck, leavesOpen: undefined }, after)).status).toBe("partial");
  });

  it("works out anchors from the file as the student has it, not from the finished file's line numbers", () => {
    const css = { path: "style.css", content: "h1 {\n  color: red;\n}\n\np {\n  margin: 0;\n  padding: 4px;\n}\n" };
    const steps = [
      step("h1", "style.css", "h1 {\n  color: red;\n}\n", { afterLine: 0 }),
      step("p", "style.css", "p {\n  margin: 0;\n}\n", { afterLine: 4 }),
      // The model counted the blank line in the finished file: afterLine 6 lands after "}" instead of inside p { }.
      step("pad", "style.css", "  padding: 4px;\n", { afterLine: 7 }),
    ];
    expect(rebuildSteps(steps, [css]).matches).toBe(false);
    const r = repairSteps(steps, [css]);
    expect(r.steps.find((s) => s.id === "pad")!.anchor).toEqual({ after: "margin: 0;" });
    expect(r.steps.find((s) => s.id === "h1")!.anchor).toEqual({ afterLine: 0 }); // already right: kept
    expect(rebuildSteps(r.steps, [css]).matches).toBe(true);
  });

  it("leaves a file alone when a step's code isn't in the finished file", () => {
    const steps = [step("x", "index.html", "<p>Not there</p>\n", { afterLine: 3 })];
    const r = repairSteps(steps, finished);
    expect(r.steps).toEqual(steps);
    expect(r.changes[0]).toMatch(/isn't in the finished file/);
  });
});

describe("proving checks on the in-between files", () => {
  // A check passes when its selector text appears in the files.
  const run: CheckRunner = async (c, _s, files) => "selector" in c && files.some((f) => f.content.includes(c.selector));
  const finished = [page("  <h1>Hi</h1>\n  <p>Text</p>\n")];
  const steps = [
    step("shell", "index.html", "<body>\n</body>\n"),
    { ...step("h1", "index.html", "  <h1>Hi</h1>\n", { inside: "body" }), checks: [{ type: "selectorExists" as const, selector: "<p>" }, { type: "selectorExists" as const, selector: "<h1>" }] },
    { ...step("p", "index.html", "  <p>Text</p>\n", { after: "</h1>" }), checks: [{ type: "selectorExists" as const, selector: "<h1>" }, { type: "selectorExists" as const, selector: "<p>" }] },
  ].map((s, i) => (i === 0 ? { ...s, checks: [{ type: "selectorExists" as const, selector: "<body>" }] } : s));

  it("drops a check that only passes once a later step is done, and a first check that passes before its step", async () => {
    const r = await selfValidateSteps(steps, finished, run);
    expect(r.steps.find((s) => s.id === "h1")!.checks).toEqual([{ type: "selectorExists", selector: "<h1>" }]);
    expect(r.steps.find((s) => s.id === "p")!.checks).toEqual([{ type: "selectorExists", selector: "<p>" }]);
    expect(r.problems.map((p) => `${p.stepId}:${p.reason}`)).toEqual(["h1:failsRightAfter", "p:passesBefore"]);
  });

  it("can check just some steps while still using the others to work out the files", async () => {
    const r = await selfValidateSteps(steps, finished, run, new Set(["p"]));
    expect(r.steps.map((s) => s.id)).toEqual(["p"]);
    expect(r.problems.map((p) => p.reason)).toEqual(["passesBefore"]);
  });
});

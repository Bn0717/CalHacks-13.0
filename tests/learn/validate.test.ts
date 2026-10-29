import { describe, expect, it } from "vitest";
import type { Check, ProjectFile, Step } from "../../src/learn/lesson.js";
import { describeProblems, selfValidateSteps, type CheckRunner } from "../../src/learn/validate.js";

const finished: ProjectFile[] = [{ path: "index.html", content: "<h1>Hi</h1>" }];

function step(id: string, checks: Check[], who: Step["who"] = "learner"): Step {
  return { id, chapter: "c", title: "t", instruction: "i", why: "w", who, expected: "", checks, hints: ["a", "b", "c"] };
}

// A fake checker: a check passes on the finished project unless it asks for "missing"; on an empty project only
// fileExists for "always" passes.
const fake: CheckRunner = async (check, _step, files) => {
  if (files.length === 0) return check.type === "selectorExists" && check.selector === "always";
  return !(check.type === "selectorExists" && check.selector === "missing");
};

describe("selfValidateSteps", () => {
  it("keeps good checks", async () => {
    const r = await selfValidateSteps([step("a", [{ type: "selectorExists", selector: "h1" }])], finished, fake);
    expect(r.steps[0]!.checks).toHaveLength(1);
    expect(r.problems).toEqual([]);
    expect(r.needsFix).toEqual([]);
  });

  it("drops checks that fail on the finished project", async () => {
    const r = await selfValidateSteps(
      [step("a", [{ type: "selectorExists", selector: "missing" }, { type: "selectorExists", selector: "h1" }])],
      finished,
      fake,
    );
    expect(r.steps[0]!.checks).toEqual([{ type: "selectorExists", selector: "h1" }]);
    expect(r.problems[0]!.reason).toBe("failsOnFinished");
  });

  it("drops a first check that already passes on an empty project", async () => {
    const r = await selfValidateSteps(
      [step("a", [{ type: "selectorExists", selector: "always" }, { type: "selectorExists", selector: "h1" }])],
      finished,
      fake,
    );
    expect(r.steps[0]!.checks).toEqual([{ type: "selectorExists", selector: "h1" }]);
    expect(r.problems[0]!.reason).toBe("passesOnEmpty");
  });

  it("flags learner steps left with no checks, but not watch steps", async () => {
    const r = await selfValidateSteps(
      [step("a", [{ type: "selectorExists", selector: "missing" }]), step("b", [], "watch")],
      finished,
      fake,
    );
    expect(r.needsFix).toEqual(["a"]);
    expect(describeProblems(r.problems)).toContain("Step a");
  });
});

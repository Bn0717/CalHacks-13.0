import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectEvidence, enforce, openProblems, rulesReceipt, type ReviewAnswer } from "../src/core/receipt.js";
import { runSequence } from "../src/core/sequence.js";
import { recheckPlannedStep, runPlannedStep } from "../src/core/runner.js";
import { runSandboxed } from "../src/core/exec.js";
import { diagnose, verifyFix } from "../src/core/fixes/diagnose.js";
import type { FixGuide } from "../src/core/fixes/types.js";
import { completedStep, goalStatus, optionState, summarizeGoal, verifiedStep, verifyGoal, verifyInstalledApp } from "../src/core/verification.js";
import { detailLines, helpSummary, stepLines } from "../src/app/view.js";
import type { Evidence, GoalVerification, PlannedStep, StepResult, StepStatus } from "../src/core/types.js";

vi.mock("../src/core/exec.js", () => ({ runSandboxed: vi.fn(), runNormally: vi.fn(), runAsAdmin: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const check = (outcome: Evidence["outcome"] = "passed", command = "test -e /tmp/target"): Evidence => ({ kind: "after", command, code: outcome === "failed" ? 1 : 0, output: "", outcome });
const goal = (outcome: Evidence["outcome"] = "passed") => summarizeGoal([{ ...check(outcome), kind: "final" }]);
const planned = (id = "1", option?: number): PlannedStep => ({
  step: { id, title: `Step ${id}`, explanation: "", kind: "command", command: "mkdir /tmp/target", ...(option === undefined ? {} : { alternativeGroup: "A", alternativeOption: option }) },
  assessment: { level: "ask", findings: [], readOnly: false }, level: "ask", reasons: [], inSource: true, checkUsable: false, needsReview: false, flags: [],
});
const result = (id = "1", status: StepStatus = "done", evidence: Evidence[] = [check()]): StepResult => ({ id, status, message: status, evidence, actionCompleted: ["done", "done-unverified"].includes(status) });
const optimistic = (refs: string[]): ReviewAnswer => ({ verdict: "done", headline: "Done!", proofs: [{ claim: "The goal is true", evidence_refs: refs }], problems: [] });
function receipt(steps: PlannedStep[], results: Map<string, StepResult>, verification: GoalVerification) {
  return rulesReceipt(steps, results, collectEvidence(steps, results, verification), verification);
}

describe("goal verification", () => {
  it.each([undefined, "", "   "])("does not invent a missing final check (%s)", async (command) => {
    const run = vi.fn();
    expect((await verifyGoal(command, run)).status).toBe("unknown");
    expect(run).not.toHaveBeenCalled();
  });
  it("does not execute unsafe final checks", async () => {
    const run = vi.fn();
    expect((await verifyGoal("touch /tmp/target", run)).status).toBe("unknown");
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    [{ code: 0, output: "yes", timedOut: false }, "passed"],
    [{ code: 1, output: "no", timedOut: false }, "failed"],
    [{ code: 0, output: "partial", timedOut: true }, "unknown"],
    [{ code: 127, output: "not found", timedOut: false }, "unknown"],
  ] as const)("records real execution %j as %s", async (execution, status) => {
    const verification = await verifyGoal("test -e /tmp/target", vi.fn().mockResolvedValue(execution));
    expect(verification.status).toBe(status);
    expect(verification.checks[0].code).toBe(execution.code);
    expect(verification.checks[0].output).toContain(execution.output);
  });
  it("captures exceptions as unknown", async () => {
    const verification = await verifyGoal("test -e /tmp/target", vi.fn().mockRejectedValue(new Error("unavailable")));
    expect(verification.status).toBe("unknown");
    expect(verification.reason).toContain("unavailable");
  });
  it("collects new final evidence on every attempt rather than reusing a previous pass", async () => {
    const run = vi.fn().mockResolvedValueOnce({ code: 0, output: "yes", timedOut: false }).mockResolvedValueOnce({ code: 0, output: "partial", timedOut: true });
    const first = await verifyGoal("test -e /tmp/target", run);
    const second = await verifyGoal("test -e /tmp/target", run);
    expect(first.status).toBe("passed");
    expect(second.status).toBe("unknown");
    expect(second.checks).toHaveLength(1);
    expect(second.checks[0].outcome).toBe("unknown");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("rejects empty or partly unknown contracts even when a caller says passed", () => {
    expect(goalStatus({ status: "passed", checks: [] })).toBe("unknown");
    expect(goalStatus({ status: "passed", checks: [check(), check("unknown", "test -e /tmp/other")] })).toBe("unknown");
    expect(goalStatus({ status: "unknown", checks: [check("failed")] })).toBe("failed");
  });
  it("requires app presence and a process in the installed bundle", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, output: "1", timedOut: false });
    expect((await verifyInstalledApp("/Applications/zoom.us.app", run)).status).toBe("passed");
    expect(run.mock.calls.map(([c]) => c)).toEqual(["test -d '/Applications/zoom.us.app'", "pgrep -f '^/Applications/zoom\\.us\\.app/Contents/MacOS/'"]);
    run.mockImplementation(async (c: string) => ({ code: c.startsWith("pgrep") ? 1 : 0, output: "", timedOut: false }));
    expect((await verifyInstalledApp("/Applications/zoom.us.app", run)).status).toBe("failed");
  });
});

describe("receipt success policy", () => {
  const steps = [planned()];
  it("accepts goal proof while preserving uncertainty of an intermediate action", () => {
    const results = new Map([["1", result("1", "done-unverified", [{ ...check(), kind: "run", outcome: undefined }])]]);
    const r = receipt(steps, results, goal());
    expect(r.verdict).toBe("done");
    expect(r.proofs).toHaveLength(1);
    expect(r.problems.join(" ")).toContain("outcome was not verified");
    expect(stepLines(steps, results)[0]).toMatchObject({ status: "unverified", note: "Ran, not verified" });
  });
  it("step checks alone cannot prove the goal", () => {
    const results = new Map([["1", result()]]);
    expect(receipt(steps, results, summarizeGoal([])).verdict).toBe("couldnt-verify");
  });
  it("post-action checks supersede the old state even when the predicate changes", () => {
    const r = result("1", "done", [{ ...check("failed", "lpstat -p"), kind: "before" }, check("passed", "lpstat -p Office")]);
    expect(verifiedStep(r)).toBe(true);
    const results = new Map([["1", r]]);
    const verification = goal();
    const evidence = collectEvidence(steps, results, verification);
    const review = enforce(optimistic(["E1", "E2", "E3"]), steps, results, evidence, verification);
    expect(review.verdict).toBe("done");
    expect(review.proofs[0].evidence.map((e) => e.ref)).toEqual(["E2", "E3"]);
  });
  it("an explicit failed outcome beats a stale success status", () => {
    const results = new Map([["1", result("1", "done", [check(), check("failed")])]]);
    expect(receipt(steps, results, goal()).verdict).toBe("not-done");
  });
  it.each(["failed", "blocked", "declined", "waiting-for-user", "not-for-this-computer", "skipped"] as StepStatus[])("does not let final proof hide required %s work", (status) => {
    expect(receipt(steps, new Map([["1", result("1", status, [])]]), goal()).verdict).toBe("not-done");
  });
  it("distinguishes obsolete skips from missing required work", () => {
    expect(receipt(steps, new Map(), goal()).verdict).toBe("not-done");
    expect(receipt(steps, new Map([["1", { ...result("1", "skipped", []), skipReason: "obsolete" }]]), goal()).verdict).toBe("done");
  });
  it("a final failure beats successful steps", () => {
    expect(receipt(steps, new Map([["1", result()]]), goal("failed")).verdict).toBe("not-done");
  });
  it("rejects run-only, missing, unknown, and superseded evidence", () => {
    const observations: Evidence[] = [{ kind: "run", command: "mkdir /tmp/target", code: 0, output: "" }, check(undefined, "legacy"), check("unknown", "unknown"), check(), check("failed")];
    // Explicitly represent legacy evidence without an outcome.
    delete observations[1].outcome;
    const results = new Map([["1", result("1", "done-unverified", observations)]]);
    const verification = summarizeGoal([]);
    const evidence = collectEvidence(steps, results, verification);
    const r = enforce(optimistic(["E1", "E2", "E3", "E4", "E5", "E99"]), steps, results, evidence, verification);
    expect(r.proofs).toEqual([]);
    expect(r.verdict).toBe("not-done");
  });
  it("keeps current step proof but requires citations for every final goal check", () => {
    const results = new Map([["1", result()]]);
    const verification = summarizeGoal([{ ...check(), kind: "final" }, { ...check("passed", "test -e /tmp/second"), kind: "final" }]);
    const evidence = collectEvidence(steps, results, verification);
    expect(enforce(optimistic(["E1"]), steps, results, evidence, verification).verdict).toBe("couldnt-verify");
    expect(enforce(optimistic(["E2"]), steps, results, evidence, verification).verdict).toBe("couldnt-verify");
    expect(enforce(optimistic(["e2", "e3"]), steps, results, evidence, verification).verdict).toBe("done");
  });
  it("never improves a stricter reviewer verdict", () => {
    const results = new Map([["1", result()]]);
    const verification = goal();
    const evidence = collectEvidence(steps, results, verification);
    expect(enforce({ ...optimistic(["E2"]), verdict: "not-done" }, steps, results, evidence, verification).verdict).toBe("not-done");
  });
});

describe("whole alternative options", () => {
  const steps = [planned("1", 1), planned("2", 1), planned("3", 2), planned("4")];
  it("cannot hide a late option failure behind an earlier success", () => {
    const results = new Map([["1", result("1")], ["2", result("2", "failed")], ["3", result("3", "failed")], ["4", result("4")]]);
    expect(optionState(steps.slice(0, 2), results)).toBe("failed");
    expect(receipt(steps, results, goal()).verdict).toBe("not-done");
    expect(openProblems(steps, results, goal()).join(" ")).toContain("Step 2");
  });
  it("resolves failures only with a whole verified replacement or complete option plus goal proof", () => {
    const results = new Map([["1", result("1")], ["2", result("2", "failed")], ["3", result("3", "done-unverified", [])], ["4", result("4")]]);
    expect(receipt(steps, results, goal()).verdict).toBe("done");
    expect(receipt(steps, results, summarizeGoal([])).verdict).toBe("not-done");
    results.set("3", result("3"));
    expect(openProblems(steps, results, summarizeGoal([]))).toEqual([]);
    expect(receipt(steps, results, summarizeGoal([])).verdict).toBe("couldnt-verify");
  });
  it("holds siblings after an unverified option and continues common work", async () => {
    const results = new Map<string, StepResult>();
    const runOne = vi.fn(async (p: PlannedStep) => result(p.step.id, p.step.id === "2" ? "done-unverified" : "done", p.step.id === "2" ? [] : [check()]));
    const hooks = { runOne, onResult: vi.fn(), stopped: () => false };
    await runSequence(steps, results, hooks);
    expect(runOne.mock.calls.map(([p]) => p.step.id)).toEqual(["1", "2", "4"]);
    expect(results.get("3")?.skipReason).toBe("awaiting-verification");
    expect(receipt(steps, results, summarizeGoal([])).verdict).toBe("couldnt-verify");
    runOne.mockClear();
    await runSequence(steps, results, hooks);
    expect(runOne).not.toHaveBeenCalled();
    expect(results.get("3")?.skipReason).toBe("awaiting-verification");
  });
  it("retry refreshes checks before selecting an option without repeating actions", async () => {
    const results = new Map([["1", result("1")], ["2", result("2", "done-unverified", [])], ["4", result("4")]]);
    const runOne = vi.fn();
    const recheck = vi.fn(async (_p: PlannedStep, r: StepResult) => ({ ...r, status: "done" as const, evidence: [check()] }));
    await runSequence(steps, results, { runOne, recheck, onResult: () => {}, stopped: () => false });
    expect(recheck).toHaveBeenCalledTimes(3);
    expect(runOne).not.toHaveBeenCalled();
    expect(results.get("3")?.skipReason).toBe("alternative-verified");
  });
  it("ignores informational steps when verifying an option", () => {
    const info = planned("info", 1);
    info.step.kind = "info";
    expect(optionState([steps[0], info], new Map([["1", result()]]))).toBe("verified");
  });
  it("does not advance past an installer still waiting for the user", async () => {
    const results = new Map<string, StepResult>();
    const runOne = vi.fn(async (p: PlannedStep) => result(p.step.id, "waiting-for-user", []));
    await runSequence(steps, results, { runOne, onResult: () => {}, stopped: () => false });
    expect(runOne).toHaveBeenCalledOnce();
    expect(receipt(steps, results, goal()).verdict).toBe("not-done");
  });
  it("allows a previously skipped manual step to be tried on explicit retry", async () => {
    const p = planned();
    const results = new Map<string, StepResult>([["1", { ...result("1", "skipped", []), skipReason: "user" }]]);
    const runOne = vi.fn(async () => result());
    await runSequence([p], results, { runOne, onResult: () => {}, stopped: () => false });
    expect(runOne).toHaveBeenCalledOnce();
    expect(results.get("1")?.status).toBe("done");
  });
});

describe("retry and presentation", () => {
  it("refreshes an executed action with read-only checks only", async () => {
    const p = planned();
    p.checkUsable = true;
    p.step.checkCommand = "test -e /tmp/target";
    vi.mocked(runSandboxed).mockResolvedValue({ code: 0, output: "", timedOut: false });
    const r = await recheckPlannedStep(p, result("1", "done-unverified", []));
    expect(r.status).toBe("done");
    expect(verifiedStep(r)).toBe(true);
    expect(runSandboxed).toHaveBeenCalledExactlyOnceWith("test -e /tmp/target", 30_000);
  });
  it("does not rerun an executed action when its check still fails", async () => {
    const p = planned();
    p.checkUsable = true;
    p.step.checkCommand = "test -e /tmp/target";
    vi.mocked(runSandboxed).mockResolvedValue({ code: 1, output: "", timedOut: false });
    const results = new Map([["1", result("1", "failed")]]);
    results.get("1")!.actionCompleted = true;
    const runOne = vi.fn();
    await runSequence([p], results, { runOne, recheck: recheckPlannedStep, onResult: () => {}, stopped: () => false });
    expect(runOne).not.toHaveBeenCalled();
    expect(results.get("1")?.status).toBe("failed");
  });
  it("returns an unverified action when a post-check times out, preserving code zero", async () => {
    const p = planned();
    p.step.checkCommand = "test -e /tmp/target";
    p.checkUsable = true;
    vi.mocked(runSandboxed).mockResolvedValueOnce({ code: 1, output: "", timedOut: false }).mockResolvedValueOnce({ code: 0, output: "", timedOut: true });
    const execute = vi.fn().mockResolvedValue({ code: 0, output: "", timedOut: false });
    const r = await runPlannedStep(p, { approve: async () => true, waitForUser: async () => "done" }, { execute });
    expect(r).toMatchObject({ status: "done-unverified", actionCompleted: true });
    expect(r.evidence?.at(-1)).toMatchObject({ code: 0, outcome: "unknown" });
    expect(execute).toHaveBeenCalledOnce();
  });
  it("does not present legacy done results without evidence as verified", () => {
    const results = new Map([["1", result("1", "done", [])]]);
    expect(stepLines([planned()], results)[0].status).toBe("unverified");
    expect(completedStep(results.get("1"))).toBe(true);
    expect(verifiedStep(results.get("1"))).toBe(false);
  });
  it("distinguishes execution from outcome checks and retains limitations in summaries", () => {
    const results = new Map([["1", result("1", "done-unverified", [{ ...check(), kind: "run", outcome: undefined }, check("unknown")])]]);
    const r = receipt([planned()], results, summarizeGoal([], "No final check"));
    const details = detailLines([planned()], results, false).map((l) => l.text).join(" ");
    expect(details).toContain("Command exited successfully");
    expect(details).toContain("Outcome not verified");
    expect(helpSummary("goal", undefined, [planned()], results, r)).toContain("No final check");
  });
});

describe("interpreted fix checks", () => {
  function guide(status: "ok" | "problem" | "unknown"): FixGuide {
    return { id: "sound", title: "Sound", goal: "Sound works", describe: "", examples: [], fixes: [], status: () => [], problemSentence: () => null,
      checks: [{ id: "one", label: "Sound", command: "test -e /tmp/target", interpret: () => ({ status, detail: status }) }] };
  }
  it("does not turn unknown or empty checks into a verified fix", async () => {
    for (const g of [guide("unknown"), { ...guide("ok"), checks: [] }]) {
      const run = vi.fn().mockResolvedValue({ code: 0, output: "", timedOut: false });
      const before = await diagnose(g, run);
      const v = await verifyFix(g, run, before);
      expect(v.fixed).toBe(false);
      expect(v.goal.status).toBe("unknown");
    }
  });
  it("retains raw code zero when interpretation detects a problem", async () => {
    const g = guide("problem");
    const run = vi.fn().mockResolvedValue({ code: 0, output: "bad state" });
    const v = await verifyFix(g, run, await diagnose(g, run));
    expect(v.goal).toMatchObject({ status: "failed", checks: [{ code: 0, outcome: "failed" }] });
  });
  it("does not let a timeout or throwing interpreter pass", async () => {
    const g = guide("ok");
    const run = vi.fn().mockResolvedValue({ code: 0, output: "", timedOut: true });
    expect((await diagnose(g, run)).results[0].status).toBe("unknown");
    g.checks[0].interpret = () => { throw new Error("parse"); };
    run.mockResolvedValue({ code: 0, output: "", timedOut: false });
    expect((await diagnose(g, run)).evidence[0].outcome).toBe("unknown");
  });
  it("runs a shared command once and preserves distinct interpreted predicates", async () => {
    const g = guide("ok");
    g.checks.push({ ...g.checks[0], id: "two", interpret: () => ({ status: "unknown", detail: "missing" }) });
    const run = vi.fn().mockResolvedValue({ code: 0, output: "" });
    const d = await diagnose(g, run);
    expect(run).toHaveBeenCalledOnce();
    expect(d.evidence.map((e) => [e.checkId, e.outcome])).toEqual([["one", "passed"], ["two", "unknown"]]);
    expect((await verifyFix(g, run, d)).goal.status).toBe("unknown");
  });
});

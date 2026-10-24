import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectEvidence, type ReviewAnswer } from "../src/core/receipt.js";
import { summarizeGoal } from "../src/core/verification.js";
import { reviewRun } from "../src/ai/review.js";
import type { PlannedStep, StepResult } from "../src/core/types.js";

const mocks = vi.hoisted(() => ({ parse: vi.fn(), hasKey: vi.fn(), readCache: vi.fn(), writeCache: vi.fn() }));
vi.mock("../src/ai/client.js", () => ({ MODEL: () => "test", hasApiKey: mocks.hasKey, getClient: () => ({ beta: { messages: { parse: mocks.parse } } }) }));
vi.mock("../src/ai/cache.js", () => ({ cacheKey: () => "review-test", readCache: mocks.readCache, writeCache: mocks.writeCache }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.hasKey.mockReturnValue(true);
});

const step: PlannedStep = { step: { id: "1", title: "Make target", explanation: "", kind: "command", command: "mkdir /tmp/target" },
  assessment: { level: "ask", findings: [], readOnly: false }, level: "ask", reasons: [], flags: [], inSource: true, checkUsable: false, needsReview: false };
const results = new Map<string, StepResult>([["1", { id: "1", status: "done-unverified", message: "Ran", evidence: [{ kind: "run", command: "mkdir /tmp/target", code: 0, output: "" }] }]]);
const answer = (refs = ["E1"]): ReviewAnswer => ({ verdict: "done", headline: "Done!", proofs: [{ claim: "Target exists", evidence_refs: refs }], problems: [] });

describe("review paths share deterministic verification", () => {
  it("falls back to rules when a cached review has an invalid shape", async () => {
    mocks.parse.mockRejectedValue(new Error("offline"));
    mocks.readCache.mockReturnValue({ ...answer(), proofs: null });
    const verification = summarizeGoal([], "No final check");
    const r = await reviewRun({ goal: "Create target", steps: [step], results, verification, evidence: collectEvidence([step], results, verification) });
    expect(r).toMatchObject({ verdict: "couldnt-verify", reviewedBy: "rules", proofs: [] });
  });
  it.each(["live", "cached", "offline", "malformed"])("%s cannot promote successful execution without a final check", async (path) => {
    mocks.parse.mockResolvedValue({ parsed_output: path === "malformed" ? null : answer() });
    if (path === "cached") {
      mocks.parse.mockRejectedValue(new Error("offline"));
      mocks.readCache.mockReturnValue(answer());
    }
    if (path === "offline") mocks.hasKey.mockReturnValue(false);
    const verification = summarizeGoal([], "No final check");
    const r = await reviewRun({ goal: "Create target", steps: [step], results, verification, evidence: collectEvidence([step], results, verification) });
    expect(r.verdict).toBe("couldnt-verify");
    expect(r.proofs).toEqual([]);
    expect(r.headline).not.toBe("Done!");
    expect(r.problems).toContain("No final check");
  });
  it.each(["live", "cached", "offline"])("%s accepts final goal evidence", async (path) => {
    mocks.parse.mockResolvedValue({ parsed_output: answer(["E2"]) });
    if (path === "cached") {
      mocks.parse.mockRejectedValue(new Error("offline"));
      mocks.readCache.mockReturnValue(answer(["E2"]));
    }
    if (path === "offline") mocks.hasKey.mockReturnValue(false);
    const verification = summarizeGoal([{ kind: "final", command: "test -d /tmp/target", code: 0, output: "", outcome: "passed" }]);
    const r = await reviewRun({ goal: "Create target", steps: [step], results, verification, evidence: collectEvidence([step], results, verification) });
    expect(r.verdict).toBe("done");
    expect(r.proofs[0].evidence[0].kind).toBe("final");
  });
});

// The deterministic evidence rules constrain both live/cached reviews and offline receipts.
import type { Evidence, GoalVerification, PlannedStep, StepResult } from "./types.js";
import { completedStep, currentStepChecks, failedStep, goalStatus, latestChecks, optionsIn, optionState, verifiedStep } from "./verification.js";

export type Verdict = "done" | "not-done" | "couldnt-verify";
export interface NumberedEvidence extends Evidence { ref: string; stepId: string | null; stepTitle: string }
export interface Proof { claim: string; evidence: NumberedEvidence[] }
export interface Receipt { verdict: Verdict; headline: string; proofs: Proof[]; problems: string[]; reviewedBy: "claude" | "rules" }
export interface ReviewAnswer { verdict: Verdict; headline: string; proofs: { claim: string; evidence_refs: string[] }[]; problems: string[] }
const RANK: Record<Verdict, number> = { done: 0, "couldnt-verify": 1, "not-done": 2 };

export function collectEvidence(steps: PlannedStep[], results: Map<string, StepResult>, goal: GoalVerification): NumberedEvidence[] {
  const list: NumberedEvidence[] = [];
  for (const p of steps) for (const e of results.get(p.step.id)?.evidence ?? []) list.push({ ...e, ref: "", stepId: p.step.id, stepTitle: p.step.title });
  for (const e of goal.checks) list.push({ ...e, kind: "final", ref: "", stepId: null, stepTitle: "Final goal check" });
  return list.map((e, i) => ({ ...e, ref: `E${i + 1}` }));
}

/** A whole verified option, or a complete option plus goal proof, resolves its group. */
export function openProblems(steps: PlannedStep[], results: Map<string, StepResult>, goal: GoalVerification): string[] {
  const out: string[] = [];
  const groups = new Set<string>();
  for (const p of steps) {
    if (p.step.kind === "info") continue;
    const group = p.step.alternativeGroup;
    if (group) {
      if (groups.has(group)) continue;
      groups.add(group);
      const options = optionsIn(steps, group);
      const states = options.map((o) => optionState(o, results));
      if (states.includes("verified") || states.includes("complete") && goalStatus(goal) === "passed") continue;
      for (const o of options) for (const x of o) {
        if (x.step.kind === "info") continue;
        const r = results.get(x.step.id);
        if (failedStep(r)) out.push(`Step ${x.step.id} (${x.step.title}): ${r!.message}`);
      }
      if (!states.includes("complete")) out.push(`Alternative group ${group}: no complete option; required work remains unfinished.`);
      continue;
    }
    const r = results.get(p.step.id);
    if (!completedStep(r)) out.push(`Step ${p.step.id} (${p.step.title}): ${r?.message || "Required work was not run."}`);
  }
  return out;
}

function evaluate(steps: PlannedStep[], results: Map<string, StepResult>, goal: GoalVerification): { verdict: Verdict; problems: string[] } {
  const hard = openProblems(steps, results, goal);
  const status = goalStatus(goal);
  const problems = [...hard];
  if (status === "failed") problems.push("The final goal check failed.");
  if (status !== "passed") problems.push(goal.reason || (status === "failed" ? "The final goal check failed." : "The final goal could not be verified."));
  for (const p of steps) {
    const r = results.get(p.step.id);
    if (p.step.kind !== "info" && completedStep(r) && r?.skipReason !== "obsolete" && !verifiedStep(r)) problems.push(`Step ${p.step.id} (${p.step.title}): ran, but its outcome was not verified.`);
  }
  if (status !== "passed") for (const group of new Set(steps.map((p) => p.step.alternativeGroup).filter((g): g is string => !!g))) {
    const states = optionsIn(steps, group).map((o) => optionState(o, results));
    if (!states.includes("verified") && states.includes("complete")) problems.push(`Alternative group ${group}: an option ran, but it still needs verification. Further alternatives were held.`);
  }
  return { verdict: hard.length || status === "failed" ? "not-done" : status === "passed" ? "done" : "couldnt-verify", problems };
}

function sameCheck(a: Evidence, b: Evidence): boolean {
  return a.command === b.command && a.code === b.code && a.output === b.output && a.outcome === b.outcome && a.checkId === b.checkId;
}

/** Only recorded, current, explicitly passing outcome checks may support claims. */
function proofEvidence(steps: PlannedStep[], results: Map<string, StepResult>, evidence: NumberedEvidence[], goal: GoalVerification): NumberedEvidence[] {
  return evidence.filter((e) => {
    if (e.kind === "run" || e.outcome !== "passed") return false;
    const scope = evidence.filter((x) => x.stepId === e.stepId && (x.kind === "final") === (e.kind === "final"));
    if (!(e.stepId === null ? latestChecks(scope) : currentStepChecks(scope)).includes(e)) return false;
    if (e.stepId === null) return e.kind === "final" && latestChecks(goal.checks).some((x) => sameCheck(x, e));
    const r = results.get(e.stepId);
    return e.kind !== "final" && steps.some((p) => p.step.id === e.stepId) && verifiedStep(r) && currentStepChecks(r?.evidence ?? []).some((x) => x.kind === e.kind && sameCheck(x, e));
  });
}

function defaultHeadline(v: Verdict): string {
  return v === "done" ? "Done, and the final checks prove it." : v === "not-done" ? "Not done. Required work is unfinished or a goal check failed." : "The steps ran, but I couldn't verify it worked.";
}

export function enforce(answer: ReviewAnswer, steps: PlannedStep[], results: Map<string, StepResult>, evidence: NumberedEvidence[], goal: GoalVerification): Receipt {
  const eligible = proofEvidence(steps, results, evidence, goal);
  const byRef = new Map(eligible.map((e) => [e.ref, e]));
  const proofs = answer.proofs.map((p) => ({ claim: p.claim.trim(), evidence: [...new Set(p.evidence_refs.map((r) => byRef.get(r.trim().toUpperCase())).filter((e): e is NumberedEvidence => !!e))] })).filter((p) => p.claim && p.evidence.length);
  const cap = evaluate(steps, results, goal);
  let verdict = RANK[answer.verdict] >= RANK[cap.verdict] ? answer.verdict : cap.verdict;
  const finals = eligible.filter((e) => e.stepId === null && e.kind === "final");
  const cited = new Set(proofs.flatMap((p) => p.evidence));
  const missingGoalProof = !finals.length || !finals.every((e) => cited.has(e)) || finals.length !== latestChecks(goal.checks).length;
  if (verdict === "done" && missingGoalProof) verdict = "couldnt-verify";
  const problems = [...new Set([...cap.problems, ...(verdict === "couldnt-verify" && missingGoalProof ? ["The review did not cite all final goal checks as proof."] : []), ...answer.problems.map((p) => p.trim()).filter(Boolean)])];
  const misleadingHeadline = verdict !== "done" && /^(done|fixed|all done|success)\b/i.test(answer.headline.trim());
  return { verdict, headline: verdict !== answer.verdict || !answer.headline.trim() || misleadingHeadline ? defaultHeadline(verdict) : answer.headline.trim(), proofs, problems, reviewedBy: "claude" };
}

export function rulesReceipt(steps: PlannedStep[], results: Map<string, StepResult>, evidence: NumberedEvidence[], goal: GoalVerification, goalMessage?: string): Receipt {
  const eligible = proofEvidence(steps, results, evidence, goal);
  const finals = eligible.filter((e) => e.kind === "final" && e.stepId === null);
  const proofs: Proof[] = [];
  if (finals.length) proofs.push({ claim: goalStatus(goal) === "passed" ? goalMessage || "The final goal checks passed" : "These final checks passed; the whole goal remains unverified", evidence: finals });
  for (const p of steps) {
    const checks = eligible.filter((e) => e.stepId === p.step.id);
    if (checks.length) proofs.push({ claim: `${p.step.title}: verified`, evidence: checks });
  }
  const cap = evaluate(steps, results, goal);
  let verdict = cap.verdict;
  if (verdict === "done" && (!finals.length || finals.length !== latestChecks(goal.checks).length)) verdict = "couldnt-verify";
  const headline = verdict === "done" && goalMessage ? `Done. ${goalMessage.replace(/^./, (c) => c.toUpperCase())}.`.replace(/\.\.$/, ".") : defaultHeadline(verdict);
  return { verdict, headline, proofs, problems: cap.problems, reviewedBy: "rules" };
}

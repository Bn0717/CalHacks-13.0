// The receipt at the end: "Done, here's the proof" or "Here's exactly what failed".
// A separate Claude call writes it (src/ai/review.ts), but these rules have the last word:
// - Every proof must point at a check that really ran and passed. Anything else is dropped.
// - "Done" with no valid proof becomes "Couldn't verify".
// - The reviewer can make the verdict stricter, never better than what the checks show.
import type { Evidence, PlannedStep, StepResult, StepStatus } from "./types.js";

export type Verdict = "done" | "not-done" | "couldnt-verify";

/** One numbered piece of evidence the reviewer can point at, e.g. E3. */
export interface NumberedEvidence extends Evidence {
  ref: string;
  stepId: string | null;
  stepTitle: string;
}

export interface Proof {
  claim: string;
  evidence: NumberedEvidence[];
}

export interface Receipt {
  verdict: Verdict;
  /** One plain line, e.g. "Done. Zoom is installed and opens." */
  headline: string;
  proofs: Proof[];
  problems: string[];
  reviewedBy: "claude" | "rules";
}

/** What the reviewer answers, before our rules check it. */
export interface ReviewAnswer {
  verdict: Verdict;
  headline: string;
  proofs: { claim: string; evidence_refs: string[] }[];
  problems: string[];
}

const BAD: StepStatus[] = ["failed", "blocked", "declined"];
const GOOD: StepStatus[] = ["done", "done-unverified", "already-done"];
const RANK: Record<Verdict, number> = { done: 0, "couldnt-verify": 1, "not-done": 2 };

export function collectEvidence(steps: PlannedStep[], results: Map<string, StepResult>, final?: Evidence | null): NumberedEvidence[] {
  const list: NumberedEvidence[] = [];
  for (const p of steps) {
    for (const e of results.get(p.step.id)?.evidence ?? []) list.push({ ...e, ref: "", stepId: p.step.id, stepTitle: p.step.title });
  }
  if (final) list.push({ ...final, ref: "", stepId: null, stepTitle: "Final check" });
  return list.map((e, i) => ({ ...e, ref: "E" + (i + 1) }));
}

/** Problems that still stand: a failed step, unless a different option in its group worked. */
export function openProblems(steps: PlannedStep[], results: Map<string, StepResult>): string[] {
  const groupWorked = (g: string) => steps.some((p) => p.step.alternativeGroup === g && GOOD.includes(results.get(p.step.id)?.status as StepStatus));
  const out: string[] = [];
  for (const p of steps) {
    const r = results.get(p.step.id);
    if (!r || !BAD.includes(r.status)) continue;
    if (p.step.alternativeGroup && groupWorked(p.step.alternativeGroup)) continue;
    out.push(`Step ${p.step.id} (${p.step.title}): ${r.message}`);
  }
  return out;
}

/** The best verdict the checks allow. */
function ceiling(steps: PlannedStep[], results: Map<string, StepResult>, evidence: NumberedEvidence[]): Verdict {
  if (openProblems(steps, results).length) return "not-done";
  const final = evidence.find((e) => e.kind === "final");
  if (final && final.code !== 0) return "not-done";
  const unfinished = steps.some((p) => p.step.kind !== "info" && !results.get(p.step.id));
  if (unfinished) return "not-done";
  return "done";
}

const passed = (e: NumberedEvidence) => e.code === 0 && (e.kind === "after" || e.kind === "before" || e.kind === "final" || e.kind === "run");

/** Applies our rules to the reviewer's answer. */
export function enforce(answer: ReviewAnswer, steps: PlannedStep[], results: Map<string, StepResult>, evidence: NumberedEvidence[]): Receipt {
  const byRef = new Map(evidence.map((e) => [e.ref, e]));
  const proofs: Proof[] = answer.proofs
    .map((p) => ({ claim: p.claim.trim(), evidence: p.evidence_refs.map((r) => byRef.get(r.trim().toUpperCase())).filter((e): e is NumberedEvidence => !!e && passed(e)) }))
    .filter((p) => p.claim && p.evidence.length > 0);

  let verdict: Verdict = RANK[answer.verdict] >= RANK[ceiling(steps, results, evidence)] ? answer.verdict : ceiling(steps, results, evidence);
  if (verdict === "done" && proofs.length === 0) verdict = "couldnt-verify";

  const problems = [...new Set([...openProblems(steps, results), ...answer.problems.map((p) => p.trim()).filter(Boolean)])];
  let headline = answer.headline.trim();
  if (verdict !== answer.verdict || !headline) headline = defaultHeadline(verdict);
  return { verdict, headline, proofs, problems, reviewedBy: "claude" };
}

function defaultHeadline(v: Verdict): string {
  if (v === "done") return "Done, and the checks prove it.";
  if (v === "not-done") return "Not done. Here's exactly what failed.";
  return "The steps ran, but I couldn't verify it worked.";
}

/** The receipt from our rules alone, used when the reviewer can't be reached. */
export function rulesReceipt(steps: PlannedStep[], results: Map<string, StepResult>, evidence: NumberedEvidence[], goalMessage?: string): Receipt {
  const verdictCap = ceiling(steps, results, evidence);
  const problems = openProblems(steps, results);
  const proofs: Proof[] = [];
  const final = evidence.find((e) => e.kind === "final" && e.code === 0);
  if (final && goalMessage) proofs.push({ claim: goalMessage, evidence: [final] });
  for (const p of steps) {
    const r = results.get(p.step.id);
    if (!r || !GOOD.includes(r.status)) continue;
    const ev = evidence.filter((e) => e.stepId === p.step.id && passed(e) && e.kind !== "run");
    const runOnly = evidence.filter((e) => e.stepId === p.step.id && passed(e));
    const use = ev.length ? ev : r.status === "done" && p.recipe ? runOnly.slice(-1) : [];
    if (use.length) proofs.push({ claim: r.status === "already-done" ? `${p.step.title}: already done` : `${p.step.title}: done`, evidence: use });
  }
  let verdict = verdictCap;
  if (verdict === "done" && proofs.length === 0) verdict = "couldnt-verify";
  const headline = verdict === "done" && goalMessage && final ? `Done. ${goalMessage.replace(/^./, (c) => c.toUpperCase())}.`.replace(/\.\.$/, ".") : defaultHeadline(verdict);
  return { verdict, headline, proofs, problems, reviewedBy: "rules" };
}

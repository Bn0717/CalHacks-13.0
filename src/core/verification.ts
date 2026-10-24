import { assessCommand } from "./risk.js";
import { runSandboxed, type ExecResult } from "./exec.js";
import type { Evidence, GoalVerification, PlannedStep, StepResult } from "./types.js";

/** Later observations supersede earlier observations of the same predicate. */
export function latestChecks<T extends Evidence>(evidence: T[]): T[] {
  const latest = new Map<string, T>();
  for (const e of evidence) if (e.kind !== "run") latest.set(e.checkId ?? e.command, e);
  return [...latest.values()];
}

/** Post-action predicates describe the new state; before checks describe the old state. */
export function currentStepChecks<T extends Evidence>(evidence: T[]): T[] {
  const after = evidence.filter((e) => e.kind === "after");
  return latestChecks(after.length ? after : evidence.filter((e) => e.kind === "before"));
}

export function verifiedStep(r?: StepResult): boolean {
  const checks = currentStepChecks(r?.evidence ?? []);
  return !!r && ["done", "already-done"].includes(r.status) && checks.length > 0 && checks.every((e) => e.outcome === "passed");
}

export function completedStep(r?: StepResult): boolean {
  return !!r && !failedStep(r) && (["done", "already-done", "done-unverified"].includes(r.status) || (r.status === "skipped" && r.skipReason === "obsolete"));
}

export function failedStep(r?: StepResult): boolean {
  return !!r && (["failed", "blocked", "declined", "not-for-this-computer"].includes(r.status)
    || (r.status === "skipped" && r.skipReason === "user")
    || (["done", "already-done", "done-unverified"].includes(r.status) && currentStepChecks(r.evidence ?? []).some((e) => e.kind === "after" && e.outcome === "failed")));
}

export function optionOf(p: PlannedStep): string {
  return String(p.step.alternativeOption ?? p.step.id);
}

export function optionState(steps: PlannedStep[], results: Map<string, StepResult>): "verified" | "complete" | "failed" | "incomplete" {
  const actionable = steps.filter((p) => p.step.kind !== "info");
  if (!actionable.length) return "incomplete";
  if (actionable.some((p) => failedStep(results.get(p.step.id)))) return "failed";
  if (!actionable.every((p) => completedStep(results.get(p.step.id)))) return "incomplete";
  return actionable.every((p) => verifiedStep(results.get(p.step.id)) || results.get(p.step.id)?.skipReason === "obsolete") ? "verified" : "complete";
}

export function optionsIn(steps: PlannedStep[], group: string): PlannedStep[][] {
  const options = new Map<string, PlannedStep[]>();
  for (const p of steps) {
    if (p.step.alternativeGroup !== group) continue;
    const key = optionOf(p);
    options.set(key, [...(options.get(key) ?? []), p]);
  }
  return [...options.values()];
}

export function summarizeGoal(checks: Evidence[], reason?: string): GoalVerification {
  const current = latestChecks(checks);
  const status = current.some((e) => e.outcome === "failed") ? "failed"
    : current.length && current.every((e) => e.outcome === "passed") && !reason ? "passed" : "unknown";
  return { status, checks, reason: reason ?? (status === "unknown" ? "The final goal could not be verified." : status === "failed" ? "The final check says the goal has not been reached." : undefined) };
}

/** Validate the contract as well as the caller's summary. Empty checks never pass. */
export function goalStatus(goal: GoalVerification): GoalVerification["status"] {
  const derived = summarizeGoal(goal.checks, goal.status === "unknown" ? goal.reason || "Unknown" : undefined).status;
  if (goal.status === "failed" || derived === "failed") return "failed";
  return goal.status === "passed" && derived === "passed" ? "passed" : "unknown";
}

export type VerificationRunner = (command: string, timeoutMs?: number) => Promise<ExecResult>;

/** Shared by step checks, desktop final checks, and the CLI. */
export async function runOutcomeCheck(command: string, kind: Evidence["kind"], run: VerificationRunner = runSandboxed): Promise<Evidence> {
  const a = assessCommand(command);
  if (!command.trim() || a.level !== "safe" || !a.readOnly || a.wrongPlatform) {
    return { kind, command, code: 126, output: "Verification unavailable: the check must be safe and read-only.", outcome: "unknown" };
  }
  try {
    const r = await run(command, 30_000);
    return { kind, command, code: r.code, output: (r.timedOut ? "Check timed out.\n" : "") + r.output.trim().split("\n").slice(-8).join("\n"),
      outcome: r.timedOut || [126, 127].includes(r.code) ? "unknown" : r.code === 0 ? "passed" : "failed" };
  } catch (error) {
    return { kind, command, code: 127, output: `Check unavailable: ${String(error)}`, outcome: "unknown" };
  }
}

export async function verifyGoal(command?: string, run: VerificationRunner = runSandboxed): Promise<GoalVerification> {
  if (!command?.trim()) return summarizeGoal([], "No usable final goal check was supplied.");
  const e = await runOutcomeCheck(command, "final", run);
  return summarizeGoal([e], e.outcome === "unknown" ? e.output || "The final check was inconclusive or timed out." : undefined);
}

const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export function appProcessCheck(path: string): string {
  const processPath = (path + "/Contents/MacOS/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `pgrep -f ${quote("^" + processPath)}`;
}

/** Proves presence and a process belonging to this exact installed bundle. */
export async function verifyInstalledApp(path: string, run: VerificationRunner = runSandboxed): Promise<GoalVerification> {
  if (!path.startsWith("/") || !path.endsWith(".app")) return summarizeGoal([], "The installed app path is unavailable or invalid.");
  const checks = [await runOutcomeCheck(`test -d ${quote(path)}`, "final", run),
    await runOutcomeCheck(appProcessCheck(path), "final", run)];
  return summarizeGoal(checks);
}

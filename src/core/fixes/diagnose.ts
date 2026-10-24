// Runs a guide's read-only checks, works out what's wrong and which fixes apply,
// then (after fixing) runs the same checks again to prove it worked.
import { assessCommand } from "../risk.js";
import { runNormally, runSandboxed } from "../exec.js";
import type { Assessment, Evidence } from "../types.js";
import type { CheckDef, CheckResult, CheckRunner, Diagnosis, Facts, FixDef, FixGuide, StatusRow } from "./types.js";

function tail(output: string, lines = 8): string {
  return output.trim().split("\n").slice(-lines).join("\n");
}

/** The command a check would run, given what's known so far. */
export function checkCommand(check: CheckDef, facts: Facts): string | null {
  return typeof check.command === "function" ? check.command(facts) : check.command;
}

/** A check may only run if our own safety rules say it only reads. */
export function isReadOnlyCheck(command: string): boolean {
  const a = assessCommand(command);
  return a.readOnly && a.level !== "blocked" && !a.wrongPlatform;
}

/** The real runner: sandboxed (no internet, no writing) unless the check needs the internet. */
export const realCheckRunner: CheckRunner = async (command, needsNetwork) => {
  if (!isReadOnlyCheck(command)) return { code: 126, output: "Refused: not a read-only command." };
  const r = needsNetwork ? await runNormally(command, 20_000) : await runSandboxed(command, 30_000);
  return { code: r.code, output: r.output };
};

/**
 * Runs every check in order. Facts from one check feed the next (e.g. the Wi-Fi device name).
 * Checks that share a command run it once.
 */
export async function diagnose(
  guide: FixGuide,
  run: CheckRunner,
  onCheck?: (checkId: string, result: CheckResult) => void,
  kind: "before" | "after" = "before",
): Promise<Diagnosis> {
  const facts: Facts = {};
  const results: CheckResult[] = [];
  const evidence: Evidence[] = [];
  const outputs = new Map<string, { code: number; output: string }>();

  for (const check of guide.checks) {
    let result: CheckResult;
    let command: string | null = null;
    try {
      command = checkCommand(check, facts);
    } catch {
      command = null;
    }
    if (command === null) {
      result = { id: check.id, label: check.label, status: "unknown", detail: check.skipped ?? "Couldn't check this.", command: null };
    } else if (!isReadOnlyCheck(command)) {
      result = { id: check.id, label: check.label, status: "unknown", detail: "Skipped: this check isn't read-only.", command };
    } else {
      let r = outputs.get(command);
      if (!r) {
        try {
          r = await run(command, !!check.needsNetwork);
        } catch (error) {
          r = { code: 1, output: String((error as Error).message ?? error) };
        }
        outputs.set(command, r);
        evidence.push({ kind, command, code: r.code, output: tail(r.output) });
      }
      const out = check.interpret(r, facts);
      Object.assign(facts, out.facts ?? {});
      result = { id: check.id, label: check.label, status: out.status, detail: out.detail, command };
    }
    results.push(result);
    onCheck?.(check.id, result);
  }

  const problem = guide.problemSentence(facts);
  return {
    guideId: guide.id,
    results,
    facts,
    problem,
    fixes: guide.fixes.filter((f) => f.applies(facts)),
    evidence,
    status: guide.status(facts),
  };
}

export interface Verification {
  after: Diagnosis;
  /** True when the same checks now find nothing wrong. */
  fixed: boolean;
  /** Before/after rows for the receipt. */
  rows: { label: string; before: string; after: string }[];
  /** What's still wrong, in one sentence, or null. */
  stillWrong: string | null;
}

/** Runs the same checks again after the fix (evidence kind "after") and compares. */
export async function verifyFix(
  guide: FixGuide,
  run: CheckRunner,
  before: Diagnosis,
  onCheck?: (checkId: string, result: CheckResult) => void,
): Promise<Verification> {
  const after = await diagnose(guide, run, onCheck, "after");
  // Fixed = no check finds a problem any more. (A "maybe" like "sound goes to your AirPods" doesn't count.)
  const fixed = !after.results.some((r) => r.status === "problem");
  return { after, fixed, rows: compareStatus(before.status, after.status), stillWrong: fixed ? null : after.problem };
}

export function compareStatus(before: StatusRow[], after: StatusRow[]): { label: string; before: string; after: string }[] {
  const labels = [...new Set([...before.map((r) => r.label), ...after.map((r) => r.label)])];
  return labels.map((label) => ({
    label,
    before: before.find((r) => r.label === label)?.value ?? "—",
    after: after.find((r) => r.label === label)?.value ?? "—",
  }));
}

export function fixLabel(fix: FixDef, facts: Facts): string {
  return typeof fix.label === "function" ? fix.label(facts) : fix.label;
}

/** A fix ready to show and run. */
export type BuiltFix =
  | { id: string; kind: "command"; label: string; command: string; admin: boolean; assessment: Assessment; waitAfterMs: number }
  | { id: string; kind: "recipe"; label: string; recipe: "add-printer"; waitAfterMs: number }
  | { id: string; kind: "manual"; label: string; manual: NonNullable<FixDef["manual"]>; waitAfterMs: number };

/**
 * Turns a fix into what will really run. Returns null when it can't be built safely
 * (a value from the facts didn't pass, or our safety rules block the command).
 */
export function buildFix(fix: FixDef, facts: Facts): BuiltFix | null {
  const label = fixLabel(fix, facts);
  const waitAfterMs = fix.waitAfterMs ?? 0;
  if (fix.recipe) return { id: fix.id, kind: "recipe", label, recipe: fix.recipe, waitAfterMs };
  if (fix.manual) return { id: fix.id, kind: "manual", label, manual: fix.manual, waitAfterMs };
  if (!fix.command) return null;
  let command: string;
  try {
    command = fix.command(facts);
  } catch {
    return null;
  }
  const assessment = assessCommand(command);
  if (assessment.level === "blocked" || assessment.wrongPlatform) return null;
  return { id: fix.id, kind: "command", label, command, admin: !!fix.admin, assessment, waitAfterMs };
}

/** Every fix that applies, built. Fixes that can't be built safely are left out. */
export function buildFixes(diagnosis: Diagnosis): BuiltFix[] {
  return diagnosis.fixes.map((f) => buildFix(f, diagnosis.facts)).filter((f): f is BuiltFix => f !== null);
}

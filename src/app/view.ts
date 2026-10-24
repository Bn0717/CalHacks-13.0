// Turns a run (plan + results + receipt) into what the helper bar shows (protocol.ts).
// Pure functions, so they're easy to test. All text is plain English; raw commands only go in "details".
import type { Receipt } from "../core/receipt.js";
import type { PlannedStep, StepResult, StepStatus } from "../core/types.js";
import type { DetailLine, Note, ReceiptView, StepLine } from "./protocol.js";

const LINE: Record<StepStatus, StepLine["status"]> = {
  "already-done": "done",
  done: "done",
  "done-unverified": "done",
  failed: "failed",
  blocked: "blocked",
  skipped: "skipped",
  declined: "skipped",
  "waiting-for-user": "waiting",
  "not-for-this-computer": "skipped",
};

const NOTE: Partial<Record<StepStatus, string>> = {
  "already-done": "Already done",
  blocked: "Not safe, skipped",
  declined: "You said no",
  "not-for-this-computer": "Not for this Mac",
};

export function stepLines(steps: PlannedStep[], results: Map<string, StepResult>, runningId?: string): StepLine[] {
  return steps
    .filter((p) => p.step.kind !== "info")
    .map((p) => {
      const r = results.get(p.step.id);
      const status: StepLine["status"] = r ? LINE[r.status] : p.step.id === runningId ? "running" : p.level === "blocked" ? "blocked" : "todo";
      const note = r ? (NOTE[r.status] ?? (r.status === "failed" ? r.message : undefined)) : p.level === "blocked" ? "Not safe, will skip" : undefined;
      return { id: p.step.id, text: p.step.title, status, note };
    });
}

export interface NoteInput {
  steps: PlannedStep[];
  useUpdated: Set<string>;
  useRecipe: Set<string>;
  pageWarnings: string[];
  droidReady: boolean;
}

/** Anything the person should know before tapping OK. */
export function planNotes(n: NoteInput): Note[] {
  const notes: Note[] = [];
  for (const w of n.pageWarnings) notes.push({ tone: "warn", text: w });
  for (const p of n.steps) {
    const i = n.steps.indexOf(p) + 1;
    if (p.level === "blocked" && (p.step.kind === "command" || p.step.kind === "download")) {
      notes.push({ tone: "blocked", text: `Step ${i} isn't safe (${(p.flags[0] ?? "risky").toLowerCase()}), so I'll skip it${p.step.alternativeGroup ? " and use the page's other option" : ""}.` });
    } else if (p.assessment.outdated?.suggestion && n.useUpdated.has(p.step.id)) {
      notes.push({ tone: "info", text: `Step ${i} is out of date on the page, so I'll use the current way.` });
    } else if (p.recipe && n.useRecipe.has(p.step.id) && p.step.kind === "manual") {
      notes.push({ tone: "info", text: `Step ${i}: I'll do this for you instead of you clicking.` });
    } else if (p.flags.length && p.level !== "blocked") {
      notes.push({ tone: "warn", text: `Step ${i} needs your OK first: ${p.flags[0].toLowerCase()}.` });
    }
  }
  return notes;
}

/** "Show what's happening": real commands, who ran them, Droid's log, and the checks. */
export function detailLines(steps: PlannedStep[], results: Map<string, StepResult>, droidReady: boolean): DetailLine[] {
  const out: DetailLine[] = [{ text: droidReady ? "🤖 Droid (Factory) runs the steps. It can only run the exact commands CalHack approved." : "Droid is off, so CalHack runs the steps itself." }];
  for (const p of steps) {
    if (p.step.kind === "info") continue;
    const r = results.get(p.step.id);
    out.push({ stepId: p.step.id, text: `Step ${p.step.id}: ${p.step.title}` });
    if (p.step.command) out.push({ stepId: p.step.id, text: p.step.command, mono: true });
    if (r?.ranBy) out.push({ stepId: p.step.id, text: r.ranBy === "droid" ? "Run by Droid" : "Run by CalHack" });
    for (const l of r?.log ?? []) out.push({ stepId: p.step.id, text: l, mono: true });
    for (const e of r?.evidence ?? []) out.push({ stepId: p.step.id, text: `${e.code === 0 ? "✔" : "✘"} ${e.command}`, mono: true });
  }
  return out;
}

export function receiptView(r: Receipt, beforeAfter: ReceiptView["beforeAfter"] = []): ReceiptView {
  return {
    verdict: r.verdict,
    headline: r.headline,
    beforeAfter,
    proofs: r.proofs.map((p) => ({ claim: p.claim, checks: p.evidence.map((e) => e.command) })),
    problems: r.problems,
    reviewedBy: r.reviewedBy,
  };
}

/** A short "here's what I tried" note the person can paste to family or IT. */
export function helpSummary(goal: string, problem: string | undefined, steps: PlannedStep[], results: Map<string, StepResult>, r: Receipt | null): string {
  const lines = [`CalHack summary: ${goal}`];
  if (problem) lines.push(`What was wrong: ${problem}`);
  lines.push("What I tried:");
  for (const p of steps) {
    if (p.step.kind === "info") continue;
    const res = results.get(p.step.id);
    lines.push(`- ${p.step.title}: ${res ? res.status + (res.message ? ` (${res.message})` : "") : "not run"}`);
    if (p.step.command) lines.push(`    $ ${p.step.command}`);
  }
  if (r) lines.push(`Result: ${r.headline}`, ...r.problems.map((x) => `- ${x}`));
  return lines.join("\n");
}

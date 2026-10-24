// Alternatives advance only after definite failure; uncertainty holds sibling options.
import type { PlannedStep, StepResult } from "./types.js";
import { completedStep, failedStep, optionOf, optionsIn, optionState } from "./verification.js";

export interface SequenceHooks {
  runOne(p: PlannedStep): Promise<StepResult>;
  /** Read-only retry: never repeat a completed action just to obtain proof. */
  recheck?(p: PlannedStep, previous: StepResult): Promise<StepResult>;
  onResult(r: StepResult): void;
  stopped(): boolean;
}

export async function runSequence(steps: PlannedStep[], results: Map<string, StepResult>, hooks: SequenceHooks): Promise<void> {
  const set = (r: StepResult) => { results.set(r.id, r); hooks.onResult(r); };
  // Refresh retained actions before deciding which alternative, if any, is needed.
  for (const p of steps) {
    if (hooks.stopped()) return;
    const previous = results.get(p.step.id);
    if (previous && (completedStep(previous) || previous.actionCompleted || previous.status === "waiting-for-user") && hooks.recheck) set(await hooks.recheck(p, previous));
  }
  const held = new Map<string, { option: string; verified: boolean }>();
  for (const group of new Set(steps.map((p) => p.step.alternativeGroup).filter((g): g is string => !!g))) {
    const options = optionsIn(steps, group);
    const winner = options.find((o) => optionState(o, results) === "verified");
    const complete = winner ?? options.find((o) => optionState(o, results) === "complete");
    if (complete) held.set(group, { option: optionOf(complete[0]), verified: !!winner });
  }
  const failed = new Set<string>();
  for (const p of steps) {
    if (hooks.stopped()) break;
    const { id, alternativeGroup: group } = p.step;
    const option = optionOf(p);
    const key = `${group}:${option}`;
    const hold = group ? held.get(group) : undefined;
    if (hold && hold.option !== option) {
      // Preserve attempted history, including failures, for the receipt to resolve.
      if (!results.has(id) || results.get(id)?.status === "skipped") set({ id, status: "skipped",
        skipReason: hold.verified ? "alternative-verified" : "awaiting-verification",
        message: hold.verified ? "Not needed: another complete option was verified." : "Held: another option ran, but its outcome still needs verification." });
      continue;
    }
    if (group && failed.has(key)) {
      if (!results.has(id) || results.get(id)?.status === "skipped") set({ id, status: "skipped", skipReason: "option-failed", message: "Skipped: this option already didn't work." });
      continue;
    }
    const previous = results.get(id);
    const retain = previous && (completedStep(previous) || previous.actionCompleted || ["blocked", "not-for-this-computer", "waiting-for-user"].includes(previous.status));
    const r = retain ? previous : await hooks.runOne(p);
    if (!retain) set(r);
    if (r.status === "waiting-for-user") break;
    if (failedStep(r)) {
      if (!group) break;
      failed.add(key);
      const options = optionsIn(steps, group);
      const left = options.some((o) => !failed.has(`${group}:${optionOf(o[0])}`));
      set({ ...r, message: r.message + (left ? " Trying the next option on the page." : ` None of the ${options.length} options on this page worked.`) });
      if (!left) break;
    } else if (group) {
      const optionSteps = steps.filter((x) => x.step.alternativeGroup === group && optionOf(x) === option);
      const state = optionState(optionSteps, results);
      if (state === "verified" || state === "complete") held.set(group, { option, verified: state === "verified" });
      // Incomplete options (e.g. waiting on an installer) must not launch siblings.
      if (optionSteps[optionSteps.length - 1].step.id === id && state === "incomplete") held.set(group, { option, verified: false });
    } else if (r.status === "skipped" && r.skipReason !== "obsolete" && p.step.kind !== "info") break;
  }
}

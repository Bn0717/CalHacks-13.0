// Runs a plan's steps in order. Each step runs once; the first problem stops everything.
// The one exception: when the page offers alternative fixes ("Option 1… Option 2…"), a failed or unsafe
// option moves on to the next option, and the first option that works ends the group.
import type { PlannedStep, StepResult, StepStatus } from "./types.js";

const BAD: StepStatus[] = ["failed", "blocked", "declined"];
const GOOD: StepStatus[] = ["done", "done-unverified", "already-done"];
/** Results that are kept on "Try again" (everything else runs again). */
const KEEP: StepStatus[] = ["already-done", "done", "done-unverified", "blocked", "skipped", "not-for-this-computer", "waiting-for-user"];

export interface SequenceHooks {
  runOne(p: PlannedStep): Promise<StepResult>;
  onResult(r: StepResult): void;
  stopped(): boolean;
}

interface GroupState {
  won?: number;
  failed: Set<number>;
}

function optionOf(p: PlannedStep): number {
  return p.step.alternativeOption ?? Number(p.step.id);
}

export async function runSequence(steps: PlannedStep[], results: Map<string, StepResult>, hooks: SequenceHooks): Promise<void> {
  const groups = new Map<string, GroupState>();
  const set = (r: StepResult) => {
    results.set(r.id, r);
    hooks.onResult(r);
  };

  // A rerun ("Try again") starts its groups fresh, except for options that already worked.
  for (const p of steps) {
    const g = p.step.alternativeGroup;
    const r = results.get(p.step.id);
    if (!g || !r) continue;
    const state = groups.get(g) ?? { failed: new Set<number>() };
    groups.set(g, state);
    const option = steps.filter((x) => x.step.alternativeGroup === g && optionOf(x) === optionOf(p));
    if (option.every((x) => GOOD.includes(results.get(x.step.id)?.status as StepStatus))) state.won = optionOf(p);
  }

  for (const p of steps) {
    if (hooks.stopped()) break;
    const id = p.step.id;
    const g = p.step.alternativeGroup;
    const state = g ? (groups.get(g) ?? { failed: new Set<number>() }) : null;
    if (g && state) groups.set(g, state);
    const opt = optionOf(p);

    if (state && state.won !== undefined && state.won !== opt) {
      if (!GOOD.includes(results.get(id)?.status as StepStatus)) set({ id, status: "skipped", message: "Not needed: another option on the page already worked." });
      continue;
    }
    if (state?.failed.has(opt)) {
      set({ id, status: "skipped", message: "Skipped: this option already didn't work." });
      continue;
    }
    const before = results.get(id);
    if (before && KEEP.includes(before.status) && !(g && before.status === "blocked")) continue;

    const r = await hooks.runOne(p);
    if (!g || !state) {
      set(r);
      if (BAD.includes(r.status)) break;
      continue;
    }

    if (BAD.includes(r.status)) {
      state.failed.add(opt);
      const options = [...new Set(steps.filter((x) => x.step.alternativeGroup === g).map(optionOf))];
      const left = options.filter((o) => !state.failed.has(o));
      if (left.length) {
        set({ ...r, message: `${r.message} Trying the next option on the page.` });
        continue;
      }
      set({ ...r, message: `${r.message} None of the ${options.length} options on this page worked.` });
      break;
    }
    set(r);
    const optionSteps = steps.filter((x) => x.step.alternativeGroup === g && optionOf(x) === opt);
    if (optionSteps.every((x) => GOOD.includes(results.get(x.step.id)?.status as StepStatus))) state.won = opt;
  }
}

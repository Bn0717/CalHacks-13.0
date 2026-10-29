// Makes sure a lesson's checks are trustworthy before a student ever sees them.
// Shared by the idea builder and the video builder. Running a single check is passed in (the checker in src/learn/check/
// does it for real; tests pass a fake), so this file never opens a browser or calls a model itself.
import type { Check, ProjectFile, Step } from "./lesson.js";
import { rebuildSteps } from "./rebuild.js";

// Answers one check for one step against a set of project files: true = it passes.
export type CheckRunner = (check: Check, step: Step, files: ProjectFile[]) => Promise<boolean>;

export type CheckProblem = {
  stepId: string;
  check: Check;
  reason: "failsOnFinished" | "passesOnEmpty" | "failsRightAfter" | "passesBefore";
};

export type ValidationResult = {
  steps: Step[]; // the steps with bad checks dropped
  problems: CheckProblem[]; // every check that was dropped, and why
  needsFix: string[]; // ids of learner steps left with no usable check
};

// For each step: every check must pass on the finished project, and the first check must fail on an empty project
// (otherwise the step would tick itself off before the student types anything). Bad checks are dropped.
// When typing every step in order rebuilds the finished project (see rebuild.ts), the real in-between files are used
// instead: every check must pass right after its step, and the first must fail right before it.
// `only`: check just these steps (the others are still used to work out the in-between files) and return just them.
export async function selfValidateSteps(steps: Step[], finished: ProjectFile[], runCheck: CheckRunner, only?: Set<string>): Promise<ValidationResult> {
  const empty: ProjectFile[] = [];
  const problems: CheckProblem[] = [];
  const needsFix: string[] = [];
  const out: Step[] = [];
  const rebuilt = rebuildSteps(steps, finished);
  const real = rebuilt.matches;

  let before: ProjectFile[] = empty;
  for (const step of steps) {
    const after = real ? rebuilt.after.get(step.id)! : finished;
    if (only && !only.has(step.id)) {
      before = after;
      continue;
    }
    const kept: Check[] = [];
    for (const check of step.checks) {
      if (!(await runCheck(check, step, after))) {
        problems.push({ stepId: step.id, check, reason: real ? "failsRightAfter" : "failsOnFinished" });
        continue;
      }
      // Only the first kept check has to fail before the step: it's the one that proves the student did something.
      if (kept.length === 0 && (await runCheck(check, step, real ? before : empty))) {
        problems.push({ stepId: step.id, check, reason: real && before.length > 0 ? "passesBefore" : "passesOnEmpty" });
        continue;
      }
      kept.push(check);
    }
    if (step.who === "learner" && kept.length === 0) needsFix.push(step.id);
    out.push({ ...step, checks: kept });
    before = after;
  }
  return { steps: out, problems, needsFix };
}

// A short plain-English list of dropped checks, to send back to the model when asking it to fix them.
export function describeProblems(problems: CheckProblem[]): string {
  return problems
    .map((p) => `Step ${p.stepId}: check ${JSON.stringify(p.check)} ${PROBLEM_TEXT[p.reason]}`)
    .join("\n");
}

const PROBLEM_TEXT: Record<CheckProblem["reason"], string> = {
  failsOnFinished: "fails on the finished project.",
  passesOnEmpty: "already passes on an empty project, so it proves nothing.",
  failsRightAfter: "fails right after the step is typed (it would only pass once later steps are done).",
  passesBefore: "already passes before the step is typed, so it proves nothing.",
};

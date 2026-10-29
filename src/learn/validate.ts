// Makes sure a lesson's checks are trustworthy before a student ever sees them.
// Shared by the idea builder and the video builder. Running a single check is passed in (the checker in src/learn/check/
// does it for real; tests pass a fake), so this file never opens a browser or calls a model itself.
import type { Check, ProjectFile, Step } from "./lesson.js";

// Answers one check for one step against a set of project files: true = it passes.
export type CheckRunner = (check: Check, step: Step, files: ProjectFile[]) => Promise<boolean>;

export type CheckProblem = {
  stepId: string;
  check: Check;
  reason: "failsOnFinished" | "passesOnEmpty";
};

export type ValidationResult = {
  steps: Step[]; // the steps with bad checks dropped
  problems: CheckProblem[]; // every check that was dropped, and why
  needsFix: string[]; // ids of learner steps left with no usable check
};

// For each step: every check must pass on the finished project, and the first check must fail on an empty project
// (otherwise the step would tick itself off before the student types anything). Bad checks are dropped.
export async function selfValidateSteps(steps: Step[], finished: ProjectFile[], runCheck: CheckRunner): Promise<ValidationResult> {
  const empty: ProjectFile[] = [];
  const problems: CheckProblem[] = [];
  const needsFix: string[] = [];
  const out: Step[] = [];

  for (const step of steps) {
    const kept: Check[] = [];
    for (const check of step.checks) {
      if (!(await runCheck(check, step, finished))) {
        problems.push({ stepId: step.id, check, reason: "failsOnFinished" });
        continue;
      }
      // Only the first kept check has to fail on an empty project: it's the one that proves the student did something.
      if (kept.length === 0 && (await runCheck(check, step, empty))) {
        problems.push({ stepId: step.id, check, reason: "passesOnEmpty" });
        continue;
      }
      kept.push(check);
    }
    if (step.who === "learner" && kept.length === 0) needsFix.push(step.id);
    out.push({ ...step, checks: kept });
  }
  return { steps: out, problems, needsFix };
}

// A short plain-English list of dropped checks, to send back to the model when asking it to fix them.
export function describeProblems(problems: CheckProblem[]): string {
  return problems
    .map((p) =>
      p.reason === "failsOnFinished"
        ? `Step ${p.stepId}: check ${JSON.stringify(p.check)} fails on the finished project.`
        : `Step ${p.stepId}: check ${JSON.stringify(p.check)} already passes on an empty project, so it proves nothing.`,
    )
    .join("\n");
}

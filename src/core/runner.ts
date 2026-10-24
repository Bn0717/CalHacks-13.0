// Runs one planned step: check "already done?", ask if needed, run, then check "did it work?".
import { assessCommand } from "./risk.js";
import { runAsAdmin, runNormally, runSandboxed, type ExecResult } from "./exec.js";
import { downloadAndVerify } from "./download.js";
import type { PlannedStep, StepResult } from "./types.js";

export interface RunHooks {
  /** Ask the user to approve a step. Resolves true for yes. */
  approve(planned: PlannedStep, detail: string): Promise<boolean>;
  /** For "you click this" steps: point the way, then resolve when the user says they're done. */
  waitForUser(planned: PlannedStep): Promise<"done" | "skip">;
  /** A short progress line, e.g. "Checking if it's already done…". */
  progress?(planned: PlannedStep, message: string): void;
}

export interface RunOptions {
  /** Use the newer form of an outdated command (built by our rules, not the AI). */
  useUpdatedCommand?: boolean;
}

function tail(output: string, lines = 12): string {
  return output.trim().split("\n").slice(-lines).join("\n");
}

async function check(planned: PlannedStep): Promise<boolean | null> {
  if (!planned.checkUsable || !planned.step.checkCommand) return null;
  const r = await runSandboxed(planned.step.checkCommand);
  return r.code === 0;
}

function usesAdmin(command: string): boolean {
  return assessCommand(command).findings.some((f) => f.rule === "admin");
}

export async function runPlannedStep(planned: PlannedStep, hooks: RunHooks, options: RunOptions = {}): Promise<StepResult> {
  const { step, assessment } = planned;
  const id = step.id;
  const say = (m: string) => hooks.progress?.(planned, m);

  if (assessment.wrongPlatform) {
    return { id, status: "not-for-this-computer", message: assessment.wrongPlatform.reason };
  }
  if (planned.level === "blocked") {
    return { id, status: "blocked", message: planned.reasons[0] ?? "This step isn't safe to run." };
  }
  if (step.kind === "info") {
    return { id, status: "skipped", message: "Just information, nothing to do." };
  }

  // 1. Already done?
  say("Checking if this is already done…");
  if ((await check(planned)) === true) {
    return { id, status: "already-done", message: "Already done on this Mac, so we skipped it." };
  }

  // 2. Do the step.
  if (step.kind === "manual") {
    say("Waiting for you…");
    const answer = await hooks.waitForUser(planned);
    if (answer === "skip") return { id, status: "skipped", message: "You skipped this step." };
  } else if (step.kind === "download" && step.url) {
    if (!(await hooks.approve(planned, `Download ${step.url}`))) {
      return { id, status: "declined", message: "You chose not to download this." };
    }
    say("Downloading and checking who made the file…");
    try {
      const dl = await downloadAndVerify(step.url);
      const ok = dl.signature.signed && dl.signature.signerMatchesSite !== false;
      if (!ok) {
        return { id, status: "failed", message: `Downloaded to ${dl.path}, but we stopped there. ${dl.signature.summary}` };
      }
      const open = await hooks.approve(planned, `Open ${dl.path}? ${dl.signature.summary}`);
      if (open) await runNormally(`open ${JSON.stringify(dl.path)}`, 30_000);
      return { id, status: open ? "waiting-for-user" : "done-unverified", message: `Downloaded and checked. ${dl.signature.summary}${open ? " The installer is open; follow its steps." : ""}` };
    } catch (err) {
      return { id, status: "failed", message: `The download didn't work: ${(err as Error).message}` };
    }
  } else if (step.kind === "command" && step.command) {
    const outdated = assessment.outdated;
    if (outdated && outdated.suggestion === "") {
      return { id, status: "skipped", message: outdated.reason };
    }
    const command = options.useUpdatedCommand && outdated?.suggestion ? outdated.suggestion : step.command;
    const now = command === step.command ? assessment : assessCommand(command);
    if (now.level === "blocked") return { id, status: "blocked", message: now.findings[0]?.reason ?? "Not safe." };

    let result: ExecResult;
    if (planned.level === "safe" && now.readOnly) {
      say("Running safely in a locked box…");
      result = await runSandboxed(command);
    } else {
      if (!(await hooks.approve(planned, command))) {
        return { id, status: "declined", message: "You chose not to run this." };
      }
      say("Running…");
      result = usesAdmin(command) ? await runAsAdmin(command) : await runNormally(command);
    }
    if (result.timedOut) return { id, status: "failed", message: "This took too long, so we stopped it.", output: tail(result.output) };
    if (result.code !== 0) {
      if (/User cancell?ed/i.test(result.output)) return { id, status: "declined", message: "You cancelled the password box." };
      return { id, status: "failed", message: `This step didn't work (error ${result.code}). We stopped here so nothing else goes wrong.`, output: tail(result.output) };
    }
    if (!planned.checkUsable) {
      return { id, status: "done-unverified", message: "Done. (There was no way to double-check this one.)", output: tail(result.output, 4) };
    }
  }

  // 3. Did it work?
  say("Checking it worked…");
  const after = await check(planned);
  if (after === true) return { id, status: "done", message: "Done, and we checked that it worked." };
  if (after === false) return { id, status: "failed", message: "The step finished, but our check says it didn't work. We stopped here." };
  return { id, status: "done-unverified", message: "Done. (There was no way to double-check this one.)" };
}

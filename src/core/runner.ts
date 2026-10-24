// Runs one planned step: check "already done?", ask if needed, run, then check "did it work?".
// Every check that runs is kept as evidence, so the receipt can show what proves what.
import { assessCommand } from "./risk.js";
import { runAsAdmin, runNormally, runSandboxed, type ExecResult } from "./exec.js";
import { downloadAndVerify } from "./download.js";
import { realRecipeDeps, recipeKey, recipeNormal, runRecipe, type RecipeDeps } from "./recipes.js";
import type { Evidence, PlannedStep, StepResult } from "./types.js";

export interface RunHooks {
  /** Ask the user to approve a step. Resolves true for yes. */
  approve(planned: PlannedStep, detail: string): Promise<boolean>;
  /**
   * For "you click this" steps: point the way, then resolve when the user says they're done.
   * `note` says why we couldn't do it for them, when we tried.
   */
  waitForUser(planned: PlannedStep, note?: string): Promise<"done" | "skip">;
  /**
   * Before asking the person: look at the screen and do the clicks ourselves. Private parts still go to the person.
   * `handled` = the step was finished or the person did/skipped it (so don't ask again).
   */
  tryOnScreen?(planned: PlannedStep, note?: string): Promise<{ handled: "done" | "skip" | false; evidence: Evidence[]; note?: string }>;
  /** A short progress line, e.g. "Checking if it's already done…". */
  progress?(planned: PlannedStep, message: string): void;
}

/** What ran a command that changes something, e.g. Droid. Its result says who ran it and what it did. */
export type Executor = (command: string, timeoutMs?: number) => Promise<ExecResult & { ranBy?: "droid" | "calhack"; log?: string[] }>;

export interface RunOptions {
  /** Use the newer form of an outdated command (built by our rules, not the AI). */
  useUpdatedCommand?: boolean;
  /** Let a fixed action from recipes.ts do a click step (on unless the person turned it off). */
  useRecipe?: boolean;
  /** Fixed actions already tried in this run, so steps that share one only try it once. */
  recipesTried?: Map<string, { stepId: string; ok: boolean }>;
  /** Runs approved commands that change something. Defaults to CalHack running them itself. */
  execute?: Executor;
  /** For tests. */
  recipeDeps?: RecipeDeps;
}

function tail(output: string, lines = 12): string {
  return output.trim().split("\n").slice(-lines).join("\n");
}

export interface CheckResult {
  passed: boolean;
  evidence: Evidence;
}

/** Runs the step's read-only check in the locked box. null = this step has no usable check. */
export async function check(planned: PlannedStep, kind: "before" | "after" = "before"): Promise<CheckResult | null> {
  if (!planned.checkUsable || !planned.step.checkCommand) return null;
  const command = planned.step.checkCommand;
  const r = await runSandboxed(command);
  return { passed: r.code === 0, evidence: { kind, command, code: r.code, output: tail(r.output, 6) } };
}

function usesAdmin(command: string): boolean {
  return assessCommand(command).findings.some((f) => f.rule === "admin");
}

const ourselves: Executor = async (command, timeoutMs) => ({ ...(await runNormally(command, timeoutMs)), ranBy: "calhack" });

export async function runPlannedStep(planned: PlannedStep, hooks: RunHooks, options: RunOptions = {}): Promise<StepResult> {
  const { step, assessment } = planned;
  const id = step.id;
  const say = (m: string) => hooks.progress?.(planned, m);
  const evidence: Evidence[] = [];
  const execute = options.execute ?? ourselves;
  let ranBy: StepResult["ranBy"];
  let log: string[] | undefined;
  const result = (r: Omit<StepResult, "id" | "evidence" | "ranBy" | "log">): StepResult => ({ id, ...r, evidence, ranBy, log });

  if (assessment.wrongPlatform) {
    return result({ status: "not-for-this-computer", message: assessment.wrongPlatform.reason });
  }
  if (planned.level === "blocked") {
    return result({ status: "blocked", message: planned.reasons[0] ?? "This step isn't safe to run." });
  }
  if (step.kind === "info") {
    return result({ status: "skipped", message: "Just information, nothing to do." });
  }

  // 1. Already done?
  say("Checking if this is already done…");
  const before = await check(planned, "before");
  if (before) evidence.push(before.evidence);
  if (before?.passed) {
    return result({ status: "already-done", message: "Already done on this Mac, so we skipped it." });
  }

  // 2. Do the step.
  let note: string | undefined;
  const recipe = options.useRecipe === false ? undefined : planned.recipe;
  if (step.kind === "manual" && recipe) {
    // A fixed action from our own code can do this step, so the person doesn't have to click.
    const key = recipeKey(recipe);
    const earlier = options.recipesTried?.get(key);
    if (earlier?.ok) return result({ status: "done", message: `Done together with step ${earlier.stepId}.` });
    if (!earlier) {
      say(recipe.label + "…");
      const deps = options.recipeDeps ?? { ...realRecipeDeps, normal: recipeNormal(execute) };
      const outcome = await runRecipe(recipe, deps);
      options.recipesTried?.set(key, { stepId: id, ok: outcome.ok });
      evidence.push(...outcome.evidence);
      ranBy = outcome.ranBy;
      log = outcome.log;
      if (outcome.ok) return result({ status: "done", message: outcome.message, output: outcome.output });
      note = outcome.message;
    }
  }
  if (step.kind === "manual") {
    let answer: "done" | "skip" | undefined;
    if (hooks.tryOnScreen) {
      say("Doing it for you…");
      const t = await hooks.tryOnScreen(planned, note);
      evidence.push(...t.evidence);
      if (t.handled) answer = t.handled;
      else note = t.note ?? note;
    }
    if (!answer) {
      say("Waiting for you…");
      answer = await hooks.waitForUser(planned, note);
    }
    if (answer === "skip") return result({ status: "skipped", message: "You skipped this step." });
  } else if (step.kind === "download" && step.url) {
    if (!(await hooks.approve(planned, `Download ${step.url}`))) {
      return result({ status: "declined", message: "You chose not to download this." });
    }
    say("Downloading and checking who made the file…");
    try {
      const dl = await downloadAndVerify(step.url);
      const ok = dl.signature.signed && dl.signature.signerMatchesSite !== false;
      if (!ok) {
        return result({ status: "failed", message: `Downloaded to ${dl.path}, but we stopped there. ${dl.signature.summary}` });
      }
      const open = await hooks.approve(planned, `Open ${dl.path}? ${dl.signature.summary}`);
      if (open) await execute(`open ${JSON.stringify(dl.path)}`, 30_000);
      return result({ status: open ? "waiting-for-user" : "done-unverified", message: `Downloaded and checked. ${dl.signature.summary}${open ? " The installer is open; follow its steps." : ""}` });
    } catch (err) {
      return result({ status: "failed", message: `The download didn't work: ${(err as Error).message}` });
    }
  } else if (step.kind === "command" && step.command) {
    const outdated = assessment.outdated;
    if (outdated && outdated.suggestion === "") {
      return result({ status: "skipped", message: outdated.reason });
    }
    const command = options.useUpdatedCommand && outdated?.suggestion ? outdated.suggestion : step.command;
    const now = command === step.command ? assessment : assessCommand(command);
    if (now.level === "blocked") return result({ status: "blocked", message: now.findings[0]?.reason ?? "Not safe." });

    let r: ExecResult;
    if (planned.level === "safe" && now.readOnly) {
      say("Running safely in a locked box…");
      r = await runSandboxed(command);
      ranBy = "calhack";
    } else {
      if (!(await hooks.approve(planned, command))) {
        return result({ status: "declined", message: "You chose not to run this." });
      }
      if (usesAdmin(command)) {
        // macOS shows its own password box, so admin steps always run through CalHack.
        say("Running (your Mac will ask for your password)…");
        r = await runAsAdmin(command);
        ranBy = "calhack";
      } else {
        say(options.execute ? "Droid is running it…" : "Running…");
        const ran = await execute(command);
        r = ran;
        ranBy = ran.ranBy ?? "calhack";
        log = ran.log;
      }
    }
    evidence.push({ kind: "run", command, code: r.code, output: tail(r.output, 6) });
    if (r.timedOut) return result({ status: "failed", message: "This took too long, so we stopped it.", output: tail(r.output) });
    if (r.code !== 0) {
      if (/User cancell?ed|no password was provided|-128\)/i.test(r.output)) return result({ status: "declined", message: "You cancelled the password box." });
      return result({ status: "failed", message: `This step didn't work (error ${r.code}). We stopped here so nothing else goes wrong.`, output: tail(r.output) });
    }
    if (!planned.checkUsable) {
      return result({ status: "done-unverified", message: "Done. (There was no way to double-check this one.)", output: tail(r.output, 4) });
    }
  }

  // 3. Did it work?
  say("Checking it worked…");
  const after = await check(planned, "after");
  if (after) evidence.push(after.evidence);
  if (after?.passed) return result({ status: "done", message: "Done, and we checked that it worked." });
  if (after) return result({ status: "failed", message: "The step finished, but our check says it didn't work. We stopped here." });
  return result({ status: "done-unverified", message: "Done. (There was no way to double-check this one.)" });
}

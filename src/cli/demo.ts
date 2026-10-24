// The whole flow in the terminal, without the desktop app.
//   npm run demo -- <page address or file>          show the checked plan
//   npm run demo -- <page address or file> --run    also run it (Droid runs the steps when FACTORY_API_KEY is set)
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fetchPageText, fileText } from "../mac/text.js";
import { describeEnvironment, probeEnvironment } from "../core/probe.js";
import { applyAiConcerns, planSteps } from "../core/plan.js";
import { runPlannedStep, type Executor } from "../core/runner.js";
import { runNormally } from "../core/exec.js";
import { verifyGoal } from "../core/verification.js";
import { runSequence } from "../core/sequence.js";
import { collectEvidence } from "../core/receipt.js";
import { reviewRun } from "../ai/review.js";
import { droidProblem, runWithDroid } from "../droid/executor.js";
import { friendlyError, hasApiKey } from "../ai/client.js";
import { parseInstructions } from "../ai/parse.js";
import type { InstructionSource, PlannedStep, StepResult } from "../core/types.js";
import type { RecipeOutcome } from "../core/recipes.js";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--")) ?? "http://localhost:4321/install-wget.html";
const shouldRun = args.includes("--run");

const BADGE = { safe: "🟢 safe", ask: "🟡 asks first", blocked: "🔴 blocked" } as const;

async function loadSource(where: string): Promise<InstructionSource> {
  if (/^https?:\/\//.test(where)) return { kind: "webpage", text: await fetchPageText(where), location: where, app: "terminal" };
  return { kind: "file", text: await fileText(where), location: "file://" + where, app: "terminal" };
}

function printStep(p: PlannedStep, i: number): void {
  const s = p.step;
  const badge = s.kind === "manual" ? (p.recipe ? `🤖 ${p.recipe.label}` : "👆 you click") : s.kind === "info" ? "ℹ️ info" : BADGE[p.level];
  const alt = s.alternativeGroup ? `   (option ${s.alternativeOption ?? "?"})` : "";
  console.log(`\n${i + 1}. ${s.title}   [${badge}]${alt}`);
  console.log(`   ${s.explanation}`);
  if (s.command) console.log(`   $ ${s.command}`);
  if (s.url) console.log(`   ⬇️ ${s.url}`);
  if (s.clickTarget) console.log(`   Click: "${s.clickTarget}"`);
  if (p.assessment.outdated?.suggestion) console.log(`   🕰️ Newer form: ${p.assessment.outdated.suggestion}`);
  for (const r of p.reasons) console.log(`   • ${r}`);
  if (p.checkUsable) console.log(`   check: ${s.checkCommand}`);
}

async function main(): Promise<void> {
  console.log(`Reading ${target} …`);
  const source = await loadSource(target);
  const env = await probeEnvironment();
  if (!hasApiKey()) console.log("(No API key found. Trying a saved answer for this page.)");
  const parsed = await parseInstructions({ source, environment: describeEnvironment(env), allowCache: true });
  const plan = planSteps(parsed.steps, source);
  applyAiConcerns(plan, parsed.pageConcerns, parsed.appliesToThisComputer);

  console.log(`\nGoal: ${parsed.goal}${parsed.fromCache ? "   (saved answer)" : ""}`);
  for (const w of plan.pageWarnings) console.log(`⛔ ${w.reason}`);
  for (const c of parsed.pageConcerns) console.log(`⚠️ ${c.text}${c.steps.length ? `  (step ${c.steps.join(", ")})` : ""}`);
  plan.steps.forEach(printStep);

  if (!shouldRun) {
    console.log("\nAdd --run to do it.");
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const problem = droidProblem();
  console.log(`\n— Running —   ${problem ? `(Droid is off: ${problem}. CalHack runs the steps.)` : "(Droid runs the steps)"}`);
  const execute: Executor = async (command, timeoutMs) => {
    if (!problem) {
      try {
        return await runWithDroid(command, timeoutMs);
      } catch (e) {
        return { ...(await runNormally(command, timeoutMs)), ranBy: "calhack", log: [`Droid couldn't start (${(e as Error).message}), so CalHack ran it.`] };
      }
    }
    return { ...(await runNormally(command, timeoutMs)), ranBy: "calhack" };
  };
  const results = new Map<string, StepResult>();
  const recipesTried = new Map<string, RecipeOutcome & { stepId: string }>();
  await runSequence(plan.steps, results, {
    runOne: (p) =>
      runPlannedStep(
        p,
        {
          approve: async (_p, detail) => (p.flags.length === 0 && !p.needsReview ? true : /^y/i.test(await rl.question(`\n⚠️ ${p.step.title} (${p.flags.join(", ")}): run "${detail}"? (y/n) `))),
          waitForUser: async (q, note) => {
            const a = await rl.question(`\n👆 ${q.step.title}: ${note ? note + " " : ""}${q.step.explanation}\n   Press Return when done, or type s to skip: `);
            return /^s/i.test(a) ? "skip" : "done";
          },
          progress: (q, m) => console.log(`   … ${m}`),
        },
        { useUpdatedCommand: !!p.assessment.outdated?.suggestion, useRecipe: true, recipesTried, execute },
      ),
    onResult: (r) => {
      console.log(`   → step ${r.id} ${r.status}: ${r.message}${r.ranBy === "droid" ? "   [run by Droid]" : ""}`);
      for (const l of r.log ?? []) console.log(`     🤖 ${l}`);
      if (r.output) console.log(r.output.split("\n").map((l) => "     " + l).join("\n"));
    },
    stopped: () => false,
  });
  rl.close();

  console.log("\n— Receipt —");
  const verification = await verifyGoal(parsed.finish?.command);
  const evidence = collectEvidence(plan.steps, results, verification);
  const receipt = await reviewRun({ goal: parsed.goal, goalMessage: parsed.finish?.message, steps: plan.steps, results, evidence, verification });
  console.log(`${receipt.verdict === "done" ? "✅" : receipt.verdict === "not-done" ? "❌" : "⚠️"} ${receipt.headline}`);
  for (const p of receipt.proofs) console.log(`   ✔ ${p.claim}   (proof: ${p.evidence.map((e) => `${e.ref} \`${e.command}\``).join(", ")})`);
  for (const p of receipt.problems) console.log(`   • ${p}`);
  console.log(`   Reviewed by ${receipt.reviewedBy === "claude" ? "a separate Claude call" : "CalHack's rules"}.`);
}

main().catch((e) => {
  console.error("⚠️ " + friendlyError(e));
  process.exit(1);
});

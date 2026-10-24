// The whole flow in the terminal, without the desktop app.
//   npm run demo -- <page address or file>          show the checked plan
//   npm run demo -- <page address or file> --run    also run it, asking before each change
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fetchPageText, fileText } from "../mac/text.js";
import { describeEnvironment, probeEnvironment } from "../core/probe.js";
import { planSteps } from "../core/plan.js";
import { runPlannedStep } from "../core/runner.js";
import { friendlyError, hasApiKey } from "../ai/client.js";
import { parseInstructions } from "../ai/parse.js";
import type { InstructionSource, PlannedStep } from "../core/types.js";

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
  const badge = s.kind === "manual" ? "👆 you click" : s.kind === "info" ? "ℹ️ info" : BADGE[p.level];
  console.log(`\n${i + 1}. ${s.title}   [${badge}]`);
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

  console.log(`\nGoal: ${parsed.goal}${parsed.fromCache ? "   (saved answer)" : ""}`);
  for (const w of plan.pageWarnings) console.log(`⛔ ${w.reason}`);
  for (const c of parsed.pageConcerns) console.log(`⚠️ ${c}`);
  plan.steps.forEach(printStep);

  if (!shouldRun) {
    console.log("\nAdd --run to do it.");
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("\n— Running —");
  for (const p of plan.steps) {
    const result = await runPlannedStep(p, {
      approve: async (_p, detail) => /^y/i.test(await rl.question(`\n${p.step.title}: run "${detail}"? (y/n) `)),
      waitForUser: async (q) => {
        const a = await rl.question(`\n👆 ${q.step.title}: ${q.step.explanation}\n   Press Return when done, or type s to skip: `);
        return /^s/i.test(a) ? "skip" : "done";
      },
      progress: (q, m) => console.log(`   … ${m}`),
    });
    console.log(`   → ${result.status}: ${result.message}`);
    if (result.output) console.log(result.output.split("\n").map((l) => "     " + l).join("\n"));
    if (["failed", "blocked", "declined"].includes(result.status)) break;
  }
  rl.close();
}

main().catch((e) => {
  console.error("⚠️ " + friendlyError(e));
  process.exit(1);
});

// Runs the reader and safety checker (nothing is executed) on a list of real how-to pages and prints a results table.
//   npm run eval -- pages.txt            (one address per line; # for comments)
//   npm run eval -- pages.txt --csv      (also writes demo/eval-results.csv)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPageText } from "../mac/text.js";
import { describeEnvironment, probeEnvironment } from "../core/probe.js";
import { applyAiConcerns, planSteps } from "../core/plan.js";
import { friendlyError, hasApiKey, loadEnv } from "../ai/client.js";
import { parseInstructions } from "../ai/parse.js";

loadEnv(process.env.CALHACK_ROOT ?? process.cwd());

interface Row {
  page: string;
  goal: string;
  steps: number;
  runsAlone: number;
  asks: number;
  blocked: number;
  outdated: number;
  wrongComputer: number;
  clickSteps: number;
  alternatives: number;
  pageWarning: string;
}

async function main(): Promise<void> {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Give a file with one page address per line.");
  if (!hasApiKey()) throw new Error("This needs ANTHROPIC_API_KEY in .env.");
  const urls = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const env = describeEnvironment(await probeEnvironment());
  const rows: Row[] = [];

  for (const url of urls) {
    process.stderr.write(`Reading ${url} …\n`);
    try {
      const source = { kind: "webpage" as const, text: await fetchPageText(url), location: url, app: "eval" };
      const parsed = await parseInstructions({ source, environment: env, allowCache: true });
      const plan = planSteps(parsed.steps, source);
      applyAiConcerns(plan, parsed.pageConcerns, parsed.appliesToThisComputer);
      const runs = plan.steps.filter((p) => p.step.kind === "command" || p.step.kind === "download");
      rows.push({
        page: url,
        goal: parsed.goal,
        steps: plan.steps.length,
        runsAlone: runs.filter((p) => p.level !== "blocked" && p.flags.length === 0 && !p.needsReview).length,
        asks: runs.filter((p) => p.level !== "blocked" && (p.flags.length > 0 || p.needsReview)).length,
        blocked: runs.filter((p) => p.level === "blocked").length,
        outdated: plan.steps.filter((p) => p.assessment.outdated).length,
        wrongComputer: plan.steps.filter((p) => p.assessment.wrongPlatform).length + (parsed.appliesToThisComputer ? 0 : 1),
        clickSteps: plan.steps.filter((p) => p.step.kind === "manual").length,
        alternatives: new Set(plan.steps.map((p) => p.step.alternativeGroup).filter(Boolean)).size,
        pageWarning: [...plan.pageWarnings.map((w) => w.reason), ...parsed.pageConcerns.map((c) => c.text)][0] ?? "",
      });
    } catch (e) {
      rows.push({ page: url, goal: "⚠️ " + friendlyError(e), steps: 0, runsAlone: 0, asks: 0, blocked: 0, outdated: 0, wrongComputer: 0, clickSteps: 0, alternatives: 0, pageWarning: "" });
    }
  }

  const head = ["Page", "Goal", "Steps", "Runs alone", "Asks first", "Blocked", "Outdated", "Wrong computer", "Click steps", "Alt. groups", "Page warning"];
  const cells = (r: Row) => [r.page, r.goal, r.steps, r.runsAlone, r.asks, r.blocked, r.outdated, r.wrongComputer, r.clickSteps, r.alternatives, r.pageWarning].map(String);
  console.log("| " + head.join(" | ") + " |");
  console.log("|" + head.map(() => "---").join("|") + "|");
  for (const r of rows) console.log("| " + cells(r).map((c) => c.replace(/\|/g, "/")).join(" | ") + " |");
  const sum = (k: keyof Row) => rows.reduce((n, r) => n + (r[k] as number), 0);
  console.log(`\n${rows.length} pages · ${sum("steps")} steps · ${sum("blocked")} blocked · ${sum("asks")} asked first · ${sum("outdated")} outdated · ${sum("wrongComputer")} for the wrong computer`);

  if (process.argv.includes("--csv")) {
    const out = join(process.env.CALHACK_ROOT ?? process.cwd(), "demo", "eval-results.csv");
    const q = (c: string) => `"${c.replace(/"/g, '""')}"`;
    writeFileSync(out, [head, ...rows.map(cells)].map((r) => r.map(q).join(",")).join("\n"));
    console.log(`Saved ${out}`);
  }
}

main().catch((e) => {
  console.error("⚠️ " + friendlyError(e));
  process.exit(1);
});

// Checks Droid is set up: which models your Factory account can use (look for Claude) and which tools Droid has.
//   npm run droid:check
import { loadEnv } from "../ai/client.js";
import { droidPath, droidProblem } from "../droid/executor.js";

loadEnv(process.env.CALHACK_ROOT ?? process.cwd());

async function main(): Promise<void> {
  const problem = droidProblem();
  if (problem) {
    console.log(`Droid isn't ready: ${problem}.`);
    console.log("1. Install the droid program (see docs.factory.ai), 2. put FACTORY_API_KEY=... in .env.");
    process.exit(1);
  }
  const { createSession, listModels } = await import("@factory/droid-sdk/node");
  const execPath = droidPath() ?? undefined;
  console.log(`droid program: ${execPath}`);

  const models = await listModels({ execPath });
  console.log("\nModels you can use:");
  for (const m of models as Array<Record<string, unknown>>) {
    const id = String(m.id ?? m.modelId ?? "?");
    const name = String(m.displayName ?? m.name ?? "");
    console.log(`  ${/claude|opus|sonnet|haiku/i.test(id + name) ? "⭐" : " "} ${id}${name ? `  (${name})` : ""}`);
  }
  console.log("Put the one you want in .env as CALHACK_DROID_MODEL=<id> (⭐ = Claude).");

  const session = await createSession({ execPath });
  try {
    const tools = await session.listTools();
    console.log("\nDroid's tools:");
    for (const t of tools) console.log(`  ${t.allowed ? "✓" : "✗"} ${t.id}`);
    const skills = await session.listSkills().catch(() => null);
    if (skills) console.log("\nSkills:", JSON.stringify(skills).slice(0, 400));
  } finally {
    await session.close();
  }
}

main().catch((e) => {
  console.error("⚠️ " + ((e as Error).message ?? e));
  process.exit(1);
});

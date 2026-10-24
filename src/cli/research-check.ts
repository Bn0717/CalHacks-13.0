// Tries the official-source lookup live and checks the answer.
//   npx tsx src/cli/research-check.ts "install zoom"
import { loadEnv } from "../ai/client.js";
import { checkOfficial } from "../core/official.js";
import { findOfficialSource } from "../droid/research.js";

loadEnv(process.env.CALHACK_ROOT ?? process.cwd());

async function main(): Promise<void> {
  const ask = process.argv.slice(2).join(" ").trim();
  if (!ask) {
    console.log('Usage: npx tsx src/cli/research-check.ts "install zoom"');
    process.exit(1);
  }
  const installApp = /^install\s+(.+)/i.exec(ask)?.[1]?.trim();
  const query = installApp ? `${installApp} download for Mac` : ask;
  const started = Date.now();
  const src = await findOfficialSource(ask, query, { installApp });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log("What Droid did:");
  for (const line of src.log) console.log("  " + line);
  console.log(`\nkind:        ${src.kind}\nurl:         ${src.url}\ntitle:       ${src.title}\npublisher:   ${src.publisher}\ndownloadUrl: ${src.downloadUrl ?? "(none)"}`);
  console.log(`citations:   ${src.citations.slice(0, 8).join("\n             ")}`);
  const verdict = checkOfficial(src);
  console.log(`\nOfficial? ${verdict.ok ? "✅" : "⛔"} ${verdict.reason} (${verdict.host})`);
  if (src.downloadUrl) {
    const page = checkOfficial({ ...src, downloadUrl: undefined });
    console.log(`Page alone: ${page.ok ? "✅" : "⛔"} ${page.reason}`);
  }
  console.log(`Took ${seconds}s`);
}

main().catch((e) => {
  console.error("⚠️ " + ((e as Error).message ?? e));
  for (const line of ((e as { log?: string[] }).log ?? [])) console.error("  " + line);
  process.exit(1);
});

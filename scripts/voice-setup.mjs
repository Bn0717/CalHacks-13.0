// Downloads the small English speech model (~142 MB) so voice works offline.
// Saves to ~/.cache/calhack/ggml-base.en.bin. Run with: npm run voice:setup
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const URL_ = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const DIR = join(homedir(), ".cache", "calhack");
const DEST = join(DIR, "ggml-base.en.bin");
const PART = DEST + ".part";
const MIN_BYTES = 100 * 1024 * 1024;

const mb = (n) => (n / 1024 / 1024).toFixed(1);

if (existsSync(DEST) && statSync(DEST).size > MIN_BYTES) {
  console.log(`Speech model already installed: ${DEST}`);
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
console.log(`Downloading speech model to ${DEST}`);

try {
  const res = await fetch(URL_, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0;
  let lastPrint = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    got += chunk.length;
    const now = Date.now();
    if (now - lastPrint > 250) {
      lastPrint = now;
      const pct = total ? ` (${Math.floor((got / total) * 100)}%)` : "";
      process.stdout.write(`\r  ${mb(got)} MB${total ? ` of ${mb(total)} MB` : ""}${pct}   `);
    }
  });
  await pipeline(body, createWriteStream(PART));
  process.stdout.write(`\r  ${mb(got)} MB done.                    \n`);

  const size = statSync(PART).size;
  if (size < MIN_BYTES) throw new Error(`file is only ${mb(size)} MB, which is too small`);
  if (total && size !== total) throw new Error(`got ${size} bytes but expected ${total}`);
  renameSync(PART, DEST);
  console.log(`Done. Voice is ready: ${DEST}`);
} catch (e) {
  rmSync(PART, { force: true });
  console.error(`\nCouldn't download the speech model: ${e instanceof Error ? e.message : e}`);
  console.error("Check your internet connection and run it again.");
  process.exit(1);
}

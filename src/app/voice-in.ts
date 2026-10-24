// Hold-to-talk speech to text, fully on this Mac with whisper.cpp. Nothing is sent to the cloud.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const MAX_WAV_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const WHISPER_PATHS = ["/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"];

/** Places we look for a model, best first. */
export function modelCandidates(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const list: string[] = [];
  const fromEnv = env.CALHACK_WHISPER_MODEL?.trim();
  if (fromEnv) list.push(fromEnv);
  list.push(
    join(home, ".cache", "calhack", "ggml-base.en.bin"),
    join(home, ".cache", "calhack", "ggml-small.en.bin"),
    join(home, ".cache", "hyperframes", "whisper", "models", "ggml-large-v3.bin"),
  );
  return list;
}

/** First model that exists. `exists` can be swapped in tests. */
export function pickModel(candidates: string[], exists: (p: string) => boolean = existsSync): { path: string; name: string } | null {
  for (const path of candidates) {
    if (exists(path)) return { path, name: basename(path).replace(/^ggml-/, "").replace(/\.bin$/, "") };
  }
  return null;
}

/** Which model will be used, or null if none is installed. */
export function voiceModel(): { path: string; name: string } | null {
  return pickModel(modelCandidates());
}

function whisperPath(): string | null {
  const fromEnv = process.env.CALHACK_WHISPER_CLI?.trim();
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  return WHISPER_PATHS.find((p) => existsSync(p)) ?? null;
}

/** Plain reason voice can't work right now, or null if it can. */
export function voiceProblem(): string | null {
  if (!whisperPath()) return "Voice needs the free whisper.cpp tool. Install it with: brew install whisper-cpp";
  if (!voiceModel()) return "Voice needs its speech model. Run: npm run voice:setup";
  return null;
}

/** True if the bytes look like a real WAV file (RIFF....WAVE) of a sane size. */
export function isWav(buf: Buffer): boolean {
  if (buf.length < 44 || buf.length > MAX_WAV_BYTES) return false;
  return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
}

/** Drop whisper's tags like [BLANK_AUDIO] or (music) and tidy the spaces. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toBuffer(wav: Buffer | ArrayBuffer): Buffer {
  return Buffer.isBuffer(wav) ? wav : Buffer.from(new Uint8Array(wav));
}

/** Turn a WAV recording into text. Throws an Error with a plain message if it can't. */
export async function transcribe(wav: Buffer | ArrayBuffer): Promise<{ text: string; ms: number; model: string }> {
  const buf = toBuffer(wav);
  if (buf.length > MAX_WAV_BYTES) throw new Error("That recording is too long. Please try a shorter one.");
  if (!isWav(buf)) throw new Error("That recording didn't come through properly. Please try again.");
  const bin = whisperPath();
  if (!bin) throw new Error(voiceProblem() ?? "Voice isn't set up.");
  const model = voiceModel();
  if (!model) throw new Error(voiceProblem() ?? "Voice isn't set up.");

  const dir = await mkdtemp(join(tmpdir(), "calhack-voice-"));
  const file = join(dir, "speech.wav");
  const started = Date.now();
  try {
    await writeFile(file, buf, { mode: 0o600 });
    const threads = String(Math.min(8, Math.max(2, availableParallelism() - 2)));
    const args = ["-m", model.path, "-f", file, "-nt", "-np", "-l", "en", "-t", threads];
    const out = await run(bin, args);
    return { text: cleanTranscript(out), ms: Date.now() - started, model: model.name };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Understanding the recording took too long. Please try again."));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString("utf8")).slice(-2000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't start the speech tool: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`The speech tool stopped with an error (code ${code}). ${err.trim().split("\n").pop() ?? ""}`.trim()));
    });
  });
}

// Sound outputs (speakers, AirPods, displays): list them and switch the default one.
// Uses a tiny CoreAudio helper (audio-devices.swift) that is built once with swiftc into ~/.cache/calhack.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export interface SoundOutput {
  id: number;
  name: string;
  /** "built-in", "bluetooth", "usb", "hdmi", "displayport", "airplay", "virtual", … */
  transport: string;
  default: boolean;
}

/** The Swift source sits next to this file in src/, or two levels up from dist/. */
function swiftSource(): string | null {
  const root = process.env.CALHACK_ROOT ?? join(here, "..", "..");
  const candidates = [join(here, "audio-devices.swift"), join(root, "src", "mac", "audio-devices.swift")];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const HELPER = join(homedir(), ".cache", "calhack", "audio-devices");

/** Builds the helper if it's missing or older than its source. */
export async function audioHelper(): Promise<string> {
  const src = swiftSource();
  const stale = !existsSync(HELPER) || (src !== null && statSync(src).mtimeMs > statSync(HELPER).mtimeMs);
  if (stale) {
    if (!src) throw new Error("The sound helper's source is missing.");
    mkdirSync(dirname(HELPER), { recursive: true });
    await run("/usr/bin/swiftc", ["-O", src, "-o", HELPER], { timeout: 120_000 });
  }
  return HELPER;
}

export function parseOutputs(json: string): SoundOutput[] {
  const raw = JSON.parse(json) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is SoundOutput => !!d && typeof d === "object" && Number.isInteger((d as SoundOutput).id) && typeof (d as SoundOutput).name === "string")
    .map((d) => ({ id: d.id, name: d.name, transport: String(d.transport ?? "other"), default: !!d.default }));
}

export async function listOutputs(): Promise<SoundOutput[]> {
  const helper = await audioHelper();
  const { stdout } = await run(helper, ["list"], { timeout: 10_000 });
  return parseOutputs(stdout);
}

/** Finds an output by name, forgiving case, curly quotes and partial names ("speakers", "airpods"). */
export function matchOutput(outputs: SoundOutput[], wanted: string): SoundOutput | null {
  const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const w = norm(wanted);
  if (!w) return null;
  return (
    outputs.find((o) => norm(o.name) === w) ??
    outputs.find((o) => norm(o.name).includes(w)) ??
    (/\b(mac|speaker|built)/.test(w) ? (outputs.find((o) => o.transport === "built-in") ?? null) : null)
  );
}

export async function setOutput(id: number): Promise<void> {
  if (!Number.isInteger(id) || id < 0) throw new Error("Bad device id.");
  const helper = await audioHelper();
  await run(helper, ["set", String(id)], { timeout: 10_000 });
}

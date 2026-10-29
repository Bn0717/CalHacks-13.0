// Screenshots that leave out CalHack's own windows (screen-capture.swift, built once with swiftc into ~/.cache/calhack).
// With this, CalHack's windows can show up in the person's screen recordings while the AI still sees only their screen.
// If the helper can't be built or stops answering, `available()` turns false and the app hides its windows from every
// capture again before taking a screenshot another way (see main.ts), so the AI never sees CalHack.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export const CAPTURE_HELPER = join(homedir(), ".cache", "calhack", "screen-capture");

function swiftSource(): string | null {
  const root = process.env.CALHACK_ROOT ?? join(here, "..", "..");
  const candidates = [join(here, "screen-capture.swift"), join(root, "src", "mac", "screen-capture.swift")];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function buildHelper(): Promise<string> {
  const src = swiftSource();
  const stale = !existsSync(CAPTURE_HELPER) || (src !== null && statSync(src).mtimeMs > statSync(CAPTURE_HELPER).mtimeMs);
  if (stale) {
    if (!src) throw new Error("The screen capture helper's source is missing.");
    mkdirSync(dirname(CAPTURE_HELPER), { recursive: true });
    await run("/usr/bin/swiftc", ["-O", src, "-o", CAPTURE_HELPER], { timeout: 240_000 });
  }
  return CAPTURE_HELPER;
}

/** Reads the helper's answers: a 4-byte big-endian length, then the image. Pure, so it can be tested. */
export class FrameReader {
  private buf = Buffer.alloc(0);
  push(chunk: Buffer): Buffer[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames: Buffer[] = [];
    while (this.buf.length >= 4) {
      const n = this.buf.readUInt32BE(0);
      if (this.buf.length < 4 + n) break;
      frames.push(this.buf.subarray(4, 4 + n));
      this.buf = this.buf.subarray(4 + n);
    }
    return frames;
  }
}

let child: ChildProcessWithoutNullStreams | null = null;
let broken = false;
let reader = new FrameReader();
const waiting: { resolve: (b: Buffer | null) => void; timer: NodeJS.Timeout }[] = [];
let queue: Promise<unknown> = Promise.resolve();

function fail(reason: string): void {
  if (!broken) console.error(`[capture] ${reason}. CalHack's windows are hidden from screen recordings again.`);
  broken = true;
  child?.kill();
  child = null;
  for (const w of waiting.splice(0)) {
    clearTimeout(w.timer);
    w.resolve(null);
  }
}

/** True while screenshots can leave out CalHack's windows. */
export function available(): boolean {
  return !broken && child !== null;
}

/** Builds and starts the helper, and checks one screenshot works. False means: keep CalHack hidden from captures. */
export async function startCapture(): Promise<boolean> {
  if (child) return true;
  if (broken) return false;
  try {
    const helper = await buildHelper();
    const c = spawn(helper, [String(process.pid)], { stdio: ["pipe", "pipe", "pipe"] });
    child = c;
    reader = new FrameReader();
    c.stdout.on("data", (chunk: Buffer) => {
      for (const frame of reader.push(chunk)) {
        const w = waiting.shift();
        if (!w) continue;
        clearTimeout(w.timer);
        w.resolve(frame.length ? frame : null);
      }
    });
    c.stderr.on("data", (d: Buffer) => { if (process.env.CALHACK_DEBUG) console.log(`[capture] ${d.toString().trim()}`); });
    c.on("exit", () => { if (child === c) fail("The screen capture helper stopped"); });
    c.on("error", (e) => fail(`The screen capture helper couldn't start (${e.message})`));
    const test = await captureWithoutCalHack(64, "png");
    if (!test) {
      fail("The screen capture helper couldn't take a screenshot");
      return false;
    }
    return true;
  } catch (e) {
    fail(`The screen capture helper couldn't be built (${(e as Error).message.split("\n")[0]})`);
    return false;
  }
}

/** A screenshot of the main display without CalHack's windows, `width` pixels wide. null when it failed. */
export function captureWithoutCalHack(width: number, format: "jpeg" | "png"): Promise<Buffer | null> {
  const next = queue.then(
    () =>
      new Promise<Buffer | null>((resolve) => {
        const c = child;
        if (!c || broken) return resolve(null);
        const timer = setTimeout(() => fail("The screen capture helper stopped answering"), 10_000);
        waiting.push({ resolve, timer });
        c.stdin.write(`${Math.max(16, Math.round(width))} ${format}\n`);
      }),
  );
  queue = next.catch(() => null);
  return next;
}

export function stopCapture(): void {
  const c = child;
  child = null;
  c?.kill();
}

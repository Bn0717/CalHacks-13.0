// A persistent local worker keeps the model loaded. No shell or network server.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

let worker: ChildProcessWithoutNullStreams | null = null;
let serial = 0;
const pending = new Map<number, { resolve: (audio: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

export function stopVoiceOut(): void {
  const previous = worker;
  worker = null;
  previous?.kill();
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error("Kokoro speech stopped"));
  }
  pending.clear();
}

export function synthesize(root: string, text: string): Promise<string> {
  if (typeof text !== "string" || !text.trim() || text.length > 2000) return Promise.reject(new Error("Invalid speech text"));
  const folder = join(root, ".kokoro");
  for (const name of ["bin/python", "kokoro-v1.0.onnx", "voices-v1.0.bin"]) {
    if (!existsSync(join(folder, name))) return Promise.reject(new Error("Kokoro is not installed"));
  }
  if (!worker) {
    const child = spawn(join(folder, "bin/python"), [join(root, "scripts/kokoro-worker.py")], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONUNBUFFERED: "1" },
    });
    worker = child;
    child.stderr.on("data", (data: Buffer) => console.error(`[kokoro] ${data.toString().trim()}`));
    const failed = () => { if (worker === child) stopVoiceOut(); };
    child.on("error", failed);
    child.on("exit", failed);
    child.stdin.on("error", failed);
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const result = JSON.parse(line);
        const item = pending.get(result.id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(result.id);
        if (typeof result.audio === "string") item.resolve(result.audio);
        else item.reject(new Error(result.error ?? "Kokoro synthesis failed"));
      } catch { /* Ignore library diagnostics. */ }
    });
  }
  if (pending.size >= 4) return Promise.reject(new Error("Speech queue full"));
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stopVoiceOut(), 60_000);
    pending.set(id, { resolve, reject, timer });
    worker!.stdin.write(JSON.stringify({ id, text }) + "\n");
  });
}

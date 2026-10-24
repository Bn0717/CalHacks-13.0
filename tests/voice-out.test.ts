import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { stopVoiceOut, synthesize } from "../src/app/voice-out.js";

afterEach(() => { stopVoiceOut(); vi.restoreAllMocks(); });

function fakeWorker() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as never);
  return child;
}

it("rejects invalid text before starting a process", async () => {
  await expect(synthesize("/project", "")).rejects.toThrow("Invalid speech text");
  await expect(synthesize("/project", "x".repeat(2001))).rejects.toThrow("Invalid speech text");
});

it("reports a missing local installation", async () => {
  vi.mocked(existsSync).mockReturnValueOnce(false);
  await expect(synthesize("/project", "Hello")).rejects.toThrow("not installed");
});

it("reuses the worker and matches responses to their requests", async () => {
  const child = fakeWorker();
  const requests: { id: number; text: string }[] = [];
  child.stdin.on("data", (data) => requests.push(JSON.parse(data.toString())));
  const first = synthesize("/project", "Hello $(do not execute)");
  const second = synthesize("/project", "Second phrase");
  expect(requests[0].text).toBe("Hello $(do not execute)");
  child.stdout.write(JSON.stringify({ id: requests[1].id, audio: "second" }) + "\n");
  child.stdout.write(JSON.stringify({ id: requests[0].id, audio: "first" }) + "\n");
  await expect(first).resolves.toBe("first");
  await expect(second).resolves.toBe("second");
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("rejects outstanding speech on worker failure", async () => {
  const child = fakeWorker();
  const result = synthesize("/project", "Hello");
  const assertion = expect(result).rejects.toThrow("stopped");
  child.emit("exit", 1);
  await assertion;
});

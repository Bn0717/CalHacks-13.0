// A shortcut made only of modifier keys (like ⌥⌘), which Electron's globalShortcut can't register.
// Uses a small keyboard listener (hotkey.swift), built once with swiftc into ~/.cache/calhack.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const HELPER = join(homedir(), ".cache", "calhack", "hotkey");
const MODIFIERS = new Set(["command", "cmd", "commandorcontrol", "cmdorctrl", "option", "alt", "control", "ctrl", "shift"]);

/** True when the shortcut has no letter or other key, e.g. "Command+Alt". */
export function modifiersOnly(hotkey: string): boolean {
  const parts = hotkey.split("+").map((k) => k.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && parts.every((k) => MODIFIERS.has(k));
}

/** The helper's argument, e.g. "command,option". */
export function helperKeys(hotkey: string): string {
  const map: Record<string, string> = { cmd: "command", commandorcontrol: "command", cmdorctrl: "command", alt: "option", ctrl: "control" };
  return [...new Set(hotkey.split("+").map((k) => k.trim().toLowerCase()).map((k) => map[k] ?? k))].join(",");
}

function swiftSource(): string | null {
  const root = process.env.CALHACK_ROOT ?? join(here, "..", "..");
  const candidates = [join(here, "hotkey.swift"), join(root, "src", "mac", "hotkey.swift")];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function hotkeyHelper(): Promise<string> {
  const src = swiftSource();
  const stale = !existsSync(HELPER) || (src !== null && statSync(src).mtimeMs > statSync(HELPER).mtimeMs);
  if (stale) {
    if (!src) throw new Error("The shortcut helper's source is missing.");
    mkdirSync(dirname(HELPER), { recursive: true });
    await run("/usr/bin/swiftc", ["-O", src, "-o", HELPER], { timeout: 180_000 });
  }
  return HELPER;
}

export interface ModifierHotkey {
  stop(): void;
}

/**
 * Starts listening. onReady/onError report whether it works (it needs Accessibility or Input Monitoring).
 * If the listener crashes it restarts, up to a few times.
 */
export function listenModifierHotkey(hotkey: string, on: { fire: () => void; ready?: () => void; error?: (why: string) => void }): ModifierHotkey {
  let child: ChildProcess | null = null;
  let stopped = false;
  let restarts = 0;
  const start = async () => {
    let helper: string;
    try {
      helper = await hotkeyHelper();
    } catch (e) {
      on.error?.((e as Error).message);
      return;
    }
    if (stopped) return;
    child = spawn(helper, [helperKeys(hotkey)], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    child.stdout?.on("data", (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === "fire") on.fire();
        else if (line === "ready") { restarts = 0; on.ready?.(); }
        else if (line.includes("no-permission")) on.error?.("no-permission");
      }
    });
    child.on("exit", (code) => {
      child = null;
      if (stopped || code === 2) return; // 2 = no permission: restarting won't help
      if (restarts++ < 3) setTimeout(() => void start(), 1000);
      else on.error?.("The shortcut listener keeps stopping.");
    });
  };
  void start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
  };
}

// Looks at the computer before planning: macOS version, chip, installed tools and apps.
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runSandboxed } from "./exec.js";

export interface Environment {
  os: "macOS";
  osVersion: string;
  chip: string;
  homebrew: string | null;
  python3: string | null;
  apps: string[];
}

async function firstLine(command: string): Promise<string | null> {
  const r = await runSandboxed(command, 15_000);
  const line = r.output.trim().split("\n")[0]?.trim();
  return r.code === 0 && line ? line : null;
}

function listApps(): string[] {
  const names = new Set<string>();
  for (const dir of ["/Applications", join(homedir(), "Applications")]) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".app")) names.add(f.slice(0, -4));
    } catch {
      // Folder missing or not readable: skip it.
    }
  }
  return [...names].sort();
}

export async function probeEnvironment(): Promise<Environment> {
  const [osVersion, chip, homebrew, python3] = await Promise.all([
    firstLine("sw_vers -productVersion"),
    firstLine("uname -m"),
    firstLine("brew --version"),
    firstLine("python3 --version"),
  ]);
  return {
    os: "macOS",
    osVersion: osVersion ?? "unknown",
    chip: chip === "arm64" ? "Apple silicon (arm64)" : chip === "x86_64" ? "Intel (x86_64)" : chip ?? "unknown",
    homebrew,
    python3,
    apps: listApps(),
  };
}

/** A short description of the computer for the AI. */
export function describeEnvironment(env: Environment): string {
  return [
    `Operating system: macOS ${env.osVersion}`,
    `Chip: ${env.chip}`,
    `Homebrew: ${env.homebrew ?? "not installed"}`,
    `Python 3: ${env.python3 ?? "not installed"}`,
    `Installed apps: ${env.apps.slice(0, 80).join(", ")}`,
  ].join("\n");
}

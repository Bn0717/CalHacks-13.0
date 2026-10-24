// The real Mac behind the agent's tools. Tests and the practice mode swap these for fakes.
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { runNormally, runSandboxed } from "../core/exec.js";
import { realCheckRunner } from "../core/fixes/index.js";
import { installFromOfficial, knownInstaller } from "../core/install.js";
import { checkOfficial } from "../core/official.js";
import type { Executor } from "../core/runner.js";
import { findAppBundles } from "../core/uninstall.js";
import { findOfficialSource } from "../droid/research.js";
import { listOutputs, setOutput } from "../mac/audio.js";
import { actCommand, actOn, controlCenter, listWindow, typeInto } from "../mac/ui.js";
import type { ScreenDeps } from "./autopilot.js";
import { folderPath } from "./danger.js";
import { listFilesIn, type AppInfo, type MacDeps } from "./tools.js";

const run = promisify(execFile);

function appleString(text: string): string {
  return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export function listInstalledApps(home = homedir()): AppInfo[] {
  const out: AppInfo[] = [];
  for (const dir of ["/Applications", join(home, "Applications"), "/System/Applications", "/System/Applications/Utilities"]) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".app")) out.push({ name: f.slice(0, -4), path: join(dir, f) });
    } catch {
      // Missing folder: skip.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Quits an app politely, waiting up to ~5 s. Doesn't open it if it isn't running. */
export async function quitAppAt(path: string): Promise<void> {
  const app = appleString(path);
  const script = `with timeout of 15 seconds\nif application ${app} is running then\ntell application ${app} to quit\nrepeat 20 times\nif not (application ${app} is running) then exit repeat\ndelay 0.25\nend repeat\nif application ${app} is running then error "The app didn't close, so I left it alone."\nend if\nend timeout`;
  await run("/usr/bin/osascript", ["-e", script], { timeout: 20_000 });
}

/** Force-quits an app by its program name (read from the app's own Info.plist), e.g. "Safari". */
export async function forceQuitAppAt(path: string): Promise<void> {
  const dirs = ["/Applications/", "/System/Applications/", join(homedir(), "Applications") + "/"];
  const dir = dirs.find((d) => path.startsWith(d));
  const rest = dir ? path.slice(dir.length) : "";
  if (!dir || !rest.endsWith(".app") || rest.includes("/")) throw new Error("Not an app in Applications.");
  const { stdout } = await run("/usr/bin/defaults", ["read", join(path, "Contents", "Info"), "CFBundleExecutable"], { timeout: 5_000 });
  const exe = stdout.trim();
  if (!/^[A-Za-z0-9 ._+-]{1,80}$/.test(exe)) throw new Error("This app's program name looks unusual, so I left it alone.");
  await run("/usr/bin/pkill", ["-9", "-x", exe]).catch((e: { code?: number }) => {
    if (e.code !== 1) throw e; // 1 = nothing was running
  });
  await new Promise((r) => setTimeout(r, 800));
}

export async function runningAppNames(): Promise<string[]> {
  const { stdout } = await run("/usr/bin/osascript", ["-e", 'tell application "System Events" to get name of (every application process whose background only is false)'], { timeout: 10_000 });
  return stdout.trim().split(/,\s*/).filter(Boolean);
}

const KIND_TYPES: Record<string, string> = {
  document: "public.content",
  pdf: "com.adobe.pdf",
  image: "public.image",
  movie: "public.movie",
  music: "public.audio",
  presentation: "public.presentation",
  spreadsheet: "public.spreadsheet",
  folder: "public.folder",
  app: "com.apple.application-bundle",
};

/** Spotlight query text. Values are cleaned so they can't change the query's meaning. */
export function spotlightQuery(q: { name?: string; contentWord?: string; kind?: string; modifiedWithinDays?: number }): string | null {
  const clean = (v: string) => v.replace(/["\\*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const parts: string[] = [];
  if (q.name && clean(q.name)) parts.push(`kMDItemFSName == "*${clean(q.name)}*"cd`);
  if (q.contentWord && clean(q.contentWord)) parts.push(`kMDItemTextContent == "*${clean(q.contentWord)}*"cd`);
  if (q.kind && KIND_TYPES[q.kind]) parts.push(`kMDItemContentTypeTree == "${KIND_TYPES[q.kind]}"`);
  if (q.modifiedWithinDays && q.modifiedWithinDays > 0) parts.push(`kMDItemFSContentChangeDate >= $time.today(-${Math.min(3650, Math.round(q.modifiedWithinDays))})`);
  return parts.length ? parts.join(" && ") : null;
}

export function spotlight(q: Parameters<MacDeps["spotlight"]>[0], timeoutMs: number, home = homedir()): Promise<{ paths: string[]; timedOut: boolean; ms: number }> {
  const query = spotlightQuery(q);
  const t0 = Date.now();
  if (!query) return Promise.resolve({ paths: [], timedOut: false, ms: 0 });
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/mdfind", ["-onlyin", home, query]);
    let out = "";
    let timedOut = false;
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
      if (out.length > 400_000) child.kill();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ paths: out.split("\n").filter(Boolean), timedOut, ms: Date.now() - t0 });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ paths: [], timedOut: false, ms: Date.now() - t0 });
    });
  });
}

/** Finds the maker's official installer and installs it (signature checked, macOS password box). */
export async function installOfficialApp(appName: string): Promise<{ ok: boolean; message: string; evidence: import("../core/types.js").Evidence[] }> {
  const known = knownInstaller(appName);
  let url = known?.url ?? null;
  let publisher = known?.publisher ?? appName;
  let name = known?.appName ?? appName;
  if (!url) {
    try {
      const src = await findOfficialSource(`Install ${appName}`, `${appName} official Mac download`, { installApp: appName });
      if (src.downloadUrl && checkOfficial(src).ok) {
        url = src.downloadUrl;
        publisher = src.publisher;
      }
    } catch {
      // Fall through.
    }
  }
  if (!url) return { ok: false, message: `I couldn't find ${appName}'s official installer, so I didn't download anything. I never use other websites.`, evidence: [] };
  const r = await installFromOfficial({ url, publisher, appName: name });
  if (r.ok && r.appPath) await run("/usr/bin/open", [r.appPath]).catch(() => {});
  return { ok: r.ok, message: r.ok ? `${name} is installed and opening.` : r.message, evidence: r.evidence };
}

/** The real Mac. `trash` comes from Electron (shell.trashItem) in the app, or Finder in the terminal. */
export function realMac(opts: { execute: Executor; trash: (path: string) => Promise<void>; protectedApps?: string[]; screen?: ScreenDeps }): MacDeps {
  // The window reader goes with screen access: both are part of "CalHack can work on your screen".
  const ui = opts.screen ? { list: listWindow, act: actOn, type: typeInto, command: actCommand, controlCenter } : undefined;
  const home = homedir();
  return {
    home,
    screen: opts.screen,
    ui,
    protectedApps: ["Finder", "CalHack", "Electron", ...(opts.protectedApps ?? [])],
    sandboxed: (c, t) => runSandboxed(c, t),
    checkRunner: realCheckRunner,
    execute: opts.execute,
    run: (c) => runNormally(c, 30_000),
    listApps: () => listInstalledApps(home),
    findApp: (name) => findAppBundles(name),
    runningApps: () => runningAppNames().catch(() => []),
    quitApp: quitAppAt,
    forceQuitApp: forceQuitAppAt,
    openApp: async (path) => {
      await run("/usr/bin/open", [path]);
    },
    trash: opts.trash,
    exists: existsSync,
    listOutputs,
    setOutput,
    listFiles: (folder, max) => listFilesIn(folderPath(folder, home), max),
    spotlight: (q, t) => spotlight(q, t, home),
    installOfficial: installOfficialApp,
    reveal: async (path, open) => {
      await run("/usr/bin/open", open ? [path] : ["-R", path]);
    },
    now: () => Date.now(),
  };
}

/** Moving to the Trash from the terminal (outside Electron), through Finder. */
export async function finderTrash(path: string): Promise<void> {
  await run("/usr/bin/osascript", ["-e", `tell application "Finder" to delete (POSIX file ${appleString(path)} as alias)`], { timeout: 20_000 });
}

export { runNormally };

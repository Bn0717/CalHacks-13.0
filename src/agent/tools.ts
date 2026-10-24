// The tools Claude can use to help the person. Each one is our own code:
//  - "look" tools only read (apps, sound, printer, internet, disk, files).
//  - "act" tools change something, always in a way that can be undone (Trash, not delete), and the risky ones ask first.
// Every check that runs is kept as evidence (E1, E2…) so the receipt can show what proves what.
import { readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { ExecResult } from "../core/exec.js";
import { assessCommand } from "../core/risk.js";
import type { Executor } from "../core/runner.js";
import type { Evidence } from "../core/types.js";
import { buildFixes, diagnose, getGuide, verifyFix, type CheckRunner, type Diagnosis } from "../core/fixes/index.js";
import { OFFICIAL_PUBLISHERS } from "../core/official.js";
import { NEVER_OPEN, realRecipeDeps, recipeNormal, runRecipe } from "../core/recipes.js";
import { uninstallApp } from "../core/uninstall.js";
import { BLUETOOTH_STATE_CHECK, bluetoothSetCommand, parseBluetooth } from "../mac/bluetooth.js";
import { parsePower, parseWifiDevice, safeDevice } from "../core/fixes/wifi.js";
import { matchOutput, type SoundOutput } from "../mac/audio.js";
import { autopilot, fileRecord, type ScreenDeps } from "./autopilot.js";
import { folderPath, humanSize, insideUserFolder, removalTier, USER_FOLDERS, type UserFolder } from "./danger.js";

export interface AppInfo {
  name: string;
  path: string;
}

export interface FileInfo {
  path: string;
  bytes: number;
  modified: number;
}

/** Everything the tools touch on the Mac, so tests can swap in fakes. */
export interface MacDeps {
  sandboxed(command: string, timeoutMs?: number): Promise<ExecResult>;
  checkRunner: CheckRunner;
  /** Runs a risky or system-changing command. In the app this is Droid, behind CalHack's gate. */
  execute: Executor;
  /** Runs a routine, harmless command directly (opening an app or page, a click). Not for anything risky. */
  run(command: string): Promise<ExecResult>;
  listApps(): AppInfo[];
  findApp(name: string): string[];
  runningApps(): Promise<string[]>;
  quitApp(path: string): Promise<void>;
  /** Force-quits an app that doesn't respond (unsaved work in it is lost). */
  forceQuitApp(path: string): Promise<void>;
  openApp(path: string): Promise<void>;
  trash(path: string): Promise<void>;
  exists(path: string): boolean;
  listOutputs(): Promise<SoundOutput[]>;
  setOutput(id: number): Promise<void>;
  listFiles(folder: UserFolder, maxFiles: number): FileInfo[];
  /** Spotlight search in the person's home folder. timedOut = it ran out of time before finishing. */
  spotlight(query: { name?: string; contentWord?: string; kind?: string; modifiedWithinDays?: number }, timeoutMs: number): Promise<{ paths: string[]; timedOut: boolean; ms: number }>;
  installOfficial(appName: string): Promise<{ ok: boolean; message: string; evidence: Evidence[] }>;
  /** Shows a file in Finder, or opens it. */
  reveal(path: string, open: boolean): Promise<void>;
  now(): number;
  /** Lets CalHack see the screen so it can finish a step itself. Missing = it asks the person instead. */
  screen?: ScreenDeps;
  home: string;
  /** Apps CalHack must never close: Finder, CalHack itself, and (while developing) the app it was started from. */
  protectedApps: string[];
}

export interface ConfirmRequest {
  title: string;
  message: string;
  details?: string[];
  yes: string;
  no: string;
  /** The person must type this word to confirm (for big removals). */
  typeToConfirm?: string;
  tone?: "normal" | "danger";
}

export interface AgentUI {
  /** One plain line about what's happening now. */
  status(line: string): void;
  /** Says it out loud (and as a caption). Short and calm. */
  say(text: string): void;
  /** A short question (spoken) with 2-4 answer buttons, and an optional longer note shown below it. */
  ask(question: string, choices: string[], note?: string): Promise<string>;
  confirm(c: ConfirmRequest): Promise<boolean>;
  /** A teaching screen. Resolves when the person closes it. */
  explain(e: { title: string; paragraphs: string[]; steps?: string[] }): Promise<void>;
  /** Something only the person can click (macOS doesn't allow it by command). The bar tells them what to click. */
  /** point: where on screen the thing to click is (screen points), so CalHack can point right at it. */
  guide(g: { instruction: string; clickTarget?: string; settingsUrl?: string; point?: { x: number; y: number; label: string } }): Promise<"done" | "skip">;
  /** Details for "show what's happening". */
  detail(text: string, mono?: boolean): void;
}

export interface ToolContext {
  mac: MacDeps;
  ui: AgentUI;
  evidence: Evidence[];
  /** Checks from check_problem, kept so fix_problem can compare before and after. */
  diagnoses: Map<string, Diagnosis>;
  /** Before → after rows for the receipt. */
  beforeAfter: { label: string; before: string; after: string }[];
  /** A tool sets this when the run must end now without another call to Claude (e.g. Wi-Fi was just switched off). */
  autoFinish?: { headline: string; details: string[]; proofRefs: { ref: string; shows: string }[] };
  /** True once the person pressed Stop or Cancel. Long loops check it before every action. */
  stopped?: () => boolean;
  /** Aborted the moment the person presses Stop: requests in flight are cancelled and loops end at once. */
  signal?: AbortSignal;
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  kind: "look" | "act" | "talk";
  /** Plain words for the bar while it runs, e.g. "Looking at your apps…". */
  label(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

// ---------------- helpers ----------------

function input_force(input: Record<string, unknown>): boolean {
  return input.force === true;
}

function tail(text: string, lines = 8): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

/** Records evidence and returns its reference, e.g. "E3". */
export function addEvidence(ctx: ToolContext, e: Evidence): string {
  ctx.evidence.push(e);
  return "E" + ctx.evidence.length;
}

function obj(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const str = (description: string) => ({ type: "string", description });
const strOrNull = (description: string) => ({ type: ["string", "null"], description });
const numOrNull = (description: string) => ({ type: ["number", "null"], description });

function s(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === "string" ? v.trim() : "";
}

function n(input: Record<string, unknown>, key: string): number | null {
  const v = input[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asFolder(value: string): UserFolder | null {
  const f = USER_FOLDERS.find((x) => x.toLowerCase() === value.toLowerCase());
  return f ?? null;
}

/** Recipes run their changing commands through the same executor as everything else (Droid, behind its gate). */
function recipeDeps(ctx: ToolContext) {
  return { ...realRecipeDeps, sandboxed: (c: string, t?: number) => ctx.mac.sandboxed(c, t), normal: recipeNormal((c, t) => ctx.mac.execute(c, t), (c) => ctx.mac.run(c)) };
}

/** Only macOS Settings pages, written the way macOS writes them. */
const SETTINGS_URL = /^x-apple\.systempreferences:[A-Za-z0-9._\-?=&]+$/;

function isOfficialHost(host: string): boolean {
  return OFFICIAL_PUBLISHERS.some((p) => p.domains.some((d) => host === d || host.endsWith("." + d)));
}

/** An https link to a maker's or Apple's own site, or null. */
function officialUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !isOfficialHost(url.hostname.toLowerCase())) return null;
  return url.href;
}

function shq(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

/**
 * A step only the screen can finish (a click somewhere). CalHack opens the page, then looks at the screen every few seconds
 * and does the clicks itself. The AI judges each action: parts that need the person's own hands, and anything it can't work out, go to the person.
 */
async function finishOnScreen(ctx: ToolContext, g: { instruction: string; clickTarget?: string; settingsUrl?: string }): Promise<{ result: "done" | "skip"; by: "calhack" | "person"; trail: string[] }> {
  const url = g.settingsUrl && SETTINGS_URL.test(g.settingsUrl) ? g.settingsUrl : undefined;
  if (!ctx.mac.screen) return { result: await ctx.ui.guide(g), by: "person", trail: ["No screen access"] };
  if (url) {
    const r = await ctx.mac.run(`open ${shq(url)}`);
    addEvidence(ctx, { kind: "run", command: `open ${shq(url)}`, code: r.code, output: tail(r.output, 2) });
    await new Promise((x) => setTimeout(x, 1500));
  }
  ctx.ui.say("Let me take care of that for you.");
  const r = await autopilot(ctx, { instruction: g.instruction, clickTarget: g.clickTarget, stopped: ctx.stopped, record: fileRecord });
  if (r.outcome === "done") return { result: "done", by: "calhack", trail: r.trail };
  if (r.outcome === "skipped" || r.outcome === "stopped") return { result: "skip", by: "person", trail: r.trail };
  // It couldn't finish: the person gets the plain version, and is told why.
  const why = r.needsAccessibility ? `${r.trail.at(-1)}. For now: ` : "";
  return { result: await ctx.ui.guide({ ...g, instruction: why + g.instruction }), by: "person", trail: r.trail };
}

function appLabel(path: string): string {
  return path.split("/").pop()!.replace(/\.app$/, "");
}

/**
 * One app by name, or a sentence saying why not. Removing an app only accepts real app folders in Applications;
 * closing or opening also accepts Apple's own apps (Safari's entry in Applications is a shortcut into the system).
 */
function oneApp(ctx: ToolContext, name: string, forRemoval = false): { path: string } | { problem: string } {
  let found = ctx.mac.findApp(name);
  if (!found.length && !forRemoval) {
    const key = name.toLowerCase().replace(/\.app$/, "").replace(/[^a-z0-9]/g, "");
    const alias: Record<string, string> = { zoom: "zoomus", chrome: "googlechrome", settings: "systemsettings", appstore: "appstore" };
    const want = alias[key] ?? key;
    found = [...new Set(ctx.mac.listApps().filter((a) => [key, want].includes(a.name.toLowerCase().replace(/[^a-z0-9]/g, ""))).map((a) => a.path))].slice(0, 1);
  }
  if (found.length === 0) {
    const close = ctx.mac.listApps().filter((a) => a.name.toLowerCase().includes(name.toLowerCase().slice(0, 4))).slice(0, 5).map((a) => a.name);
    return { problem: `No app called "${name}" is installed.${close.length ? ` Similar names: ${close.join(", ")}.` : ""}` };
  }
  if (found.length > 1) return { problem: `More than one app matches "${name}": ${found.join(", ")}. Ask the person which one.` };
  return { path: found[0] };
}

interface FileFilter {
  nameContains: string;
  olderThanDays: number | null;
  largerThanMb: number | null;
}

function filterFiles(files: FileInfo[], f: FileFilter, now: number): FileInfo[] {
  const name = f.nameContains.toLowerCase();
  return files.filter(
    (x) =>
      (!name || x.path.toLowerCase().split("/").pop()!.includes(name)) &&
      (f.olderThanDays === null || now - x.modified > f.olderThanDays * 86_400_000) &&
      (f.largerThanMb === null || x.bytes > f.largerThanMb * 1024 * 1024),
  );
}

// ---------------- look ----------------

const listApps: AgentTool = {
  name: "list_apps",
  kind: "look",
  description: "List the apps installed in Applications. Optionally only those whose name contains some text. Use it to check whether an app is installed and its exact name.",
  input_schema: obj({ name_contains: strOrNull("Part of the app name, or null for all apps") }),
  label: () => "Looking at your apps…",
  async run(input, ctx) {
    const q = s(input, "name_contains").toLowerCase();
    const apps = ctx.mac.listApps().filter((a) => !q || a.name.toLowerCase().includes(q));
    const ref = addEvidence(ctx, { kind: "before", command: `ls /Applications${q ? ` | grep -i ${JSON.stringify(q)}` : ""}`, code: 0, output: apps.slice(0, 20).map((a) => a.name).join(", ") });
    if (!apps.length) return `[${ref}] No installed app matches "${q}".`;
    return `[${ref}] ${apps.length} app(s): ${apps.slice(0, 80).map((a) => `${a.name} (${a.path})`).join("; ")}`;
  },
};

const runningApps: AgentTool = {
  name: "running_apps",
  kind: "look",
  description: "List the apps that are open right now.",
  input_schema: obj({}),
  label: () => "Checking which apps are open…",
  async run(_input, ctx) {
    const names = await ctx.mac.runningApps();
    const ref = addEvidence(ctx, { kind: "before", command: "list open apps", code: 0, output: names.join(", ") });
    return `[${ref}] Open apps: ${names.join(", ") || "none"}`;
  },
};

const soundStatus: AgentTool = {
  name: "sound_status",
  kind: "look",
  description: "The Mac's volume, whether it's muted, and every sound output (speakers, AirPods, monitors) with which one is in use.",
  input_schema: obj({}),
  label: () => "Checking your sound…",
  async run(_input, ctx) {
    const v = await ctx.mac.sandboxed("osascript -e 'get volume settings'");
    const outputs = await ctx.mac.listOutputs().catch(() => [] as SoundOutput[]);
    const ref = addEvidence(ctx, { kind: "before", command: "osascript -e 'get volume settings'", code: v.code, output: tail(v.output, 2) });
    const ref2 = addEvidence(ctx, { kind: "before", command: "list sound outputs", code: outputs.length ? 0 : 1, output: outputs.map((o) => `${o.name}${o.default ? " (in use)" : ""}`).join(", ") });
    return `[${ref}] ${tail(v.output, 2)}\n[${ref2}] Sound outputs: ${outputs.map((o) => `"${o.name}" (${o.transport}${o.default ? ", IN USE" : ""})`).join("; ") || "couldn't list them"}`;
  },
};

const AREAS = ["printer", "sound", "wifi"] as const;

const checkProblem: AgentTool = {
  name: "check_problem",
  kind: "look",
  description: "Run CalHack's built-in read-only checks for a common problem area: printer (paused, stuck jobs, missing driver, not set up), sound (muted, volume, output), wifi (Wi-Fi off, no address, no internet, website lookups failing). Returns what's wrong and which built-in fixes apply. Call this before fix_problem.",
  input_schema: obj({ area: { type: "string", enum: [...AREAS], description: "Which area to check" } }),
  label: (i) => `Checking your ${s(i, "area") === "wifi" ? "internet" : s(i, "area")}…`,
  async run(input, ctx) {
    const guide = getGuide(s(input, "area"));
    if (!guide) return "Unknown area.";
    const d = await diagnose(guide, ctx.mac.checkRunner, (_id, r) => ctx.ui.status(`${r.label}: ${r.status === "ok" ? "OK" : r.status === "problem" ? r.detail : "not sure"}`));
    ctx.diagnoses.set(guide.id, d);
    // Each check line carries the number of the command it read, so proofs point at the right check.
    const refByCommand = new Map(d.evidence.map((e) => [e.command, addEvidence(ctx, e)]));
    const lines = d.results.map((r) => `- ${r.command && refByCommand.has(r.command) ? `[${refByCommand.get(r.command)}] ` : ""}${r.label}: ${r.status}${r.detail ? ` (${r.detail})` : ""}`);
    const refs = [...refByCommand.values()];
    const fixes = buildFixes(d).map((f) => `- ${f.label}${f.kind === "manual" ? " (the person must click this; use guide_person)" : ""}`);
    return [
      `Checks (${refs.length} commands ran; a check passed if its status is ok):`,
      ...lines,
      d.problem ? `Problem: ${d.problem}` : "Nothing wrong found by these checks.",
      fixes.length ? `Built-in fixes that apply (fix_problem runs them):\n${fixes.join("\n")}` : "No built-in fix applies.",
      `Status now: ${d.status.map((r) => `${r.label}: ${r.value}`).join("; ")}`,
    ].join("\n");
  },
};

const diskUsage: AgentTool = {
  name: "disk_usage",
  kind: "look",
  description: "How full the Mac's disk is, and how much space the main folders (Desktop, Documents, Downloads, Movies, Music, Pictures) and the Trash use.",
  input_schema: obj({}),
  label: () => "Checking how much space you have…",
  async run(_input, ctx) {
    const df = await ctx.mac.sandboxed("df -h /");
    const ref = addEvidence(ctx, { kind: "before", command: "df -h /", code: df.code, output: tail(df.output, 2) });
    const sizes = USER_FOLDERS.map((f) => {
      const files = ctx.mac.listFiles(f, 20_000);
      return `${f}: ${humanSize(files.reduce((a, x) => a + x.bytes, 0))} (${files.length} files)`;
    });
    const ref2 = addEvidence(ctx, { kind: "before", command: "folder sizes", code: 0, output: sizes.join("; ") });
    return `[${ref}] ${tail(df.output, 2)}\n[${ref2}] ${sizes.join("; ")}`;
  },
};

const findFiles: AgentTool = {
  name: "find_files",
  kind: "look",
  description: "Find files in one of the person's folders (Desktop, Documents, Downloads, Movies, Music, Pictures), optionally by part of the name, age or size. Read-only.",
  input_schema: obj({
    folder: { type: "string", enum: [...USER_FOLDERS] },
    name_contains: strOrNull("Part of the file name, or null"),
    older_than_days: numOrNull("Only files not changed for this many days, or null"),
    larger_than_mb: numOrNull("Only files bigger than this many MB, or null"),
  }),
  label: (i) => `Looking in your ${s(i, "folder")} folder…`,
  async run(input, ctx) {
    const folder = asFolder(s(input, "folder"));
    if (!folder) return "Unknown folder.";
    const all = ctx.mac.listFiles(folder, 20_000);
    const hits = filterFiles(all, { nameContains: s(input, "name_contains"), olderThanDays: n(input, "older_than_days"), largerThanMb: n(input, "larger_than_mb") }, ctx.mac.now());
    const total = hits.reduce((a, x) => a + x.bytes, 0);
    const biggest = [...hits].sort((a, b) => b.bytes - a.bytes).slice(0, 15);
    const ref = addEvidence(ctx, { kind: "before", command: `find ~/${folder}`, code: 0, output: `${hits.length} files, ${humanSize(total)}` });
    return `[${ref}] ${hits.length} matching file(s) in ${folder}, ${humanSize(total)} in total. Biggest: ${biggest.map((f) => `${f.path.replace(ctx.mac.home, "~")} (${humanSize(f.bytes)})`).join("; ") || "none"}`;
  },
};

const KINDS = ["any", "document", "pdf", "image", "movie", "music", "presentation", "spreadsheet", "folder", "app"] as const;

const findFile: AgentTool = {
  name: "find_file",
  kind: "look",
  description: "Find a lost file or folder anywhere in the person's home folder with Spotlight (fast). Search by part of its name, a word inside it, its kind, and/or how recently it was changed. Says whether the search finished or ran out of time. If nothing is found, try once more with a looser search (shorter name part, a word inside it, or just the kind and date) before giving up.",
  input_schema: obj({
    name_contains: strOrNull("Part of the file name, or null"),
    word_inside: strOrNull("A word that's inside the document, or null"),
    kind: { type: "string", enum: [...KINDS], description: "What kind of file" },
    changed_within_days: numOrNull("Only files changed in the last N days, or null"),
  }),
  label: (i) => `Looking for ${s(i, "name_contains") || s(i, "word_inside") || "your file"}…`,
  async run(input, ctx) {
    const kind = s(input, "kind");
    const query = {
      name: s(input, "name_contains") || undefined,
      contentWord: s(input, "word_inside") || undefined,
      kind: kind && kind !== "any" ? kind : undefined,
      modifiedWithinDays: n(input, "changed_within_days") ?? undefined,
    };
    if (!query.name && !query.contentWord && !query.kind && !query.modifiedWithinDays) return "Give at least one thing to search by.";
    const r = await ctx.mac.spotlight(query, 12_000);
    // Hide app internals and caches; people mean their own files.
    const paths = r.paths.filter((p) => !/\/(Library|\.Trash|node_modules|\.git)\//.test(p));
    const ref = addEvidence(ctx, { kind: "before", command: `mdfind ${JSON.stringify(query)}`, code: paths.length ? 0 : 1, output: `${paths.length} found in ${r.ms} ms${r.timedOut ? " (ran out of time)" : ""}` });
    const shown = paths.slice(0, 15).map((p) => p.replace(ctx.mac.home, "~"));
    const status = r.timedOut ? `The search ran out of time after ${Math.round(r.ms / 1000)} s, so there may be more.` : `The search finished in ${(r.ms / 1000).toFixed(1)} s.`;
    return `[${ref}] ${status} ${paths.length} match(es)${paths.length > 15 ? " (showing 15)" : ""}: ${shown.join("; ") || "none"}`;
  },
};

const revealFile: AgentTool = {
  name: "show_file",
  kind: "act",
  description: "Show a file to the person: open its folder in Finder with the file selected, or open the file itself. Only for files inside their home folder.",
  input_schema: obj({ path: str("Full path from find_file or find_files (may start with ~)"), open_it: { type: "boolean", description: "true = open the file, false = show it in Finder" } }),
  label: () => "Showing you the file…",
  async run(input, ctx) {
    const raw = s(input, "path");
    const path = raw.startsWith("~/") ? ctx.mac.home + raw.slice(1) : raw;
    if (!path.startsWith(ctx.mac.home + "/") || path.includes("/../") || !ctx.mac.exists(path)) return "That file isn't in the person's home folder, or doesn't exist.";
    await ctx.mac.reveal(path, input.open_it === true);
    const ref = addEvidence(ctx, { kind: "after", command: `${input.open_it === true ? "open" : "open -R"} ${JSON.stringify(path)}`, code: 0, output: "shown" });
    return `[${ref}] ${input.open_it === true ? "Opened" : "Showed it in Finder"}: ${path.replace(ctx.mac.home, "~")}`;
  },
};

const runCheck: AgentTool = {
  name: "run_check",
  kind: "look",
  description: "Run one read-only Mac shell command to look something up (for example `sw_vers`, `system_profiler SPBluetoothDataType`, `pmset -g batt`, `networksetup -listallhardwareports`). It runs in a locked box with no internet and no writing. Anything that changes the Mac is refused here; use run_command for that.",
  input_schema: obj({ command: str("One read-only shell command") }),
  label: () => "Looking something up on your Mac…",
  async run(input, ctx) {
    const command = s(input, "command");
    const a = assessCommand(command);
    if (!(a.level === "safe" && a.readOnly)) return `Refused: that command isn't read-only (${a.findings[0]?.reason ?? "it changes something"}).`;
    const r = await ctx.mac.sandboxed(command);
    const ref = addEvidence(ctx, { kind: "before", command, code: r.code, output: tail(r.output) });
    return `[${ref}] exit ${r.code}\n${r.output.trim().slice(0, 4000)}`;
  },
};

// ---------------- act ----------------

const quitApp: AgentTool = {
  name: "quit_app",
  kind: "act",
  description: "Close an app. force=false asks it politely (like choosing Quit). For a frozen app that doesn't respond, use force=true: CalHack asks the person first, because unsaved work in that app is lost. After a frozen app is closed, open it again with open_app.",
  input_schema: obj({ app_name: str("The app's name, e.g. Zoom"), force: { type: "boolean", description: "true = force quit a frozen app (asks the person first)" } }),
  label: (i) => `${input_force(i) ? "Force-closing" : "Closing"} ${s(i, "app_name")}…`,
  async run(input, ctx) {
    const app = oneApp(ctx, s(input, "app_name"));
    if ("problem" in app) return app.problem;
    const name = appLabel(app.path);
    if (ctx.mac.protectedApps.some((p) => p.toLowerCase() === name.toLowerCase())) {
      return `Not closed: ${name} has to stay open (${name === "Finder" ? "it's part of macOS" : "CalHack is running inside it"}). Leave it and tell the person if it matters.`;
    }
    try {
      if (input_force(input)) {
        const ok = await ctx.ui.confirm({ title: `Force ${name} to close?`, message: `${name} isn't responding. Forcing it closed loses anything not saved in it, like an unsaved document or form.`, yes: "Yes, force it to close", no: "No, wait" });
        if (!ok) return "The person said no. Not force-closed.";
        await ctx.mac.forceQuitApp(app.path);
      } else {
        await ctx.mac.quitApp(app.path);
      }
    } catch (e) {
      return `Couldn't close it: ${(e as Error).message}. If it's frozen, try force=true.`;
    }
    const open = await ctx.mac.runningApps();
    const still = open.some((x) => x.toLowerCase() === appLabel(app.path).toLowerCase());
    const ref = addEvidence(ctx, { kind: "after", command: `is ${appLabel(app.path)} still open?`, code: still ? 1 : 0, output: still ? "still open" : "closed" });
    return `[${ref}] ${appLabel(app.path)} is ${still ? "still open" : "closed"}.`;
  },
};

const openApp: AgentTool = {
  name: "open_app",
  kind: "act",
  description: "Open an installed app, and check it started.",
  input_schema: obj({ app_name: str("The app's name") }),
  label: (i) => `Opening ${s(i, "app_name")}…`,
  async run(input, ctx) {
    const app = oneApp(ctx, s(input, "app_name"));
    if ("problem" in app) return app.problem;
    const name = appLabel(app.path);
    if (NEVER_OPEN.has(name.toLowerCase())) {
      return `Not opened: ${name} can run anything on the Mac, so CalHack never opens it for someone. Tell the person why.`;
    }
    // Opening an app is routine, so it runs directly; "is it running?" is checked in the read-only box.
    const r = await runRecipe({ id: "open-app", label: "Open", app: name }, recipeDeps(ctx));
    for (const l of r.log ?? []) ctx.ui.detail(l, true);
    const refs = r.evidence.map((e) => addEvidence(ctx, { ...e, kind: e.kind === "run" && /pgrep/.test(e.command) ? "after" : e.kind }));
    return `[${refs.join(", ")}] ${r.message}`;
  },
};

const openSettings: AgentTool = {
  name: "open_settings",
  kind: "act",
  description: "Open System Settings at the right page for the person (for example Sound, Printers & Scanners, Wi-Fi, Bluetooth, or a Privacy page), so they never have to find it. Give the x-apple.systempreferences: link for the page. Use this before guide_person when the person has to click something there.",
  input_schema: obj({ settings_url: str("An x-apple.systempreferences: link, e.g. x-apple.systempreferences:com.apple.Sound-Settings.extension") }),
  label: () => "Opening System Settings…",
  async run(input, ctx) {
    const url = s(input, "settings_url");
    if (!SETTINGS_URL.test(url)) return "Refused: that isn't a System Settings link (it must look like x-apple.systempreferences:com.apple.…).";
    const command = `open ${shq(url)}`;
    const r = await ctx.mac.run(command);
    addEvidence(ctx, { kind: "run", command, code: r.code, output: tail(r.output, 2) });
    if (r.code !== 0) return `Couldn't open it: ${tail(r.output, 2)}`;
    // This separate read-only check proves System Settings is really up.
    let up = false;
    for (let i = 0; i < 5 && !up; i++) {
      if (i) await new Promise((x) => setTimeout(x, 600));
      up = (await ctx.mac.sandboxed("pgrep -x 'System Settings'")).code === 0;
    }
    const ref = addEvidence(ctx, { kind: "after", outcome: up ? "passed" : "failed", command: "pgrep -x 'System Settings'", code: up ? 0 : 1, output: up ? "System Settings is open" : "System Settings did not start" });
    return `[${ref}] ${up ? "System Settings is open at that page." : "I ran the command but System Settings didn't appear."}`;
  },
};

const openWebsite: AgentTool = {
  name: "open_website",
  kind: "act",
  description: "Open a page from Apple's or an app maker's own website in the person's browser (for example an official help page or the maker's download page). Only official sites; anything else is refused. Opening a page isn't installing anything.",
  input_schema: obj({ url: str("A full https:// link on an official site, e.g. https://support.apple.com/...") }),
  label: () => "Opening a web page…",
  async run(input, ctx) {
    const url = officialUrl(s(input, "url"));
    if (!url) return "Refused: CalHack only opens https pages on Apple's or the maker's own website.";
    const command = `open ${shq(url)}`;
    const r = await ctx.mac.run(command);
    const ref = addEvidence(ctx, { kind: "after", command, code: r.code, output: r.code === 0 ? "opened" : tail(r.output, 2) });
    return r.code === 0 ? `[${ref}] Opened ${new URL(url).hostname} in the browser.` : `Couldn't open it: ${tail(r.output, 2)}`;
  },
};

const trashApp: AgentTool = {
  name: "move_app_to_trash",
  kind: "act",
  description: "Uninstall an app: close it, move it from Applications to the Trash, and check it's gone. Reversible (it can be dragged back out of the Trash). The person's request is enough permission; no need to ask.",
  input_schema: obj({ app_name: str("The app's name") }),
  label: (i) => `Moving ${s(i, "app_name")} to the Trash…`,
  async run(input, ctx) {
    const name = s(input, "app_name");
    const r = await uninstallApp(name, { find: ctx.mac.findApp, exists: ctx.mac.exists, quit: ctx.mac.quitApp, trash: ctx.mac.trash }, (m) => ctx.ui.status(m));
    const gone = r.ok && r.paths.length > 0;
    const ref = addEvidence(ctx, { kind: "after", command: r.paths.length ? `test ! -e ${JSON.stringify(r.paths[0])}` : `find app ${name}`, code: gone ? 0 : 1, output: r.message });
    if (gone) ctx.beforeAfter.push({ label: appLabel(r.paths[0]), before: "Installed", after: "In the Trash (drag it back out to undo)" });
    return `[${ref}] ${r.message}`;
  },
};

const setVolume: AgentTool = {
  name: "set_volume",
  kind: "act",
  description: "Turn the sound on or off (mute) and/or set the volume from 0 to 100.",
  input_schema: obj({ level: numOrNull("Volume 0-100, or null to leave it"), muted: { type: ["boolean", "null"], description: "true = mute, false = unmute, null = leave it" } }),
  label: () => "Adjusting the sound…",
  async run(input, ctx) {
    const level = n(input, "level");
    const muted = typeof input.muted === "boolean" ? input.muted : null;
    const parts: string[] = [];
    if (muted === false) parts.push("osascript -e 'set volume without output muted'");
    if (muted === true) parts.push("osascript -e 'set volume with output muted'");
    if (level !== null) parts.push(`osascript -e 'set volume output volume ${Math.max(0, Math.min(100, Math.round(level)))}'`);
    if (!parts.length) return "Nothing to change.";
    const before = await ctx.mac.sandboxed("osascript -e 'get volume settings'");
    for (const c of parts) {
      const r = await ctx.mac.execute(c);
      addEvidence(ctx, { kind: "run", command: c, code: r.code, output: tail(r.output, 2) });
      if (r.code !== 0) return `That didn't work: ${tail(r.output, 2)}`;
    }
    const after = await ctx.mac.sandboxed("osascript -e 'get volume settings'");
    const ref = addEvidence(ctx, { kind: "after", command: "osascript -e 'get volume settings'", code: after.code, output: tail(after.output, 2) });
    ctx.beforeAfter.push({ label: "Sound", before: summarizeVolume(before.output), after: summarizeVolume(after.output) });
    return `[${ref}] Now: ${tail(after.output, 2)}`;
  },
};

function summarizeVolume(output: string): string {
  const vol = /output volume:(\d+)/.exec(output)?.[1];
  const muted = /output muted:true/.test(output);
  return muted ? "Muted" : vol ? `On, volume ${vol}%` : "Unknown";
}

const setSoundOutput: AgentTool = {
  name: "set_sound_output",
  kind: "act",
  description: "Send the Mac's sound to a different output, e.g. from AirPods back to the MacBook speakers, or to a headset. Use sound_status first to see the names.",
  input_schema: obj({ device_name: str("The output's name (or part of it), e.g. 'MacBook Air Speakers' or 'AirPods'") }),
  label: (i) => `Switching the sound to ${s(i, "device_name")}…`,
  async run(input, ctx) {
    const outputs = await ctx.mac.listOutputs();
    const target = matchOutput(outputs, s(input, "device_name"));
    if (!target) return `No sound output matches "${s(input, "device_name")}". Outputs: ${outputs.map((o) => o.name).join(", ")}.`;
    const before = outputs.find((o) => o.default)?.name ?? "unknown";
    await ctx.mac.setOutput(target.id);
    // macOS can take a moment to report the new output.
    let now = (await ctx.mac.listOutputs()).find((o) => o.default);
    for (let i = 0; i < 4 && now?.id !== target.id; i++) {
      await new Promise((r) => setTimeout(r, 250));
      now = (await ctx.mac.listOutputs()).find((o) => o.default);
    }
    const ok = now?.id === target.id;
    const ref = addEvidence(ctx, { kind: "after", command: "list sound outputs", code: ok ? 0 : 1, output: `in use: ${now?.name ?? "?"}` });
    if (ok) ctx.beforeAfter.push({ label: "Sound goes to", before, after: target.name });
    return `[${ref}] ${ok ? `Sound now goes to "${target.name}".` : `It didn't switch; "${now?.name}" is still in use.`}`;
  },
};

const setWifi: AgentTool = {
  name: "set_wifi",
  kind: "act",
  description: "Turn Wi-Fi on or off. This is an ordinary setting, so just do it when the person asks (no need to ask first), then it is checked. Turning Wi-Fi off can cut the internet, which also ends this conversation; that is handled for you.",
  input_schema: obj({ on: { type: "boolean", description: "true = turn Wi-Fi on, false = turn it off" } }),
  label: (i) => `Turning Wi-Fi ${i.on === false ? "off" : "on"}…`,
  async run(input, ctx) {
    const want = input.on !== false;
    const ports = await ctx.mac.sandboxed("networksetup -listallhardwareports");
    const dev = parseWifiDevice(ports.output);
    if (!dev) return "This Mac has no Wi-Fi.";
    const power = `networksetup -getairportpower ${safeDevice(dev)}`;
    const was = parsePower((await ctx.mac.sandboxed(power)).output);
    if (was === want) {
      const ref = addEvidence(ctx, { kind: "after", outcome: "passed", command: power, code: 0, output: `Wi-Fi is already ${want ? "on" : "off"}` });
      return `[${ref}] Wi-Fi was already ${want ? "on" : "off"}.`;
    }
    // Is this Mac online through Wi-Fi? Then switching it off ends our connection to Claude.
    const route = want ? "" : (await ctx.mac.sandboxed("route -n get default")).output;
    const viaWifi = new RegExp(`interface:\\s*${dev}\\b`).test(route);
    const r = await ctx.mac.execute(`networksetup -setairportpower ${safeDevice(dev)} ${want ? "on" : "off"}`);
    for (const l of r.log ?? []) ctx.ui.detail(l, true);
    addEvidence(ctx, { kind: "run", command: `networksetup -setairportpower ${dev} ${want ? "on" : "off"}`, code: r.code, output: tail(r.output, 2) });
    if (r.code !== 0) return `That didn't work: ${tail(r.output, 2)}`;
    await new Promise((x) => setTimeout(x, 800));
    const now = parsePower((await ctx.mac.sandboxed(power)).output);
    const ok = now === want;
    const ref = addEvidence(ctx, { kind: "after", outcome: ok ? "passed" : "failed", command: power, code: ok ? 0 : 1, output: `Wi-Fi is ${now === null ? "unknown" : now ? "on" : "off"}` });
    if (ok) ctx.beforeAfter.push({ label: "Wi-Fi", before: was === null ? "Unknown" : was ? "On" : "Off", after: want ? "On" : "Off" });
    if (ok && !want && viaWifi) {
      ctx.autoFinish = { headline: "Done. Wi-Fi is off.", details: ["You'll be offline until you turn it back on. Just ask me, or use the Wi-Fi icon in the menu bar."], proofRefs: [{ ref, shows: "Wi-Fi is off" }] };
    }
    return `[${ref}] ${ok ? `Wi-Fi is now ${want ? "on" : "off"}.` : `It didn't switch; Wi-Fi is still ${now ? "on" : "off"}.`}`;
  },
};

const setBluetooth: AgentTool = {
  name: "set_bluetooth",
  kind: "act",
  description: "Turn Bluetooth on or off. This is an ordinary setting, so just do it when the person asks (no need to ask first); it is checked afterwards. If a Bluetooth keyboard, mouse or trackpad is connected, turning Bluetooth off would cut it off, so CalHack asks first in that case.",
  input_schema: obj({ on: { type: "boolean", description: "true = turn Bluetooth on, false = turn it off" } }),
  label: (i) => `Turning Bluetooth ${i.on === false ? "off" : "on"}…`,
  async run(input, ctx) {
    const want = input.on !== false;
    const read = async () => parseBluetooth((await ctx.mac.sandboxed(BLUETOOTH_STATE_CHECK, 30_000)).output);
    const was = await read();
    if (was.on === want) {
      const ref = addEvidence(ctx, { kind: "after", outcome: "passed", command: BLUETOOTH_STATE_CHECK, code: 0, output: `Bluetooth is already ${want ? "on" : "off"}` });
      return `[${ref}] Bluetooth was already ${want ? "on" : "off"}.`;
    }
    // Turning it off would cut off a Bluetooth keyboard or mouse. If we can't tell what's connected, ask too.
    if (!want && (was.on === null || was.inputDevices.length > 0)) {
      const names = was.inputDevices.length ? was.inputDevices.join(", ") : "";
      const ok = await ctx.ui.confirm({
        title: "Turn Bluetooth off?",
        message: names ? `${names} ${was.inputDevices.length > 1 ? "are" : "is"} connected over Bluetooth. If you turn it off, you may not be able to type or click until you turn it back on.` : "I couldn't tell what's connected over Bluetooth. If your keyboard or mouse uses it, turning it off would cut it off.",
        yes: "Yes, turn it off",
        no: "No, leave it on",
      });
      if (!ok) return "The person said no. Bluetooth was left as it is.";
    }
    const r = await ctx.mac.execute(bluetoothSetCommand(want));
    for (const l of r.log ?? []) ctx.ui.detail(l, true);
    addEvidence(ctx, { kind: "run", command: `bluetooth ${want ? "on" : "off"}`, code: r.code, output: tail(r.output, 2) });
    if (r.code !== 0) return `That didn't work: ${tail(r.output, 2)}. The person can use the Bluetooth switch in System Settings (open_settings).`;
    // A different tool than the one that made the change reads the result back.
    let now = await read();
    for (let i = 0; i < 4 && now.on !== want; i++) {
      await new Promise((x) => setTimeout(x, 700));
      now = await read();
    }
    const ok = now.on === want;
    const ref = addEvidence(ctx, { kind: "after", outcome: ok ? "passed" : "failed", command: BLUETOOTH_STATE_CHECK, code: ok ? 0 : 1, output: `Bluetooth is ${now.on === null ? "unknown" : now.on ? "on" : "off"}` });
    if (ok) ctx.beforeAfter.push({ label: "Bluetooth", before: was.on === null ? "Unknown" : was.on ? "On" : "Off", after: want ? "On" : "Off" });
    return `[${ref}] ${ok ? `Bluetooth is now ${want ? "on" : "off"}.` : `It didn't switch; Bluetooth is still ${now.on ? "on" : "off"}.`}`;
  },
};

const fixProblem: AgentTool = {
  name: "fix_problem",
  kind: "act",
  description: "Run CalHack's built-in fixes for an area you just checked with check_problem (printer, sound, wifi), then run the same checks again to prove it's fixed. Only fixes for problems the checks found are run.",
  input_schema: obj({ area: { type: "string", enum: [...AREAS] } }),
  label: (i) => `Fixing your ${s(i, "area") === "wifi" ? "internet" : s(i, "area")}…`,
  async run(input, ctx) {
    const guide = getGuide(s(input, "area"));
    const before = guide ? ctx.diagnoses.get(guide.id) : undefined;
    if (!guide || !before) return "Run check_problem for this area first.";
    const fixes = buildFixes(before);
    if (!fixes.length) return "No built-in fix applies.";
    const done: string[] = [];
    let wait = 0;
    for (const f of fixes) {
      ctx.ui.status(f.label);
      ctx.ui.say(`${f.label}.`);
      if (f.kind === "command") {
        const command = f.admin && !/^sudo\b/.test(f.command) ? "sudo " + f.command : f.command;
        const r = await ctx.mac.execute(command);
        addEvidence(ctx, { kind: "run", command, code: r.code, output: tail(r.output, 3) });
        for (const l of r.log ?? []) ctx.ui.detail(l, true);
        done.push(`${f.label}: ${r.code === 0 ? "done" : `failed (${tail(r.output, 1)})`}`);
        if (r.code !== 0) break;
      } else if (f.kind === "recipe") {
        const r = await runRecipe({ id: f.recipe, label: f.label }, recipeDeps(ctx));
        for (const l of r.log ?? []) ctx.ui.detail(l, true);
        for (const e of r.evidence) addEvidence(ctx, e);
        done.push(`${f.label}: ${r.ok ? "done" : r.message}`);
        if (!r.ok) {
          // Couldn't do it ourselves: try the screen, then the person. The fix says where; printers are the default.
          const fb = f.manual ?? { clickTarget: "Add Printer, Scanner or Fax…", settingsUrl: "x-apple.systempreferences:com.apple.Print-Scan-Settings.extension", explain: r.message };
          const g = await finishOnScreen(ctx, { instruction: f.manual ? `${r.message} ${fb.explain}` : r.message, clickTarget: fb.clickTarget, settingsUrl: fb.settingsUrl });
          done.push(g.by === "calhack" ? "CalHack added it on screen" : `The person was shown where to click: ${g.result}`);
        }
      } else {
        const g = await finishOnScreen(ctx, { instruction: f.manual.explain, clickTarget: f.manual.clickTarget, settingsUrl: f.manual.settingsUrl });
        done.push(`${f.label}: ${g.by === "calhack" ? "CalHack did it on screen" : `the person ${g.result === "done" ? "did it" : "skipped it"}`}`);
      }
      wait = Math.max(wait, f.waitAfterMs);
    }
    if (wait) await new Promise((r) => setTimeout(r, Math.min(wait, 15_000)));
    ctx.ui.status("Checking it worked…");
    const v = await verifyFix(guide, ctx.mac.checkRunner, before);
    const after = v.after.results.filter((r) => r.command).map((r) => `[${addEvidence(ctx, { kind: "after", command: r.command!, code: r.status === "problem" ? 1 : 0, output: `${r.label}: ${r.detail}` })}] ${r.label}: ${r.status}`);
    ctx.beforeAfter.push(...v.rows);
    return [`Fixes: ${done.join("; ")}`, `Checked again: ${v.fixed ? "FIXED" : `still wrong: ${v.stillWrong}`}\n${after.join("\n")}`, `Before → after: ${v.rows.map((r) => `${r.label}: ${r.before} → ${r.after}`).join("; ")}`].join("\n");
  },
};

const installApp: AgentTool = {
  name: "install_app",
  kind: "act",
  description: "Install an app from its maker's official website only (never mirrors or download sites). CalHack checks the file is signed by the maker, installs it (macOS asks for the password), and checks it's there. Asks the person first.",
  input_schema: obj({ app_name: str("The app's name, e.g. Zoom") }),
  label: (i) => `Installing ${s(i, "app_name")}…`,
  async run(input, ctx) {
    const name = s(input, "app_name");
    const ok = await ctx.ui.confirm({ title: `Install ${name}?`, message: `I'll download ${name} from its maker's official website, check it's genuine, and install it. Your Mac will ask for your password.`, yes: "Yes, install", no: "Not now" });
    if (!ok) return "The person said no. Don't install.";
    const r = await ctx.mac.installOfficial(name);
    const refs = r.evidence.map((e) => addEvidence(ctx, e));
    if (r.ok) ctx.beforeAfter.push({ label: name, before: "Not installed", after: "Installed" });
    return `[${refs.join(", ")}] ${r.message}`;
  },
};

const trashFiles: AgentTool = {
  name: "move_files_to_trash",
  kind: "act",
  description: "Move files from one of the person's folders to the Trash (never deleted outright, so it can be undone). Filter like find_files, or the whole folder's contents. CalHack shows exactly what will move and asks the person; big removals need extra confirmation. Never use this for system or Library files.",
  input_schema: obj({
    folder: { type: "string", enum: [...USER_FOLDERS] },
    name_contains: strOrNull("Part of the file name, or null"),
    older_than_days: numOrNull("Only files not changed for this many days, or null"),
    larger_than_mb: numOrNull("Only files bigger than this many MB, or null"),
    whole_folder: { type: "boolean", description: "true = everything in the folder (needs extra confirmation)" },
  }),
  label: (i) => `Getting files in ${s(i, "folder")} ready to move to the Trash…`,
  async run(input, ctx) {
    const folder = asFolder(s(input, "folder"));
    if (!folder) return "Unknown folder.";
    const whole = input.whole_folder === true;
    const all = ctx.mac.listFiles(folder, 50_000);
    const hits = whole ? all : filterFiles(all, { nameContains: s(input, "name_contains"), olderThanDays: n(input, "older_than_days"), largerThanMb: n(input, "larger_than_mb") }, ctx.mac.now());
    const safe = hits.filter((f) => insideUserFolder(f.path, ctx.mac.home) === folder);
    if (!safe.length) return "No files match, so nothing was moved.";
    const total = safe.reduce((a, x) => a + x.bytes, 0);
    const sample = [...safe].sort((a, b) => b.bytes - a.bytes).slice(0, 6).map((f) => `${f.path.split("/").pop()} (${humanSize(f.bytes)})`);
    const tier = removalTier(safe.length, total, whole);
    const what = `${safe.length} file${safe.length === 1 ? "" : "s"} (${humanSize(total)}) from your ${folder} folder`;

    // Every removal asks once. Big ones ask twice more and need the folder's name typed.
    if (!(await ctx.ui.confirm({ title: `Move ${what} to the Trash?`, message: "They go to the Trash, not deleted. You can drag them back out if you change your mind.", details: sample, yes: "Yes, move them", no: "No, keep them", tone: tier === "big" ? "danger" : "normal" }))) {
      return "The person said no. Nothing was moved.";
    }
    if (tier === "big") {
      if (!(await ctx.ui.confirm({ title: "Are you really sure?", message: `This is a lot: ${what}. If something important is in there, you'll need to find it in the Trash to get it back.`, yes: "Yes, I'm sure", no: "No, stop", tone: "danger" }))) {
        return "The person stopped at the second check. Nothing was moved.";
      }
      if (!(await ctx.ui.confirm({ title: `Last check: type ${folder} to confirm`, message: `Type the word ${folder} below to move ${what} to the Trash.`, yes: "Move to Trash", no: "Cancel", typeToConfirm: folder, tone: "danger" }))) {
        return "The person didn't confirm. Nothing was moved.";
      }
    }
    let moved = 0;
    const failed: string[] = [];
    for (const f of safe) {
      try {
        await ctx.mac.trash(f.path);
        if (!ctx.mac.exists(f.path)) moved++;
        else failed.push(f.path);
      } catch {
        failed.push(f.path);
      }
      if (moved % 25 === 0) ctx.ui.status(`Moved ${moved} of ${safe.length} to the Trash…`);
    }
    const ref = addEvidence(ctx, { kind: "after", command: `check ${safe.length} files left ~/${folder}`, code: failed.length ? 1 : 0, output: `${moved} moved, ${failed.length} not moved` });
    ctx.beforeAfter.push({ label: folder, before: `${safe.length} files there`, after: `${moved} moved to the Trash` });
    return `[${ref}] Moved ${moved} of ${safe.length} files to the Trash.${failed.length ? ` Couldn't move ${failed.length}.` : ""} To undo: open the Trash, select them, and choose "Put Back".`;
  },
};

const runCommand: AgentTool = {
  name: "run_command",
  kind: "act",
  description: "Last resort: run one Mac shell command that changes something, when no other tool can do it. CalHack's safety rules check it first: dangerous commands are refused, and anything risky asks the person. Droid runs it behind CalHack's gate. Never use it to delete files (use move_files_to_trash) or to bypass a refusal.",
  input_schema: obj({ command: str("One shell command"), plain_description: str("What it does, in plain words for a non-technical person, e.g. 'Restart the printing system'") }),
  label: (i) => `${s(i, "plain_description") || "Running a command"}…`,
  async run(input, ctx) {
    const command = s(input, "command");
    const about = s(input, "plain_description");
    const a = assessCommand(command);
    if (a.level === "blocked") return `Refused by CalHack's safety rules: ${a.findings.find((f) => f.level === "blocked")?.reason ?? "not safe"}. Don't try another way around it; tell the person why.`;
    if (/\brm\b|\bsrm\b|\bshred\b|\bunlink\b|\bdiskutil\s+(erase|zero|secureErase|partition)/.test(command)) return "Refused: deleting or erasing isn't allowed. Use move_files_to_trash for files.";
    if (!(a.level === "safe" && a.readOnly)) {
      const routine = a.findings.every((f) => ["installs-software", "changes-something", "vendor-download"].includes(f.rule));
      if (!routine) {
        const ok = await ctx.ui.confirm({ title: `${about}?`, message: `This step needs your OK: ${a.findings.map((f) => f.reason).join(" ")}`, details: [command], yes: "Yes, go ahead", no: "No" });
        if (!ok) return "The person said no. Not run.";
      }
    }
    const r = await ctx.mac.execute(command);
    for (const l of r.log ?? []) ctx.ui.detail(l, true);
    const ref = addEvidence(ctx, { kind: "run", command, code: r.code, output: tail(r.output, 4) });
    return `[${ref}] exit ${r.code}${r.ranBy === "droid" ? " (run by Droid)" : ""}\n${r.output.trim().slice(0, 3000)}`;
  },
};

// ---------------- talk ----------------

const guidePerson: AgentTool = {
  name: "guide_person",
  kind: "talk",
  description: "For a step that is still incomplete and only a click on screen can finish (e.g. adding a printer in Settings, choosing an option in an app). CalHack opens the page and then looks at the screen every few seconds and does the clicks itself. Anything private (permissions, passwords, sign-in, payments, deleting) it hands to the person, who is shown what to click. Returns who did it.",
  input_schema: obj({ instruction: str("One short, plain instruction"), click_target: strOrNull("The exact on-screen label to click, or null"), settings_url: strOrNull("An x-apple.systempreferences: link that opens the right page, or null") }),
  label: () => "Asking you to click something…",
  async run(input, ctx) {
    const url = s(input, "settings_url");
    const g = await finishOnScreen(ctx, { instruction: s(input, "instruction"), clickTarget: s(input, "click_target") || undefined, settingsUrl: SETTINGS_URL.test(url) ? url : undefined });
    const steps = g.trail.length ? ` (${g.trail.join("; ")})` : "";
    if (g.result === "skip") return `The person skipped it${steps}.`;
    return g.by === "calhack" ? `CalHack did it on the screen${steps}. The last screen check is in the evidence; still check it worked with a tool.` : `The person says they did it${steps}. Check it worked if you can.`;
  },
};

const askPerson: AgentTool = {
  name: "ask_person",
  kind: "talk",
  description: "Ask the person one short question when you truly can't tell what they want (e.g. two apps match). Give 2-4 short answer choices. Don't ask for permission to do what they already asked for.",
  input_schema: obj({ question: str("One short, friendly question"), choices: { type: "array", items: { type: "string" }, description: "2-4 short answers" } }),
  label: () => "Asking you something…",
  async run(input, ctx) {
    const choices = Array.isArray(input.choices) ? input.choices.filter((c): c is string => typeof c === "string").slice(0, 4) : [];
    const answer = await ctx.ui.ask(s(input, "question"), choices);
    return `The person answered: "${answer}"`;
  },
};

const explainIrreversible: AgentTool = {
  name: "explain_irreversible",
  kind: "talk",
  description: "Use when the person asks for something that can't be undone (delete files permanently, empty the Trash, erase the Mac, delete system files). CalHack never does these itself. This explains why in plain words, offers the safe version, and, if they still want to, teaches them how to do it themselves after three warnings.",
  input_schema: obj({
    what: str("What they asked for, plainly, e.g. 'Delete all your files permanently'"),
    why_dangerous: str("Why it's risky, in one or two plain sentences"),
    safer_option: str("The safe alternative CalHack can do instead, e.g. 'Move old Downloads to the Trash to free up space'"),
    do_it_yourself_steps: { type: "array", items: { type: "string" }, description: "Plain steps to do it themselves on macOS, using Apple's own tools" },
  }),
  label: () => "Explaining something important…",
  async run(input, ctx) {
    const what = s(input, "what");
    ctx.ui.say("Wait. This one can't be undone, so I won't do it myself.");
    const choice = await ctx.ui.ask(
      `${what} can't be undone. What would you like to do?`,
      ["Do the safer thing", "I still want to do it myself", "Never mind"],
      `${s(input, "why_dangerous")} The safer thing I can do: ${s(input, "safer_option")}`,
    );
    if (/safer/i.test(choice)) return `The person chose the safer option: ${s(input, "safer_option")}. Do that now with your tools.`;
    if (!/myself/i.test(choice)) return "The person changed their mind. Nothing was done.";
    const warnings = [
      { title: "Are you sure?", message: `Once this is done, it can't be undone. Not by you, not by CalHack, not by Apple.` },
      { title: "Is everything important backed up?", message: "Photos, documents and emails that aren't backed up will be gone for good. If you're not sure, stop and ask someone you trust first." },
      { title: "Last warning", message: `You're about to learn how to: ${what}. CalHack won't do it for you. Continue only if you're completely sure.` },
    ];
    for (const w of warnings) {
      if (!(await ctx.ui.confirm({ ...w, yes: "I understand, continue", no: "Stop", tone: "danger" }))) return "The person stopped during the warnings. Nothing was done.";
    }
    const steps = Array.isArray(input.do_it_yourself_steps) ? input.do_it_yourself_steps.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
    await ctx.ui.explain({ title: `How to do it yourself: ${what}`, paragraphs: ["CalHack never does this itself, because it can't be undone. Here's how, step by step, if you're sure:"], steps });
    return "The person was taught how to do it themselves. CalHack did not do it.";
  },
};

export const FINISH_TOOL = "finish";

const finish: AgentTool = {
  name: FINISH_TOOL,
  kind: "talk",
  description: "Call this once at the end. verdict: 'done' (the goal is met and a check proves it), 'answered' (they asked a question and you answered it), 'not_done' (it failed; say what failed), 'cant_do' (CalHack isn't allowed or able). proofs: the evidence numbers (E1, E2…) of checks that PASSED and prove the result, each with what it shows.",
  input_schema: obj({
    verdict: { type: "string", enum: ["done", "answered", "not_done", "cant_do"] },
    headline: str("One plain sentence for the person, max 16 words, e.g. 'Done. Zoom is in the Trash.'"),
    details: { type: "array", items: { type: "string" }, description: "Up to 4 short plain lines: what you did, or the answer" },
    proofs: {
      type: "array",
      description: "Each check that PASSED and proves part of the result: its evidence number and what it shows, in plain words",
      items: { type: "object", properties: { ref: { type: "string", description: "e.g. E4" }, shows: { type: "string", description: "Plain words, max 10, e.g. 'Calculator is running'" } }, required: ["ref", "shows"], additionalProperties: false },
    },
  }),
  label: () => "Wrapping up…",
  async run() {
    return "ok";
  },
};

export const TOOLS: AgentTool[] = [
  listApps, runningApps, soundStatus, checkProblem, diskUsage, findFiles, findFile, runCheck, revealFile,
  quitApp, openApp, openSettings, openWebsite, trashApp, setVolume, setSoundOutput, setWifi, setBluetooth, fixProblem, installApp, trashFiles, runCommand,
  guidePerson, askPerson, explainIrreversible, finish,
];

/** The real list of files in a folder (not following links, skipping hidden files), up to a limit. */
export function listFilesIn(root: string, max: number): FileInfo[] {
  const out: FileInfo[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= max || depth > 6) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= max) return;
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      // An app or package bundle counts as one item.
      if (st.isDirectory() && !/\.(app|photoslibrary|musiclibrary|bundle|pkg)$/i.test(name)) walk(p, depth + 1);
      else out.push({ path: p, bytes: st.isDirectory() ? 0 : st.size, modified: st.mtimeMs });
    }
  };
  walk(root, 0);
  return out;
}

export { folderPath };

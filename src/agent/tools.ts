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
import { closeOpenedSheet } from "./uipilot.js";
import { safeFacts, type Fact } from "./fill.js";
import { keepWarning, refusal, scamSigns, type ScamVerdict } from "./scam.js";
import { loadEnv } from "../ai/client.js";
import { fillWebForm, webLog, type WebFormDeps } from "./webform.js";
import { signedInPage } from "../core/trusted.js";
import { cardIsThePerson } from "../mac/contacts.js";
import { linkFor } from "../mac/front.js";
import { addEventCommand, findEventCommand, parseEvent, parseFound, whenLabel } from "../mac/calendar.js";

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
  /** The address of the page in the browser in front, or null (not a browser, or macOS said no). Checked before filling in a form. */
  pageUrl?(): Promise<string | null>;
  /** Fills web forms with Playwright in CalHack's own Chrome window. Missing = forms are filled on screen. */
  webForm?: WebFormDeps;
  /** The links on the page in the browser (preferring this browser), with their addresses. Missing = links are clicked on screen. */
  pageLinks?(prefer?: string): Promise<import("../mac/front.js").PageLinks>;
  /** The person's own contact card (My Card in Contacts), as details for a form. Missing = not used. */
  myCard?(): Promise<Fact[]>;
  /** Reads the front window's buttons and rows by name and acts on them (fast, no screenshot). Missing = screenshots only. */
  ui?: import("./uipilot.js").UiDeps;
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
  autoFinish?: { headline: string; details: string[]; proofRefs: { ref: string; shows: string }[]; verdict?: "done" | "cant_do" };
  /** The message is a scam: every action is refused for the rest of the run, whatever anyone asks. */
  scam?: ScamVerdict;
  /** True once the person pressed Stop or Cancel. Long loops check it before every action. */
  stopped?: () => boolean;
  /** Aborted the moment the person presses Stop: requests in flight are cancelled and loops end at once. */
  signal?: AbortSignal;
  /** The steps the person said yes to on the plan screen (propose_plan). */
  approvedPlan?: string[];
  /** The app that was in front when the person asked for help (e.g. the browser showing their email). */
  sourceApp?: string;
  /** The person saw CalHack's warning that the message may not be genuine, and chose to go ahead. */
  personTrusts?: boolean;
  /** The links in the person's message (text and address), remembered once read, for later steps like joining a call. */
  messageLinks?: { text: string; url: string }[];
  /** Sites where the person said yes to filling in a form despite a warning about the page. */
  formOkSites?: Set<string>;
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
async function finishOnScreen(
  ctx: ToolContext,
  g: { instruction: string; clickTarget?: string; settingsUrl?: string; facts?: Fact[]; doneWhen?: () => Promise<boolean>; noHandoff?: boolean },
): Promise<{ result: "done" | "skip" | "failed"; by: "calhack" | "person"; trail: string[] }> {
  const url = g.settingsUrl && SETTINGS_URL.test(g.settingsUrl) ? g.settingsUrl : undefined;
  if (!ctx.mac.screen) return g.noHandoff ? { result: "failed", by: "calhack", trail: ["CalHack can't see the screen (Screen Recording is off)"] } : { result: await ctx.ui.guide(g), by: "person", trail: ["No screen access"] };
  if (url) {
    const before = await ctx.mac.screen.glance?.().catch(() => null);
    const r = await ctx.mac.run(`open ${shq(url)}`);
    addEvidence(ctx, { kind: "run", command: `open ${shq(url)}`, code: r.code, output: tail(r.output, 2) });
    // Wait for System Settings to appear and settle, not a fixed 1.5 s.
    const { waitForSettle } = await import("./autopilot.js");
    const w = await waitForSettle(ctx.mac.screen, { before, reactMs: 2000, maxMs: 3000, signal: ctx.signal });
    if (w.reason === "no-glance") await new Promise((x) => setTimeout(x, 1500));
  }
  ctx.ui.say("Let me take care of that for you.");
  const r = await autopilot(ctx, { instruction: g.instruction, clickTarget: g.clickTarget, app: url ? "System Settings" : undefined, stopped: ctx.stopped, record: fileRecord, facts: g.facts, doneWhen: g.doneWhen, noHandoff: g.noHandoff });
  if (r.outcome === "done") return { result: "done", by: "calhack", trail: r.trail };
  if (r.outcome === "skipped" || r.outcome === "stopped") return { result: "skip", by: "person", trail: r.trail };
  if (g.noHandoff) return { result: "failed", by: "calhack", trail: r.trail };
  // It couldn't finish: the person gets the plain version, and is told why.
  const why = r.needsAccessibility ? `${r.trail.at(-1)}. For now: ` : "";
  return { result: await ctx.ui.guide({ instruction: why + g.instruction, clickTarget: g.clickTarget, settingsUrl: g.settingsUrl }), by: "person", trail: r.trail };
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
      // Routine and easily undone, so it runs directly (fast); Droid handles the risky changes.
      const r = await ctx.mac.run(c);
      addEvidence(ctx, { kind: "run", command: c, code: r.code, output: tail(r.output, 2) });
      if (r.code !== 0) return `That didn't work: ${tail(r.output, 2)}`;
    }
    const after = await ctx.mac.sandboxed("osascript -e 'get volume settings'");
    const ref = addEvidence(ctx, { kind: "after", command: "osascript -e 'get volume settings'", code: after.code, output: tail(after.output, 2) });
    ctx.beforeAfter.push({ label: "Sound", before: summarizeVolume(before.output), after: summarizeVolume(after.output) });
    return `[${ref}] Now: ${tail(after.output, 2)}`;
  },
};

/**
 * Settings CalHack changes with a fixed, tested command (macOS 26), each with a read-back check that proves it took.
 * The AI only picks the setting and the value; it never writes these commands. Things macOS doesn't allow by command
 * (wallpaper, pointer size, text size, Do Not Disturb, brightness) go through the screen instead.
 */
const APPEARANCE = `tell application "System Events" to tell appearance preferences to`;
export const SETTINGS: Record<string, { label: string; values: string[]; set: (v: string) => string; read: string; is: (out: string, v: string) => boolean; show: (out: string) => string }> = {
  dark_mode: {
    label: "Dark mode",
    values: ["on", "off"],
    set: (v) => `osascript -e '${APPEARANCE} set dark mode to ${v === "on"}'`,
    read: `osascript -e '${APPEARANCE} get dark mode'`,
    is: (out, v) => out.trim() === String(v === "on"),
    show: (out) => (out.trim() === "true" ? "On" : out.trim() === "false" ? "Off" : "Unknown"),
  },
  dock_autohide: {
    label: "Hide the Dock automatically",
    values: ["on", "off"],
    set: (v) => `defaults write com.apple.dock autohide -bool ${v === "on"} && killall Dock`,
    read: "defaults read com.apple.dock autohide",
    is: (out, v) => out.trim() === (v === "on" ? "1" : "0"),
    show: (out) => (out.trim() === "1" ? "On" : "Off"),
  },
  dock_magnification: {
    label: "Dock icons grow when you point at them",
    values: ["on", "off"],
    set: (v) => `defaults write com.apple.dock magnification -bool ${v === "on"} && killall Dock`,
    read: "defaults read com.apple.dock magnification",
    is: (out, v) => out.trim() === (v === "on" ? "1" : "0"),
    show: (out) => (out.trim() === "1" ? "On" : "Off"),
  },
  dock_size: {
    label: "Dock size",
    values: ["small", "medium", "large"],
    set: (v) => `defaults write com.apple.dock tilesize -int ${({ small: 36, medium: 56, large: 96 } as Record<string, number>)[v]} && killall Dock`,
    read: "defaults read com.apple.dock tilesize",
    is: (out, v) => out.trim() === String(({ small: 36, medium: 56, large: 96 } as Record<string, number>)[v]),
    show: (out) => ({ "36": "Small", "56": "Medium", "96": "Large" } as Record<string, string>)[out.trim()] ?? (out.trim() ? `Size ${out.trim()}` : "Standard"),
  },
  wifi: {
    // Only "on": turning Wi-Fi off would cut CalHack off from Claude in the middle of helping.
    label: "Wi-Fi",
    values: ["on"],
    set: () => "networksetup -setairportpower \"$(networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2; exit}')\" on",
    read: "networksetup -getairportpower \"$(networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2; exit}')\"",
    is: (out) => /:\s*On\b/.test(out),
    show: (out) => (/:\s*On\b/.test(out) ? "On" : /:\s*Off\b/.test(out) ? "Off" : "Unknown"),
  },
};

/**
 * Settings macOS has no command for, done through a fixed, tested route in the app itself (macOS 26): CalHack opens the
 * page, moves the exact slider or switch by name through Accessibility, reads it back, and closes what it opened.
 * No AI is involved in these clicks.
 */
type ScreenSettingResult = { ok: boolean; before: string; after: string; proof: string; error?: string };
const ACCESSIBILITY_DISPLAY = "x-apple.systempreferences:com.apple.Accessibility-Settings.extension?Display";

async function waitForItem(ui: NonNullable<MacDeps["ui"]>, app: string, match: (i: import("../mac/ui.js").UiItem) => boolean, ms = 6000): Promise<import("../mac/ui.js").UiItem | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const w = await ui.list(app);
    if (!("error" in w)) {
      const hit = w.items.find(match);
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/**
 * Opens a System Settings page, runs `work` on it, then leaves things as they were: a panel the work opened (like Text Size)
 * is closed, keeping the change, and System Settings is closed again if it wasn't open before.
 */
async function onSettingsPage<T>(ctx: ToolContext, url: string, work: (ui: NonNullable<MacDeps["ui"]>) => Promise<T>): Promise<T> {
  const ui = ctx.mac.ui!;
  const wasOpen = (await ctx.mac.sandboxed("pgrep -x 'System Settings'")).code === 0;
  // A panel the person already had open is theirs: it stays.
  const before = wasOpen ? await ui.list("System Settings").catch(() => null) : null;
  const hadSheet = !!before && !("error" in before) && !!before.sheet;
  await ctx.mac.run(`open ${shq(url)}`);
  try {
    return await work(ui);
  } finally {
    await closeOpenedSheet(ctx, ui, { app: "System Settings", hadSheet, step: `Settings page ${url}`, record: fileRecord }).catch(() => null);
    if (!wasOpen) await ctx.mac.run(`osascript -e 'tell application "System Settings" to quit'`).catch(() => {});
  }
}

/** Moves a slider a few steps up or down and reads it back. */
async function stepSlider(ui: NonNullable<MacDeps["ui"]>, name: string, steps: number, up: boolean): Promise<{ before?: number; after?: number; error?: string }> {
  const slider = await waitForItem(ui, "System Settings", (i) => i.role === "AXSlider" && i.name === name);
  if (!slider) return { error: `I couldn't find the "${name}" slider.` };
  const before = slider.value;
  let current = slider;
  for (let n = 0; n < steps; n++) {
    const r = await ui.act("System Settings", current, up ? "increase" : "decrease");
    if (!r.ok) return { before, error: r.error };
  }
  // Read it back from the window, not from what the action said.
  current = (await waitForItem(ui, "System Settings", (i) => i.role === "AXSlider" && i.name === name, 2000)) ?? current;
  return { before, after: current.value };
}

export const SCREEN_SETTINGS: Record<string, { label: string; values: string[]; apply: (ctx: ToolContext, value: string) => Promise<ScreenSettingResult> }> = {
  pointer_size: {
    label: "Mouse pointer size",
    values: ["larger", "smaller"],
    apply: (ctx, value) =>
      onSettingsPage(ctx, ACCESSIBILITY_DISPLAY, async (ui) => {
        // Each step is 0.3 of the normal size: "larger" goes three steps (about twice the size).
        const r = await stepSlider(ui, "Pointer size", 3, value === "larger");
        const ok = r.after !== undefined && r.before !== undefined && (value === "larger" ? r.after > r.before : r.after < r.before || r.before <= 1);
        const show = (v?: number) => (v === undefined ? "Unknown" : v <= 1 ? "Normal" : `${Math.round(v * 10) / 10}× normal`);
        return { ok, before: show(r.before), after: show(r.after), proof: `Pointer size slider reads ${r.after ?? "?"}`, error: r.error };
      }),
  },
  text_size: {
    label: "Text size",
    values: ["larger", "smaller"],
    apply: (ctx, value) =>
      onSettingsPage(ctx, ACCESSIBILITY_DISPLAY, async (ui) => {
        const button = await waitForItem(ui, "System Settings", (i) => i.role === "AXButton" && i.name.startsWith("Text size"));
        if (!button) return { ok: false, before: "Unknown", after: "Unknown", proof: "", error: "I couldn't find the Text size page." };
        const opened = await ui.act("System Settings", button, "press");
        if (!opened.ok) return { ok: false, before: "Unknown", after: "Unknown", proof: "", error: opened.error };
        const r = await stepSlider(ui, "Preferred reading size", 2, value === "larger");
        const ok = r.after !== undefined && r.before !== undefined && (value === "larger" ? r.after > r.before : r.after < r.before);
        return { ok, before: `Size ${r.before ?? "?"}`, after: `Size ${r.after ?? "?"}`, proof: `Preferred reading size slider reads ${r.after ?? "?"}`, error: r.error };
      }),
  },
  do_not_disturb: {
    label: "Do Not Disturb",
    values: ["on", "off"],
    apply: async (ctx, value) => {
      const ui = ctx.mac.ui!;
      if (!ui.controlCenter) return { ok: false, before: "Unknown", after: "Unknown", proof: "", error: "Control Center isn't available." };
      const r = await ui.controlCenter("controlcenter-focus-modes", "focus-mode-activity-com.apple.donotdisturb.mode.default", value as "on" | "off");
      const show = (v?: number) => (v === 1 ? "On" : v === 0 ? "Off" : "Unknown");
      return { ok: r.ok && r.after === (value === "on" ? 1 : 0), before: show(r.before), after: show(r.after), proof: `Do Not Disturb switch in Control Center reads ${show(r.after)}`, error: r.error };
    },
  },
};

const changeSetting: AgentTool = {
  name: "change_setting",
  kind: "act",
  description: `Change a Mac setting yourself, by a tested route, and read it back to prove it took. Settings: ${[...Object.entries(SETTINGS), ...Object.entries(SCREEN_SETTINGS)].map(([k, v]) => `${k} (${v.values.join("/")})`).join(", ")}. Always use this for these (the person never has to do them). Wallpaper is a personal choice: use open_settings + guide_person so they pick.`,
  input_schema: obj({ setting: { type: "string", enum: [...Object.keys(SETTINGS), ...Object.keys(SCREEN_SETTINGS)] }, value: str("One of the values listed for that setting") }),
  label: (i) => `Changing ${(SETTINGS[s(i, "setting")]?.label ?? SCREEN_SETTINGS[s(i, "setting")]?.label ?? "a setting").toLowerCase()}…`,
  async run(input, ctx) {
    const key = s(input, "setting");
    const def = SETTINGS[key];
    const value = s(input, "value").toLowerCase();
    // Settings with no command: a fixed route through the app, read back the same way.
    const screenDef = SCREEN_SETTINGS[key];
    if (screenDef) {
      if (!screenDef.values.includes(value)) return `Refused: ${screenDef.label} can only be set to ${screenDef.values.join(" or ")}.`;
      if (!ctx.mac.ui) return `I can't change ${screenDef.label.toLowerCase()} without the Accessibility permission. Use guide_person so the person can do it.`;
      const r = await screenDef.apply(ctx, value);
      const ref = addEvidence(ctx, { kind: "after", command: `read back: ${screenDef.label}`, code: r.ok ? 0 : 1, output: r.proof || r.error || "" });
      if (r.ok) ctx.beforeAfter.push({ label: screenDef.label, before: r.before, after: r.after });
      return r.ok ? `[${ref}] ${screenDef.label}: ${r.before} → ${r.after} (checked).` : `[${ref}] ${screenDef.label} didn't change${r.error ? `: ${r.error}` : ""}. Try open_settings + guide_person.`;
    }
    if (!def) return `Refused: I don't have a tested command for "${key}". Use open_settings + guide_person instead.`;
    if (!def.values.includes(value)) return `Refused: ${def.label} can only be set to ${def.values.join(" or ")} by command.${key === "wifi" ? " (Turning Wi-Fi off would cut me off from helping.)" : ""}`;
    const before = await ctx.mac.run(def.read);
    if (def.is(before.output, value)) {
      const ref = addEvidence(ctx, { kind: "after", command: def.read, code: 0, output: tail(before.output, 2) });
      return `[${ref}] ${def.label} was already ${value}. Nothing to change.`;
    }
    const command = def.set(value);
    const r = await ctx.mac.run(command);
    addEvidence(ctx, { kind: "run", command, code: r.code, output: tail(r.output, 2) });
    if (r.code !== 0) return `That didn't work: ${tail(r.output, 2)}`;
    // Read it back: the command saying OK isn't proof (macOS ignores some changes silently).
    let after = await ctx.mac.run(def.read);
    for (let i = 0; i < 4 && !def.is(after.output, value); i++) {
      await new Promise((x) => setTimeout(x, 250));
      after = await ctx.mac.run(def.read);
    }
    const ok = def.is(after.output, value);
    const ref = addEvidence(ctx, { kind: "after", command: def.read, code: ok ? 0 : 1, output: tail(after.output, 2) });
    ctx.beforeAfter.push({ label: def.label, before: def.show(before.output), after: def.show(after.output) });
    return ok
      ? `[${ref}] ${def.label} is now ${value} (checked).`
      : `[${ref}] I ran the command, but reading it back says it didn't change. macOS may not allow it this way: try open_settings + guide_person.`;
  },
};

const checkScreen: AgentTool = {
  name: "check_screen",
  kind: "look",
  description: "Final check: take one look at the screen and confirm a visible result, e.g. 'the screen is in dark mode' or 'the Wallpaper page shows the blue wallpaper'. Use it after a change you can see, especially when there is no read-back check. Returns an evidence number when the screen shows it.",
  input_schema: obj({ question: str("What the screen should show, in plain words") }),
  label: () => "Checking the screen…",
  async run(input, ctx) {
    const question = s(input, "question").slice(0, 200);
    if (!question) return "Say what the screen should show.";
    if (!ctx.mac.screen) return "I can't see the screen (Screen Recording isn't allowed), so rely on the other checks.";
    const shot = await ctx.mac.screen.capture();
    if (!shot) return "I couldn't take a look at the screen.";
    const { screenShows } = await import("./autopilot.js");
    const a = await screenShows(question, shot, ctx.signal);
    if (a.decisionTrace) {
      ctx.ui.detail(`Screen check: ${a.decisionTrace.provider} (${a.decisionTrace.model}), ${a.decisionTrace.elapsedMs} ms`, true);
      fileRecord({ ts: new Date().toISOString(), step: question, round: 0, decisionTrace: a.decisionTrace,
        action: { taken: "none", route: "none" }, outcome: "decided", delay: { decisionMs: a.decisionTrace.elapsedMs }, cancelled: false });
    }
    const ref = addEvidence(ctx, { kind: "after", command: `screen check: ${question}`, code: a.shows ? 0 : 1, output: a.seen || (a.shows ? "shown" : "not shown") });
    return `[${ref}] ${a.shows ? "Yes" : "No"}: ${a.seen}`;
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
  description: "Make sure an app is installed: checks first, and if it's missing installs it from its maker's official website only (never mirrors or download sites), checks the file is signed by the maker, installs it (macOS asks for the password), and checks it's there. Use this for any 'download/install X' step; opening a download page is not installing.",
  input_schema: obj({ app_name: str("The app's name, e.g. Zoom") }),
  label: (i) => `Checking ${s(i, "app_name")}…`,
  async run(input, ctx) {
    const name = s(input, "app_name");
    // Already installed: say so (with its version) instead of downloading it again.
    const have = oneApp(ctx, name);
    if ("path" in have) {
      const v = await ctx.mac.sandboxed(`/usr/bin/mdls -raw -name kMDItemVersion ${shq(have.path)}`).catch(() => null);
      const version = v && v.code === 0 && !/null/.test(v.output) ? v.output.trim() : "";
      const ref = addEvidence(ctx, { kind: "after", outcome: "passed", command: `check ${name} is installed`, code: 0, output: `${appLabel(have.path)} is installed at ${have.path}${version ? `, version ${version}` : ""}` });
      ctx.beforeAfter.push({ label: name, before: "Installed", after: `Installed${version ? ` (${version})` : ""}` });
      return `[${ref}] ${name} is already installed${version ? ` (version ${version})` : ""}, so nothing was downloaded.${/zoom/i.test(name) ? " Zoom updates itself when it opens." : ""}`;
    }
    // The person already said yes to a plan with this step: don't ask again.
    const ok = ctx.approvedPlan?.length ? true : await ctx.ui.confirm({ title: `Install ${name}?`, message: `I'll download ${name} from its maker's official website, check it's genuine, and install it. Your Mac will ask for your password.`, yes: "Yes, install", no: "Not now" });
    if (!ok) return "The person said no. Don't install.";
    ctx.ui.status(`Installing ${name}…`);
    const r = await ctx.mac.installOfficial(name);
    const refs = r.evidence.map((e) => addEvidence(ctx, e));
    // Installed means the app is really there now, not just that the installer ran.
    const now = r.ok ? oneApp(ctx, name) : null;
    if (now && "path" in now) {
      refs.push(addEvidence(ctx, { kind: "after", outcome: "passed", command: `check ${name} is installed`, code: 0, output: `${appLabel(now.path)} is installed at ${now.path}` }));
      ctx.beforeAfter.push({ label: name, before: "Not installed", after: "Installed" });
      return `[${refs.join(", ")}] ${name} is installed now.`;
    }
    return `[${refs.join(", ")}] ${r.ok ? `The installer finished, but I can't find ${name} in Applications.` : r.message}`;
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

const addCalendarEvent: AgentTool = {
  name: "add_calendar_event",
  kind: "act",
  description: "Add an event to the person's Apple Calendar, with an alert before it, then read it back to prove it's there. Use for appointments, calls and visits from the screen or the person's words. If the message has a link to join the call or visit, pass its words as join_link_text: CalHack reads the link's address from the message and puts it on the event. An event that's already there gets whatever it's missing (the join link, the alert) instead of a copy. Use the date exactly as written; work out the year from today's date.",
  input_schema: obj({
    title: str("Short title, e.g. 'Video visit with Dr. Priya Patel'"),
    start: str("Local start time on this Mac as YYYY-MM-DDTHH:MM, e.g. 2026-10-26T10:00"),
    duration_minutes: numOrNull("Length in minutes; null for 30"),
    alert_minutes_before: numOrNull("Minutes before the start for the alert, e.g. 15; null for no alert"),
    notes: strOrNull("Useful details for the event (appointment number, phone), or null"),
    url: strOrNull("An https link to join, if you know its full address, or null"),
    join_link_text: strOrNull("The words of the message's link to join the call or visit, e.g. 'Join your visit' (CalHack reads its address), or null"),
  }),
  label: () => "Adding it to your calendar…",
  async run(input, ctx) {
    // The join link's address comes from the message itself: the AI sees the link's words, not where it goes.
    let joinUrl = s(input, "url");
    const linkText = s(input, "join_link_text");
    if (linkText && !joinUrl) {
      let links = ctx.messageLinks ?? [];
      if (!linkFor(links, linkText) && ctx.mac.pageLinks) {
        const pl = await ctx.mac.pageLinks(ctx.sourceApp).catch(() => ({ links: [] as { text: string; url: string }[] }));
        if (pl.links.length) links = ctx.messageLinks = pl.links;
      }
      joinUrl = linkFor(links, linkText) ?? backupJoinLink() ?? "";
      webLog("calendar_link", { link: linkText, links: links.length, found: !!joinUrl, host: joinUrl ? new URL(joinUrl).hostname : null });
      if (!joinUrl) ctx.ui.detail(`I couldn't read the "${linkText}" link from the message, so the event has no join link.`, true);
    }
    const e = parseEvent(
      { title: s(input, "title"), start: s(input, "start"), durationMinutes: n(input, "duration_minutes"), alertMinutesBefore: n(input, "alert_minutes_before"), notes: s(input, "notes"), url: joinUrl },
      ctx.mac.now(),
    );
    if ("problem" in e) return `Not added: ${e.problem}`;
    const when = whenLabel(e);
    const add = await ctx.mac.run(addEventCommand(e));
    const outcome = add.output.trim().split("\n").pop() ?? "";
    if (add.code !== 0 || !/^(added|updated|exists)\|/.test(outcome)) {
      const why = /-1743|not allowed|not authorized/i.test(add.output) ? "macOS hasn't allowed CalHack to use Calendar yet (System Settings > Privacy & Security > Automation)" : tail(add.output, 2);
      addEvidence(ctx, { kind: "run", command: `add calendar event "${e.title}" on ${when}`, code: add.code || 1, output: why });
      return `Couldn't add it to Calendar: ${why}`;
    }
    const existed = outcome.startsWith("exists|");
    const updated = outcome.startsWith("updated|");
    // Read it back: the event must really be there, with the alert and join link we asked for.
    const check = await ctx.mac.run(findEventCommand(e));
    const found = parseFound(check.output);
    const alertOk = e.alertMinutesBefore === 0 || (found.found && found.alertMinutesBefore === e.alertMinutesBefore);
    const linkOk = !e.url || (found.found && found.url === e.url);
    const ok = check.code === 0 && found.found && (alertOk || existed) && linkOk;
    const host = (u: string) => {
      try {
        return new URL(u).hostname;
      } catch {
        return u.slice(0, 60);
      }
    };
    const linkNote = found.found && found.url ? `, join link ${host(found.url)}` : "";
    const shows = found.found ? `"${e.title}" is in Calendar (${found.calendar}) on ${when}${found.alertMinutesBefore !== null ? `, alert ${found.alertMinutesBefore} min before` : ", no alert"}${linkNote}` : "the event wasn't found";
    const ref = addEvidence(ctx, { kind: "after", outcome: ok ? "passed" : "failed", command: `look up calendar event "${e.title}" on ${when}`, code: ok ? 0 : 1, output: shows });
    ctx.beforeAfter.push({
      label: "Calendar",
      before: existed || updated ? "Already there" : "Not in calendar",
      after: found.found ? `${when}${found.alertMinutesBefore !== null ? `, alert ${found.alertMinutesBefore} min before` : ""}${found.url ? ", with join link" : ""}` : "Not found",
    });
    if (!ok) return `[${ref}] I tried to add it, but the check failed: ${shows}${e.url && !linkOk ? " (the join link isn't on it)" : ""}.`;
    return `[${ref}] ${updated ? "It was already in the calendar; I added what was missing" : existed ? "It was already in the calendar" : "Added"}: ${shows}.${existed && !alertOk ? " (The existing event's alert is different; I didn't change it.)" : ""}`;
  },
};

/**
 * Clicks the form's link on screen (if there is one), reads the address of the page that opened, and fills the form there
 * with Playwright. done = the tool's answer; linkClicked = the link was clicked, so the screen route should only fill.
 */
async function formViaPlaywright(
  ctx: ToolContext,
  o: { clickTarget?: string; inMessage: boolean; facts: Fact[]; webForm: WebFormDeps },
): Promise<{ done?: string; linkClicked: boolean }> {
  let linkClicked = false;
  // The link's page is open once the browser shows a new web address that isn't the email: checked by code, not by
  // looking at the screen, so the screen step stops right there and Playwright does the form.
  const startUrl = await ctx.mac.pageUrl?.().catch(() => null);
  const formUrl = async () => {
    const u = await ctx.mac.pageUrl?.().catch(() => null);
    return u && u !== startUrl && /^https?:/.test(u) && !signedInPage(u) ? u : null;
  };
  // Fastest and exact: read the link's address from the email itself and give it straight to Playwright (no clicking).
  let direct: string | null = null;
  if (o.inMessage && o.clickTarget && ctx.mac.pageLinks) {
    const pl = await ctx.mac.pageLinks(ctx.sourceApp).catch((e: Error) => ({ links: [], problem: e.message }));
    direct = linkFor(pl.links, o.clickTarget);
    if (pl.links.length) ctx.messageLinks = pl.links;
    webLog("message_links", { links: pl.links.length, found: !!direct, host: direct ? new URL(direct).hostname : null, problem: pl.problem });
    if (!direct && pl.problem) ctx.ui.detail(`I couldn't read the email's links (${pl.problem}), so I'll click the link instead.`, true);
  }
  if (direct) linkClicked = true;
  if (!direct && o.inMessage && o.clickTarget) {
    // CalHack clicks the link itself; nothing is handed to the person. If it can't, it says so and the agent moves on.
    const click = await finishOnScreen(ctx, { instruction: `Click the "${o.clickTarget}" link in the message`, doneWhen: async () => !!(await formUrl()), noHandoff: true });
    if (click.result === "skip") return { done: `Stopped (${click.trail.join("; ")}).`, linkClicked };
    if (click.result === "failed" && !(await formUrl())) {
      webLog("link_failed", { trail: click.trail });
      return { done: `CalHack couldn't open the "${o.clickTarget}" link: ${click.trail.at(-1) ?? "it didn't open"}. Say so in finish; carry on with the other steps.`, linkClicked };
    }
    linkClicked = true;
    webLog("link_clicked", { trail: click.trail, by: click.by });
  }
  if (ctx.signal?.aborted) return { done: "The person pressed Stop.", linkClicked };
  // A new tab can take a moment to load: wait up to 6 s for its address.
  let url = direct ?? (linkClicked ? await formUrl() : await ctx.mac.pageUrl?.().catch(() => null));
  for (let t = 0; linkClicked && !direct && !url && t < 12 && !ctx.signal?.aborted; t++) {
    await new Promise((x) => setTimeout(x, 500));
    url = await formUrl();
  }
  webLog("page_address", { host: url ? new URL(url).hostname : null, readable: !!url });
  if (!url || signedInPage(url) || !/^https?:/.test(url)) {
    // Not a web page CalHack can open (or the address can't be read): only then is the form filled on screen.
    ctx.ui.detail(`No form page to open with Playwright (${url ? new URL(url).hostname : "couldn't read the page address"}); filling it on screen instead.`, true);
    return { linkClicked };
  }
  // The rest of the form comes from the person's own contact card, if that card is the person the message is about.
  let facts = o.facts;
  const card = (await ctx.mac.myCard?.().catch(() => [])) ?? [];
  if (card.length && cardIsThePerson(card, o.facts)) {
    facts = safeFacts([...o.facts, ...card.filter((c) => !o.facts.some((f) => f.label.toLowerCase() === c.label.toLowerCase()))]);
    ctx.ui.detail(`Also using your contact card: ${card.map((c) => c.label).join(", ")}`, true);
  } else if (card.length) ctx.ui.detail("Your contact card is someone other than the person in the message, so I didn't use it.", true);
  const approved = !!ctx.approvedPlan?.length || ctx.personTrusts === true;
  const r = await fillWebForm(ctx, url, facts, o.webForm, { approved });
  if (!r) {
    ctx.ui.say("I couldn't fill in that form.");
    return { done: `CalHack couldn't open or fill the form at ${new URL(url).hostname} with Playwright (no Chrome, the page didn't load, or no box matched the details). Tell the person; don't retry on screen.`, linkClicked };
  }
  const filledList = r.filled.map((f) => (f.chose ? `${f.field}: ${f.chose}` : f.field)).join(", ");
  if (r.submitted) {
    ctx.ui.say(`Done. The site says: ${r.confirmation}`);
    return { done: `[${r.evidenceRef}] CalHack opened the link, filled ${filledList} with Playwright, ticked the required boxes and pressed "${r.submit}". The site confirmed it: "${r.confirmation}". Use ${r.evidenceRef} as proof the form was submitted.`, linkClicked };
  }
  ctx.ui.say(`I filled in the form, but didn't send it: ${r.problem}.`);
  return { done: `[${r.evidenceRef}] CalHack filled ${filledList} with Playwright but did NOT submit: ${r.problem}. Tell the person exactly that in finish; the form is still open in CalHack's Chrome window.`, linkClicked };
}

/** The backup join link from .env (CALHACK_JOIN_LINK), used only when the message's link can't be read. https only. */
export function backupJoinLink(): string | null {
  loadEnv();
  const raw = process.env.CALHACK_JOIN_LINK?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** The Zoom app's own link for a zoom.us meeting link (opens the app straight into the meeting), or null. */
export function zoomAppLink(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/(^|\.)zoom\.(us|com)$/.test(u.hostname)) return null;
  const id = /^\/(?:j|w|s)\/(\d{9,12})\/?$/.exec(u.pathname)?.[1];
  if (!id) return null;
  const pwd = u.searchParams.get("pwd");
  if (pwd !== null && !/^[A-Za-z0-9._-]{1,128}$/.test(pwd)) return null;
  return `zoommtg://zoom.us/join?action=join&confno=${id}${pwd ? `&pwd=${pwd}` : ""}`;
}

const joinMeeting: AgentTool = {
  name: "join_meeting",
  kind: "act",
  description: "Join a video call or visit from the link in the person's message (e.g. 'Join your visit'). CalHack reads the link's address from the message, makes sure Zoom is installed for a Zoom link (installing it from zoom.us if needed), opens the meeting straight in the Zoom app, and checks a meeting or waiting-room window opened. Other links open in the browser.",
  input_schema: obj({ link_text: str("The link's words in the message, e.g. 'Join your visit'") }),
  label: () => "Joining your call…",
  async run(input, ctx) {
    const text = s(input, "link_text");
    let links = ctx.messageLinks ?? [];
    if (!linkFor(links, text) && ctx.mac.pageLinks) {
      if (ctx.sourceApp && !NEVER_OPEN.has(ctx.sourceApp.toLowerCase())) await ctx.mac.run(`open -a ${shq(ctx.sourceApp)}`).catch(() => null);
      const pl = await ctx.mac.pageLinks(ctx.sourceApp).catch((e: Error) => ({ links: [], problem: e.message }));
      if (pl.links.length) links = ctx.messageLinks = pl.links;
      else if (pl.problem) return `Couldn't read the message's links: ${pl.problem}.`;
    }
    const url = linkFor(links, text) ?? backupJoinLink();
    if (!url || !/^https:\/\//.test(url)) return `I couldn't find a "${text}" link in the message.`;
    const zoom = zoomAppLink(url);
    if (!zoom) {
      const r = await ctx.mac.run(`open ${shq(url)}`);
      const ref = addEvidence(ctx, { kind: "run", command: `open the "${text}" link (${new URL(url).hostname})`, code: r.code, output: r.code === 0 ? "opened in the browser" : tail(r.output, 2) });
      return r.code === 0 ? `[${ref}] Opened "${text}" (${new URL(url).hostname}) in the browser. It isn't a Zoom link, so check the page with check_screen.` : `Couldn't open it: ${tail(r.output, 2)}`;
    }
    // A Zoom meeting needs the Zoom app: install it first if it's missing.
    if (!("path" in oneApp(ctx, "Zoom"))) {
      const inst = await installApp.run({ app_name: "Zoom" }, ctx);
      if (!("path" in oneApp(ctx, "Zoom"))) return `Zoom isn't installed, so I couldn't join. ${inst}`;
    }
    const r = await ctx.mac.run(`open ${shq(zoom)}`);
    if (r.code !== 0) return `Couldn't open the meeting in Zoom: ${tail(r.output, 2)}`;
    // Joined means Zoom shows a meeting (or the waiting room), not just that the app opened.
    let windows = "";
    for (let t = 0; t < 20 && !ctx.signal?.aborted; t++) {
      await new Promise((x) => setTimeout(x, 750));
      const w = await ctx.mac.run(`osascript -e 'tell application "System Events" to if exists process "zoom.us" then get name of every window of process "zoom.us"'`).catch(() => null);
      windows = w && w.code === 0 ? w.output.trim() : "";
      if (/meeting|waiting|webinar|host will let you in|join audio/i.test(windows)) break;
    }
    const joined = /meeting|waiting|webinar|host will let you in|join audio/i.test(windows);
    const ref = addEvidence(ctx, { kind: "after", outcome: joined ? "passed" : "failed", command: `join the Zoom meeting from "${text}"`, code: joined ? 0 : 1, output: joined ? `Zoom shows: ${windows.slice(0, 200)}` : `Zoom opened, but no meeting window appeared${windows ? ` (windows: ${windows.slice(0, 120)})` : ""}` });
    if (joined) ctx.beforeAfter.push({ label: "Video visit", before: "Not joined", after: /waiting|host will let you in/i.test(windows) ? "In the waiting room" : "Joined" });
    return joined ? `[${ref}] Joined the meeting in Zoom (${windows.slice(0, 120)}).` : `[${ref}] Zoom opened but I couldn't confirm the meeting started. Use check_screen to look.`;
  },
};

const guidePerson: AgentTool = {
  name: "guide_person",
  kind: "talk",
  description: "For a step that is still incomplete and only a click on screen can finish (e.g. adding a printer in Settings, choosing an option in an app, clicking a link in an email, filling in a web form). CalHack opens the page and then looks at the screen every few seconds and does the clicks itself. Anything private (permissions, passwords, sign-in, payments, deleting) it hands to the person, who is shown what to click. For a form, pass fill_details: only facts written in the message on screen (e.g. the person's name as it addresses them, an appointment number, a date, and what kind of visit or appointment it is, like 'Video visit', so CalHack can pick that option on the form). On a web page CalHack fills it with Playwright, adds what's missing from the person's own contact card when it's them, ticks the required agreement boxes once the person approved the plan, submits it, and checks the site confirmed it. Nothing is made up; secrets, card, social security and insurance numbers are never typed. Returns what happened.",
  input_schema: obj({
    instruction: str("One short, plain instruction, e.g. 'Click the Check in link in the email, then fill in the check-in form'"),
    click_target: strOrNull("The exact on-screen label to click, or null"),
    settings_url: strOrNull("An x-apple.systempreferences: link that opens the right page, or null"),
    in_message: { type: "boolean", description: "True when the step happens in the message or page the person had on screen when they asked (e.g. clicking a link in their email): CalHack brings that window back to the front first" },
    fill_details: {
      type: ["array", "null"],
      description: "For a form: details from the message on screen that CalHack may type, each with what it is. Never invent or guess one. null when there's no form",
      items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"], additionalProperties: false },
    },
  }),
  label: () => "Asking you to click something…",
  async run(input, ctx) {
    const url = s(input, "settings_url");
    // Other steps (Calendar, an installer, Zoom) may have covered the email: bring it back before looking for its link.
    if (input.in_message === true && ctx.sourceApp && !NEVER_OPEN.has(ctx.sourceApp.toLowerCase())) {
      const before = await ctx.mac.screen?.glance?.().catch(() => null);
      const r = await ctx.mac.run(`open -a ${shq(ctx.sourceApp)}`);
      if (r.code === 0 && ctx.mac.screen) {
        const { waitForSettle } = await import("./autopilot.js");
        const w = await waitForSettle(ctx.mac.screen, { before, reactMs: 1500, maxMs: 3000, signal: ctx.signal });
        if (w.reason === "no-glance") await new Promise((x) => setTimeout(x, 800));
      }
      ctx.ui.detail(r.code === 0 ? `Brought ${ctx.sourceApp} back to the front` : `Couldn't bring ${ctx.sourceApp} to the front: ${tail(r.output, 1)}`, true);
    }
    const facts = safeFacts(input.fill_details);
    if (facts.length) ctx.ui.detail(`Details I may type: ${facts.map((f) => f.label).join(", ")}`, true);
    let instruction = s(input, "instruction");
    let clickTarget = s(input, "click_target") || undefined;
    // A web form with details to fill: click the link on screen, then fill the form with Playwright (fast and exact).
    // Anything that doesn't work out falls through to filling it on screen.
    if (facts.length && ctx.mac.webForm) {
      const web = await formViaPlaywright(ctx, { clickTarget, inMessage: input.in_message === true, facts, webForm: ctx.mac.webForm });
      if (web.done) return web.done;
      if (web.linkClicked) {
        instruction = "Fill in the form on the page that's open";
        clickTarget = undefined;
      }
    }
    // A form to fill is CalHack's job end to end: on screen too, nothing is handed to the person.
    const g = await finishOnScreen(ctx, { instruction, clickTarget, settingsUrl: SETTINGS_URL.test(url) ? url : undefined, facts, noHandoff: facts.length > 0 });
    const steps = g.trail.length ? ` (${g.trail.join("; ")})` : "";
    if (g.result === "skip") return `The person skipped it${steps}.`;
    if (g.result === "failed") return `CalHack couldn't finish this on screen${steps}. Say so in finish and carry on with the other steps.`;
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

/** Refuses a scam: shows why, locks every action for the rest of the run, and ends it. */
async function refuseScam(ctx: ToolContext, reasons: string[]): Promise<string> {
  const plain = reasons.map((r) => r.trim()).filter(Boolean).slice(0, 5);
  ctx.scam = { reasons: plain.length ? plain : ["It has signs of a scam."] };
  ctx.ui.say("Careful. This is a scam, so I won't do it.");
  await ctx.ui.explain(refusal(ctx.scam.reasons));
  ctx.autoFinish = { verdict: "cant_do", headline: "This is a scam, so I didn't do any of its steps.", details: ctx.scam.reasons.slice(0, 3), proofRefs: [] };
  return "Refused: this message is a scam. Nothing was done, and nothing will be done for it.";
}

const reportScam: AgentTool = {
  name: "report_scam",
  kind: "talk",
  description: "The message or page on screen is a scam (it asks for gift cards or untraceable payment, to turn off antivirus, to allow remote control, to download a program from a site that isn't the maker's, for passwords or ID through a link, threatens to cancel within hours, or says not to call the real office). CalHack refuses, tells the person why, and won't do any of its steps even if they insist. Use this instead of propose_plan.",
  input_schema: obj({ reasons: { type: "array", items: { type: "string" }, description: "Each sign of the scam, in plain words, e.g. 'It asks you to pay with a gift card'" } }),
  label: () => "Checking this message…",
  async run(input, ctx) {
    const reasons = Array.isArray(input.reasons) ? input.reasons.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 200)) : [];
    return refuseScam(ctx, reasons);
  },
};

const proposePlan: AgentTool = {
  name: "propose_plan",
  kind: "talk",
  description: "When the screen shows steps meant for the person (an email, a message, a document) and they didn't say what they want: list each step as a goal, in order, and ask ONCE whether to do them all. After a yes, do every step without asking again. Mark each step with who does it: 'me' (CalHack does it), 'you' (only things software can't do at all: typing a password, a payment, answering a macOS permission prompt such as camera or microphone), or 'skip' (CalHack won't, with why). Clicking a link in the message, filling in and submitting its form, installing, settings and calendar are all 'me'.",
  input_schema: obj({
    goal: str("The overall goal in plain words, max 10, e.g. 'Get you ready for the video call'"),
    warning: strOrNull("If the message may not be genuine (the sender's address doesn't match who it claims to be, pressure to act fast, links that don't go where they say): what looks off, in one or two plain sentences. The person then decides whether to go ahead. null if it looks fine"),
    steps: {
      type: "array",
      description: "Each step from the screen, in order, in plain words",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "Plain words, max 12, e.g. 'Make the text bigger'" },
          by: { type: "string", enum: ["me", "you", "skip"] },
          why: { type: ["string", "null"], description: "For 'you' or 'skip': why, max 12 words. Otherwise null" },
        },
        required: ["text", "by", "why"],
      },
    },
  }),
  label: () => "Making a plan…",
  async run(input, ctx) {
    const raw = Array.isArray(input.steps) ? input.steps : [];
    const steps = raw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({ text: s(x, "text").slice(0, 120), by: ["me", "you", "skip"].includes(s(x, "by")) ? s(x, "by") : "you", why: s(x, "why").slice(0, 120) }))
      .filter((x) => x.text)
      .slice(0, 12);
    if (!steps.length) return "No steps given. Ask the person what they want with ask_person.";
    const details = steps.map((x, i) => `${i + 1}. ${x.text}${x.by === "you" ? ` (you'll do this part${x.why ? `: ${x.why}` : ""})` : x.by === "skip" ? ` (I'll skip this${x.why ? `: ${x.why}` : ""})` : ""}`);
    const goal = s(input, "goal") || "Do the steps on your screen";
    // Code checks the message's steps for scam signs too, whatever the AI concluded: a scam is refused, not planned.
    const scam = scamSigns([s(input, "goal"), s(input, "warning"), ...steps.map((x) => x.text), ...steps.map((x) => x.why)].join("\n"));
    if (scam) return refuseScam(ctx, scam.reasons);
    // A warning that's only about a sender the person trusts (CALHACK_TRUSTED_SENDERS) isn't shown.
    const rawWarning = s(input, "warning").slice(0, 400);
    const warning = keepWarning(rawWarning) ? rawWarning : "";
    if (rawWarning && !warning) ctx.ui.detail("The sender is one you trust, so I'm not warning about it.", true);
    if (warning) {
      ctx.ui.say("Careful. This message might not be real. You decide whether I go ahead.");
      const yes = await ctx.ui.confirm({
        title: "This message might not be real",
        message: `${warning} If you trust it, I'll do all of these steps for you. You can press Stop any time.`,
        details,
        yes: "I trust it, go ahead",
        no: "No, stop",
        tone: "danger",
      });
      if (!yes) return "The person chose not to go ahead because of the warning. Do nothing; finish with verdict 'not_done', a kind headline, and one detail on why the message looked suspicious.";
      ctx.personTrusts = true;
      ctx.approvedPlan = steps.filter((x) => x.by !== "skip").map((x) => x.text);
      return "The person read your warning and chose to go ahead. Treat the message as genuine from now on: do every 'me' step now, in order, fully (click its links with guide_person in_message=true, fill its forms with fill_details), without asking again and without holding back or stopping early because of the warning. A tool that asks for its own OK still will. Don't walk the person through 'you' steps; mention them once in finish. Then check and finish, and mention the warning once in the details.";
    }
    ctx.ui.say(`I can do this for you. Here's my plan.`);
    const yes = await ctx.ui.confirm({ title: `${goal}?`, message: "I'll do these one after another. You can press Stop any time.", details, yes: "Yes, do it all", no: "No thanks" });
    if (!yes) return "The person said no. Do nothing; finish with verdict 'not_done' and a kind headline.";
    ctx.approvedPlan = steps.filter((x) => x.by !== "skip").map((x) => x.text);
    return "The person said yes to the whole plan. Do every 'me' step now, in order, without asking again (a tool that asks for its own OK still will). Don't walk the person through 'you' steps; mention them once in finish. Then check and finish.";
  },
};

/** A phone number or email address FaceTime can call, or null. */
export function callTarget(raw: string): string | null {
  const t = raw.trim();
  if (/^[^\s@<>"'`;|&$()]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return t;
  if (!/^[+\d\s().-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  // "+(425) 628 4156" is a US number written with a stray +: keep the + only for full international numbers.
  return t.startsWith("+") && digits.length >= 11 ? `+${digits}` : digits;
}

const startCall: AgentTool = {
  name: "start_call",
  kind: "act",
  description: "Start a FaceTime call to a phone number or email address. Only for a call the person said yes to in propose_plan (the number must be in that plan), or one they asked for themselves.",
  input_schema: obj({ to: str("The phone number or email address, exactly as shown"), video: { type: "boolean", description: "true for video, false for audio only" } }),
  label: () => "Starting the FaceTime call…",
  async run(input, ctx) {
    const to = callTarget(s(input, "to"));
    if (!to) return "Refused: that isn't a phone number or email address FaceTime can call.";
    const key = to.replace(/\D/g, "").slice(-10) || to.toLowerCase();
    const approved = (ctx.approvedPlan ?? []).some((line) => (/@/.test(to) ? line.toLowerCase().includes(key) : line.replace(/\D/g, "").includes(key)));
    if (!approved) return "Refused: the person hasn't seen this number. Put the call (with the number) in propose_plan first, so they can say yes to it.";
    const url = `${input.video === false ? "facetime-audio" : "facetime"}://${to}`;
    const command = `open ${shq(url)}`;
    const r = await ctx.mac.run(command);
    addEvidence(ctx, { kind: "run", command, code: r.code, output: tail(r.output, 2) });
    if (r.code !== 0) return `Couldn't start FaceTime: ${tail(r.output, 2)}`;
    let up = false;
    for (let i = 0; i < 5 && !up; i++) {
      if (i) await new Promise((x) => setTimeout(x, 600));
      up = (await ctx.mac.sandboxed("pgrep -x FaceTime")).code === 0;
    }
    const ref = addEvidence(ctx, { kind: "after", command: "pgrep -x FaceTime", code: up ? 0 : 1, output: up ? "FaceTime is open" : "FaceTime did not start" });
    return up
      ? `[${ref}] FaceTime is open and calling ${to}. macOS may show a "Call" button first: if so, use guide_person with click_target "Call".`
      : `[${ref}] I asked FaceTime to call, but it didn't open.`;
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
  listApps, runningApps, soundStatus, checkScreen, checkProblem, diskUsage, findFiles, findFile, runCheck, revealFile,
  quitApp, openApp, changeSetting, openSettings, openWebsite, trashApp, setVolume, setSoundOutput, setWifi, setBluetooth, fixProblem, installApp, trashFiles, runCommand,
  startCall, addCalendarEvent, joinMeeting, reportScam, guidePerson, askPerson, proposePlan, explainIrreversible, finish,
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

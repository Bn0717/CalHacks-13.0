// Fixed actions that do a "click this" step for the person, so they don't have to.
// Like the updated-command swaps in risk.ts, these commands are built by our code, never by the AI.
// Code decides when one applies (from the step's words), and every command is checked again before it runs.
// If an action can't run, the step falls back to asking the person to click it.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listOutputs, setOutput, type SoundOutput } from "../mac/audio.js";
import { assessCommand } from "./risk.js";
import { runNormally, runSandboxed, type ExecResult } from "./exec.js";
import type { Evidence, Recipe, Step } from "./types.js";
import { appProcessCheck, runOutcomeCheck } from "./verification.js";

export interface RecipeOutcome {
  ok: boolean;
  /** One plain-English line, e.g. "Printer “HP LaserJet” is added and ready." */
  message: string;
  output?: string;
  /** Every command that ran, with its exit code. */
  evidence: Evidence[];
  /** Who ran the commands that change something. */
  ranBy?: "droid" | "calhack";
  /** What Droid did, if it ran them. */
  log?: string[];
}

type Result = Omit<RecipeOutcome, "evidence" | "ranBy" | "log">;

/** Apps we never open for someone: they can run anything. */
export const NEVER_OPEN = new Set(["terminal", "iterm", "script editor", "automator", "system settings", "system preferences", "disk utility", "keychain access"]);

/** Apps whose file name differs from the name people use. */
const APP_FILE_NAMES: Record<string, string> = { zoom: "zoom.us", "microsoft teams": "Microsoft Teams", chrome: "Google Chrome", "google chrome": "Google Chrome", vscode: "Visual Studio Code", "vs code": "Visual Studio Code" };

/** Same rule as the app's openSafely: plain app names only. */
const APP_NAME = /^[A-Za-z0-9][\w .&+'-]{0,59}$/;

/** Which fixed action, if any, can do this manual step. */
export function recipeFor(step: Step): Recipe | undefined {
  if (step.kind !== "manual") return undefined;
  const text = [step.title, step.clickTarget, step.explanation].filter(Boolean).join(" ").toLowerCase();

  if (/\bprinters?\b/.test(text) && !/\b(remove|delete|reset|uninstall)\b/.test(text)) {
    return { id: "add-printer", label: "Add your network printer" };
  }

  if (/\b(pick|choose|switch|change|select)\b[^.]*\b(sound|audio|speakers?)\b[^.]*\b(plays?|output|speakers?)\b|\bwhere sound plays\b/.test(text) && !/\b(input|microphone|mic)\b/.test(text)) {
    return { id: "sound-output", label: "Send the sound to your Mac's speakers" };
  }

  const open = /^(?:open|launch|start)\s+(?:the\s+)?(.+?)(?:\s+app)?\.?$/i.exec(step.title.trim());
  const app = open?.[1].trim();
  if (app && APP_NAME.test(app) && app.split(/\s+/).length <= 3 && !NEVER_OPEN.has(app.toLowerCase())) {
    return { id: "open-app", label: `Open ${app}`, app };
  }
  return undefined;
}

/** Steps that share an action only run it once. */
export function recipeKey(recipe: Recipe): string {
  return recipe.id + (recipe.app ? ":" + recipe.app.toLowerCase() : "");
}

function shellQuote(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

// ---------- Add a printer ----------

const DNSSD_URI = /^dnssd:\/\/[A-Za-z0-9%._~-]+\/(?:\?[A-Za-z0-9%=&._~-]*)?$/;

/** Printer addresses from `lpinfo -v` output. Only well-formed Bonjour (dnssd://) addresses count. */
export function parsePrinterList(output: string): string[] {
  const uris = output
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[1] ?? "")
    .filter((uri) => DNSSD_URI.test(uri));
  return [...new Set(uris)];
}

/** "dnssd://HP%20LaserJet%20Pro._ipp._tcp.local./?uuid=…" → "HP LaserJet Pro" */
export function printerDisplayName(uri: string): string {
  const host = uri.slice("dnssd://".length).split("/")[0];
  let name = host.replace(/\._(ipps?|pdl-datastream|printer)\._tcp.*$/i, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the raw text.
  }
  return name.trim() || "Printer";
}

/** A printer queue name: letters, digits, _ and - only (what lpadmin -p accepts). */
export function printerQueueName(display: string): string {
  return display.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Printer";
}

/** The exact command used to add one printer. "-m everywhere" uses the driverless driver every modern printer supports. */
export function addPrinterCommand(uri: string): string {
  if (!DNSSD_URI.test(uri)) throw new Error("Not a printer address we trust.");
  return `lpadmin -p ${printerQueueName(printerDisplayName(uri))} -E -v ${shellQuote(uri)} -m everywhere`;
}

export interface RecipeDeps {
  sandboxed(command: string, timeoutMs?: number): Promise<ExecResult>;
  /** Runs a command that changes something (Droid, when it's set up). */
  normal(command: string, timeoutMs?: number): Promise<ExecResult & { ranBy?: "droid" | "calhack"; log?: string[] }>;
  appPath(name: string): string | null;
  wait(ms: number): Promise<void>;
  /** The Mac's sound outputs, and switching the one in use. */
  outputs?: { list(): Promise<SoundOutput[]>; set(id: number): Promise<void> };
}

export const realRecipeDeps: RecipeDeps = {
  sandboxed: runSandboxed,
  normal: runNormally,
  appPath: (name) => {
    const dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", join(homedir(), "Applications")];
    return dirs.map((d) => join(d, name + ".app")).find((p) => existsSync(p)) ?? null;
  },
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  outputs: { list: listOutputs, set: setOutput },
};

/** Keeps what ran, so the receipt can show it. */
interface Trail {
  evidence: Evidence[];
  ranBy?: "droid" | "calhack";
  log?: string[];
}

/** Runs our own command, refusing it if the safety rules would block it. */
async function runOurs(command: string, deps: RecipeDeps, timeoutMs: number, trail: Trail): Promise<ExecResult | null> {
  const a = assessCommand(command);
  if (a.level === "blocked") return null;
  let r: ExecResult;
  if (a.readOnly) {
    r = await deps.sandboxed(command, timeoutMs);
  } else {
    const ran = await deps.normal(command, timeoutMs);
    trail.ranBy = ran.ranBy ?? "calhack";
    if (ran.log) trail.log = [...(trail.log ?? []), ...ran.log];
    r = ran;
  }
  trail.evidence.push({ kind: "run", command, code: r.code, output: r.output.trim().split("\n").slice(-6).join("\n") });
  return r;
}

async function addPrinter(deps: RecipeDeps, trail: Trail): Promise<Result> {
  const found = await runOurs("lpinfo --include-schemes dnssd -v", deps, 30_000, trail);
  const uris = found && found.code === 0 ? parsePrinterList(found.output) : [];
  if (uris.length === 0) return { ok: false, message: "I couldn't find a printer on your network. Check it's on and on the same Wi-Fi." };
  if (uris.length > 1) return { ok: false, message: `I found ${uris.length} printers, so you pick yours.` };

  const uri = uris[0];
  const name = printerDisplayName(uri);
  const queue = printerQueueName(name);
  const added = await runOurs(addPrinterCommand(uri), deps, 90_000, trail);
  if (!added || added.code !== 0) return { ok: false, message: `I couldn't add “${name}” myself.`, output: added?.output.trim().slice(-800) };

  const status = await runOutcomeCheck(`lpstat -p ${queue}`, "after", deps.sandboxed);
  trail.evidence.push(status);
  if (status.outcome !== "passed") {
    status.outcome = "unknown";
    return { ok: true, message: `The add-printer command finished; I couldn't verify that “${name}” was added.`, output: status.output };
  }
  const ready = /\b(idle|enabled)\b/i.test(status.output) && !/\bdisabled\b/i.test(status.output);
  return {
    ok: true,
    message: ready ? `Printer “${name}” is added and shows as Ready.` : `Printer “${name}” is added.`,
    output: status.output.trim(),
  };
}

// ---------- Send sound to the Mac's speakers ----------

/** The Mac's own speakers: built-in, and not a headset or display. */
export function builtInSpeakers(outputs: SoundOutput[]): SoundOutput | null {
  const builtIn = outputs.filter((o) => o.transport === "built-in");
  return builtIn.find((o) => /speakers?/i.test(o.name)) ?? builtIn[0] ?? null;
}

async function soundOutput(deps: RecipeDeps, trail: Trail): Promise<Result> {
  if (!deps.outputs) return { ok: false, message: "I can't switch the sound output here." };
  const outputs = await deps.outputs.list();
  const target = builtInSpeakers(outputs);
  if (!target) return { ok: false, message: "I couldn't find your Mac's own speakers in the list." };
  const before = outputs.find((o) => o.default);
  if (before?.id !== target.id) await deps.outputs.set(target.id);
  // macOS can take a moment to report the new output.
  let now = (await deps.outputs.list()).find((o) => o.default);
  for (let i = 0; i < 4 && now?.id !== target.id; i++) {
    await deps.wait(250);
    now = (await deps.outputs.list()).find((o) => o.default);
  }
  const ok = now?.id === target.id;
  trail.evidence.push({ kind: "run", command: "switch sound output", code: ok ? 0 : 1, output: `in use: ${now?.name ?? "?"}` });
  return ok ? { ok: true, message: `Sound now plays from “${target.name}”.` } : { ok: false, message: `The sound didn't switch; “${now?.name ?? "?"}” is still in use.` };
}

// ---------- Open an app ----------

async function openApp(app: string, deps: RecipeDeps, trail: Trail): Promise<Result> {
  const path = deps.appPath(app) ?? deps.appPath(APP_FILE_NAMES[app.toLowerCase()] ?? app);
  if (!path) return { ok: false, message: `I couldn't find ${app} in Applications.` };
  const opened = await runOurs(`open ${shellQuote(path)}`, deps, 30_000, trail);
  if (!opened || opened.code !== 0) return { ok: false, message: `I couldn't open ${app}.`, output: opened?.output.trim() };
  // Give it a moment to start, then check it's really running.
  for (let i = 0; i < 5; i++) {
    await deps.wait(1500);
    const running = await runOutcomeCheck(appProcessCheck(path), "after", deps.sandboxed);
    running.checkId = "app-running";
    trail.evidence.push(running);
    if (running.outcome === "passed") return { ok: true, message: `${app} is open and running.` };
  }
  const last = trail.evidence[trail.evidence.length - 1];
  last.outcome = "unknown";
  return { ok: true, message: `The launch command finished; I couldn't verify that ${app} is running.` };
}

export async function runRecipe(recipe: Recipe, deps: RecipeDeps = realRecipeDeps): Promise<RecipeOutcome> {
  const trail: Trail = { evidence: [] };
  let r: Result;
  try {
    if (recipe.id === "add-printer") r = await addPrinter(deps, trail);
    else if (recipe.id === "sound-output") r = await soundOutput(deps, trail);
    else if (recipe.id === "open-app" && recipe.app && APP_NAME.test(recipe.app)) r = await openApp(recipe.app, deps, trail);
    else r = { ok: false, message: "I can't do this one myself." };
  } catch (error) {
    r = { ok: false, message: `Something went wrong: ${(error as Error).message}` };
  }
  return { ...r, ...trail };
}

/**
 * Which recipe commands go through the executor (Droid). Opening an app is routine and runs directly;
 * anything that changes the system (like adding a printer) goes through the executor.
 */
export function recipeNormal(execute: RecipeDeps["normal"], direct: RecipeDeps["normal"] = realRecipeDeps.normal): RecipeDeps["normal"] {
  return (command, timeoutMs) => (/^open\s/.test(command) ? direct(command, timeoutMs) : execute(command, timeoutMs));
}

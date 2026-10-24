// Fixed actions that do a "click this" step for the person, so they don't have to.
// Like the updated-command swaps in risk.ts, these commands are built by our code, never by the AI.
// Code decides when one applies (from the step's words), and every command is checked again before it runs.
// If an action can't run, the step falls back to pointing with the arrow.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assessCommand } from "./risk.js";
import { runNormally, runSandboxed, type ExecResult } from "./exec.js";
import type { Recipe, Step } from "./types.js";

export interface RecipeOutcome {
  ok: boolean;
  /** One plain-English line, e.g. "Printer “HP LaserJet” is added and ready." */
  message: string;
  output?: string;
}

/** Apps we never open for someone: they can run anything. */
const NEVER_OPEN = new Set(["terminal", "iterm", "script editor", "automator", "system settings", "system preferences", "disk utility", "keychain access"]);

/** Same rule as the app's openSafely: plain app names only. */
const APP_NAME = /^[A-Za-z0-9][\w .&+'-]{0,59}$/;

/** Which fixed action, if any, can do this manual step. */
export function recipeFor(step: Step): Recipe | undefined {
  if (step.kind !== "manual") return undefined;
  const text = [step.title, step.clickTarget, step.explanation].filter(Boolean).join(" ").toLowerCase();

  if (/\bprinters?\b/.test(text) && !/\b(remove|delete|reset|uninstall)\b/.test(text)) {
    return { id: "add-printer", label: "Add your network printer" };
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
  normal(command: string, timeoutMs?: number): Promise<ExecResult>;
  appPath(name: string): string | null;
  wait(ms: number): Promise<void>;
}

const realDeps: RecipeDeps = {
  sandboxed: runSandboxed,
  normal: runNormally,
  appPath: (name) => {
    const dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", join(homedir(), "Applications")];
    return dirs.map((d) => join(d, name + ".app")).find((p) => existsSync(p)) ?? null;
  },
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Runs our own command, refusing it if the safety rules would block it. */
async function runOurs(command: string, deps: RecipeDeps, timeoutMs: number): Promise<ExecResult | null> {
  const a = assessCommand(command);
  if (a.level === "blocked") return null;
  return a.readOnly ? deps.sandboxed(command, timeoutMs) : deps.normal(command, timeoutMs);
}

async function addPrinter(deps: RecipeDeps): Promise<RecipeOutcome> {
  const found = await runOurs("lpinfo --include-schemes dnssd -v", deps, 30_000);
  const uris = found && found.code === 0 ? parsePrinterList(found.output) : [];
  if (uris.length === 0) return { ok: false, message: "I couldn't find a printer on your network. Check it's on and on the same Wi-Fi." };
  if (uris.length > 1) return { ok: false, message: `I found ${uris.length} printers, so you pick yours.` };

  const uri = uris[0];
  const name = printerDisplayName(uri);
  const queue = printerQueueName(name);
  const added = await runOurs(addPrinterCommand(uri), deps, 90_000);
  if (!added || added.code !== 0) return { ok: false, message: `I couldn't add “${name}” myself.`, output: added?.output.trim().slice(-800) };

  const status = await runOurs(`lpstat -p ${queue}`, deps, 15_000);
  if (!status || status.code !== 0) return { ok: false, message: `I added “${name}”, but the Mac doesn't list it yet.`, output: status?.output.trim() };
  const ready = /\b(idle|enabled)\b/i.test(status.output) && !/\bdisabled\b/i.test(status.output);
  return {
    ok: true,
    message: ready ? `Printer “${name}” is added and shows as Ready.` : `Printer “${name}” is added.`,
    output: status.output.trim(),
  };
}

// ---------- Open an app ----------

async function openApp(app: string, deps: RecipeDeps): Promise<RecipeOutcome> {
  const path = deps.appPath(app);
  if (!path) return { ok: false, message: `I couldn't find ${app} in Applications.` };
  const opened = await runOurs(`open ${shellQuote(path)}`, deps, 30_000);
  if (!opened || opened.code !== 0) return { ok: false, message: `I couldn't open ${app}.`, output: opened?.output.trim() };
  // Give it a moment to start, then check it's really running.
  for (let i = 0; i < 5; i++) {
    await deps.wait(1500);
    const running = await runOurs(`pgrep -f ${shellQuote(path + "/Contents/MacOS/")}`, deps, 10_000);
    if (running?.code === 0) return { ok: true, message: `${app} is open and running.` };
  }
  return { ok: true, message: `Opened ${app}. (It's still starting.)` };
}

export async function runRecipe(recipe: Recipe, deps: RecipeDeps = realDeps): Promise<RecipeOutcome> {
  try {
    if (recipe.id === "add-printer") return await addPrinter(deps);
    if (recipe.id === "open-app" && recipe.app && APP_NAME.test(recipe.app)) return await openApp(recipe.app, deps);
    return { ok: false, message: "I can't do this one myself." };
  } catch (error) {
    return { ok: false, message: `Something went wrong: ${(error as Error).message}` };
  }
}

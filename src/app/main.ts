// CalHack desktop app: press the shortcut (⌃⌥⌘D by default) on any how-to, tap "Do it", and it does the steps,
// only stopping for steps the safety rules flag. At the end it shows proof that it worked.
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, systemPreferences, Tray } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeEnvironment, probeEnvironment, type Environment } from "../core/probe.js";
import { applyAiConcerns, planSteps, type Plan } from "../core/plan.js";
import { check, runPlannedStep, type Executor } from "../core/runner.js";
import { runNormally, runSandboxed } from "../core/exec.js";
import { runSequence } from "../core/sequence.js";
import { collectEvidence, type Receipt } from "../core/receipt.js";
import { reviewRun } from "../ai/review.js";
import { droidProblem, runWithDroid } from "../droid/executor.js";
import { assessCommand } from "../core/risk.js";
import type { Evidence, InstructionSource, PlannedStep, StepResult } from "../core/types.js";
import { friendlyError, hasApiKey, loadEnv } from "../ai/client.js";
import { parseInstructions, type ParseResult } from "../ai/parse.js";
import { locateOnScreen, type ScreenLocation } from "../ai/locate.js";
import { frontAppName } from "../mac/front.js";
import { describeSource, gatherInstructions } from "./gather.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
process.env.CALHACK_ROOT ??= ROOT;
loadEnv(ROOT);

// The shortcut can be changed with CALHACK_HOTKEY in .env (Electron format, e.g. "Control+Alt+Command+D").
const HOTKEY = process.env.CALHACK_HOTKEY?.trim() || "Control+Alt+Command+D";
const KEY_SYMBOLS: Record<string, string> = { control: "⌃", ctrl: "⌃", alt: "⌥", option: "⌥", shift: "⇧", command: "⌘", cmd: "⌘", commandorcontrol: "⌘", cmdorctrl: "⌘" };
/** "Control+Alt+D" → "⌃⌥D" */
const KEY_LABEL = HOTKEY.split("+").map((k) => KEY_SYMBOLS[k.toLowerCase()] ?? k.toUpperCase()).join("");
const UI = (name: string) => join(here, "ui", name);
const PRELOAD = join(here, "preload.cjs");
const OWN_APP_NAMES = new Set(["Electron", "CalHack"]);

let tray: Tray | null = null;
let panel: BrowserWindow | null = null;
let overlay: BrowserWindow | null = null;
let warning: BrowserWindow | null = null;

interface Session {
  source: InstructionSource;
  parse: ParseResult;
  plan: Plan;
  useUpdated: Set<string>;
  results: Map<string, StepResult>;
  /** Fixed actions tried in the current run (see core/recipes.ts). */
  recipesTried: Map<string, { stepId: string; ok: boolean }>;
  /** Click steps the person lets a fixed action do (on by default; they can turn it off before running). */
  useRecipe: Set<string>;
  /** Why we couldn't do a click step for them, by step id. */
  notes: Map<string, string>;
  /** Shown when a run ends: proof that it worked, or exactly what failed. */
  receipt: Receipt | null;
  /** True while the separate Claude reviewer checks the evidence. */
  reviewing: boolean;
}
let session: Session | null = null;
let busy = false;
let running = false;
let stopRequested = false;
let envCache: { env: Environment; at: number } | null = null;
let lastExternalApp: string | null = null;

const approvals = new Map<string, (yes: boolean) => void>();
const manualWaits = new Map<string, (answer: "done" | "skip") => void>();

// ---------- Windows ----------

function baseWindow(opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    transparent: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    ...opts,
  });
  // Keep our own windows out of screenshots so Claude only sees the person's screen.
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Never navigate away from our own pages.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // CALHACK_DEBUG=1 prints page errors in the terminal.
  if (process.env.CALHACK_DEBUG) {
    win.webContents.on("console-message", (e) => console.log(`[page ${e.level}] ${e.message}`));
    win.webContents.on("preload-error", (_e, path, err) => console.log(`[preload error] ${path}: ${err}`));
  }
  return win;
}

function ensurePanel(): BrowserWindow {
  if (panel && !panel.isDestroyed()) return panel;
  const area = screen.getPrimaryDisplay().workArea;
  const width = 420;
  const height = Math.min(720, area.height - 40);
  panel = baseWindow({ width, height, x: area.x + area.width - width - 16, y: area.y + 16 });
  panel.loadFile(UI("panel.html"));
  panel.on("closed", () => (panel = null));
  return panel;
}

function showPanel(): void {
  const p = ensurePanel();
  if (p.webContents.isLoading()) p.webContents.once("did-finish-load", () => p.showInactive());
  else p.showInactive();
}

function send(channel: string, data: unknown): void {
  const p = ensurePanel();
  if (channel === "state") data = { ...(data as object), hotkey: KEY_LABEL };
  const go = () => p.webContents.send(channel, data);
  if (p.webContents.isLoading()) p.webContents.once("did-finish-load", go);
  else go();
}

function ensureOverlay(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay;
  const b = screen.getPrimaryDisplay().bounds;
  overlay = baseWindow({ x: b.x, y: b.y, width: b.width, height: b.height, hasShadow: false, focusable: false });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setIgnoreMouseEvents(true);
  overlay.loadFile(UI("overlay.html"));
  overlay.on("closed", () => (overlay = null));
  return overlay;
}

function pointAt(x: number, y: number, label: string): void {
  const o = ensureOverlay();
  const go = () => {
    o.webContents.send("point", { x, y, label });
    o.showInactive();
  };
  if (o.webContents.isLoading()) o.webContents.once("did-finish-load", go);
  else go();
}

function hidePointer(): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("point-hide", {});
  overlay.hide();
}

function showWarning(data: { reasons: string[]; command: string }): void {
  if (!warning || warning.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    const width = 480;
    warning = baseWindow({ width, height: 340, x: Math.round(area.x + (area.width - width) / 2), y: area.y + 40 });
    warning.setAlwaysOnTop(true, "screen-saver");
    warning.loadFile(UI("warning.html"));
    warning.on("closed", () => (warning = null));
  }
  const w = warning;
  const go = () => {
    w.webContents.send("warning", data);
    w.show();
  };
  if (w.webContents.isLoading()) w.webContents.once("did-finish-load", go);
  else go();
}

// ---------- Screen ----------

interface Shot {
  data: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  /** Multiply screenshot pixels by this to get screen points. */
  toScreen: number;
}

async function captureScreen(): Promise<Shot | null> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.bounds;
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    // Claude works best with images up to about 1500 pixels on the long side.
    const scale = Math.min(1, 1456 / Math.max(width, height));
    const img = scale < 1 ? src.thumbnail.resize({ width: Math.round(width * scale), quality: "good" }) : src.thumbnail;
    const size = img.getSize();
    return { data: img.toJPEG(75).toString("base64"), mediaType: "image/jpeg", width: size.width, height: size.height, toScreen: width / size.width };
  } catch {
    return null;
  }
}

function screenAllowed(): boolean {
  return systemPreferences.getMediaAccessStatus("screen") === "granted";
}

// ---------- Plan → panel ----------

function stepView(p: PlannedStep, s: Session) {
  const r = s.results.get(p.step.id);
  return {
    id: p.step.id,
    title: p.step.title,
    explanation: p.step.explanation,
    kind: p.step.kind,
    command: p.step.command ?? null,
    url: p.step.url ?? null,
    clickTarget: p.step.clickTarget ?? null,
    hasSettingsLink: !!safeSettingsUrl(p.step.settingsUrl),
    recipe: p.recipe?.label ?? null,
    note: s.notes.get(p.step.id) ?? null,
    level: p.level,
    reasons: p.reasons,
    outdated: p.assessment.outdated ?? null,
    wrongPlatform: p.assessment.wrongPlatform ?? null,
    needsReview: p.needsReview,
    checkCommand: p.checkUsable ? p.step.checkCommand : null,
    useUpdated: s.useUpdated.has(p.step.id),
    useRecipe: s.useRecipe.has(p.step.id),
    alternative: p.step.alternativeGroup ? { group: p.step.alternativeGroup, option: p.step.alternativeOption ?? null } : null,
    ranBy: r?.ranBy ?? null,
    log: r?.log ?? null,
    evidence: (r?.evidence ?? []).map((e) => ({ kind: e.kind, command: e.command, code: e.code })),
    flags: p.flags,
    notNeeded: p.assessment.outdated?.suggestion === "",
    status: r?.status ?? null,
    message: r?.message ?? null,
    output: r?.output ?? null,
  };
}

function sendPlan(): void {
  if (!session) return;
  const s = session;
  send("state", {
    phase: "plan",
    receipt: s.receipt,
    reviewing: s.reviewing,
    droid: droidProblem() ? { ready: false, problem: droidProblem() } : { ready: true, problem: null },
    goal: s.parse.goal,
    sourceLabel: describeSource(s.source),
    location: s.source.location ?? null,
    fromCache: s.parse.fromCache,
    appliesToThisComputer: s.parse.appliesToThisComputer,
    pageWarnings: [...s.plan.pageWarnings.map((w) => ({ level: w.level, reason: w.reason })), ...s.parse.pageConcerns.filter((c) => c.steps.length === 0).map((c) => ({ level: "ask", reason: c.text }))],
    steps: s.plan.steps.map((p) => stepView(p, s)),
    running,
  });
}

/** Only System Settings links are opened, whatever the AI suggests. */
function safeSettingsUrl(url?: string): string | null {
  return url && /^x-apple\.systempreferences:[A-Za-z0-9._\-?=&]+$/.test(url) ? url : null;
}

// ---------- The hotkey ----------

async function getEnvironment(): Promise<Environment> {
  if (envCache && Date.now() - envCache.at < 5 * 60_000) return envCache.env;
  const env = await probeEnvironment();
  envCache = { env, at: Date.now() };
  return env;
}

async function onHotkey(): Promise<void> {
  if (busy || running) {
    showPanel();
    return;
  }
  busy = true;
  try {
    let appName = await frontAppName();
    if (appName && OWN_APP_NAMES.has(appName)) appName = lastExternalApp;
    if (appName) lastExternalApp = appName;

    hidePointer();
    showPanel();
    send("state", { phase: "reading", message: `Looking at ${appName ?? "your screen"}…` });

    if (!screenAllowed()) {
      send("state", { phase: "permission", message: "CalHack needs Screen Recording permission to see your screen." });
    }
    const shot = screenAllowed() ? await captureScreen() : null;
    const source = await gatherInstructions({ app: appName, recentClipboard: recentClipboard() });
    send("state", { phase: "reading", message: `Reading ${describeSource(source)}…` });

    if (!hasApiKey()) {
      send("state", { phase: "error", message: "No Claude API key yet. Put ANTHROPIC_API_KEY=... in the .env file in the project folder, then restart CalHack." });
      return;
    }
    if (source.kind === "screenshot" && !shot) {
      send("state", { phase: "error", message: `Couldn't read anything. Copy the instructions (⌘C) and press ${KEY_LABEL} again, or allow Screen Recording.` });
      return;
    }
    const env = await getEnvironment();
    const parse = await parseInstructions({
      source,
      environment: describeEnvironment(env),
      screenshot: shot ? { data: shot.data, mediaType: shot.mediaType } : undefined,
      allowCache: true,
    });
    const plan = planSteps(parse.steps, source);
    applyAiConcerns(plan, parse.pageConcerns, parse.appliesToThisComputer);
    // Start with "Use the updated command" on wherever our rules built a newer form.
    // The newer command is still checked again and still asks before it runs.
    const useUpdated = new Set(plan.steps.filter((p) => p.assessment.outdated?.suggestion).map((p) => p.step.id));
    // Find steps that are already done, so the list only shows what's left.
    send("state", { phase: "reading", message: "Checking your Mac…" });
    const results = new Map<string, StepResult>();
    await Promise.all(
      plan.steps.map(async (p) => {
        if (p.assessment.wrongPlatform || p.step.kind === "info") return;
        const c = await check(p, "before").catch(() => null);
        if (c?.passed) results.set(p.step.id, { id: p.step.id, status: "already-done", message: "Already done on this Mac, so we skipped it.", evidence: [c.evidence] });
      }),
    );
    const useRecipe = new Set(plan.steps.filter((p) => p.recipe).map((p) => p.step.id));
    session = { source, parse, plan, useUpdated, useRecipe, results, recipesTried: new Map(), notes: new Map(), receipt: null, reviewing: false };
    sendPlan();
  } catch (error) {
    send("state", { phase: "error", message: friendlyError(error) });
  } finally {
    busy = false;
  }
}

// ---------- Running ----------

/**
 * Droid runs the approved commands that change something. If Droid isn't set up (no key, or the droid
 * program isn't installed) or can't start, CalHack runs the command itself, and the log says so.
 */
const execute: Executor = async (command, timeoutMs) => {
  const problem = droidProblem();
  if (!problem) {
    try {
      return await runWithDroid(command, timeoutMs);
    } catch (error) {
      const r = await runNormally(command, timeoutMs);
      return { ...r, ranBy: "calhack", log: [`Droid couldn't start (${(error as Error).message}), so CalHack ran it.`] };
    }
  }
  return { ...(await runNormally(command, timeoutMs)), ranBy: "calhack", log: [`Droid is off (${problem}), so CalHack ran it.`] };
};

async function runAll(): Promise<void> {
  if (!session || running) return;
  const s = session;
  running = true;
  stopRequested = false;
  s.receipt = null;
  s.recipesTried.clear();
  s.notes.clear();
  // "Try again" reruns what failed; everything that worked is kept.
  for (const [id, r] of s.results) if (["failed", "declined", "skipped"].includes(r.status)) s.results.delete(id);
  sendPlan();
  try {
    const hooks = {
      approve: (planned: PlannedStep, detail: string) =>
        new Promise<boolean>((resolve) => {
          // The person already OK'd the plan. Only flagged steps ask again.
          if (planned.flags.length === 0 && !planned.needsReview) return resolve(true);
          approvals.set(planned.step.id, resolve);
          send("approve-request", { id: planned.step.id, detail, needsReview: planned.needsReview });
        }),
      waitForUser: (planned: PlannedStep, note?: string) =>
        new Promise<"done" | "skip">((resolve) => {
          if (note) s.notes.set(planned.step.id, note);
          manualWaits.set(planned.step.id, resolve);
          send("manual-request", { id: planned.step.id });
          const link = safeSettingsUrl(planned.step.settingsUrl);
          if (link) void shell.openExternal(link);
          if (planned.step.clickTarget) setTimeout(() => void showMe(planned.step.id), link ? 1500 : 0);
        }),
      progress: (planned: PlannedStep, message: string) => send("step-progress", { id: planned.step.id, message }),
    };
    await runSequence(s.plan.steps, s.results, {
      runOne: (p) =>
        runPlannedStep(p, hooks, {
          useUpdatedCommand: s.useUpdated.has(p.step.id),
          useRecipe: s.useRecipe.has(p.step.id),
          recipesTried: s.recipesTried,
          execute,
        }),
      onResult: () => {
        hidePointer();
        sendPlan();
      },
      stopped: () => stopRequested,
    });
    if (!stopRequested) {
      s.reviewing = true;
      sendPlan();
      s.receipt = await makeReceipt(s);
    }
  } finally {
    running = false;
    s.reviewing = false;
    approvals.clear();
    manualWaits.clear();
    sendPlan();
    send("finished", {});
  }
}

/**
 * The receipt: the final goal check (from the plan, only if our rules say it's read-only, run in the
 * locked box), then a separate Claude call that must point at which check proves what.
 */
async function makeReceipt(s: Session): Promise<Receipt> {
  let final: Evidence | null = null;
  const finish = s.parse.finish;
  const a = finish ? assessCommand(finish.command) : null;
  if (finish && a?.level === "safe" && a.readOnly) {
    const r = await runSandboxed(finish.command).catch(() => null);
    if (r) final = { kind: "final", command: finish.command, code: r.code, output: r.output.trim().split("\n").slice(-6).join("\n") };
  }
  const evidence = collectEvidence(s.plan.steps, s.results, final);
  return reviewRun({ goal: s.parse.goal, goalMessage: finish?.message, steps: s.plan.steps, results: s.results, evidence });
}

/**
 * Opens what the AI says would show the target. Only safe things: installed apps,
 * System Settings pages, and https pages from the same site as the instructions.
 */
async function openSafely(open: NonNullable<ScreenLocation["open_first"]>, s: Session): Promise<string | null> {
  if (open.kind === "settings") {
    const link = safeSettingsUrl(open.target);
    if (!link) return null;
    await shell.openExternal(link);
    return "System Settings";
  }
  if (open.kind === "app") {
    if (!/^[\w .&+'-]{1,60}$/.test(open.target)) return null;
    const dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", join(homedir(), "Applications")];
    const path = dirs.map((d) => join(d, open.target + ".app")).find((p) => existsSync(p));
    if (!path) return null;
    if (await shell.openPath(path)) return null;
    return open.target;
  }
  try {
    const url = new URL(open.target);
    const pageHost = s.source.location ? new URL(s.source.location).hostname : null;
    const fromPage = s.source.text.includes(open.target);
    if (url.protocol !== "https:" || !(fromPage || (pageHost && url.hostname === pageHost))) return null;
    await shell.openExternal(url.toString());
    return url.hostname;
  } catch {
    return null;
  }
}

async function showMe(id: string): Promise<void> {
  if (!session) return;
  const s = session;
  const p = s.plan.steps.find((x) => x.step.id === id);
  if (!p?.step.clickTarget) return;
  hidePointer();
  // Look, and if it isn't there, open what would show it and look again (twice at most).
  for (let attempt = 0; attempt < 3; attempt++) {
    send("step-progress", { id, message: attempt ? "Looking again…" : "Looking at your screen…" });
    const shot = await captureScreen();
    if (!shot) {
      send("step-progress", { id, message: "I can't see your screen yet.", needsScreen: true });
      return;
    }
    try {
      const loc = await locateOnScreen({ screenshot: shot.data, mediaType: shot.mediaType, width: shot.width, height: shot.height, target: p.step.clickTarget, stepTitle: p.step.title });
      if (loc.found) {
        // The overlay covers the main display exactly, so screenshot pixels × toScreen = overlay position.
        pointAt(Math.round(loc.x * shot.toScreen), Math.round(loc.y * shot.toScreen), p.step.clickTarget);
        send("step-progress", { id, message: "👉 " + loc.hint });
        return;
      }
      const opened = loc.open_first && attempt < 2 ? await openSafely(loc.open_first, s) : null;
      if (!opened) {
        send("step-progress", { id, message: loc.hint + " Then press Show me again." });
        return;
      }
      send("step-progress", { id, message: `Opening ${opened}…` });
      await new Promise((r) => setTimeout(r, 1800));
    } catch (error) {
      send("step-progress", { id, message: friendlyError(error) });
      return;
    }
  }
  send("step-progress", { id, message: "I couldn't find it. Look for “" + p.step.clickTarget + "”." });
}

// ---------- Copy guard ----------

const SAFE_NOTE = `# CalHack stopped a dangerous command from being pasted. Press ${KEY_LABEL} for details.`;
let lastClip = "";
let lastClipAt = 0;
let blockedClip: string | null = null;
let guardOn = true;

function recentClipboard(): string | null {
  return lastClip && lastClip !== SAFE_NOTE && Date.now() - lastClipAt < 3 * 60_000 ? lastClip : null;
}

const SHELL_HINT = /(\||\$\(|`|\b(curl|wget|sudo|bash|zsh|sh|base64|osascript|powershell|iex|chmod|xattr|spctl|csrutil|rm|security|eval|python3?|perl|mshta)\b)/;

function watchClipboard(): void {
  let checking = false;
  void clipboard.readText().then((t) => (lastClip = t));
  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const text = await clipboard.readText();
      if (text === lastClip) return;
      lastClip = text;
      lastClipAt = Date.now();
      if (!guardOn || text === SAFE_NOTE || !text.trim() || text.length > 5000 || !SHELL_HINT.test(text)) return;
      const a = assessCommand(text);
      if (a.level !== "blocked") return;
      blockedClip = text;
      await clipboard.writeText(SAFE_NOTE);
      lastClip = SAFE_NOTE;
      showWarning({ reasons: a.findings.filter((f) => f.level === "blocked").map((f) => f.reason), command: text });
    } finally {
      checking = false;
    }
  }, 500);
}

// ---------- Messages from the windows ----------

ipcMain.on("run-all", () => void runAll());
ipcMain.on("stop", () => {
  stopRequested = true;
});
ipcMain.on("approve-response", (_e, { id, yes }: { id: string; yes: boolean }) => {
  approvals.get(id)?.(!!yes);
  approvals.delete(id);
});
ipcMain.on("manual-response", (_e, { id, answer }: { id: string; answer: "done" | "skip" }) => {
  manualWaits.get(id)?.(answer === "skip" ? "skip" : "done");
  manualWaits.delete(id);
  hidePointer();
});
ipcMain.on("show-me", (_e, { id }: { id: string }) => void showMe(id));
ipcMain.on("open-settings", (_e, { id }: { id: string }) => {
  const link = safeSettingsUrl(session?.plan.steps.find((p) => p.step.id === id)?.step.settingsUrl);
  if (link) void shell.openExternal(link);
});
ipcMain.on("toggle-updated", (_e, { id, value }: { id: string; value: boolean }) => {
  if (!session || running) return;
  if (value) session.useUpdated.add(id);
  else session.useUpdated.delete(id);
  sendPlan();
});
ipcMain.on("toggle-recipe", (_e, { id, value }: { id: string; value: boolean }) => {
  if (!session || running) return;
  if (value) session.useRecipe.add(id);
  else session.useRecipe.delete(id);
  sendPlan();
});
ipcMain.on("close-panel", () => {
  hidePointer();
  panel?.hide();
});
ipcMain.on("open-privacy", () => void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"));
ipcMain.on("warning-close", () => warning?.hide());
ipcMain.on("warning-restore", () => {
  if (blockedClip) {
    void clipboard.writeText(blockedClip);
    lastClip = blockedClip;
  }
  blockedClip = null;
  warning?.hide();
});

// ---------- Start ----------

function buildTrayMenu(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Do this for me  (${KEY_LABEL})`, click: () => void onHotkey() },
      { label: "Show panel", click: () => showPanel() },
      { type: "separator" },
      { label: "Warn me about dangerous copies", type: "checkbox", checked: guardOn, click: (item) => (guardOn = item.checked) },
      { type: "separator" },
      { label: "Quit CalHack", role: "quit" },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName("CalHack");
  app.whenReady().then(() => {
    app.dock?.hide();
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle("🛡️ CalHack");
    tray.setToolTip(`CalHack: press ${KEY_LABEL} on any how-to`);
    buildTrayMenu();
    if (globalShortcut.register(HOTKEY, () => void onHotkey())) {
      console.log(`CalHack shortcut: ${KEY_LABEL}`);
    } else {
      console.error(`Couldn't register ${KEY_LABEL}. Another app is using it. Set CALHACK_HOTKEY in .env to pick another.`);
    }
    watchClipboard();
    showPanel();
    send("state", { phase: "idle", hasKey: hasApiKey(), screenAllowed: screenAllowed() });
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => {
    // Stay in the menu bar.
  });
}

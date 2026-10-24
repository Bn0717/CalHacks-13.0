// CalHack desktop app: press ⌃⌥D on any how-to, see a checked plan, and run it step by step.
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, systemPreferences, Tray } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeEnvironment, probeEnvironment, type Environment } from "../core/probe.js";
import { planSteps, type Plan } from "../core/plan.js";
import { runPlannedStep } from "../core/runner.js";
import { assessCommand } from "../core/risk.js";
import type { InstructionSource, PlannedStep, StepResult, StepStatus } from "../core/types.js";
import { stricter } from "../core/types.js";
import { friendlyError, hasApiKey, loadEnv } from "../ai/client.js";
import { parseInstructions, type ParseResult } from "../ai/parse.js";
import { locateOnScreen } from "../ai/locate.js";
import { frontAppName } from "../mac/front.js";
import { describeSource, gatherInstructions } from "./gather.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
process.env.CALHACK_ROOT ??= ROOT;
loadEnv(ROOT);

const HOTKEY = "Control+Alt+D";
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
  if (overlay && !overlay.isDestroyed()) overlay.hide();
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

const FINAL: StepStatus[] = ["already-done", "done", "done-unverified", "failed", "blocked", "skipped", "declined", "not-for-this-computer"];

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
    level: p.level,
    reasons: p.reasons,
    outdated: p.assessment.outdated ?? null,
    wrongPlatform: p.assessment.wrongPlatform ?? null,
    needsReview: p.needsReview,
    checkCommand: p.checkUsable ? p.step.checkCommand : null,
    useUpdated: s.useUpdated.has(p.step.id),
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
    goal: s.parse.goal,
    sourceLabel: describeSource(s.source),
    location: s.source.location ?? null,
    fromCache: s.parse.fromCache,
    appliesToThisComputer: s.parse.appliesToThisComputer,
    pageWarnings: [...s.plan.pageWarnings.map((w) => ({ level: w.level, reason: w.reason })), ...s.parse.pageConcerns.map((c) => ({ level: "ask", reason: c }))],
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
      send("state", { phase: "error", message: "Couldn't read anything. Copy the instructions (⌘C) and press ⌃⌥D again, or allow Screen Recording." });
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
    // Page-wide worries from the AI can only make steps stricter.
    if (parse.pageConcerns.length || !parse.appliesToThisComputer) {
      for (const p of plan.steps) if (p.step.kind === "command" || p.step.kind === "download") p.level = stricter(p.level, "ask");
    }
    session = { source, parse, plan, useUpdated: new Set(), results: new Map() };
    sendPlan();
  } catch (error) {
    send("state", { phase: "error", message: friendlyError(error) });
  } finally {
    busy = false;
  }
}

// ---------- Running ----------

async function runAll(): Promise<void> {
  if (!session || running) return;
  const s = session;
  running = true;
  stopRequested = false;
  sendPlan();
  try {
    for (const p of s.plan.steps) {
      if (stopRequested) break;
      const done = s.results.get(p.step.id);
      if (done && FINAL.includes(done.status) && done.status !== "failed" && done.status !== "declined") continue;
      const result = await runPlannedStep(
        p,
        {
          approve: (planned, detail) =>
            new Promise((resolve) => {
              approvals.set(planned.step.id, resolve);
              send("approve-request", { id: planned.step.id, detail, needsReview: planned.needsReview });
            }),
          waitForUser: (planned) =>
            new Promise((resolve) => {
              manualWaits.set(planned.step.id, resolve);
              send("manual-request", { id: planned.step.id });
              const link = safeSettingsUrl(planned.step.settingsUrl);
              if (link) void shell.openExternal(link);
              if (planned.step.clickTarget) setTimeout(() => void showMe(planned.step.id), link ? 1500 : 0);
            }),
          progress: (planned, message) => send("step-progress", { id: planned.step.id, message }),
        },
        { useUpdatedCommand: s.useUpdated.has(p.step.id) },
      );
      s.results.set(p.step.id, result);
      hidePointer();
      sendPlan();
      // Stop at the first problem so nothing builds on a broken step.
      if (["failed", "blocked", "declined"].includes(result.status)) break;
    }
  } finally {
    running = false;
    approvals.clear();
    manualWaits.clear();
    sendPlan();
    send("finished", {});
  }
}

async function showMe(id: string): Promise<void> {
  if (!session) return;
  const p = session.plan.steps.find((x) => x.step.id === id);
  if (!p?.step.clickTarget) return;
  hidePointer();
  send("step-progress", { id, message: "Looking for it on your screen…" });
  const shot = await captureScreen();
  if (!shot) {
    send("step-progress", { id, message: "Can't see your screen. Allow Screen Recording to get an arrow." });
    return;
  }
  try {
    const loc = await locateOnScreen({ screenshot: shot.data, mediaType: shot.mediaType, width: shot.width, height: shot.height, target: p.step.clickTarget, stepTitle: p.step.title });
    // The overlay covers the main display exactly, so screenshot pixels × toScreen = overlay position.
    if (loc.found) pointAt(Math.round(loc.x * shot.toScreen), Math.round(loc.y * shot.toScreen), p.step.clickTarget);
    send("step-progress", { id, message: loc.hint });
  } catch (error) {
    send("step-progress", { id, message: friendlyError(error) });
  }
}

// ---------- Copy guard ----------

const SAFE_NOTE = "# CalHack stopped a dangerous command from being pasted. Press ⌃⌥D for details.";
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
      { label: `Do this for me  (⌃⌥D)`, click: () => void onHotkey() },
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
    tray.setToolTip("CalHack: press ⌃⌥D on any how-to");
    buildTrayMenu();
    if (!globalShortcut.register(HOTKEY, () => void onHotkey())) {
      console.error(`Couldn't register ${HOTKEY}. Another app may be using it.`);
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

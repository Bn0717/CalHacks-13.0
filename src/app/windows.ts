// The window the person sees: the helper bar (bottom-center). Shapes of the messages are in protocol.ts.
import { BrowserWindow, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BarState, PointerCommand, SayMessage } from "./protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const UI = (name: string) => join(here, "ui", name);
const PRELOAD = join(here, "preload.cjs");

/** The bar window's size. The card inside sits at the bottom and grows upward. */
const BAR_W = 620;
const BAR_H = 560;

let bar: BrowserWindow | null = null;
/** Where the bar's card is, in screen points (sent by the bar page). */
let barCard: { x: number; y: number; width: number; height: number } | null = null;
let lastBarState: BarState = { phase: "hidden" };
let pointer: BrowserWindow | null = null;

function makeWindow(opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    transparent: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    ...opts,
  });
  // Keep our windows out of screenshots, so Claude only sees the person's screen.
  // (CALHACK_SHOW_IN_SCREENSHOTS=1 turns this off, for recording demos and testing.)
  win.setContentProtection(process.env.CALHACK_SHOW_IN_SCREENSHOTS !== "1");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env.CALHACK_DEBUG) win.webContents.on("console-message", (e) => console.log(`[page ${e.level}] ${e.message}`));
  return win;
}

function whenLoaded(win: BrowserWindow, go: () => void): void {
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", go);
  else go();
}

// ---------- Helper bar ----------

export function ensureBar(): BrowserWindow {
  if (bar && !bar.isDestroyed()) return bar;
  const area = screen.getPrimaryDisplay().workArea;
  // acceptFirstMouse: the bar never takes focus (another app is in front), so without this the first click only
  // activates the window and Done, Skip and Close appear dead.
  bar = makeWindow({ acceptFirstMouse: true, width: BAR_W, height: BAR_H, x: Math.round(area.x + (area.width - BAR_W) / 2), y: area.y + area.height - BAR_H - 8 });
  bar.setAlwaysOnTop(true, "floating");
  bar.loadFile(UI("bar.html"));
  bar.on("closed", () => (bar = null));
  // The window is bigger than the card, so clicks on the empty area around the card pass through.
  bar.setIgnoreMouseEvents(true, { forward: true });
  const timer = setInterval(() => {
    if (!bar || bar.isDestroyed()) return clearInterval(timer);
    if (!bar.isVisible() || !barCard) return;
    const p = screen.getCursorScreenPoint();
    const inside = p.x >= barCard.x - 8 && p.x <= barCard.x + barCard.width + 8 && p.y >= barCard.y - 8 && p.y <= barCard.y + barCard.height + 8;
    bar.setIgnoreMouseEvents(!inside, { forward: true });
  }, 80);
  return bar;
}

/** Shows a new bar state. "hidden" hides the window. */
export function showBar(state: BarState): void {
  lastBarState = state;
  if (process.env.CALHACK_DEBUG) console.log(`[bar] ${state.phase}: ${JSON.stringify(state).slice(0, 300)}`);
  const w = ensureBar();
  whenLoaded(w, () => {
    w.webContents.send("bar", state);
    if (state.phase === "hidden") {
      w.hide();
      hidePointer();
    }
    else if (!w.isVisible()) w.showInactive();
  });
}

export function currentBar(): BarState {
  return lastBarState;
}

/** Lets the bar take typing (for the "What's going on?" box). */
export function focusBar(): void {
  const w = ensureBar();
  whenLoaded(w, () => {
    w.setIgnoreMouseEvents(false);
    w.show();
    w.focus();
  });
}

/** Says something out loud and shows it as a caption. Short and calm, never a command. */
export function say(text: string, mode: SayMessage["mode"] = "queue"): void {
  if (process.env.CALHACK_DEBUG) console.log(`[say] ${text}`);
  const w = ensureBar();
  whenLoaded(w, () => w.webContents.send("say", { text, mode } satisfies SayMessage));
}

/** The bar page reports where its card is, in window coordinates (so clicks outside it pass through). */
export function setBarRect(rect: { x: number; y: number; width: number; height: number }): void {
  if (!bar || bar.isDestroyed()) return;
  const b = bar.getBounds();
  barCard = { x: b.x + rect.x, y: b.y + rect.y, width: rect.width, height: rect.height };
  if (process.env.CALHACK_DEBUG) console.log(`[rect] window ${JSON.stringify(b)} card ${JSON.stringify(rect)}`);
}

// ---------- Pointer layer ----------
// A see-through layer over the main display. It never takes clicks or focus, so the person clicks the real button under the ring.

function ensurePointer(): BrowserWindow {
  if (pointer && !pointer.isDestroyed()) return pointer;
  const b = screen.getPrimaryDisplay().bounds;
  pointer = makeWindow({ x: b.x, y: b.y, width: b.width, height: b.height, focusable: false, enableLargerThanScreen: true });
  pointer.setAlwaysOnTop(true, "screen-saver");
  pointer.setIgnoreMouseEvents(true);
  pointer.loadFile(UI("pointer.html"));
  pointer.on("closed", () => (pointer = null));
  return pointer;
}

/** Puts a ring and a label on a screen point (main display, in points). */
export function pointAt(x: number, y: number, label: string): void {
  const b = screen.getPrimaryDisplay().bounds;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > b.width || y > b.height) return;
  const w = ensurePointer();
  whenLoaded(w, () => {
    w.webContents.send("pointer", { show: true, x, y, label: label.slice(0, 80) } satisfies PointerCommand);
    if (!w.isVisible()) w.showInactive();
  });
}

export function hidePointer(): void {
  if (!pointer || pointer.isDestroyed() || !pointer.isVisible()) return;
  pointer.webContents.send("pointer", { show: false } satisfies PointerCommand);
  pointer.hide();
}

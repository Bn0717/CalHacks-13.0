// The two windows the person sees: the helper bar (bottom-center) and the buddy layer (full screen,
// click-through, where the mascot hops around). Shapes of the messages are in protocol.ts.
import { BrowserWindow, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BarState, BuddyCommand, BuddyPose, SayMessage } from "./protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const UI = (name: string) => join(here, "ui", name);
const PRELOAD = join(here, "preload.cjs");

/** The bar window's size. The card inside sits at the bottom and grows upward. */
const BAR_W = 620;
const BAR_H = 560;

let bar: BrowserWindow | null = null;
let buddy: BrowserWindow | null = null;
/** Where the bar's card is, in screen points (sent by the bar page). */
let barCard: { x: number; y: number; width: number; height: number } | null = null;
let lastBarState: BarState = { phase: "hidden" };
let buddyVisible = false;
/** True while the buddy sits on the bar, so it follows the bar when the card grows or shrinks. */
let buddyAtHome = false;
let buddyHomePose: BuddyPose = "idle";

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
  bar = makeWindow({ width: BAR_W, height: BAR_H, x: Math.round(area.x + (area.width - BAR_W) / 2), y: area.y + area.height - BAR_H - 8 });
  bar.setAlwaysOnTop(true, "floating");
  bar.loadFile(UI("bar.html"));
  bar.on("closed", () => (bar = null));
  // The window is bigger than the card, so clicks on the empty area around the card pass through.
  bar.setIgnoreMouseEvents(true, { forward: true });
  const timer = setInterval(() => {
    if (!bar || bar.isDestroyed()) return clearInterval(timer);
    if (!bar.isVisible() || !barCard) return;
    const p = screen.getCursorScreenPoint();
    const inside = p.x >= barCard.x - 8 && p.x <= barCard.x + barCard.width + 8 && p.y >= barCard.y - 70 && p.y <= barCard.y + barCard.height + 8;
    bar.setIgnoreMouseEvents(!inside, { forward: true });
  }, 80);
  return bar;
}

/** Shows a new bar state. "hidden" hides the window (and the buddy). */
export function showBar(state: BarState): void {
  lastBarState = state;
  if (process.env.CALHACK_DEBUG) console.log(`[bar] ${state.phase}: ${JSON.stringify(state).slice(0, 300)}`);
  const w = ensureBar();
  whenLoaded(w, () => {
    w.webContents.send("bar", state);
    if (state.phase === "hidden") {
      w.hide();
      hideBuddy();
    } else if (!w.isVisible()) {
      w.showInactive();
    }
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

/** The bar page reports where its card is, in window coordinates. */
export function setBarRect(rect: { x: number; y: number; width: number; height: number }): void {
  if (!bar || bar.isDestroyed()) return;
  const b = bar.getBounds();
  const old = barCard;
  barCard = { x: b.x + rect.x, y: b.y + rect.y, width: rect.width, height: rect.height };
  if (process.env.CALHACK_DEBUG) console.log(`[rect] window ${JSON.stringify(b)} card ${JSON.stringify(rect)} seat ${JSON.stringify(barSeat())} home=${buddyAtHome}`);
  // Keep the buddy on its seat when the card changes height.
  if (buddyAtHome && buddyVisible && (!old || Math.abs(old.y - barCard.y) > 6 || Math.abs(old.x - barCard.x) > 6)) {
    const s = barSeat();
    toBuddy({ type: "hop", x: s.x, y: s.y, pose: buddyHomePose });
  }
}

/** The buddy's seat on top of the bar card (where its feet go), in screen points. */
export function barSeat(): { x: number; y: number } {
  const d = screen.getPrimaryDisplay().bounds;
  if (barCard) return { x: barCard.x + 54 - d.x, y: barCard.y + 6 - d.y };
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width / 2 - BAR_W / 2 + 70 - d.x, y: area.y + area.height - 200 - d.y };
}

/** The middle of the bar's "what's happening" line, where the buddy "types". */
export function barLine(): { x: number; y: number } {
  const d = screen.getPrimaryDisplay().bounds;
  if (barCard) return { x: barCard.x + barCard.width * 0.6 - d.x, y: barCard.y + barCard.height - 96 - d.y };
  const s = barSeat();
  return { x: s.x + 200, y: s.y + 80 };
}

// ---------- Buddy ----------

/**
 * The buddy layer covers the screen below the menu bar (macOS won't put a normal window over the menu bar).
 * Buddy positions are given from the display's top-left, so they're shifted by this offset.
 */
function layerOffset(): { x: number; y: number } {
  const d = screen.getPrimaryDisplay();
  return { x: 0, y: d.workArea.y - d.bounds.y };
}

function toLayer<T extends { x: number; y: number }>(p: T): T {
  const o = layerOffset();
  return { ...p, x: p.x - o.x, y: p.y - o.y };
}

function ensureBuddy(): BrowserWindow {
  if (buddy && !buddy.isDestroyed()) return buddy;
  const d = screen.getPrimaryDisplay();
  // Full width, from just under the menu bar to the bottom of the screen (over the Dock).
  const top = d.workArea.y;
  buddy = makeWindow({ x: d.bounds.x, y: top, width: d.bounds.width, height: d.bounds.y + d.bounds.height - top, focusable: false, movable: false });
  buddy.setAlwaysOnTop(true, "screen-saver");
  buddy.setIgnoreMouseEvents(true);
  buddy.loadFile(UI("buddy.html"));
  buddy.on("closed", () => {
    buddy = null;
    buddyVisible = false;
  });
  return buddy;
}

export function toBuddy(input: BuddyCommand): void {
  const w = ensureBuddy();
  // Shift positions from display coordinates to the layer's own.
  let cmd = input;
  if (cmd.type === "show" || cmd.type === "hop" || cmd.type === "point") cmd = toLayer(cmd);
  else if (cmd.type === "scan") cmd = { ...cmd, rect: toLayer(cmd.rect) };
  whenLoaded(w, () => {
    w.webContents.send("buddy", cmd);
    if (cmd.type === "hide") {
      buddyVisible = false;
      setTimeout(() => {
        if (!buddyVisible && w && !w.isDestroyed()) w.hide();
      }, 600);
    } else if (!buddyVisible) {
      buddyVisible = true;
      w.showInactive();
    }
  });
}

/** Pops the buddy onto the bar, or hops it back there. */
export function buddyHome(pose: BuddyPose = "idle"): void {
  buddyAtHome = true;
  buddyHomePose = pose;
  const s = barSeat();
  toBuddy(buddyVisible ? { type: "hop", x: s.x, y: s.y, pose } : { type: "show", x: s.x, y: s.y, pose });
}

export function buddyPose(pose: BuddyPose): void {
  if (buddyAtHome) buddyHomePose = pose;
  if (buddyVisible) toBuddy({ type: "pose", pose });
}

export function buddyTo(x: number, y: number, pose: BuddyPose, label?: string): void {
  buddyAtHome = false;
  toBuddy({ type: "hop", x, y, pose, label });
}

export function buddyPoint(x: number, y: number, label: string): void {
  buddyAtHome = false;
  toBuddy({ type: "point", x, y, label });
}

export function buddyScanScreen(): void {
  buddyAtHome = false;
  const b = screen.getPrimaryDisplay().workArea;
  const d = screen.getPrimaryDisplay().bounds;
  toBuddy({ type: "scan", rect: { x: b.x - d.x + 80, y: b.y - d.y + 120, width: b.width - 160, height: b.height - 360 } });
}

export function hideBuddy(): void {
  if (buddyVisible) toBuddy({ type: "hide" });
}

/** Rough spot of the front browser/app window's top area (for "going to the website" hops). */
export function screenTopCenter(): { x: number; y: number } {
  const a = screen.getPrimaryDisplay().workArea;
  const d = screen.getPrimaryDisplay().bounds;
  return { x: a.x - d.x + a.width / 2, y: a.y - d.y + 140 };
}

/** Near the Dock (for "installing" hops), bottom-center of the screen. */
export function dockSpot(): { x: number; y: number } {
  const a = screen.getPrimaryDisplay().workArea;
  const d = screen.getPrimaryDisplay().bounds;
  return { x: a.x - d.x + a.width / 2 + 260, y: a.y - d.y + a.height - 4 };
}

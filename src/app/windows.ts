// The windows the person sees: the helper bar (bottom-center at first; the person can drag it anywhere) and the buddy, a red
// mascot that sits on the bar and hops over to point at things. Shapes of the messages are in protocol.ts.
import { BrowserWindow, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClickHolds, keepCardOnScreen, shouldIgnoreMouse } from "./clickthrough.js";
import { poseForBar, seatOnCard } from "./buddy-pose.js";
import type { BarState, BuddyCommand, BuddyPose, PointerCommand, SayMessage } from "./protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const UI = (name: string) => join(here, "ui", name);
const PRELOAD = join(here, "preload.cjs");

/** The bar window's size. The card inside sits at the bottom and grows upward. */
const BAR_W = 620;
const BAR_H = 560;

let bar: BrowserWindow | null = null;
/** Where the bar's card is inside the window (sent by the bar page). Its place on screen follows the window when it's dragged. */
let barCardInWindow: { x: number; y: number; width: number; height: number } | null = null;
/** The card's place on screen right now. */
function barCardOnScreen(): { x: number; y: number; width: number; height: number } | null {
  if (!bar || bar.isDestroyed() || !barCardInWindow) return null;
  const b = bar.getBounds();
  return { ...barCardInWindow, x: b.x + barCardInWindow.x, y: b.y + barCardInWindow.y };
}
/** Set while the person drags the bar by its top. */
let drag: { timer: NodeJS.Timeout; safety: NodeJS.Timeout } | null = null;
const clickHolds = new ClickHolds();

/**
 * Call right before CalHack clicks something on the screen for the person. Until the returned function is called, the bar lets
 * every click pass through to the app underneath (the bar is hidden from CalHack's screenshots, so it may sit on top of
 * what Claude is aiming at). Without this, CalHack could click its own Stop or Skip button.
 */
export function holdClicksThrough(): () => void {
  const release = clickHolds.hold();
  if (bar && !bar.isDestroyed()) bar.setIgnoreMouseEvents(true, { forward: true });
  return release;
}

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
  // acceptFirstMouse: the bar never takes focus (another app is in front), so without this the first click only
  // activates the window and Done, Skip and Close appear dead.
  bar = makeWindow({ acceptFirstMouse: true, width: BAR_W, height: BAR_H, ...defaultBarPosition() });
  bar.setAlwaysOnTop(true, "floating");
  bar.loadFile(UI("bar.html"));
  bar.on("closed", () => (bar = null));
  // The window is bigger than the card, so clicks on the empty area around the card pass through.
  bar.setIgnoreMouseEvents(true, { forward: true });
  const timer = setInterval(() => {
    if (!bar || bar.isDestroyed()) return clearInterval(timer);
    if (!bar.isVisible()) return;
    if (drag) return; // mid-drag the bar keeps the mouse (set in startBarDrag)
    const card = barCardOnScreen();
    if (!card && clickHolds.count === 0) return;
    bar.setIgnoreMouseEvents(shouldIgnoreMouse(screen.getCursorScreenPoint(), card, clickHolds.count), { forward: true });
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
  buddyForBar(state);
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
  barCardInWindow = { ...rect };
  if (process.env.CALHACK_DEBUG) console.log(`[rect] window ${JSON.stringify(bar.getBounds())} card ${JSON.stringify(rect)}`);
  // The card grows upward: if it was dragged near the top, slide the window down so the whole card stays visible.
  if (!drag) placeBar(bar.getPosition()[0], bar.getPosition()[1]);
  reseatBuddySoon();
}

/** Bottom-center of the main screen, where the bar starts. */
function defaultBarPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(area.x + (area.width - BAR_W) / 2), y: area.y + area.height - BAR_H - 8 };
}

/** Moves the bar's window, keeping the card fully on the screen it's over. */
function placeBar(x: number, y: number): void {
  if (!bar || bar.isDestroyed()) return;
  const card = barCardInWindow;
  if (!card) return bar.setPosition(Math.round(x), Math.round(y));
  const area = screen.getDisplayNearestPoint({ x: Math.round(x + card.x + card.width / 2), y: Math.round(y + card.y + card.height / 2) }).workArea;
  const p = keepCardOnScreen({ x, y }, card, area);
  const [cx, cy] = bar.getPosition();
  if (p.x !== cx || p.y !== cy) bar.setPosition(p.x, p.y);
}

/** The person pressed on the bar's top: the bar follows the mouse until they let go. */
export function startBarDrag(): void {
  if (!bar || bar.isDestroyed()) return;
  stopBarDrag();
  const from = screen.getCursorScreenPoint();
  const [wx, wy] = bar.getPosition();
  bar.setIgnoreMouseEvents(false);
  const timer = setInterval(() => {
    const at = screen.getCursorScreenPoint();
    placeBar(wx + at.x - from.x, wy + at.y - from.y);
  }, 16);
  // If the "let go" message is ever lost, stop following the mouse anyway.
  const safety = setTimeout(stopBarDrag, 30_000);
  drag = { timer, safety };
}

export function stopBarDrag(): void {
  if (!drag) return;
  clearInterval(drag.timer);
  clearTimeout(drag.safety);
  drag = null;
  reseatBuddySoon();
}

/** Back to bottom-center (double-click on the bar's top). */
export function resetBarPosition(): void {
  stopBarDrag();
  const p = defaultBarPosition();
  bar?.setPosition(p.x, p.y);
  reseatBuddySoon();
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
  if (BUDDY_ON) {
    // The buddy hops over and points, with its own ring and label.
    buddy.pointing = true;
    toBuddy({ type: "point", x, y, label: label.slice(0, 80) });
    return;
  }
  const w = ensurePointer();
  whenLoaded(w, () => {
    w.webContents.send("pointer", { show: true, x, y, label: label.slice(0, 80) } satisfies PointerCommand);
    if (!w.isVisible()) w.showInactive();
  });
}

export function hidePointer(): void {
  if (buddy.pointing) {
    buddy.pointing = false;
    // Back to its seat on the bar (or away, if the bar is hidden).
    buddyForBar(lastBarState, true);
  }
  if (!pointer || pointer.isDestroyed() || !pointer.isVisible()) return;
  pointer.webContents.send("pointer", { show: false } satisfies PointerCommand);
  pointer.hide();
}

// ---------- Buddy layer ----------
// The red mascot (ui/buddy*.js). A see-through layer over the main display, like the pointer layer: it never takes clicks
// or focus, and it's kept out of screenshots. It sits on the bar's card and takes a pose for each moment (poseForBar);
// pointAt sends it over to point at the thing to click, and hidePointer brings it back.

const BUDDY_ON = process.env.CALHACK_BUDDY !== "0";

const buddy = {
  win: null as BrowserWindow | null,
  /** Shown (or on its way in). */
  visible: false,
  /** Off pointing at something, so bar changes don't pull it back to its seat. */
  pointing: false,
  /** Where it last sat, and in which pose, so repeated bar updates don't make it hop again. */
  seat: null as { x: number; y: number } | null,
  pose: null as BuddyPose | null,
  reseatTimer: null as NodeJS.Timeout | null,
  hideTimer: null as NodeJS.Timeout | null,
};

function ensureBuddy(): BrowserWindow {
  if (buddy.win && !buddy.win.isDestroyed()) return buddy.win;
  const b = screen.getPrimaryDisplay().bounds;
  const w = makeWindow({ x: b.x, y: b.y, width: b.width, height: b.height, focusable: false, enableLargerThanScreen: true });
  // Above the bar, so it can stand on the card. Clicks still reach the bar underneath.
  w.setAlwaysOnTop(true, "screen-saver");
  w.setIgnoreMouseEvents(true);
  w.loadFile(UI("buddy.html"));
  w.on("closed", () => {
    buddy.win = null;
    buddy.visible = false;
    buddy.seat = null;
  });
  buddy.win = w;
  return w;
}

function toBuddy(cmd: BuddyCommand): void {
  if (!BUDDY_ON) return;
  if (cmd.type === "hide" && !buddy.visible) return;
  const w = ensureBuddy();
  if (cmd.type === "hide") buddy.visible = false;
  else if (cmd.type !== "talking" && cmd.type !== "pose") buddy.visible = true;
  const wantVisible = buddy.visible;
  whenLoaded(w, () => {
    if (w.isDestroyed()) return;
    w.webContents.send("buddy", cmd);
    if (buddy.hideTimer) clearTimeout(buddy.hideTimer);
    buddy.hideTimer = null;
    if (!wantVisible) {
      // Let it pop out before the window goes.
      buddy.hideTimer = setTimeout(() => {
        if (!buddy.visible && !w.isDestroyed()) w.hide();
      }, 600);
    } else if (!w.isVisible()) w.showInactive();
  });
}

function buddySeat(): { x: number; y: number } | null {
  return seatOnCard(barCardOnScreen(), screen.getPrimaryDisplay().bounds);
}

/** Puts the buddy on its seat in the pose for this bar moment. force: hop even if nothing seems to have changed. */
function buddyForBar(state: BarState, force = false): void {
  if (!BUDDY_ON) return;
  const pose = poseForBar(state);
  if (pose === null) {
    buddy.pointing = false;
    buddy.seat = null;
    buddy.pose = null;
    toBuddy({ type: "hide" });
    return;
  }
  if (buddy.pointing) return;
  const seat = buddySeat();
  if (!seat) {
    // The card isn't measured yet (it reports itself right after it draws), or the bar is on another screen.
    buddy.pose = pose;
    if (barCardOnScreen()) {
      buddy.seat = null;
      toBuddy({ type: "hide" });
    }
    return;
  }
  const moved = !buddy.seat || Math.abs(buddy.seat.x - seat.x) > 2 || Math.abs(buddy.seat.y - seat.y) > 2;
  if (!force && buddy.visible && !moved && buddy.pose === pose) return;
  const wasVisible = buddy.visible;
  buddy.seat = seat;
  buddy.pose = pose;
  if (!wasVisible) toBuddy({ type: "show", ...seat, pose });
  else if (moved || force) toBuddy({ type: "hop", ...seat, pose });
  else toBuddy({ type: "pose", pose });
}

/** The card changed size or place: once it settles, hop the buddy back onto it. */
function reseatBuddySoon(): void {
  if (!BUDDY_ON) return;
  if (buddy.reseatTimer) clearTimeout(buddy.reseatTimer);
  buddy.reseatTimer = setTimeout(() => {
    buddy.reseatTimer = null;
    if (!drag) buddyForBar(lastBarState);
  }, 320);
}

/** The bar's voice started or stopped: the buddy's mouth moves while it talks. */
export function buddyTalking(on: boolean): void {
  if (buddy.visible) toBuddy({ type: "talking", on });
}

// The windows the person sees: the helper bar (bottom-center at first; the person can drag it anywhere) and Stride, the red
// buddy that sits on the bar and hops over to point at things. Shapes of the messages are in protocol.ts.
import { BrowserWindow, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClickHolds, keepCardOnScreen, shouldIgnoreMouse } from "./clickthrough.js";
import { poseForBar, seatOnCard } from "./buddy-pose.js";
import { chooseEmptySpot, type Bitmap } from "./empty-spot.js";
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
let drag: { timer: NodeJS.Timeout; safety: NodeJS.Timeout; from: { x: number; y: number } } | null = null;
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
  const phaseChanged = state.phase !== lastBarState.phase;
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
  // A new moment: once the card has its new size, glide it off the words it covers.
  if (phaseChanged && state.phase !== "hidden") setTimeout(() => void moveToEmptySpot(), 450);
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
  stopGlide();
  const from = screen.getCursorScreenPoint();
  const [wx, wy] = bar.getPosition();
  bar.setIgnoreMouseEvents(false);
  const timer = setInterval(() => {
    const at = screen.getCursorScreenPoint();
    placeBar(wx + at.x - from.x, wy + at.y - from.y);
  }, 16);
  // If the "let go" message is ever lost, stop following the mouse anyway.
  const safety = setTimeout(stopBarDrag, 30_000);
  drag = { timer, safety, from: { x: wx, y: wy } };
}

export function stopBarDrag(): void {
  if (!drag) return;
  clearInterval(drag.timer);
  clearTimeout(drag.safety);
  // The person put the bar somewhere themselves: it stays there (no more moving on its own) until double-clicked back.
  if (bar && !bar.isDestroyed()) {
    const [x, y] = bar.getPosition();
    if (Math.hypot(x - drag.from.x, y - drag.from.y) > 6) placedByPerson = true;
  }
  drag = null;
  reseatBuddySoon();
}

/** Back to bottom-center (double-click on the bar's top). */
export function resetBarPosition(): void {
  stopBarDrag();
  stopGlide();
  placedByPerson = false;
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
// Stride, the red buddy (ui/buddy*.js). A see-through layer over the main display, like the pointer layer: it never takes clicks
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

// ---------- Moving the bar off the words ----------
// When the bar opens or moves on to a new moment, CalHack glances at the screen (a small copy; the bar itself is kept out
// of screenshots, so it sees what's underneath) and glides the card to the emptiest place, so it doesn't cover what the
// person is reading. It moves only when the new place is clearly emptier, never while the person drags it, and never
// again once they've put it somewhere themselves (double-click the top to hand it back). CALHACK_AUTO_PLACE=0 turns it off.

/** A small copy of the main display, and image pixels per screen point. Set by main.ts, which has screen access. */
export type ScreenGlance = () => Promise<{ bitmap: Bitmap; toImage: number } | null>;
let glanceScreen: ScreenGlance | null = null;
let placedByPerson = false;
let placing = false;
let lastPlaced = 0;
let glide: NodeJS.Timeout | null = null;

export function setScreenGlance(fn: ScreenGlance): void {
  glanceScreen = fn;
}

function stopGlide(): void {
  if (glide) clearInterval(glide);
  glide = null;
}

/** Glides the bar's window to (x, y): eases out with a small overshoot, while the card leans the way it's pulled. */
function glideBar(x: number, y: number): void {
  if (!bar || bar.isDestroyed()) return;
  stopGlide();
  const w = bar;
  const [x0, y0] = w.getPosition();
  const dx = x - x0;
  const dy = y - y0;
  const ms = Math.round(Math.min(900, Math.max(450, 380 + Math.hypot(dx, dy) * 0.35)));
  w.webContents.send("bar-glide", { dx, dy, ms });
  const start = Date.now();
  // easeOutBack: quick start, slides a little past, settles back.
  const ease = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
  glide = setInterval(() => {
    if (w.isDestroyed() || drag) return stopGlide();
    const t = Math.min(1, (Date.now() - start) / ms);
    const k = ease(t);
    w.setPosition(Math.round(x0 + dx * k), Math.round(y0 + dy * k));
    if (t >= 1) {
      stopGlide();
      placeBar(x, y);
      reseatBuddySoon(); // Stride hops after the bar
    }
  }, 16);
}

async function moveToEmptySpot(): Promise<void> {
  if (!glanceScreen || placedByPerson || drag || glide || placing || clickHolds.count > 0) return;
  // With CalHack visible in screenshots it would see itself as "busy", so it stays put.
  if (process.env.CALHACK_AUTO_PLACE === "0" || process.env.CALHACK_SHOW_IN_SCREENSHOTS === "1") return;
  if (Date.now() - lastPlaced < 2000) return;
  const card = barCardOnScreen();
  if (!bar || bar.isDestroyed() || !bar.isVisible() || !card) return;
  const display = screen.getPrimaryDisplay();
  const b = display.bounds;
  const mid = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
  if (mid.x < b.x || mid.y < b.y || mid.x > b.x + b.width || mid.y > b.y + b.height) return; // only on the main screen
  placing = true;
  try {
    const g = await glanceScreen();
    if (!g || !bar || bar.isDestroyed() || drag || placedByPerson) return;
    const now = barCardOnScreen();
    if (!now) return;
    // The card grows upward as steps are added, so keep some room above it free too.
    const tall = Math.max(now.height, 240);
    const current = { x: now.x - b.x, y: now.y + now.height - tall - b.y };
    const a = display.workArea;
    const area = { x: a.x - b.x + 8, y: a.y - b.y + 8, width: a.width - 16, height: a.height - 16 };
    const choice = chooseEmptySpot(g.bitmap, g.toImage, area, { width: now.width, height: tall }, current);
    lastPlaced = Date.now();
    if (process.env.CALHACK_DEBUG) console.log(`[place] here ${choice.here.toFixed(3)} there ${choice.there.toFixed(3)} move=${choice.move}`);
    if (!choice.move) return;
    const [wx, wy] = bar.getPosition();
    glideBar(wx + choice.at.x - current.x, wy + choice.at.y - current.y);
  } finally {
    placing = false;
  }
}

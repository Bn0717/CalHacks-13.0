// Reading and acting on a Mac app's window by name (buttons, rows, fields), like Playwright does for web pages.
// Uses a small Accessibility helper (ui-elements.swift), built once with swiftc into ~/.cache/calhack.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export interface UiItem {
  /** Where the item sits in the window, e.g. "0.3.1". */
  path: string;
  /** e.g. AXButton, AXRow, AXStaticText, AXTextField, AXSecureTextField */
  role: string;
  /** The words the person sees on it. */
  name: string;
  /** Screen points on the main display, (0,0) at its top-left. */
  frame: { x: number; y: number; w: number; h: number };
  actions?: string[];
  /** A password box: only the person types there. */
  secure?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** On/off or slider value, for switches, checkboxes and sliders. */
  value?: number;
  /** Where a link goes (links in web pages and emails). */
  url?: string;
}

export interface UiWindow {
  app: string;
  window: string;
  /** A panel (sheet) is open in front of the page, so the items are only the panel's. */
  sheet?: boolean;
  items: UiItem[];
}

/** The only buttons that ever close a panel. The helper refuses any other name. */
export type CloseButton = "Done" | "OK" | "Cancel";

function swiftSource(): string | null {
  const root = process.env.CALHACK_ROOT ?? join(here, "..", "..");
  const candidates = [join(here, "ui-elements.swift"), join(root, "src", "mac", "ui-elements.swift")];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export const UI_HELPER = join(homedir(), ".cache", "calhack", "ui-elements");

/** Builds the helper if it's missing or older than its source. */
export async function uiHelper(): Promise<string> {
  const src = swiftSource();
  const stale = !existsSync(UI_HELPER) || (src !== null && statSync(src).mtimeMs > statSync(UI_HELPER).mtimeMs);
  if (stale) {
    if (!src) throw new Error("The screen helper's source is missing.");
    mkdirSync(dirname(UI_HELPER), { recursive: true });
    await run("/usr/bin/swiftc", ["-O", src, "-o", UI_HELPER], { timeout: 180_000 });
  }
  return UI_HELPER;
}

async function call(args: string[]): Promise<Record<string, unknown>> {
  const helper = await uiHelper();
  try {
    const { stdout } = await run(helper, args, { timeout: 10_000, maxBuffer: 4_000_000 });
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (e) {
    const err = e as { stdout?: string; message: string };
    try {
      return JSON.parse(err.stdout ?? "") as Record<string, unknown>;
    } catch {
      return { ok: false, error: err.message };
    }
  }
}

export function parseWindow(raw: Record<string, unknown>): UiWindow | { error: string } {
  if (!raw.ok) return { error: String(raw.error ?? "I couldn't read the window.") };
  const items = (Array.isArray(raw.items) ? raw.items : []).filter(
    (i): i is UiItem => !!i && typeof i === "object" && typeof (i as UiItem).path === "string" && typeof (i as UiItem).role === "string",
  );
  return { app: String(raw.app ?? ""), window: String(raw.window ?? ""), ...(raw.sheet === true ? { sheet: true } : {}), items: items.map((i) => ({ ...i, name: String(i.name ?? "") })) };
}

/** The front window of an app (or of the app in front), with every item you can act on. */
export async function listWindow(app?: string): Promise<UiWindow | { error: string }> {
  return parseWindow(await call(["list", ...(app ? [app] : [])]));
}

/** Press a button, select a row, or focus a field. Text and cells act through the row or button that holds them. */
export async function actOn(app: string, item: UiItem, how: "press" | "select" | "focus" | "increase" | "decrease" = "press"): Promise<{ ok: boolean; error?: string; did?: string; value?: number }> {
  const r = await call(["act", app, item.path, item.role, item.name, how]);
  return { ok: !!r.ok, error: r.error ? String(r.error) : undefined, did: r.did ? String(r.did) : undefined, value: typeof r.value === "number" ? r.value : undefined };
}

/** A Control Center switch with no setting anywhere else (Do Not Disturb): set it and read it back. 1 = on, 0 = off. */
export async function controlCenter(moduleId: string, switchId: string, want: "on" | "off" | "status"): Promise<{ ok: boolean; error?: string; before?: number; after?: number }> {
  const r = await call(["controlcenter", moduleId, switchId, want]);
  return { ok: !!r.ok, error: r.error ? String(r.error) : undefined, before: typeof r.before === "number" ? r.before : undefined, after: typeof r.after === "number" ? r.after : undefined };
}

/** Closes the panel in front of an app's window with one of its closing buttons, and checks it closed. No panel: nothing pressed. */
export async function closeSheet(app: string, button: CloseButton): Promise<{ ok: boolean; pressed: string | null; closed: boolean; error?: string }> {
  const r = await call(["closesheet", app, button]);
  return { ok: !!r.ok, pressed: typeof r.pressed === "string" ? r.pressed : null, closed: r.closed === true, error: r.error ? String(r.error) : undefined };
}

/** Types into a text field (never a password box: the helper refuses). */
export async function typeInto(app: string, item: UiItem, text: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call(["type", app, item.path, item.role, item.name, text]);
  return { ok: !!r.ok, error: r.error ? String(r.error) : undefined };
}

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
/** The same action as a shell command, for running sensitive ones through Droid's gate. */
export function actCommand(app: string, item: UiItem, how: string): string {
  return [UI_HELPER, "act", app, item.path, item.role, item.name, how].map(q).join(" ");
}

/** The links in an app's front window (a web page or an email), with where each one goes. */
export async function windowLinks(app: string): Promise<{ name: string; url: string }[]> {
  const w = await listWindow(app);
  if ("error" in w) return [];
  const seen = new Set<string>();
  const out: { name: string; url: string }[] = [];
  for (const i of w.items) {
    if (i.role !== "AXLink" || !i.url || !/^https?:/i.test(i.url) || seen.has(i.url)) continue;
    seen.add(i.url);
    out.push({ name: i.name, url: i.url });
  }
  return out;
}

/** The words in an app's front window (a web page or email they're signed in to), with each link's address. */
export async function windowText(app: string): Promise<{ window: string; text: string } | null> {
  const r = await call(["text", app]);
  return r.ok && typeof r.text === "string" ? { window: String(r.window ?? ""), text: unwrapRedirects(r.text) } : null;
}

/** Email links that go through a redirect (Gmail's google.com/url?q=…, Outlook's safelinks): the real address. */
export function unwrapRedirects(text: string): string {
  return text.replace(/<(https?:\/\/[^>\s]+)>/g, (whole, raw: string) => {
    try {
      const u = new URL(raw);
      const inner = (u.hostname.endsWith("google.com") && u.pathname === "/url" && u.searchParams.get("q")) || (u.hostname.endsWith("safelinks.protection.outlook.com") && u.searchParams.get("url"));
      return inner && /^https?:\/\//.test(inner) ? `<${inner}>` : whole;
    } catch {
      return whole;
    }
  });
}

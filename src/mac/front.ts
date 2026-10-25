// Finds out what the person is looking at: the front app, a browser's page address, or an open document.
import { execFile } from "node:child_process";

function exec(file: string, args: string[], timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (err, stdout) => resolve(err ? null : stdout.toString().trim()));
  });
}

/** Name of the app in front, e.g. "Safari". No permission needed. */
export async function frontAppName(): Promise<string | null> {
  const asn = await exec("/usr/bin/lsappinfo", ["front"]);
  if (!asn) return null;
  const info = await exec("/usr/bin/lsappinfo", ["info", "-only", "name", asn]);
  return info?.match(/="(.+)"/)?.[1] ?? null;
}

/** Browsers whose page address CalHack can read. */
export const BROWSERS = ["Safari", "Safari Technology Preview", "Google Chrome", "Arc", "Brave Browser", "Microsoft Edge", "Chromium", "Vivaldi", "Opera"];

const CHROMIUM_BROWSERS = new Set(["Google Chrome", "Chrome", "Arc", "Brave Browser", "Microsoft Edge", "Chromium", "Vivaldi", "Opera"]);

/**
 * The address of the page open in a browser. macOS asks the person once per browser
 * ("CalHack wants to control Safari"). Returns null for browsers without AppleScript, like Firefox.
 */
export async function browserUrl(app: string): Promise<string | null> {
  let script: string | null = null;
  if (app === "Safari" || app === "Safari Technology Preview") script = `tell application "${app}" to return URL of front document`;
  else if (CHROMIUM_BROWSERS.has(app)) script = `tell application "${app === "Chrome" ? "Google Chrome" : app}" to return URL of active tab of front window`;
  if (!script) return null;
  const url = await exec("/usr/bin/osascript", ["-e", script]);
  return url && /^(https?|file):\/\//.test(url) ? url : null;
}

/** Lists the page's visible links as [text, address] pairs. Runs in the person's own page; reads only, changes nothing. */
const LINKS_JS =
  "JSON.stringify([...document.querySelectorAll('a[href]')].filter(a => a.offsetParent !== null).map(a => [(a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120), a.href]).filter(x => x[0] && /^https?:/.test(x[1])).slice(0, 300))";

export interface PageLinks {
  links: { text: string; url: string }[];
  /** Why the links couldn't be read (e.g. the browser's "Allow JavaScript from Apple Events" is off). */
  problem?: string;
}

/**
 * The links on the page open in a browser (e.g. "Check in" in an email), with their addresses, so CalHack can open the
 * page itself instead of clicking. Chrome-family browsers and Safari need "Allow JavaScript from Apple Events" turned on
 * once (Chrome: View > Developer; Safari: Develop menu).
 */
export async function pageLinks(app: string): Promise<PageLinks> {
  const name = app === "Chrome" ? "Google Chrome" : app;
  const js = JSON.stringify(LINKS_JS);
  let script: string;
  if (app === "Safari" || app === "Safari Technology Preview") script = `tell application "${name}" to do JavaScript ${js} in front document`;
  else if (CHROMIUM_BROWSERS.has(app)) script = `tell application "${name}" to execute active tab of front window javascript ${js}`;
  else return { links: [], problem: `${app} can't share its links` };
  return new Promise((resolve) => {
    execFile("/usr/bin/osascript", ["-e", script], { timeout: 6000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = `${stderr || err.message}`;
        const off = /JavaScript.*(turned off|not allowed)|Allow JavaScript from Apple Events/i.test(msg);
        resolve({ links: [], problem: off ? `turn on "Allow JavaScript from Apple Events" in ${name} once (${app.startsWith("Safari") ? "Develop menu" : "View > Developer"})` : msg.trim().slice(0, 200) });
        return;
      }
      resolve({ links: parseLinks(stdout.toString()) });
    });
  });
}

export function parseLinks(raw: string): { text: string; url: string }[] {
  try {
    const list = JSON.parse(raw.trim()) as unknown;
    return Array.isArray(list) ? list.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string").map(([text, url]) => ({ text, url })) : [];
  } catch {
    return [];
  }
}

/**
 * The address of the link whose text is `label` ("Check in"): an exact match, else the only link containing it.
 * Gmail and other webmail wrap links in a redirect (google.com/url?q=…): the real address is taken out of it.
 */
export function linkFor(links: { text: string; url: string }[], label: string): string | null {
  const want = label.trim().toLowerCase();
  if (!want) return null;
  const exact = links.filter((l) => l.text.toLowerCase() === want);
  const within = links.filter((l) => l.text.toLowerCase().includes(want));
  const pick = exact.length ? exact : within;
  const urls = [...new Set(pick.map((l) => unwrap(l.url)))];
  return urls.length === 1 ? urls[0] : null;
}

function unwrap(url: string): string {
  try {
    const u = new URL(url);
    const inner = /(^|\.)google\.com$/.test(u.hostname) && u.pathname === "/url" ? u.searchParams.get("q") ?? u.searchParams.get("url") : null;
    return inner && /^https?:\/\//.test(inner) ? inner : url;
  } catch {
    return url;
  }
}

/**
 * The file open in the front window (Preview, TextEdit, Pages…), using the Accessibility "document" attribute.
 * Needs Accessibility permission; returns null without it.
 */
export async function frontDocumentPath(): Promise<string | null> {
  const script = `tell application "System Events" to tell (first process whose frontmost is true) to return value of attribute "AXDocument" of window 1`;
  const value = await exec("/usr/bin/osascript", ["-e", script]);
  if (!value || value === "missing value") return null;
  try {
    return value.startsWith("file://") ? decodeURIComponent(new URL(value).pathname) : value;
  } catch {
    return null;
  }
}

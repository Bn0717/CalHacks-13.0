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

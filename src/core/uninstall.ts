// Local app removal: exact bundle matching, graceful quit, macOS Trash, verification.
import { lstatSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const normalize = (s: string) => s.toLowerCase().replace(/\.app$/i, "").replace(/[^\p{L}\p{N}]/gu, "");
const aliases: Record<string, string> = { zoom: "zoomus", zoomworkplace: "zoomus", chrome: "googlechrome", vscode: "visualstudiocode" };

/** Recognize direct removal requests before any network/AI work. */
export function uninstallRequest(text: string): string | null {
  const match = /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:(?:i (?:want|need) to|help me(?: to)?)\s+)?(?:uninstall|remove|delete)\s+(.+?)(?:\s+(?:from my (?:mac|computer)|for me))?[.!?]*$/i.exec(text.trim());
  if (!match) return null;
  const name = match[1].replace(/^(?:the\s+)?app\s+/i, "").replace(/\s+app$/i, "").trim();
  if (!name || /[/\\]|\b(and|then|except|don't|not|files|folder|photos|documents)\b/i.test(name)) return null;
  return name;
}

export function findAppBundles(name: string, dirs = ["/Applications", join(homedir(), "Applications")]): string[] {
  const key = normalize(name);
  const want = aliases[key] ?? key;
  if (!want) return [];
  const found: string[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".app") || ![key, want].includes(normalize(entry))) continue;
      const path = join(dir, entry);
      const stat = lstatSync(path);
      if (stat.isDirectory() && !stat.isSymbolicLink()) found.push(path);
    }
  }
  return found;
}

export interface UninstallDeps {
  find(name: string): string[];
  exists(path: string): boolean;
  quit(path: string): Promise<void>;
  trash(path: string): Promise<void>;
}
export interface UninstallResult { ok: boolean; message: string; paths: string[] }
export async function uninstallApp(name: string, deps: UninstallDeps, progress: (message: string) => void = () => {}): Promise<UninstallResult> {
  progress(`Checking whether ${name} is installed…`);
  const paths = deps.find(name);
  if (!paths.length) return { ok: true, message: `I couldn't find ${name} in Applications. Nothing was moved.`, paths };
  if (paths.length > 1) return { ok: false, message: `I found more than one copy of ${name}. I haven't changed either copy.`, paths };
  const path = paths[0];
  const label = basename(path, ".app");
  try {
    progress(`Closing ${name}…`);
    await deps.quit(path);
    progress(`Moving ${name} to Trash…`);
    await deps.trash(path);
    if (deps.exists(path)) return { ok: false, message: `${label} is still in Applications. It wasn't removed.`, paths };
    return { ok: true, message: `${name} was moved to Trash.`, paths };
  } catch (error) {
    return { ok: false, message: `I couldn't remove ${name}: ${(error as Error).message}`, paths };
  }
}

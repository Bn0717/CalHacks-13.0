// Saves Claude's answers for known pages so the demo still works without internet.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CACHE_DIR = () => join(process.env.CALHACK_ROOT ?? process.cwd(), "demo", "cache");

export function cacheKey(location: string, text: string): string {
  return createHash("sha256").update(location + "\n" + text.trim()).digest("hex").slice(0, 24);
}

export function readCache<T>(key: string): T | null {
  const path = join(CACHE_DIR(), key + ".json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    mkdirSync(CACHE_DIR(), { recursive: true });
    writeFileSync(join(CACHE_DIR(), key + ".json"), JSON.stringify(value, null, 2));
  } catch {
    // Saving is only a convenience.
  }
}

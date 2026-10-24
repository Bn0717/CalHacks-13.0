// What CalHack may remove, and how hard it must ask first. Written in code, not left to the AI.
//
// 1. Reversible (quit an app, change a setting, move ONE app or a few files to the Trash): just do it, say how to undo.
// 2. Big but recoverable (a whole folder, many files, lots of space): show exactly what, ask twice, then the person
//    types the folder's name. Everything goes to the Trash, never deleted outright.
// 3. Can't be undone (delete permanently, empty the Trash, erase the disk, system files): CalHack never does it.
//    It explains why, offers the safe version, and teaches the person how to do it themselves if they still want to.
import { homedir } from "node:os";
import { join, normalize, relative, sep } from "node:path";

/** The only folders CalHack will move files out of. */
export const USER_FOLDERS = ["Desktop", "Documents", "Downloads", "Movies", "Music", "Pictures"] as const;
export type UserFolder = (typeof USER_FOLDERS)[number];

export function folderPath(folder: UserFolder, home = homedir()): string {
  return join(home, folder);
}

/** True when `path` is inside one of the user folders (not the folder itself, not a link trick like ../). */
export function insideUserFolder(path: string, home = homedir()): UserFolder | null {
  const p = normalize(path);
  for (const f of USER_FOLDERS) {
    const root = folderPath(f, home);
    const rel = relative(root, p);
    if (rel && !rel.startsWith("..") && !rel.startsWith(sep) && !rel.split(sep).includes("..")) return f;
  }
  return null;
}

export type RemovalTier = "simple" | "big";

/** How many confirmations a removal needs. */
export function removalTier(fileCount: number, totalBytes: number, wholeFolder: boolean): RemovalTier {
  if (wholeFolder) return "big";
  if (fileCount > 20) return "big";
  if (totalBytes > 2 * 1024 ** 3) return "big";
  return "simple";
}

/** Requests CalHack refuses to carry out, whatever the wording. The AI also gets told this, but code decides. */
const IRREVERSIBLE = [
  { re: /\b(empty|clear)\b.*\btrash\b|\btrash\b.*\b(empty|clear)\b/i, what: "Emptying the Trash" },
  { re: /\b(permanent(ly)?|forever|for good|irreversibl[ey]|can'?t be undone|shred|securely?\s+(erase|delete))\b/i, what: "Deleting files permanently" },
  { re: /\b(erase|wipe|format|reformat|factory reset|reset)\b.*\b(disk|drive|mac|computer|hard ?drive|ssd|everything)\b/i, what: "Erasing the Mac" },
  { re: /\bdelete\b.*\b(all|every|everything)\b.*\b(files?|data|photos|documents|stuff)\b|\bdelete everything\b/i, what: "Deleting all your files" },
  { re: /\b(system|library)\b.*\b(files?|folder)\b.*\b(delete|remove)\b|\b(delete|remove)\b.*\b(system|library)\b.*\b(files?|folder)\b/i, what: "Removing system files" },
];

/** If the request is one CalHack never does itself, what it is (for the explanation). */
export function irreversibleRequest(text: string): string | null {
  for (const r of IRREVERSIBLE) if (r.re.test(text)) return r.what;
  return null;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

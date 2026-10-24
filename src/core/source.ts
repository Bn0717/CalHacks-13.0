// Checks about the instructions themselves: is a command really in them, and does the page look like a scam?
import { comparable } from "./normalize.js";
import type { Finding } from "./types.js";

/**
 * True when the command appears word for word in the instructions.
 * This stops the AI (or a sneaky page) from adding commands the post never had.
 */
export function appearsInSource(command: string, sourceText: string): boolean {
  const cmd = comparable(command);
  if (!cmd) return false;
  const src = comparable(sourceText);
  if (src.includes(cmd)) return true;
  // A command split over several lines in the post still counts when every line is there in order.
  const lines = command.split(/\r?\n/).map(comparable).filter(Boolean);
  if (lines.length > 1) {
    let from = 0;
    for (const line of lines) {
      const at = src.indexOf(line, from);
      if (at === -1) return false;
      from = at + line.length;
    }
    return true;
  }
  return false;
}

const SCAM_SIGNS: { re: RegExp; reason: string }[] = [
  { re: /verify (that )?you('| a)?re (a )?human|i('| a)?m not a robot|human verification|verification step/i, reason: "The page asks you to \"prove you're human\" by running a command. Real CAPTCHAs never ask you to open Terminal." },
  { re: /(press|hit|type)\s+(⌘|cmd|command)\s*\+?\s*space.{0,80}terminal/i, reason: "The page walks you through opening Terminal by keyboard, a pattern used by fake-CAPTCHA scams." },
  { re: /(press|hit)\s+(win(dows)?(\s*key)?\s*\+\s*r)/i, reason: "The page tells you to press Windows+R and paste something, a pattern used by fake-CAPTCHA scams." },
  { re: /(paste|ctrl\s*\+\s*v|⌘\s*\+?\s*v|cmd\s*\+\s*v).{0,60}(and )?(press|hit) (enter|return)/i, reason: "The page tells you to paste something and press Enter without explaining what it does." },
  { re: /(fix|resolve) (the )?(error|issue|problem).{0,40}(copy|paste)/i, reason: "The page offers a \"fix\" that only works by pasting a command, a common scam setup." },
];

/** Signs that the page itself is a "paste this command" scam. */
export function scanForScamSigns(text: string): Finding[] {
  const found: Finding[] = [];
  for (const s of SCAM_SIGNS) {
    if (s.re.test(text)) found.push({ rule: "scam-page", level: "blocked", reason: s.reason });
  }
  return found;
}

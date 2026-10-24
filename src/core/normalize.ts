// Cleans up commands copied from web pages so the same command always looks the same.

const INVISIBLE = /[​-‍⁠﻿­]/g;

/** True when text hides invisible characters, a trick used to sneak extra code into a copy. */
export function hasInvisibleCharacters(text: string): boolean {
  return /[​-‍⁠﻿­‪-‮⁦-⁩]/.test(text);
}

/**
 * Turns "pretty" web text back into what a terminal expects:
 * curly quotes become straight quotes, long dashes become "--", odd spaces become normal ones,
 * a leading "$ " prompt is removed, and lines ending in "\" are joined.
 */
export function normalizeCommand(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[–—−]/g, "--")
    .replace(/[  -   　]/g, " ")
    .replace(/\\\r?\n\s*/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[$%]\s+/, ""))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Same as normalizeCommand, then all whitespace collapsed, for comparing text. */
export function comparable(text: string): string {
  return normalizeCommand(text).replace(/\s+/g, " ");
}

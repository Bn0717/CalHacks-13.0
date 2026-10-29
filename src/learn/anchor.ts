// Where a step's code goes in a file: "after line 3", "after </title>", "inside <body>".
// Used by "Show me" (Stride types the code there) and to point at the right line. Pure: no files, no editor.
import type { Anchor } from "./lesson.js";

export type Placement = {
  content: string; // the file with the code added
  line: number; // the first line of the added code, counted from 1
  found: boolean; // false when the anchor wasn't in the file, so the code went at the end
};

// How many lines come before the spot the code goes (0 = the very top), or null when the anchor isn't in the file.
export function anchorLine(content: string, anchor: Anchor | undefined): number | null {
  const lines = splitLines(content);
  if (!anchor) return lines.length;
  if (anchor.afterLine !== undefined) return Math.min(anchor.afterLine, lines.length);
  if (anchor.after !== undefined) {
    const at = content.indexOf(anchor.after);
    if (at < 0) return null;
    return lineIndexAt(content, at + anchor.after.length - 1) + 1;
  }
  if (anchor.inside !== undefined) {
    const spot = insideSpot(content, anchor.inside);
    return spot ? spot.before : null;
  }
  return null;
}

// Adds `code` at the anchor. A missing anchor puts it at the end of the file (found = false).
export function insertAtAnchor(content: string, anchor: Anchor | undefined, code: string): Placement {
  const add = code.endsWith("\n") ? code : `${code}\n`;
  // `inside` where the closing tag shares a line with other code ("<body></body>"): split the line.
  if (anchor?.inside !== undefined && anchor.afterLine === undefined && anchor.after === undefined) {
    const spot = insideSpot(content, anchor.inside);
    if (spot && !spot.ownLine) {
      const updated = `${content.slice(0, spot.index)}\n${add}${content.slice(spot.index)}`;
      return { content: updated, line: lineIndexAt(content, spot.index) + 2, found: true };
    }
  }
  const at = anchorLine(content, anchor);
  const lines = splitLines(content);
  const before = at ?? lines.length;
  const head = lines.slice(0, before);
  const tail = lines.slice(before);
  const updated = [...head, ...splitLines(add), ...tail].join("\n") + "\n";
  return { content: updated, line: before + 1, found: at !== null };
}

// True when the file already holds this code (spacing and blank lines don't matter).
export function hasCode(content: string, code: string): boolean {
  const want = squash(code);
  return want !== "" && squash(content).includes(want);
}

// The line to point at for a step: the anchor line itself (or line 1 at the top of a file).
export function pointLine(content: string, anchor: Anchor | undefined): number {
  const at = anchorLine(content, anchor);
  if (at === null) return Math.max(1, splitLines(content).length);
  return Math.max(1, at);
}

// ---------- Helpers ----------

// Lines of a file, without the empty "line" after a final newline.
function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lineIndexAt(content: string, index: number): number {
  let n = 0;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") n++;
  return n;
}

// The spot just before an element's end: "</body>" in HTML, or the "}" of a CSS rule like "h1 { … }".
// `before` = lines before that spot; `ownLine` = the closing mark starts its own line.
function insideSpot(content: string, inside: string): { index: number; before: number; ownLine: boolean } | null {
  const name = inside.trim().replace(/^<|>$/g, "").trim();
  let index = -1;
  if (/^[a-z][a-z0-9-]*$/i.test(name)) {
    const lower = content.toLowerCase();
    const open = lower.search(new RegExp(`<${name}(\\s|>|/)`, "i"));
    index = open >= 0 ? lower.indexOf(`</${name.toLowerCase()}`, open) : -1;
  }
  if (index < 0) {
    // A CSS rule: find "name {" and its closing "}".
    const rule = new RegExp(`(^|[\\s,}])${escapeRegExp(name)}\\s*\\{`, "m").exec(content);
    if (rule) {
      const close = content.indexOf("}", rule.index + rule[0].length);
      if (close >= 0) index = close;
    }
  }
  if (index < 0) return null;
  const lineStart = content.lastIndexOf("\n", index - 1) + 1;
  const ownLine = content.slice(lineStart, index).trim() === "";
  return { index, before: lineIndexAt(content, index), ownLine };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

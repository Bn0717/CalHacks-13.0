// The pretend student used by scripts/learn-simulate.ts for end-to-end runs without a person.
// It makes plausible beginner mistakes out of a step's own code, so it works on any lesson, including ones the AI just
// wrote. Pure: no files, no timers.
import type { Lesson, Step } from "./lesson.js";

// A typo a beginner might make, that leaves the code complete (not half-typed):
// HTML: the first tag name is misspelled everywhere it's used (<h1>…</h1> -> <h>…</h>).
// CSS: the first property name is misspelled (color -> colorr).
// JS: the first word is misspelled.
// Returns null when there's nothing to misspell.
export function wrongTry(step: Pick<Step, "expected" | "file">): string | null {
  const code = step.expected;
  const file = step.file ?? "";
  if (file.endsWith(".css")) {
    const m = /(^|[{;\s])([a-z-]+)\s*:/m.exec(code);
    if (!m) return null;
    const prop = m[2]!;
    const at = m.index + m[1]!.length;
    return `${code.slice(0, at)}${prop}${prop.at(-1)}${code.slice(at + prop.length)}`;
  }
  if (file.endsWith(".html")) {
    const m = /<([a-zA-Z][a-zA-Z0-9]*)[\s>/]/.exec(code);
    if (!m) return null;
    const tag = m[1]!;
    // A tag with nothing to close (<link>, <img>): misspell the link instead, the classic herf / scr.
    if (VOID.has(tag.toLowerCase())) {
      const attr = /\s(href|src)=/.exec(code);
      if (attr) return `${code.slice(0, attr.index)} ${attr[1] === "href" ? "herf" : "scr"}=${code.slice(attr.index + attr[0].length)}`;
    }
    const typo = tag.length > 1 ? tag.slice(0, -1) : `${tag}${tag}`;
    // Only whole tag names: <h1 and </h1, never <h1x.
    return code.replace(new RegExp(`(</?)${tag}(?=[\\s>/])`, "g"), `$1${typo}`);
  }
  const m = /[A-Za-z_]\w{2,}/.exec(code);
  if (!m) return null;
  return `${code.slice(0, m.index)}${m[0]}x${code.slice(m.index + m[0].length)}`;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// The code cut off in the middle of a tag, as if the student stopped typing mid-way. Null for non-HTML steps or code
// too short to cut.
export function halfTyped(step: Pick<Step, "expected" | "file">): string | null {
  if (!(step.file ?? "").endsWith(".html")) return null;
  const code = step.expected;
  const lastOpen = code.lastIndexOf("<", code.length - 2);
  if (lastOpen <= 0) return null;
  return code.slice(0, lastOpen + 2);
}

// Which learner steps get a wrong try first, and which a half-typed save: spread out, one mistake per step.
// Two wrong tries (the 2nd and the 2nd-from-last learner step) and one half-typed save (the 3rd), when the lesson has them.
export function mistakePlan(lesson: Pick<Lesson, "steps">): { wrong: string[]; half: string[] } {
  const learners = lesson.steps.filter((s) => s.who === "learner");
  const wrong: string[] = [];
  const half: string[] = [];
  for (const i of [1, learners.length - 2]) {
    const s = learners[i];
    if (s && !wrong.includes(s.id) && wrongTry(s) !== null && wrongTry(s) !== s.expected) wrong.push(s.id);
  }
  const h = learners.find((s, i) => i >= 2 && !wrong.includes(s.id) && halfTyped(s) !== null);
  if (h) half.push(h.id);
  return { wrong, half };
}

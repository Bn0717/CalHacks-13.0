// Plays a lesson's steps in order, the way a student who types every step exactly would: each step's code goes into its
// file at its anchor. This finds lessons a student can't finish even when every check passes on the finished project:
// a step that leaves a tag open until a later step (the student's right answer then looks half-typed forever), or
// anchors that don't put the code where the finished file has it. repairSteps fixes both in code, without asking the
// model again. Pure: no browser, no model.
import { insertAtAnchor } from "./anchor.js";
import { fileKind, readHtml } from "./check/parse.js";
import type { Anchor, ProjectFile, Step } from "./lesson.js";
import { normCode } from "./rules.js";

export type Rebuild = {
  after: Map<string, ProjectFile[]>; // step id -> every file as it is right after that step
  files: ProjectFile[]; // the files after the last step
  matches: boolean; // true when those equal the finished project (spacing ignored)
};

const types = (s: Step) => s.who === "learner" && !!s.file && s.expected.trim() !== "";

// Only steps the student types add code; Stride and "watch" steps add none.
export function rebuildSteps(steps: Step[], finished: ProjectFile[]): Rebuild {
  const state = new Map<string, string>();
  const after = new Map<string, ProjectFile[]>();
  const snapshot = () => [...state].map(([path, content]) => ({ path, content }));
  for (const s of steps) {
    if (types(s)) state.set(s.file!, insertAtAnchor(state.get(s.file!) ?? "", s.anchor, s.expected).content);
    after.set(s.id, snapshot());
  }
  const files = snapshot();
  const matches = finished.every((f) => normCode(state.get(f.path) ?? "") === normCode(f.content));
  return { after, files, matches };
}

// What stops a student from finishing, in words the model can act on. Empty = the steps build up cleanly.
export function rebuildProblems(steps: Step[], finished: ProjectFile[]): string[] {
  const problems: string[] = [];
  const r = rebuildSteps(steps, finished);
  for (const s of steps) {
    if (!types(s) || fileKind(s.file!) !== "html") continue;
    const page = r.after.get(s.id)?.find((f) => f.path === s.file);
    const problem = page ? readHtml(page.content, s.leavesOpen).problem : undefined;
    if (!problem) continue;
    const open = /<(\w[\w-]*)>/.exec(problem.message)?.[1];
    problems.push(
      open
        ? `Step ${s.id} leaves <${open}> open (its </${open}> only comes in a later step), so the student's right answer looks unfinished. ` +
            `Each step must close every tag it opens: type the empty <${open}></${open}> first, then add what goes inside in later steps.`
        : `Step ${s.id}: right after it, ${s.file} still looks half-typed (${problem.message}). Each step's code must be complete on its own.`,
    );
  }
  if (!r.matches) {
    for (const f of finished) {
      const built = r.files.find((x) => x.path === f.path)?.content ?? "";
      if (normCode(built) === normCode(f.content)) continue;
      problems.push(
        built.trim() === ""
          ? `${f.path}: no learner step types any of it. Every line of the finished files is typed in some step.`
          : `${f.path}: typing every step's code at its anchor, in order, doesn't give the finished file (an anchor puts code in the wrong place, ` +
              `or a step's code isn't copied exactly from the finished file).`,
      );
    }
  }
  return problems;
}

// ---------- Repair ----------

type Line = { pos: number; text: string }; // pos = the line's index in the finished file (blank lines in between: +0.5)

// Where each non-blank line of `code` sits in the finished file, avoiding lines another step already types.
// Tries every place the first line could be and keeps the tightest match. Null when some line isn't in the file.
function place(code: string, file: string[], taken: Set<number>): number[] | null {
  const want = code.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (want.length === 0) return null;
  let best: number[] | null = null;
  for (let start = 0; start < file.length; start++) {
    if (taken.has(start) || file[start]!.trim() !== want[0]) continue;
    const at = [start];
    for (let k = 1, j = start + 1; k < want.length; k++, j++) {
      while (j < file.length && (taken.has(j) || file[j]!.trim() !== want[k])) j++;
      if (j >= file.length) break;
      at.push(j);
    }
    if (at.length === want.length && (!best || at[at.length - 1]! - at[0]! < best[best.length - 1]! - best[0]!)) best = at;
  }
  return best;
}

// The step's code as lines with their places (blank lines inside the code go right after the line before them).
function lines(code: string, at: number[]): Line[] {
  const out: Line[] = [];
  let k = 0;
  let last = (at[0] ?? 0) - 0.5;
  for (const text of code.replace(/\n$/, "").split("\n")) {
    if (text.trim() === "") out.push({ pos: last + 0.001, text });
    else out.push({ pos: (last = at[k++]!), text });
  }
  return out;
}

const textOf = (state: Line[]) => (state.length ? `${state.map((l) => l.text).join("\n")}\n` : "");

// The finished line that closes the element opened on `openPos`, e.g. the "</main>" for "<main>".
function closingLine(file: string[], openPos: number, tag: string): number | null {
  let depth = 0;
  const open = new RegExp(`<${tag}(?=[\\s>/])`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  for (let j = openPos; j < file.length; j++) {
    depth += (file[j]!.match(open) ?? []).length - (file[j]!.match(close) ?? []).length;
    if (depth <= 0 && j > openPos) return j;
    if (depth <= 0 && j === openPos) return null; // opened and closed on the same line
  }
  return null;
}

// The simplest anchor that puts `code` right after line `index` of `before`: the model's own if it already does,
// then "after <the line before>" when that text appears just once, else the line number.
function anchorFor(before: string, prev: Line | undefined, index: number, code: string, want: string, model: Anchor | undefined): Anchor {
  const ok = (a: Anchor | undefined) => normCode(insertAtAnchor(before, a, code).content) === normCode(want) && insertAtAnchor(before, a, code).found;
  if (model && ok(model)) return model;
  const t = prev?.text.trim();
  if (t && before.indexOf(t) === before.lastIndexOf(t)) {
    const a = { after: t };
    if (ok(a)) return a;
  }
  return { afterLine: index };
}

// Fixes what rebuildProblems finds, where code can do it safely:
// - a closing tag typed in a later step ("</main>") moves into the step that opened it, so every step is complete;
//   when that would split a later step in two, the step instead notes the tag it leaves open on purpose (leavesOpen),
//   so the checker doesn't call the student's right answer half-typed;
// - every anchor is worked out from the file as the student has it at that point.
// A file whose steps can't all be found in the finished file keeps its anchors. `changes` says what was done.
export function repairSteps(steps: Step[], finished: ProjectFile[]): { steps: Step[]; changes: string[] } {
  const changes: string[] = [];
  let out = steps.map((s) => ({ ...s }));
  for (const f of finished) {
    const file = f.content.replace(/\n$/, "").split("\n");
    const mine = out.filter((s) => types(s) && s.file === f.path);
    if (mine.length === 0) continue;

    // 1. Which finished lines each step types.
    const taken = new Set<number>();
    const owned = new Map<string, number[]>();
    for (const s of mine) {
      const at = place(s.expected, file, taken);
      if (!at) break;
      at.forEach((p) => taken.add(p));
      owned.set(s.id, at);
    }
    if (owned.size !== mine.length) {
      changes.push(`${f.path}: some step's code isn't in the finished file, so its anchors were left as they are.`);
      continue;
    }

    // 2. Closing tags that come too late move into the step that opened the element (HTML only).
    const html = fileKind(f.path) === "html";
    const tried = html ? closeEarly(mine, owned, file) : { owned, moved: new Set<string>(), notes: [] };
    let laid = layout(mine, tried.owned, tried.moved, file);
    if (laid) changes.push(...tried.notes);
    else if (tried.moved.size > 0) laid = layout(mine, owned, new Set(), file); // keep the tag open instead (below)
    if (!laid) {
      changes.push(`${f.path}: a step's code is split around code typed earlier, so its anchors were left as they are.`);
      continue;
    }
    changes.push(...laid.notes);

    // 3. Tags still left open on purpose after a step (a later step closes them).
    if (html) {
      for (const s of mine) {
        const step = laid.steps.get(s.id);
        if (!step) continue;
        const page = laid.after.get(s.id)!;
        const open: string[] = [];
        for (let p = readHtml(page).problem; p; p = readHtml(page, open).problem) {
          const tag = /still needs its closing <\/(\w[\w-]*)>/.exec(p.message)?.[1];
          if (!tag || open.includes(tag)) break;
          open.push(tag);
        }
        if (open.length > 0) {
          laid.steps.set(s.id, { ...step, leavesOpen: open });
          changes.push(`Step ${s.id} leaves ${open.map((t) => `<${t}>`).join(", ")} open on purpose (a later step closes it).`);
        }
      }
    }
    out = out.flatMap((s) => (laid.steps.has(s.id) ? (laid.steps.get(s.id) ? [laid.steps.get(s.id)!] : []) : [s]));
  }
  return { steps: out, changes };
}

// Moves each late closing tag ("</main>" typed steps later) into the step that opened its element.
function closeEarly(mine: Step[], start: Map<string, number[]>, file: string[]): { owned: Map<string, number[]>; moved: Set<string>; notes: string[] } {
  const owned = new Map([...start].map(([k, v]) => [k, [...v]]));
  const moved = new Set<string>();
  const notes: string[] = [];
  const ownerOf = (p: number) => mine.findIndex((s) => owned.get(s.id)!.includes(p));
  for (let i = 0; i < mine.length; i++) {
    for (let guard = 0; guard < 10; guard++) {
      const sofar = mine.slice(0, i + 1).flatMap((s) => owned.get(s.id)!).sort((a, b) => a - b);
      const problem = readHtml(sofar.map((p) => file[p]).join("\n")).problem;
      const tag = problem && /still needs its closing <\/(\w[\w-]*)>/.exec(problem.message)?.[1];
      if (!problem || !tag || problem.line === undefined) break;
      const openPos = sofar[problem.line - 1];
      const closePos = openPos === undefined ? null : closingLine(file, openPos, tag);
      if (closePos === null || file[closePos]!.trim().toLowerCase() !== `</${tag}>` || ownerOf(closePos) <= i) break;
      const from = mine[ownerOf(closePos)]!;
      owned.set(from.id, owned.get(from.id)!.filter((p) => p !== closePos));
      owned.set(mine[i]!.id, [...owned.get(mine[i]!.id)!, closePos].sort((a, b) => a - b));
      moved.add(from.id).add(mine[i]!.id);
      notes.push(`Step ${mine[i]!.id} now closes its <${tag}> (the </${tag}> was in step ${from.id}).`);
    }
  }
  return { owned, moved, notes };
}

// Each step's code (from the finished file where closeEarly changed it) and its anchor in the file as the student has
// it then. Null when a step's lines are split up by code typed earlier, so it can't go in as one piece.
function layout(
  mine: Step[],
  owned: Map<string, number[]>,
  moved: Set<string>,
  file: string[],
): { steps: Map<string, Step | null>; after: Map<string, string>; notes: string[] } | null {
  let state: Line[] = [];
  const steps = new Map<string, Step | null>();
  const after = new Map<string, string>();
  const notes: string[] = [];
  for (const s of mine) {
    const at = owned.get(s.id)!;
    if (at.length === 0) {
      steps.set(s.id, null); // its only line moved to an earlier step
      notes.push(`Step ${s.id} had nothing left to type, so it was dropped.`);
      continue;
    }
    const code = moved.has(s.id) ? `${at.map((p) => file[p]).join("\n")}\n` : s.expected;
    const add = lines(code, at);
    const first = add[0]!.pos;
    const last = add[add.length - 1]!.pos;
    if (state.some((l) => l.pos > first && l.pos < last)) return null;
    const index = state.filter((l) => l.pos < first).length;
    const before = textOf(state);
    state = [...state.slice(0, index), ...add, ...state.slice(index)];
    const anchor = anchorFor(before, state[index - 1], index, code, textOf(state), s.anchor);
    if (JSON.stringify(anchor) !== JSON.stringify(s.anchor ?? null) && !moved.has(s.id)) {
      notes.push(`Step ${s.id}: anchor ${JSON.stringify(s.anchor ?? {})} → ${JSON.stringify(anchor)}.`);
    }
    steps.set(s.id, { ...s, expected: code, anchor });
    after.set(s.id, textOf(state));
  }
  return { steps, after, notes };
}

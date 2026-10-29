// Lesson rules the code enforces, so they never depend on the model following its prompt:
// - a learner step adds at most ~12 lines (the prompt asks for 3-10)
// - hint 3 never contains the step's whole answer
// - Stride and "watch" steps never add code the student should be learning
// Both lesson builders reject (and ask again for) steps that break them; the grader (grade.ts) uses the same tests.
import { linesIn, strideActionInput, type Step } from "./lesson.js";

export const MAX_STEP_LINES = 12;

// Code with spacing and case ignored, so "<h1>Hi</h1>" and "<h1> hi </h1>" compare equal.
export function normCode(code: string): string {
  return code.replace(/\s+/g, "").toLowerCase();
}

// True when the hint holds the whole expected code (tiny answers, under 8 characters, can't really be given away).
export function hintGivesAway(hint: string, expected: string): boolean {
  const want = normCode(expected);
  return want.length >= 8 && normCode(hint).includes(want);
}

// How much of the answer a hint gives: the share of the answer's code pieces (names and symbols) that the hint shows.
export function hintStrength(hint: string, expected: string): number {
  const pieces = (text: string) => text.toLowerCase().match(/[a-z][a-z0-9-]*|[<>{}:;="\/]/g) ?? [];
  const want = pieces(expected);
  if (want.length === 0) return 0;
  const left = new Map<string, number>();
  for (const p of want) left.set(p, (left.get(p) ?? 0) + 1);
  let shown = 0;
  for (const p of pieces(hint)) {
    const n = left.get(p) ?? 0;
    if (n > 0) {
      shown++;
      left.set(p, n - 1);
    }
  }
  return Math.round((shown / want.length) * 100) / 100;
}

// A hint 2 made from the answer when the model's own shows more than hint 3: which tags or CSS properties to use, by name.
export function nameHint(expected: string): string {
  const tags = [...new Set([...expected.matchAll(/<([a-z][a-z0-9]*)[\s>/]/gi)].map((m) => m[1]!.toLowerCase()))];
  const props = [...new Set([...expected.matchAll(/^\s*([a-z-]+)\s*:/gim)].map((m) => m[1]!.toLowerCase()))];
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]!);
  if (tags.length > 0) return `Here you need ${list(tags.map((t) => `<${t}>`))}.`;
  if (props.length > 0) return `Here you need ${props.length > 1 ? "the properties" : "the property"} ${list(props)}.`;
  return "Look at the spot the step points to, and think about which words go there.";
}

// The 3 hints, made to get stronger when the model's don't: a hint 3 holding the whole answer becomes the code's
// outline, then a hint 2 showing more than hint 3 becomes the names of what to use.
export function strongerHints(hints: string[], expected: string): string[] {
  const out = [...hints];
  if (out[2] !== undefined && hintGivesAway(out[2], expected)) out[2] = outlineHint(expected);
  if (out[1] !== undefined && out[2] !== undefined && hintStrength(out[1], expected) > hintStrength(out[2], expected)) out[1] = nameHint(expected);
  return out;
}

// A hint 3 made from the answer when the model's own gives the whole thing away: the code's outline, with the parts the
// student writes themselves (text between tags, attribute values, CSS values, quoted text) left as … to fill in.
export function outlineHint(expected: string): string {
  const outline = expected
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/="[^"]*"/g, '="…"')
        .replace(/>([^<>]*\S[^<>]*)</g, ">…<")
        .replace(/^(\s*[a-z-]+\s*:\s*)[^;{}]+;/i, "$1…;")
        .replace(/(["'`])(?:(?!\1).)+\1/g, "$1…$1"),
    )
    .join("\n");
  if (!hintGivesAway(outline, expected)) return outline;
  // Nothing to blank out (e.g. only tags): show the first half of the lines.
  const lines = expected.replace(/\n+$/, "").split("\n");
  return [...lines.slice(0, Math.max(1, Math.floor(lines.length / 2))), "…"].join("\n");
}

// Does this text look like HTML, CSS or JavaScript a beginner would be learning?
export function looksLikeCode(text: string): boolean {
  return (
    /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(text) || // an HTML tag
    /[^{}]*\{[^{}]*[a-z-]+\s*:\s*[^;{}]+;?[^{}]*\}/i.test(text) || // a CSS rule
    /\b(function\s*\w*\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|document\.|addEventListener|=>)/.test(text) // JavaScript
  );
}

// Why one step breaks the rules, in words the model can act on. Empty = fine.
export function stepRuleProblems(step: Step): string[] {
  const problems: string[] = [];
  if (step.who === "learner") {
    const lines = linesIn(step.expected);
    if (lines > MAX_STEP_LINES) problems.push(`Step ${step.id} adds ${lines} lines. Split it into steps of 3-10 lines each.`);
    if (hintGivesAway(step.hints[2], step.expected)) {
      problems.push(`Step ${step.id}: hint 3 contains the whole answer. Show only part of the code, with … for the rest.`);
    }
    return problems;
  }
  if (step.expected.trim() !== "" && looksLikeCode(step.expected)) {
    problems.push(`Step ${step.id} is a "${step.who}" step but adds code. Code the student should learn goes in a "learner" step.`);
  }
  if (step.who === "stride" && step.strideAction) {
    const values = Object.values(strideActionInput(step.strideAction)).filter((v): v is string => typeof v === "string");
    if (values.some(looksLikeCode)) problems.push(`Step ${step.id}: Stride's action writes code. Code the student should learn goes in a "learner" step.`);
  }
  return problems;
}

export function lessonRuleProblems(steps: Step[]): string[] {
  return steps.flatMap(stepRuleProblems);
}

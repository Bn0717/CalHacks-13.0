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

// True when the hint holds the whole expected code (tiny answers, under 8 characters, can't really be given away),
// or the same code with only the words changed: 80% or more of its tags, attributes, CSS rules and properties.
export function hintGivesAway(hint: string, expected: string): boolean {
  const want = normCode(expected);
  if (want.length >= 8 && normCode(hint).includes(want)) return true;
  return structureShare(hint, expected) >= STRUCTURE_LIMIT;
}

export const STRUCTURE_LIMIT = 0.8;

// The shape of some code, with the words left out: one item per HTML tag and attribute ("li", "link@href") and per CSS
// rule and property ("rule:h1", "color"). "<h1>Hi</h1>" and "<h1>Hello</h1>" have the same shape.
export function codeStructure(code: string): string[] {
  const out: string[] = [];
  const noComments = code.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of noComments.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = m[1]!.toLowerCase();
    out.push(tag);
    for (const a of m[2]!.matchAll(/([a-z_:][\w:.-]*)\s*(=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/gi)) out.push(`${tag}@${a[1]!.toLowerCase()}`);
  }
  const css = noComments.replace(/<[^>]*>/g, " ");
  for (const m of css.matchAll(/([^{}<>;]+)\{([^{}]*)\}?/g)) {
    const selector = m[1]!.trim().toLowerCase().replace(/\s+/g, " ");
    if (!selector || /[<>"]/.test(selector)) continue;
    out.push(`rule:${selector}`);
    for (const p of m[2]!.matchAll(/([a-z-]+)\s*:/gi)) out.push(p[1]!.toLowerCase());
  }
  return out;
}

// How much of the expected code's shape the hint has (0-1). Answers with fewer than 3 parts are too small to judge.
export function structureShare(hint: string, expected: string): number {
  const want = codeStructure(expected);
  if (want.length < 3) return 0;
  const have = new Map<string, number>();
  for (const t of codeStructure(hint)) have.set(t, (have.get(t) ?? 0) + 1);
  let matched = 0;
  for (const t of want) {
    const n = have.get(t) ?? 0;
    if (n > 0) {
      matched++;
      have.set(t, n - 1);
    }
  }
  return matched / want.length;
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
      problems.push(`Step ${step.id}: hint 3 contains the whole answer (or the same tags and properties with other words). Show only part of the code, with … for the rest.`);
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

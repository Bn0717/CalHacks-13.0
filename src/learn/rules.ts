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

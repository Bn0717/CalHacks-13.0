// Picks which of a step's 3 prepared hints fits best, and words the short message the student sees.
import type { Check } from "../lesson.js";
import type { ParseProblem } from "./parse.js";
import { attributeWords, capital, counted, describeSelector, propertyWords, withArticle, withThe } from "./words.js";

export type HintIndex = 0 | 1 | 2;

export type CheckOutcome = {
  check: Check;
  passed: boolean;
  reason?: string; // why it failed, in plain words
};

// The rule (hints go gentlest first: a nudge, then pointing at the spot, then part of the code):
// - 0, the nudge: the code doesn't parse, nothing passes yet, or the first failing check is about a missing file
//   or the file not parsing. The student still needs the basic idea.
// - 2, part of the code: only one check is still failing. They're nearly done; show them the last bit.
// - 1, point at the spot: anything in between (some progress, more than one thing left).
export function pickHint(outcomes: CheckOutcome[], parseIssue?: ParseProblem): HintIndex {
  const failed = outcomes.filter((o) => !o.passed);
  if (failed.length === 0) return 0;
  const first = failed[0]!.check;
  if (parseIssue || failed.length === outcomes.length || first.type === "parses" || first.type === "fileExists") return 0;
  return failed.length === 1 ? 2 : 1;
}

export function passMessage(): string {
  return "Nice, that works!";
}

// "Still typing?" when the code is half-written, otherwise the first thing that's missing.
export function failMessage(outcomes: CheckOutcome[], parseIssue: ParseProblem | undefined, consoleErrors: string[]): string {
  let message: string;
  if (parseIssue) {
    message = `Still typing? ${withLine(parseIssue)}`;
  } else {
    const first = outcomes.find((o) => !o.passed);
    const someDone = outcomes.some((o) => o.passed);
    message = `${someDone ? "Almost there. " : ""}${first?.reason ?? "Not quite yet."}`;
  }
  // The browser's own error text is full of code words, so the student only hears that there is one.
  if (consoleErrors.length > 0) message += " Your page also shows a problem when it opens, so check the code you just typed for a typo.";
  return message;
}

function withLine(p: ParseProblem): string {
  return p.line ? `${p.message.replace(/\.$/, "")} (line ${p.line}).` : p.message;
}

// Plain-English reasons, one per kind of failure. Checks are written in CSS selectors ("header h1"), but the student
// reads them in words ("a big heading (<h1>) inside the header (<header>)").
export const reasons = {
  missingFile: (file: string) => `There's no file called ${file} in your project folder yet.`,
  notFound: (selector: string) => `I can't see ${withArticle(describeSelector(selector))} yet.`,
  wrongCount: (selector: string, found: number, want: number) =>
    `I see ${counted(describeSelector(selector), found)}, but this step needs ${want}.`,
  wrongText: (selector: string, text: string) => `${capital(withThe(describeSelector(selector)))} should say "${text}".`,
  missingAttr: (selector: string, name: string, value?: string) =>
    value === undefined
      ? `${capital(withThe(describeSelector(selector)))} still needs ${attributeWords(name)}.`
      : `${capital(withThe(describeSelector(selector)))} needs ${name}="${value}".`,
  wrongStyle: (selector: string, property: string, anyValue = false) =>
    `${capital(withThe(describeSelector(selector)))} doesn't have ${anyValue ? "its own" : "the right"} ${propertyWords(property)} yet.`,
  unknown: () => "I couldn't check this part yet. Keep going, and I'll look again in a moment.",
};

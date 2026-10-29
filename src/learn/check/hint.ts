// Words the short message the student sees after a look at their code.
// (The step's 3 hints are always shown in order, gentlest first. The message says what's missing, so the student
// always sees the problem right above hint 1 and the two never point at different things without a reason.)
import type { Check } from "../lesson.js";
import type { ParseProblem } from "./parse.js";
import { attributeWords, capital, counted, describeSelector, propertyWords, tagWords, withArticle, withThe } from "./words.js";

export type CheckOutcome = {
  check: Check;
  passed: boolean;
  reason?: string; // why it failed, in plain words
};

export function passMessage(): string {
  return "Nice, that works!";
}

// The first thing that's wrong, in plain words: half-typed code, a real slip the parser found, or the first failing check.
export function firstReason(outcomes: CheckOutcome[], parseIssue: ParseProblem | undefined): string {
  if (parseIssue) return withLine(parseIssue);
  return outcomes.find((o) => !o.passed)?.reason ?? "Not quite yet.";
}

// "Still typing?" when the code is half-written, otherwise the first thing that's wrong. "Almost there" only when at
// least half the parts are right, so a mostly-wrong try is never praised.
export function failMessage(outcomes: CheckOutcome[], parseIssue: ParseProblem | undefined, consoleErrors: string[]): string {
  let message: string;
  if (parseIssue && !parseIssue.mistake) {
    message = `Still typing? ${withLine(parseIssue)}`;
  } else {
    const passed = outcomes.filter((o) => o.passed).length;
    const almost = !parseIssue && passed > 0 && passed * 2 >= outcomes.length;
    message = `${almost ? "Almost there. " : ""}${firstReason(outcomes, parseIssue)}`;
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
  // line: where a start tag was typed instead of the closing one ("<li>Drawing<li>"), so they know where to look.
  missingCloser: (tag: string, missing: number, line?: number) =>
    (missing === 1
      ? `${capital(tagWords(tag).replace(/^an? /, "one "))} is missing its closing </${tag}>`
      : `${capital(tagWords(tag, missing))} are missing their closing </${tag}>`) +
    (line ? ` (line ${line}).` : "."),
  unknown: () => "I couldn't check this part yet. Keep going, and I'll look again in a moment.",
};

// The step checker: is the student's code done for this step?
// Three levels, cheapest first, and a level only runs when the ones before it can't decide:
//   1. code checks with real parsers (instant)
//   2. the page rendered in a hidden browser (~0.5 s): computed CSS, console errors, unusual selectors
//   3. a fast model (Claude Haiku): 'ai' checks, or anything levels 1-2 couldn't answer
// The browser and the model are passed in, so tests use fakes.
import type { Check, ProjectFile, Step } from "../lesson.js";
import type { CheckRunner } from "../validate.js";
import { haikuJudge, type Judge } from "./ai.js";
import { failMessage, passMessage, pickHint, reasons, type CheckOutcome, type HintIndex } from "./hint.js";
import { fileKind, parseProblem, readHtml, type ParsedHtml, type ParseProblem } from "./parse.js";
import { playwrightRenderer, type Probe, type ProbeAnswer, type Renderer, type StyleAnswer } from "./render.js";
import { attributeOf, querySelectorAll, textOf, UnsupportedSelector } from "./selector.js";
import { JARGON } from "./words.js";

export { haikuJudge, type Judge, type JudgeRequest, type Verdict } from "./ai.js";
export { pickHint, type HintIndex } from "./hint.js";
export { playwrightRenderer, type Probe, type ProbeAnswer, type Renderer, type RenderRequest, type RenderResult } from "./render.js";

export type CheckDeps = { renderer?: Renderer; judge?: Judge };

export type CheckStatus = "pass" | "partial" | "fail";

export type StepCheckResult = {
  status: CheckStatus; // partial = mid-edit or some checks pass: the runner waits instead of hinting
  failed: Check[]; // checks not (yet) passing, in the step's order
  hintIndex: HintIndex; // which of the step's 3 hints fits best
  message: string; // short plain English for the student
  level: 1 | 2 | 3; // the highest level that had to run
  consoleErrors: string[]; // errors the page logged, if it was rendered
};

// The real dependencies: one hidden Chromium (call renderer.close() when done) and Claude Haiku.
export function defaultCheckDeps(): Required<CheckDeps> {
  return { renderer: playwrightRenderer(), judge: haikuJudge() };
}

// For the lesson builders' self-validation (src/learn/validate.ts): does this one check pass on these files?
export function checkRunner(deps: CheckDeps): CheckRunner {
  return async (check, step, files) => (await checkStep({ ...step, checks: [check] }, files, deps)).status === "pass";
}

// One check's state while the levels run. "undecided" goes up a level.
type State =
  | { kind: "done"; passed: boolean; reason?: string }
  | { kind: "render"; page: string; probe: Probe; judge: (a: ProbeAnswer) => Decision }
  | { kind: "ask"; question: string };
type Decision = { passed: boolean; reason?: string } | null; // null = still can't tell

export async function checkStep(step: Step, projectFiles: ProjectFile[], deps: CheckDeps = {}): Promise<StepCheckResult> {
  const files = new Files(projectFiles);
  let level: 1 | 2 | 3 = 1;
  let consoleErrors: string[] = [];

  // Level 1.
  const open = step.leavesOpen ?? [];
  const states: State[] = step.checks.map((check) => levelOne(check, fileFor(check, step), files, open));

  // Half-typed code in any file this step touches means the student is mid-edit.
  const touched = new Set([...(step.file ? [norm(step.file)] : []), ...step.checks.map((c) => norm(fileFor(c, step)))]);
  let parseIssue: ParseProblem | undefined;
  for (const path of touched) {
    const content = files.get(path);
    if (content !== undefined) parseIssue ??= parseProblem(path, content, open);
  }

  // Level 2: one render per page, with every probe that page needs.
  const toRender = states.flatMap((s, i) => (s.kind === "render" ? [{ s, i }] : []));
  if (toRender.length > 0) {
    level = 2;
    const pages = [...new Set(toRender.map(({ s }) => s.page))];
    for (const page of pages) {
      const group = toRender.filter(({ s }) => s.page === page);
      let answers: ProbeAnswer[] | null = null;
      if (deps.renderer) {
        try {
          const result = await deps.renderer.render({ page, files: projectFiles, probes: group.map(({ s }) => s.probe) });
          answers = result.answers;
          consoleErrors = [...consoleErrors, ...result.consoleErrors];
        } catch {
          answers = null; // the browser couldn't open: level 3 decides
        }
      }
      group.forEach(({ s, i }, k) => {
        const decision = answers ? s.judge(answers[k] ?? null) : null;
        states[i] = decision ? { kind: "done", ...decision } : { kind: "ask", question: describe(step.checks[i]!) };
      });
    }
  }

  // Level 3, skipped when the answer can't change the result: something already passed and something already failed
  // (or the code is half-typed), so the step is "partial" whatever the model says.
  const done = states.filter((s): s is Extract<State, { kind: "done" }> => s.kind === "done");
  const fixed = (parseIssue !== undefined || done.some((s) => !s.passed)) && (parseIssue !== undefined || done.some((s) => s.passed));
  const toAsk = states.flatMap((s, i) => (s.kind === "ask" ? [{ s, i }] : []));
  if (toAsk.length > 0 && !fixed && deps.judge) {
    level = 3;
    const code = codeFor(step, files);
    await Promise.all(
      toAsk.map(async ({ s, i }) => {
        const check = step.checks[i]!;
        try {
          const verdict = await deps.judge!({
            stepTitle: step.title,
            instruction: step.instruction,
            question: s.question,
            file: fileFor(check, step),
            code,
            reference: step.expected,
          });
          states[i] = { kind: "done", passed: verdict.answer === "yes", reason: verdict.reason };
        } catch {
          // Leave it undecided: it counts as not passing yet.
        }
      }),
    );
  }

  const outcomes: CheckOutcome[] = states.map((s, i) => {
    const check = step.checks[i]!;
    const passed = s.kind === "done" && s.passed;
    // The lesson's own plain wording wins, unless it slipped in code words.
    const own = !passed && check.say && !JARGON.test(check.say) ? check.say : undefined;
    return { check, passed, reason: own ?? (s.kind === "done" ? s.reason : reasons.unknown()) };
  });
  const passed = outcomes.filter((o) => o.passed).length;
  const failed = outcomes.filter((o) => !o.passed).map((o) => o.check);

  let status: CheckStatus;
  if (failed.length === 0 && !parseIssue) status = "pass";
  else if (parseIssue || passed > 0) status = "partial";
  else status = "fail";

  return {
    status,
    failed,
    hintIndex: status === "pass" ? 0 : pickHint(outcomes, parseIssue),
    message: status === "pass" ? passMessage() : failMessage(outcomes, parseIssue, consoleErrors),
    level,
    consoleErrors,
  };
}

// ---------- Level 1 ----------

function levelOne(check: Check, path: string, files: Files, leavesOpen: readonly string[] = []): State {
  if (check.type === "ai") return { kind: "ask", question: check.question };
  const content = files.get(path);
  if (content === undefined) return { kind: "done", passed: false, reason: reasons.missingFile(path) };

  switch (check.type) {
    case "fileExists":
      return { kind: "done", passed: true };
    case "parses": {
      const problem = parseProblem(path, content, leavesOpen);
      return { kind: "done", passed: !problem, reason: problem?.message };
    }
    case "cssProperty": {
      const page = pageFor(path, files);
      if (!page) return { kind: "ask", question: describe(check) };
      const probe: Probe = { kind: "style", selector: check.selector, property: check.property, expected: check.value };
      return { kind: "render", page, probe, judge: (a) => judgeStyle(check, a) };
    }
    default: {
      // selectorExists, textIncludes, attribute: answered on the parsed HTML when the selector is a simple one.
      if (fileKind(path) !== "html") return { kind: "ask", question: describe(check) };
      try {
        const els = querySelectorAll(files.html(path).doc, check.selector);
        return { kind: "done", ...decideOnElements(check, els.length, els.map(textOf), (name) => els.map((el) => attributeOf(el, name) ?? null)) };
      } catch (e) {
        if (!(e instanceof UnsupportedSelector)) throw e;
        return renderInstead(check, path);
      }
    }
  }
}

type ElementCheck = Extract<Check, { type: "selectorExists" | "textIncludes" | "attribute" }>;

// The same decision for parsed HTML (level 1) and the rendered page (level 2).
function decideOnElements(check: ElementCheck, count: number, texts: string[], attrs: (name: string) => (string | null)[]): { passed: boolean; reason?: string } {
  if (check.type === "selectorExists") {
    if (check.count === undefined) return count > 0 ? { passed: true } : { passed: false, reason: reasons.notFound(check.selector) };
    if (count === check.count) return { passed: true };
    return { passed: false, reason: count === 0 ? reasons.notFound(check.selector) : reasons.wrongCount(check.selector, count, check.count) };
  }
  if (count === 0) return { passed: false, reason: reasons.notFound(check.selector) };
  if (check.type === "textIncludes") {
    const want = squash(check.text);
    return texts.some((t) => squash(t).includes(want)) ? { passed: true } : { passed: false, reason: reasons.wrongText(check.selector, check.text) };
  }
  const values = attrs(check.name);
  const ok = values.some((v) => v !== null && (check.value === undefined || v.trim() === check.value));
  return ok ? { passed: true } : { passed: false, reason: reasons.missingAttr(check.selector, check.name, check.value) };
}

// A selector the quick matcher can't read: let the browser answer it.
function renderInstead(check: ElementCheck, page: string): State {
  const probe: Probe =
    check.type === "selectorExists"
      ? { kind: "count", selector: check.selector }
      : check.type === "textIncludes"
        ? { kind: "text", selector: check.selector }
        : { kind: "attr", selector: check.selector, name: check.name };
  return {
    kind: "render",
    page,
    probe,
    judge: (a) => {
      if (a === null) return null;
      if (check.type === "selectorExists" && typeof a === "number") return decideOnElements(check, a, [], () => []);
      if (!Array.isArray(a)) return null;
      const list = a as (string | null)[];
      return decideOnElements(check, list.length, list.map((t) => t ?? ""), () => list);
    },
  };
}

function judgeStyle(check: Extract<Check, { type: "cssProperty" }>, a: ProbeAnswer): Decision {
  if (a === null || typeof a !== "object" || Array.isArray(a)) return null;
  const { values, want } = a as StyleAnswer;
  if (values.length === 0) return { passed: false, reason: reasons.notFound(check.selector) };
  const ok =
    check.value === undefined
      ? values.some((v) => v.value !== v.base)
      : values.some((v) => same(v.value, check.value!) || (want !== undefined && want !== "" && same(v.value, want)));
  return ok ? { passed: true } : { passed: false, reason: reasons.wrongStyle(check.selector, check.property, check.value === undefined) };
}

// ---------- Helpers ----------

class Files {
  private byPath = new Map<string, string>();
  private parsed = new Map<string, ParsedHtml>();
  constructor(files: ProjectFile[]) {
    for (const f of files) this.byPath.set(norm(f.path), f.content);
  }
  get(path: string): string | undefined {
    return this.byPath.get(norm(path));
  }
  paths(): string[] {
    return [...this.byPath.keys()];
  }
  html(path: string): ParsedHtml {
    const key = norm(path);
    let p = this.parsed.get(key);
    if (!p) this.parsed.set(key, (p = readHtml(this.get(key) ?? "")));
    return p;
  }
}

function norm(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
}

// A check's file, defaulting to the step's file (and to index.html if the step has none).
function fileFor(check: Check, step: Step): string {
  return check.file ?? step.file ?? "index.html";
}

// The page to render for a check: the HTML file itself, or for a CSS/JS file, the page that loads it.
function pageFor(path: string, files: Files): string | undefined {
  if (fileKind(path) === "html") return norm(path);
  const html = files.paths().filter((p) => fileKind(p) === "html");
  const name = norm(path);
  const loader = html.find((p) => {
    const content = files.get(p) ?? "";
    return content.includes(name) || content.includes(name.split("/").pop()!);
  });
  return loader ?? html.find((p) => p === "index.html") ?? html[0];
}

// All the files the step checks, labelled, for the model.
function codeFor(step: Step, files: Files): string {
  const paths = new Set([...(step.file ? [norm(step.file)] : []), ...step.checks.map((c) => norm(fileFor(c, step)))]);
  return [...paths].map((p) => `--- ${p} ---\n${files.get(p) ?? "(this file doesn't exist yet)"}`).join("\n\n");
}

// A check as a yes/no question, for when only the model can answer it.
function describe(check: Check): string {
  switch (check.type) {
    case "parses":
      return "Is the code complete, with nothing half-typed?";
    case "fileExists":
      return `Does the file ${check.file} exist?`;
    case "selectorExists":
      return check.count === undefined
        ? `Is there an element matching the CSS selector "${check.selector}"?`
        : `Are there exactly ${check.count} elements matching the CSS selector "${check.selector}"?`;
    case "textIncludes":
      return `Does the element matching "${check.selector}" contain the text "${check.text}" (ignoring case)?`;
    case "attribute":
      return check.value === undefined
        ? `Does the element matching "${check.selector}" have a ${check.name} attribute?`
        : `Does the element matching "${check.selector}" have ${check.name}="${check.value}"?`;
    case "cssProperty":
      return check.value === undefined
        ? `Does the CSS give "${check.selector}" a ${check.property}?`
        : `Does the CSS make the ${check.property} of "${check.selector}" equal to ${check.value}?`;
    case "ai":
      return check.question;
  }
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function same(a: string, b: string): boolean {
  return squash(a).replace(/\s*,\s*/g, ", ") === squash(b).replace(/\s*,\s*/g, ", ");
}

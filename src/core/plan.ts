// Turns steps from the AI into a checked plan. Code makes every safety decision here.
import { assessCommand, assessDownload } from "./risk.js";
import { recipeFor } from "./recipes.js";
import { appearsInSource, scanForScamSigns } from "./source.js";
import type { Assessment, Finding, InstructionSource, PlannedStep, RiskLevel, Step } from "./types.js";
import { stricter } from "./types.js";
import type { PageJudgment } from "../droid/judge.js";

export interface Plan {
  steps: PlannedStep[];
  /** Page-level warnings, e.g. "this looks like a fake CAPTCHA scam". */
  pageWarnings: Finding[];
}

function hostOf(location?: string): string | undefined {
  if (!location) return undefined;
  try {
    return new URL(location).hostname;
  } catch {
    return undefined;
  }
}

/** Normal changes. The person's OK on the plan covers these, so they aren't flagged. */
const ROUTINE_RULES = new Set(["installs-software", "changes-something", "vendor-download"]);

/** A few words for each safety rule, for the plan list. Long reasons stay in the details. */
const SHORT: Record<string, string> = {
  "download-and-run": "Downloads and runs code from the internet",
  "official-installer": "Runs an installer script from the internet",
  "decode-and-run": "Runs hidden code",
  "pipe-to-shell": "Runs code you can't see",
  "run-generated-code": "Runs code you can't see",
  eval: "Runs code you can't see",
  "applescript-shell": "Runs hidden code",
  applescript: "Controls other apps",
  admin: "Needs your Mac password",
  delete: "Deletes files",
  wipe: "Could erase your files",
  "erase-disk": "Could erase your disk",
  "raw-disk-write": "Could erase your disk",
  autostart: "Starts by itself every time",
  "remove-quarantine": "Skips the Mac's app safety check",
  "disable-gatekeeper": "Turns off Mac security",
  "disable-sip": "Turns off Mac security",
  "disable-quarantine": "Turns off Mac security",
  "disable-defender": "Turns off antivirus",
  "password-access": "Goes after your passwords",
  "password-check": "Goes after your passwords",
  "secret-files": "Goes after your passwords and keys",
  "fake-password-box": "Fake password pop-up",
  "suspicious-host": "Uses a shady website",
  "unknown-host": "Uses a website we don't know",
  "insecure-download": "Download isn't secure",
  "long-encoded-text": "Has hidden text",
  "hex-escapes": "Has hidden text",
  "invisible-characters": "Has hidden characters",
  unreadable: "We couldn't read this command",
  "bad-url": "Bad web address",
  "scam-page": "This page looks like a scam",
};

const NOTHING_TO_RUN: Assessment = { level: "safe", findings: [], readOnly: true };

/**
 * The AI's worries can only make steps stricter. A worry about certain steps flags those steps;
 * a worry about the whole page (or a guide for another computer) flags every step that runs something.
 */
export function applyAiConcerns(plan: Plan, concerns: { text: string; steps: string[] }[], appliesToThisComputer: boolean): void {
  const whole = concerns.filter((c) => c.steps.length === 0 || c.steps.every((id) => !plan.steps.some((p) => p.step.id === id)));
  for (const p of plan.steps) {
    if (p.step.kind !== "command" && p.step.kind !== "download") continue;
    const mine = concerns.filter((c) => c.steps.includes(p.step.id)).map((c) => c.text);
    const flags = [...mine, ...(whole.length ? ["See the warning at the top"] : []), ...(!appliesToThisComputer ? ["May not be for this Mac"] : [])];
    if (!flags.length) continue;
    p.level = stricter(p.level, "ask");
    for (const f of flags) if (!p.flags.includes(f)) p.flags.push(f);
    for (const m of mine) if (!p.reasons.includes(m)) p.reasons.push(m);
  }
}

/** Droid's page verdict as page-level findings. "unsure" doesn't block the page; it makes every step ask first (see planSteps). */
export function judgmentFindings(j: PageJudgment): Finding[] {
  return j.page.verdict === "scam" ? [{ rule: "scam-page", level: "blocked", reason: j.page.reason || "Droid thinks this page is a scam." }] : [];
}

/**
 * `judgment` is Droid's reading of the page and steps. When there is one, it decides whether the page is a scam and can make
 * any step stricter. Without one (Droid off or unreachable) the old text patterns are the fallback, so a missing judge never
 * means a looser check. The command safety rules below always apply and are never loosened by Droid.
 */
export function planSteps(steps: Step[], source: InstructionSource, opts: { judgment?: PageJudgment | null } = {}): Plan {
  const pageHost = hostOf(source.location);
  const judgment = opts.judgment ?? null;
  const pageWarnings = judgment ? judgmentFindings(judgment) : scanForScamSigns(source.text);
  const verdictFor = new Map((judgment?.steps ?? []).map((s) => [s.id, s]));
  const fromScreenshot = source.kind === "screenshot" || !source.text.trim();

  const planned = steps.map((step): PlannedStep => {
    const reasons: string[] = [];
    const flags: string[] = [];
    let assessment: Assessment = NOTHING_TO_RUN;
    let inSource = true;

    if (step.kind === "command" && step.command) {
      assessment = assessCommand(step.command, { pageHost });
      inSource = fromScreenshot || appearsInSource(step.command, source.text);
    } else if (step.kind === "download" && step.url) {
      assessment = assessDownload(step.url, { pageHost });
      inSource = fromScreenshot || appearsInSource(step.url, source.text);
    }
    let level: RiskLevel = assessment.level;
    reasons.push(...assessment.findings.map((f) => f.reason));
    for (const f of assessment.findings) if (!ROUTINE_RULES.has(f.rule)) flags.push(SHORT[f.rule] ?? f.reason);

    const runsSomething = step.kind === "command" || step.kind === "download";

    // Only run what the instructions really say.
    if (runsSomething && !inSource) {
      level = "blocked";
      reasons.unshift("This isn't in the instructions word for word, so we won't run it. We only run what the post actually shows.");
      flags.unshift("Not in the instructions word for word");
    }

    // Text read from a picture can be misread, so a person must look at it first.
    const needsReview = runsSomething && fromScreenshot;
    if (needsReview) {
      level = stricter(level, "ask");
      reasons.push("We read this from a screenshot, so please check it matches the instructions exactly.");
      flags.push("Read from a picture, so check it");
    }

    // A scam page taints every command on it (and we won't do its click steps either, see below).
    if (runsSomething && pageWarnings.length > 0) {
      level = "blocked";
      reasons.unshift(...pageWarnings.map((w) => w.reason));
      flags.unshift(SHORT["scam-page"]);
    }

    // Droid's judgment of the page and of this step. It can only make a step stricter.
    if (judgment && runsSomething) {
      const v = verdictFor.get(step.id);
      if (v?.verdict === "block") {
        level = "blocked";
        reasons.unshift(v.reason || "Droid thinks this step is unsafe.");
        flags.unshift("Droid thinks this is unsafe");
      } else if (v?.verdict === "ask") {
        level = stricter(level, "ask");
        reasons.push(v.reason || "Droid wants you to look at this one first.");
        flags.push("Droid wants you to check this");
      }
      if (judgment.page.verdict === "unsure") {
        level = stricter(level, "ask");
        reasons.push(judgment.page.reason || "Droid couldn't tell whether this page is trustworthy.");
        flags.push("Droid isn't sure about this page");
      }
    }

    // The AI can make a step stricter, never safer.
    if (step.aiRisk) level = stricter(level, step.aiRisk);
    if (step.aiConcerns?.length && runsSomething) {
      level = stricter(level, "ask");
      reasons.push(...step.aiConcerns);
      flags.push(...step.aiConcerns);
    }
    if (step.aiRisk === "blocked" && runsSomething) flags.push("AI thinks this is unsafe");

    if (assessment.wrongPlatform) {
      reasons.unshift(assessment.wrongPlatform.reason);
      flags.unshift(assessment.wrongPlatform.platform === "windows" ? "This is for Windows, not Mac" : "This is for Linux, not Mac");
    }
    if (assessment.outdated) reasons.push(assessment.outdated.reason);

    // A check command is only used when it is itself read-only.
    const checkAssessment = step.checkCommand ? assessCommand(step.checkCommand) : null;
    const checkUsable = !!checkAssessment && checkAssessment.level === "safe" && checkAssessment.readOnly && !checkAssessment.wrongPlatform;

    return { step, assessment, level, reasons: [...new Set(reasons)], inSource, checkUsable, needsReview, flags: runsSomething ? [...new Set(flags)] : [], recipe: pageWarnings.length ? undefined : recipeFor(step) };
  });

  return { steps: planned, pageWarnings };
}

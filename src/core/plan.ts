// Turns steps from the AI into a checked plan. Code makes every safety decision here.
import { assessCommand, assessDownload } from "./risk.js";
import { appearsInSource, scanForScamSigns } from "./source.js";
import type { Assessment, Finding, InstructionSource, PlannedStep, RiskLevel, Step } from "./types.js";
import { stricter } from "./types.js";

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

const NOTHING_TO_RUN: Assessment = { level: "safe", findings: [], readOnly: true };

export function planSteps(steps: Step[], source: InstructionSource): Plan {
  const pageHost = hostOf(source.location);
  const pageWarnings = scanForScamSigns(source.text);
  const fromScreenshot = source.kind === "screenshot" || !source.text.trim();

  const planned = steps.map((step): PlannedStep => {
    const reasons: string[] = [];
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

    const runsSomething = step.kind === "command" || step.kind === "download";

    // Only run what the instructions really say.
    if (runsSomething && !inSource) {
      level = "blocked";
      reasons.unshift("This isn't in the instructions word for word, so we won't run it. We only run what the post actually shows.");
    }

    // Text read from a picture can be misread, so a person must look at it first.
    const needsReview = runsSomething && fromScreenshot;
    if (needsReview) {
      level = stricter(level, "ask");
      reasons.push("We read this from a screenshot, so please check it matches the instructions exactly.");
    }

    // A scam page taints every command on it.
    if (runsSomething && pageWarnings.length > 0) {
      level = "blocked";
      reasons.unshift(...pageWarnings.map((w) => w.reason));
    }

    // The AI can make a step stricter, never safer.
    if (step.aiRisk) level = stricter(level, step.aiRisk);
    if (step.aiConcerns?.length && runsSomething) {
      level = stricter(level, "ask");
      reasons.push(...step.aiConcerns);
    }

    if (assessment.wrongPlatform) reasons.unshift(assessment.wrongPlatform.reason);
    if (assessment.outdated) reasons.push(assessment.outdated.reason);

    // A check command is only used when it is itself read-only.
    const checkUsable = !!step.checkCommand && assessCommand(step.checkCommand).level === "safe";

    return { step, assessment, level, reasons: [...new Set(reasons)], inSource, checkUsable, needsReview };
  });

  return { steps: planned, pageWarnings };
}

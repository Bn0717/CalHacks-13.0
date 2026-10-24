// Shared shapes used by the safety checker, the runner, the AI parser and the app.

/** How risky a step is. Order matters: later levels are stricter. */
export type RiskLevel = "safe" | "ask" | "blocked";

export const RISK_ORDER: Record<RiskLevel, number> = { safe: 0, ask: 1, blocked: 2 };

/** The stricter of two risk levels. Used so the AI can raise risk but never lower it. */
export function stricter(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/** One reason a command got its rating, written for a non-technical person. */
export interface Finding {
  rule: string;
  level: RiskLevel;
  reason: string;
}

export interface Assessment {
  level: RiskLevel;
  findings: Finding[];
  /** True when every part of the command only reads information. */
  readOnly: boolean;
  /** Set when the command is old and has a newer replacement. */
  outdated?: { suggestion: string; reason: string };
  /** Set when the command is meant for a different operating system. */
  wrongPlatform?: { platform: "windows" | "linux"; reason: string };
}

export type StepKind = "command" | "download" | "manual" | "info";

/** A fixed action (built by our code, see recipes.ts) that does a manual step for the person. */
export interface Recipe {
  id: "add-printer" | "open-app";
  /** Short label, e.g. "Add your network printer". */
  label: string;
  /** For open-app: the app's name. */
  app?: string;
}

/** One step taken from a set of instructions. */
export interface Step {
  id: string;
  /** Short plain-English title, e.g. "Install wget". */
  title: string;
  /** What the step does and why, in plain English. */
  explanation: string;
  kind: StepKind;
  /** The exact command from the instructions (kind = "command"). */
  command?: string;
  /** The file address to download (kind = "download"). */
  url?: string;
  /**
   * A read-only command that succeeds (exit code 0) when the step's goal is
   * already true. Used before the step ("already done?") and after it ("did it work?").
   */
  checkCommand?: string;
  /** What the user must click, for manual steps, e.g. "Add Printer button". */
  clickTarget?: string;
  /** A System Settings deep link that opens the right page for a manual step. */
  settingsUrl?: string;
  /** Concerns the AI noticed. These can only make a step stricter. */
  aiConcerns?: string[];
  /** The AI's own risk opinion. It can raise the code's rating, never lower it. */
  aiRisk?: RiskLevel;
}

/** Where the instruction text came from. Screenshot text is never trusted to run on its own. */
export type SourceKind = "webpage" | "document" | "clipboard" | "screenshot" | "file";

export interface InstructionSource {
  kind: SourceKind;
  /** The exact text of the instructions (empty for screenshot-only). */
  text: string;
  /** The page or file address, if known. */
  location?: string;
  /** The app the instructions were in, e.g. "Safari". */
  app?: string;
}

/** The final, checked plan for one step, ready to show in the panel. */
export interface PlannedStep {
  step: Step;
  /** Rating of the step's own command (or download address). */
  assessment: Assessment;
  /** The final level after combining code rules, AI opinion and source checks. */
  level: RiskLevel;
  /** Plain-English reasons behind the final level. */
  reasons: string[];
  /** False when a command can't be found word for word in the instructions. */
  inSource: boolean;
  /** The check command is only used when it is itself read-only. */
  checkUsable: boolean;
  /** True when the user must look over the command before it can run. */
  needsReview: boolean;
  /**
   * Short safety flags, e.g. "Needs your Mac password". Empty means the step is a normal
   * change (like an install) that runs once the person OKs the plan. A flagged step asks again.
   */
  flags: string[];
  /** For manual steps: a fixed action that does it for the person. Falls back to pointing if it can't. */
  recipe?: Recipe;
}

export type StepStatus =
  | "already-done"
  | "done"
  | "done-unverified"
  | "failed"
  | "blocked"
  | "skipped"
  | "declined"
  | "waiting-for-user"
  | "not-for-this-computer";

export interface StepResult {
  id: string;
  status: StepStatus;
  /** One plain-English line about what happened. */
  message: string;
  /** The last part of the command's output, for troubleshooting. */
  output?: string;
}

// Shapes for fix guides: "my printer won't print" → read-only checks → one plain sentence → fixes → same checks again.
// Every command here is written by us. The AI only picks a guide and explains; code decides what runs.
import type { Evidence } from "../types.js";

/** What the checks found, e.g. { printers: ["HP_LaserJet"], paused: ["HP_LaserJet"], jobs: 3 }. */
export type FactValue = string | number | boolean | string[];
export type Facts = Record<string, FactValue>;

export type CheckStatus = "ok" | "problem" | "unknown";

export interface CheckOutcome {
  status: CheckStatus;
  /** Plain words for the person, e.g. "3 print jobs are stuck". */
  detail: string;
  facts?: Facts;
}

export interface CheckDef {
  id: string;
  /** Plain words, e.g. "Printer is set up". */
  label: string;
  /**
   * A read-only command. It can be a function of the facts found by the checks before it
   * (checks run in order), e.g. Wi-Fi checks need the device name ("en0") from the first check.
   * Returning null means "can't check this" (e.g. no Wi-Fi found), and the check is "unknown".
   */
  command: string | ((facts: Facts) => string | null);
  /** What to show when the command is null, e.g. "Wi-Fi is off". */
  skipped?: string;
  /** True = needs the internet, so it can't run in the no-network sandbox. It still must be read-only. */
  needsNetwork?: boolean;
  /** Reads the command's output. `facts` are what earlier checks found. */
  interpret(r: { code: number; output: string }, facts: Facts): CheckOutcome;
}

export interface FixDef {
  id: string;
  /** Plain step text, e.g. "Clear the 3 stuck print jobs". Can use the facts. */
  label: string | ((facts: Facts) => string);
  /** True only when a check found the problem this fixes. */
  applies(facts: Facts): boolean;
  /** Built by our code from the facts. Throws if a value from the facts isn't safe to use. Unused for recipe/manual fixes. */
  command?(facts: Facts): string;
  /** Needs the Mac password (macOS shows its own password box). The command starts with sudo. */
  admin?: boolean;
  /** Instead of a command, use a fixed action from recipes.ts. */
  recipe?: "add-printer";
  /** When macOS doesn't allow a fix by command: CalHack points at the right switch. */
  manual?: { clickTarget: string; settingsUrl: string; explain: string };
  /** How long to wait after this fix before checking again (e.g. Wi-Fi takes a few seconds to reconnect). */
  waitAfterMs?: number;
}

export type GuideId = "printer" | "sound" | "wifi";

export interface StatusRow {
  label: string;
  value: string;
}

export interface FixGuide {
  id: GuideId;
  /** "Printer won't print" */
  title: string;
  /** "Get your printer printing again" */
  goal: string;
  /** One line for the AI picker: what problems this covers. */
  describe: string;
  /** Things people say, e.g. "my printer won't print". */
  examples: string[];
  checks: CheckDef[];
  /** In the order they should run. */
  fixes: FixDef[];
  /** One plain sentence about what's wrong, or null when nothing is wrong. */
  problemSentence(facts: Facts): string | null;
  /** Rows for the before/after receipt. */
  status(facts: Facts): StatusRow[];
}

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What ran, or null when the check couldn't run. */
  command: string | null;
  evidence?: Evidence;
}

export interface Diagnosis {
  guideId: GuideId;
  results: CheckResult[];
  facts: Facts;
  /** One plain sentence, or null when nothing is wrong. */
  problem: string | null;
  /** Fixes that apply, in order. */
  fixes: FixDef[];
  /** Every command that ran, kind "before" (or "after" when re-checking). */
  evidence: Evidence[];
  status: StatusRow[];
}

/** Runs one check command. needsNetwork = it may use the internet (so it can't be sandboxed). */
export type CheckRunner = (command: string, needsNetwork: boolean) => Promise<{ code: number; output: string; timedOut?: boolean }>;

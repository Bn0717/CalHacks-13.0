// The contract between the app (main.ts) and its window: the helper bar.
// The windows are plain JS (no build step), so they follow these shapes by hand.
// Every message goes through preload.cjs: window.calhack.send(channel, data) / window.calhack.on(channel, cb).
// All text shown to the person is plain, friendly English. Pages insert it as text, never as HTML.

// ---------------- App → helper bar: channel "bar" ----------------

/** What the bar shows. The app sends the whole state each time something changes. */
export type BarState =
  | { phase: "hidden" }
  /** Just pressed the hotkey: "Let me take a look…" */
  | { phase: "looking"; message: string }
  /** Nothing useful on screen, or the person tapped the mic/typing box: Siri-style question. */
  /** note: a short explanation shown under the question (the question itself stays short, and is what's spoken). */
  | { phase: "ask"; question: string; note?: string; suggestions: string[]; listening: boolean; transcribing: boolean; heard?: string }
  /** Running read-only checks for a problem, one by one. */
  | { phase: "checking"; title: string; checks: CheckLine[] }
  /** Ready to act: the goal, what's wrong (for fixes), the plan in plain words, and OK. */
  | {
      phase: "plan";
      goal: string;
      /** For fixes: one plain sentence, e.g. "Your printer is paused and has 3 stuck jobs." */
      problem?: string;
      steps: StepLine[];
      /** Anything done differently from the page, or unsafe steps that will be skipped. */
      notes: Note[];
      okLabel: string; // e.g. "OK, fix it" / "OK, do it" / "Yes, install"
      cancelLabel: string; // e.g. "Not now"
      source?: string; // e.g. "From support.apple.com" or "From the page you're reading"
    }
  /** Working through the steps. */
  /** openEnded: the agent doesn't know the number of steps ahead, so it shows "Step 3", not "Step 3 of 3". */
  | { phase: "working"; goal: string; current: number; total: number; line: string; steps: StepLine[]; detail: DetailLine[]; openEnded?: boolean }
  /** A question that needs a clear yes or no. Big removals add typeToConfirm (the person types the folder's name). */
  | { phase: "confirm"; title: string; message: string; details?: string[]; yes: string; no: string; typeToConfirm?: string; tone?: "normal" | "danger" }
  /** A teaching screen: how to do something yourself (CalHack won't do it, e.g. it can't be undone). */
  | { phase: "explain"; title: string; paragraphs: string[]; steps?: string[] }
  /** A step needs the person: an OK for a flagged step, or a click they must do themselves. */
  | { phase: "needs-you"; goal: string; stepId: string; kind: "approve" | "manual"; question: string; why: string[]; command?: string }
  /** Finished: the receipt. */
  | { phase: "done"; receipt: ReceiptView; steps: StepLine[]; detail: DetailLine[]; canRetry: boolean; canSendSummary: boolean }
  | { phase: "error"; message: string };

export interface CheckLine {
  label: string; // "Printer is connected"
  status: "pending" | "running" | "ok" | "problem" | "unknown";
  detail?: string; // "3 print jobs are stuck"
}

export interface StepLine {
  id: string;
  /** Plain words, e.g. "Download Zoom from zoom.us, Zoom's own website". Never a raw command. */
  text: string;
  status: "todo" | "running" | "done" | "unverified" | "skipped" | "blocked" | "failed" | "waiting";
  /** Short reason when skipped/blocked/failed. */
  note?: string;
}

export interface Note {
  tone: "info" | "warn" | "blocked";
  text: string;
}

/** "Show what's happening": the real commands and Droid's log, for judges. Hidden by default. */
export interface DetailLine {
  stepId?: string;
  text: string; // e.g. "✅ Allowed: brew install --cask zoom" or "Run by Droid (Factory)"
  mono?: boolean; // show in a code font
}

export interface ReceiptView {
  /** answered = a question was answered; cant-do = CalHack won't do it (e.g. it can't be undone). */
  verdict: "done" | "answered" | "not-done" | "cant-do" | "couldnt-verify";
  /** The answer or what was done, in a few plain lines. */
  lines?: string[];
  headline: string; // "Fixed. Your printer is Ready."
  /** Before/after for fixes, e.g. { label: "Printer", before: "Paused, 3 stuck jobs", after: "Ready" }. */
  beforeAfter: { label: string; before: string; after: string }[];
  proofs: { claim: string; checks: string[] }[]; // checks = the commands that passed
  problems: string[];
  reviewedBy: "claude" | "rules" | "agent";
}

// ---------------- App → helper bar: channel "say" ----------------

/**
 * Something to say out loud AND show as a caption (captions are always on).
 * Short and calm. Never a raw command.
 */
export interface SayMessage {
  text: string;
  /** "now" interrupts what's being said; "queue" waits its turn. */
  mode: "now" | "queue";
}

// ---------------- Helper bar → app ----------------

export type BarToApp =
  | { channel: "bar-ok" } // the OK button on "plan"
  | { channel: "bar-confirm"; data: { yes: boolean; typed?: string } } // the answer on "confirm"
  | { channel: "bar-explain-ok" } // closes "explain"
  | { channel: "bar-cancel" }
  | { channel: "bar-stop" }
  | { channel: "bar-retry" }
  | { channel: "bar-answer"; data: { text: string } } // typed answer, or a suggestion chip
  | { channel: "bar-approve"; data: { stepId: string; yes: boolean } }
  | { channel: "bar-manual"; data: { stepId: string; answer: "done" | "skip" } }
  | { channel: "bar-send-summary" } // copies a "here's what I tried" summary to the clipboard
  | { channel: "bar-mic-start" } // hold-to-talk pressed
  | { channel: "bar-mic-audio"; data: { wav: ArrayBuffer } } // hold-to-talk released: 16 kHz mono 16-bit WAV
  | { channel: "bar-mic-cancel" }
  | { channel: "bar-rect"; data: { x: number; y: number; width: number; height: number } }; // where the card is, so clicks around it pass through


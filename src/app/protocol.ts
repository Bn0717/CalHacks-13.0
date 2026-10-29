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
  /** canContinue: the person pressed Stop; "Continue" picks the task up where it stopped. */
  | { phase: "done"; receipt: ReceiptView; steps: StepLine[]; detail: DetailLine[]; canRetry: boolean; canSendSummary: boolean; canContinue?: boolean }
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
  | { channel: "bar-speaking"; data: { on: boolean } } // the voice started or stopped (the buddy's mouth moves)
  | { channel: "bar-rect"; data: { x: number; y: number; width: number; height: number } }; // where the card is, so clicks around it pass through


// ---------------- App → pointer layer: channel "pointer" ----------------

/**
 * A ring and a short label right on the thing the person should click (when a part is theirs, like a password or a
 * personal choice). The layer covers the main display, lets every click pass through, and is kept out of screenshots.
 * x, y are screen points on the main display, (0,0) at its top-left.
 */
export type PointerCommand = { show: true; x: number; y: number; label: string } | { show: false };

// ---------------- App → buddy layer: channel "buddy" ----------------

/**
 * Stride, the red buddy. It sits on the bar's card, takes a pose for each moment, and hops over to point at the thing the
 * person should click. The layer covers the main display, lets every click pass through, and is kept out of screenshots.
 * x, y are screen points on the main display, (0,0) at its top-left. CALHACK_BUDDY=0 turns it off (the plain ring is used).
 */
export type BuddyPose = "idle" | "wave" | "scan" | "think" | "type" | "carry" | "stop" | "point" | "celebrate" | "sad" | "talk";

export type BuddyCommand =
  | { type: "show"; x: number; y: number; pose?: BuddyPose } // appear (pop in) at a point
  | { type: "hide" }
  | { type: "hop"; x: number; y: number; pose?: BuddyPose; label?: string } // jump in an arc to a point, then take the pose
  | { type: "pose"; pose: BuddyPose }
  | { type: "point"; x: number; y: number; label: string } // hop next to a spot and point at it, with a ring and a label
  | { type: "scan"; rect: { x: number; y: number; width: number; height: number } } // look around an area
  | { type: "talking"; on: boolean };

// ---------------- App → lesson screen: channel "lesson" ----------------

/**
 * Stride Learn's lesson screen (lesson.html). Like the bar, the app sends the whole view each time something changes, and the
 * screen only draws it. The screen sits in its own narrow window docked beside VS Code, so it never covers the code.
 * All text is plain and friendly, and is inserted as text, never as HTML. src/learn/view.ts builds these from runner state.
 * App → screen also: channel "lesson-layout" with a LessonLayout, to restore where the student put the card.
 */
export type LessonView =
  | { screen: "hidden" }
  /**
   * Building the lesson. Honest progress: the real stages, ticked as they finish (no made-up percentage).
   * Either send `stages` with their status, or just the stage labels plus `stage` (the 0-based one running now, or
   * labels.length when all are done), e.g. straight from a builder's onStage callback. time: how long building usually
   * takes, in words (BUILD_TIME_TEXT in src/learn/stages.ts).
   */
  | { screen: "building"; what: string; stages?: LessonBuildStage[]; labels?: string[]; stage?: number; time?: string; note?: string }
  /** A starting question with big tap buttons. multi: the student can tap several, then Next. */
  | {
      screen: "question";
      id: string;
      number: number; // 1-based
      total: number;
      question: string;
      options: string[];
      multi: boolean;
      picked: string[];
      extras?: ("addPicture" | "showStyles")[];
    }
  /** What Stride read from the reference picture, for the student to confirm or correct. image: a data: URL, optional. */
  | { screen: "picture"; summary: string; sections: { name: string; description: string }[]; image?: string }
  /** The honest estimate before starting, with the simpler version offered first when there is one. */
  | {
      screen: "estimate";
      title: string;
      outcome: string;
      learns: string[];
      estimate: LessonEstimateView;
      /** learns: what the simple version teaches (it's the option the screen highlights, so it shows this list). */
      simpler?: { title: string; why: string; estimate: LessonEstimateView; learns: string[] };
    }
  /** Stride doing the boring setup, with ticks. ask: a once-only yes/no (e.g. adding Stride's VS Code helper). */
  | { screen: "setup"; items: LessonSetupItem[]; ask?: { question: string; why: string; yes: string; no: string } }
  | LessonStepView
  /** The optional quick question at the end of a chapter. After a pick the app sends answer + explain. */
  | {
      screen: "quiz";
      chapterTitle: string;
      question: string;
      options: string[];
      picked?: number;
      answer?: number;
      explain?: string;
      progress: LessonProgressView;
    }
  /** break: the student pressed Pause. welcome-back: they came back to a saved lesson. */
  | {
      screen: "paused";
      reason: "break" | "welcome-back";
      lessonTitle: string;
      step: { number: number; total: number; title: string };
      hintsUsed: number;
      progress: LessonProgressView;
    }
  /** Something went wrong. The screen words each kind itself; message adds a detail. saved: their progress is safe. */
  | { screen: "error"; kind: "no-key" | "no-internet" | "video-unreadable" | "other"; message?: string; saved?: boolean }
  /** The finish screen. picture: a data: URL screenshot of their page. */
  | {
      screen: "finished";
      title: string;
      outcome: string;
      picture?: string;
      learned: string[];
      steps: number; // the steps the student types
      allSteps?: number; // every step, with the setup steps Stride did (so it matches "Step 3 of 6")
      alone: number;
      hinted: number;
      shown: number;
      skipped: number;
      minutes: number;
      next: { title: string; why: string; minutes?: number };
    };

export interface LessonBuildStage {
  label: string; // "Building the finished page out of sight"
  status: "todo" | "running" | "done";
}

export interface LessonEstimateView {
  minutes: number;
  linesToType: number;
  steps: number;
}

export interface LessonSetupItem {
  label: string; // "VS Code is installed"
  status: "todo" | "running" | "done" | "failed";
  detail?: string;
}

/** How each step went, for the progress strip. */
export type LessonStepMark = "todo" | "done" | "hinted" | "shown" | "skipped";

export interface LessonProgressView {
  chapters: { id: string; title: string }[];
  steps: { chapter: string; mark: LessonStepMark }[];
  index: number; // the current step, 0-based
}

/**
 * The step card's status:
 * your-turn (open, nothing typed) · typing (never judged) · checking (looking at the code) · passed (✅) · partial (half-typed,
 * or closer than before) · stuck (the last look found a problem) · showing (Stride types it for them) · stride-working / stride-failed
 * (a setup step Stride does) · watch (a part to watch).
 */
export type LessonStepStatus =
  | "your-turn"
  | "typing"
  | "checking"
  | "passed"
  | "partial"
  | "stuck"
  | "showing"
  | "stride-working"
  | "stride-failed"
  | "watch";

export interface LessonStepView {
  screen: "step";
  lessonTitle: string;
  progress: LessonProgressView;
  step: {
    id: string;
    number: number; // 1-based
    total: number;
    title: string;
    instruction: string;
    why: string;
    who: "learner" | "stride" | "watch";
    chapterTitle: string;
    file?: string;
    line?: number; // the line to type at, when the VS Code helper knows it
    concept?: { title: string; explain: string; links: { title: string; url: string }[] };
    video?: { videoId?: string; start: number; end: number };
  };
  status: LessonStepStatus;
  hints: string[]; // the hints shown so far, gentlest first (0-3)
  hintOffered: boolean; // "Want a hint?"
  canShowMe: boolean;
  doneForMe: boolean; // "Do this one for me" is on (so "Let me try" is offered)
  pace: "learn" | "fast";
  note?: string; // a short line from the app, e.g. what's still missing
  partial?: "typing" | "closer"; // with status "partial": the code is half-typed, or it's closer than any try before
  parts?: { done: number; total: number }; // with "partial" or "stuck": how many parts of the step are right so far
  open?: "concept" | "hints" | "video"; // ask the screen to open this panel (e.g. the first time a concept comes up)
}

/** Where the student put the lesson card. The screen remembers it, and tells the app so the window can follow. */
export interface LessonLayout {
  dock: "left" | "right"; // which side of the code
  expanded: boolean;
}

// ---------------- Lesson screen → app ----------------

export type LessonToApp =
  | { channel: "lesson-answer"; data: { id: string; answers: string[] } } // a question's tap buttons ([] = skipped)
  | { channel: "lesson-extra"; data: { kind: "addPicture" | "showStyles" } }
  | { channel: "lesson-picture"; data: { ok: boolean; correction?: string } }
  | { channel: "lesson-choose"; data: { version: "simple" | "full" } } // the estimate screen
  | { channel: "lesson-setup"; data: { yes: boolean } } // the setup screen's once-only question
  | { channel: "lesson-hint" } // runner event hintRequested
  | { channel: "lesson-show-me" } // runner event showMe
  | { channel: "lesson-skip" } // runner event skip
  | { channel: "lesson-continue" } // runner event continue (watch steps)
  | { channel: "lesson-do-for-me" } // runner event doForMe
  | { channel: "lesson-let-me-try" } // runner event letMeTry
  | { channel: "lesson-pace"; data: { pace: "learn" | "fast" } } // runner event paceChanged
  | { channel: "lesson-watch"; data: { start: number; end: number } } // play this part of the video
  | { channel: "lesson-open-link"; data: { url: string } } // open a concept link in the browser
  | { channel: "lesson-wrong-step" } // "This step looks wrong"
  | { channel: "lesson-quiz"; data: { picked: number } }
  | { channel: "lesson-quiz-next" }
  | { channel: "lesson-pause" }
  | { channel: "lesson-resume" }
  | { channel: "lesson-retry" }
  | { channel: "lesson-open-settings" }
  | { channel: "lesson-other-video" }
  | { channel: "lesson-use-idea" }
  | { channel: "lesson-next-lesson" }
  | { channel: "lesson-close" }
  | { channel: "lesson-layout"; data: LessonLayout }
  | { channel: "lesson-rect"; data: { x: number; y: number; width: number; height: number } }; // where the card is

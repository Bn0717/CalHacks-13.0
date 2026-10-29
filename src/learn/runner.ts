// The lesson runner: decides what happens next in a lesson (check now? show a hint? next step?).
// The core is a pure state machine: it takes events (the student typed, a check came back, a second passed) and
// returns a new state plus a list of effects (things to do). A thin driver below does the effects with injected
// helpers (the checker, Stride's tool executor, the progress store and a clock), so it's easy to test with fakes.
import { strideActionInput, type Check, type Lesson, type Progress, type Step, type StepProgress } from "./lesson.js";

// All timing rules in one place, so they're easy to tune after testing with students.
export const TIMING = {
  settleMs: 1_500, // check this long after the last edit (the driver checks right on time, not on the next tick)
  firstHintMs: 10_000, // after a failed check, show hint 1 this long later
  nextHintMs: 30_000, // then the next hint after this long without progress
  offerHintMs: 30_000, // ask "Want a hint?" after this long without progress
  settledStuckMs: 30_000, // half-typed or "closer" code left alone this long counts as stuck (so hints come)
  cheerMs: 1_500, // how long the ✅ stays before the next step opens
  tickMs: 500, // how often the driver tells the machine time has passed
} as const;

// What the checker (T4) says about a step. Kept local so this file doesn't depend on the checker's code.
// partial means half-typed code (never judged). A "fail" can still count as progress: see `remaining`.
export interface CheckOutcome {
  status: "pass" | "partial" | "fail";
  failed: Check[];
  message: string;
  reason?: string; // the first thing that's wrong, in plain words (shown next to hint 1)
  untouched?: boolean; // nothing typed in the step's file yet: still "your turn"
  remaining?: number; // how much is left (defaults to the number of failed checks); less than ever before = progress
  passed?: number; // checks passing
  total?: number; // checks in the step
}

export type Pace = Progress["pace"];

// waiting: step open, nothing typed yet · typing: the student is typing · settled: checked, half-typed or closer than
// ever, keep going · checking: a check is running · passed: ✅ shown, next step soon · stuck: the last check found
// something wrong and no progress (hints come from here)
export type Phase = "waiting" | "typing" | "settled" | "checking" | "passed" | "stuck";

export interface RunnerState {
  progress: Progress;
  phase: Phase;
  finished: boolean;
  hintLevel: number; // highest hint shown on this step (0-3)
  checkId: number; // grows with every check, so an old result is ignored
  lastEditAt?: number;
  stepOpenedAt: number;
  lastProgressAt: number; // when the student last got closer (step opened, fewer failed checks, a hint)
  firstFailAt?: number;
  lastHintAt?: number;
  bestRemaining?: number; // the least left so far on this step: only beating it counts as progress
  settledWhy?: "typing" | "closer"; // why the phase is "settled": half-typed code, or closer than ever
  settledAt?: number;
  lastCheck?: { passed: number; total: number; reason?: string }; // the last look that wasn't a pass
  passedAt?: number;
  hintOffered: boolean;
  doneForMe: boolean; // "do this one for me" is on for this step
}

export type RunnerEvent =
  | { type: "start" } // open the current step (first time, or after resuming)
  | { type: "edit"; at?: number } // at: when the edit really happened, if the caller noticed it a little late
  | { type: "save" }
  | { type: "tick" } // time has passed; the machine reads `now`
  | { type: "idle"; ms: number } // the same as a tick, for callers that count idle time themselves
  | { type: "checkResult"; checkId: number; outcome: CheckOutcome }
  | { type: "strideResult"; ok: boolean; message?: string }
  | { type: "hintRequested" }
  | { type: "showMe" }
  | { type: "skip" }
  | { type: "continue" } // for watch steps, or a stride step that's done
  | { type: "paceChanged"; pace: Pace }
  | { type: "doForMe" }
  | { type: "letMeTry" }
  | { type: "resumed"; awayMs: number }; // back from a break: the time away doesn't count toward hints

export type Effect =
  | { type: "openStep"; index: number; step: Step; welcomeBack: boolean }
  | { type: "runCheck"; checkId: number; step: Step }
  | { type: "showHint"; level: number; text: string; reason?: string } // reason: what's wrong right now, shown with it
  | { type: "offerHint" }
  | { type: "typeCode"; step: Step } // Stride types the step's code for the student
  | { type: "revertCode"; step: Step } // undo what Stride typed ("let me try")
  | { type: "runStrideAction"; step: Step; tool: string; input: Record<string, unknown> }
  | { type: "cheer"; step: Step }
  | { type: "say"; text: string }
  | { type: "saveProgress"; progress: Progress }
  | { type: "finished"; progress: Progress };

export interface Transition {
  state: RunnerState;
  effects: Effect[];
}

// ---------- Small helpers ----------

const iso = (ms: number): string => new Date(ms).toISOString();

export function currentStep(lesson: Lesson, state: RunnerState): Step | undefined {
  return lesson.steps[state.progress.stepIndex];
}

// "Show me" is there in Go faster, and in Learn more only once all 3 hints have been shown.
export function canShowMe(lesson: Lesson, state: RunnerState): boolean {
  const step = currentStep(lesson, state);
  if (!step || step.who !== "learner" || state.finished) return false;
  return state.progress.pace === "fast" || state.hintLevel >= 3;
}

// The label on the step card.
export function whoLabel(step: Step): string {
  if (step.who === "stride") return "🤖 Stride";
  if (step.who === "watch") return "👀 Watch";
  return "🧑 Your turn";
}

function stepProgress(state: RunnerState, step: Step): StepProgress {
  return state.progress.steps[step.id] ?? { status: "todo", hintsUsed: 0 };
}

function setStep(state: RunnerState, step: Step, change: Partial<StepProgress>, now: number): void {
  state.progress.steps[step.id] = { ...stepProgress(state, step), ...change };
  state.progress.updatedAt = iso(now);
}

// A fresh Progress for a lesson that hasn't been started.
export function newProgress(lesson: Lesson, pace: Pace, now: number): Progress {
  return { lessonId: lesson.id, stepIndex: 0, steps: {}, pace, updatedAt: iso(now) };
}

// A runner state from saved (or new) progress. Call `reduce` with { type: "start" } to open the step.
export function initialState(lesson: Lesson, progress: Progress, now: number): RunnerState {
  const stepIndex = Math.min(Math.max(progress.stepIndex, 0), lesson.steps.length);
  const p: Progress = { ...progress, stepIndex, steps: { ...progress.steps } };
  const step = lesson.steps[stepIndex];
  return {
    progress: p,
    phase: "waiting",
    finished: stepIndex >= lesson.steps.length,
    hintLevel: step ? (p.steps[step.id]?.hintsUsed ?? 0) : 0,
    checkId: 0,
    stepOpenedAt: now,
    lastProgressAt: now,
    hintOffered: false,
    doneForMe: false,
  };
}

// ---------- The state machine ----------

export function reduce(lesson: Lesson, prev: RunnerState, event: RunnerEvent, now: number): Transition {
  const state: RunnerState = structuredClone(prev);
  const effects: Effect[] = [];
  const step = currentStep(lesson, state);
  if (state.finished || !step) {
    state.finished = true;
    return { state, effects };
  }
  const save = () => effects.push({ type: "saveProgress", progress: structuredClone(state.progress) });

  const startCheck = () => {
    state.checkId += 1;
    state.phase = "checking";
    effects.push({ type: "runCheck", checkId: state.checkId, step });
  };

  const showHint = (level: number) => {
    if (level > 3 || level <= state.hintLevel) return;
    state.hintLevel = level;
    state.lastHintAt = now;
    state.lastProgressAt = now;
    const sp = stepProgress(state, step);
    setStep(state, step, { hintsUsed: Math.max(sp.hintsUsed, level), status: sp.status === "todo" ? "hinted" : sp.status }, now);
    effects.push({ type: "showHint", level, text: step.hints[level - 1], ...(state.lastCheck?.reason ? { reason: state.lastCheck.reason } : {}) });
    save();
  };

  // Stride types the expected code, the step is marked shown, then we check it like any other step.
  const typeItForThem = () => {
    setStep(state, step, { status: "shown" }, now);
    effects.push({ type: "typeCode", step });
    save();
    startCheck();
  };

  // Mark this step finished and move to the next one (or finish the lesson).
  const advance = (status: StepProgress["status"] | undefined) => {
    if (status) setStep(state, step, { status, doneAt: iso(now) }, now);
    state.progress.stepIndex += 1;
    state.progress.updatedAt = iso(now);
    Object.assign(state, freshStepFields(now));
    const next = lesson.steps[state.progress.stepIndex];
    if (!next) {
      state.finished = true;
      save();
      effects.push({ type: "finished", progress: structuredClone(state.progress) });
      return;
    }
    openStep(lesson, state, next, now, effects, false);
    save();
  };

  switch (event.type) {
    case "start": {
      const resumed = Object.keys(state.progress.steps).length > 0 || state.progress.stepIndex > 0;
      openStep(lesson, state, step, now, effects, resumed);
      save();
      break;
    }

    case "edit": {
      if (step.who !== "learner" || state.phase === "passed") break;
      state.phase = "typing"; // an edit also makes any running check out of date
      state.lastEditAt = Math.min(event.at ?? now, now);
      break;
    }

    case "save": {
      if (step.who !== "learner" || state.phase === "passed" || state.phase === "checking") break;
      startCheck();
      break;
    }

    case "tick":
    case "idle": {
      onTime(lesson, state, step, now, effects, { startCheck, showHint, advance });
      break;
    }

    case "checkResult": {
      if (state.phase !== "checking" || event.checkId !== state.checkId) break; // out of date
      const { outcome } = event;
      if (outcome.status === "pass") {
        const sp = stepProgress(state, step);
        setStep(state, step, { status: sp.status === "todo" ? "done" : sp.status, doneAt: iso(now) }, now);
        state.phase = "passed";
        state.passedAt = now;
        effects.push({ type: "cheer", step });
        save();
        break;
      }
      if (outcome.untouched) {
        state.phase = "waiting"; // nothing typed yet: still their turn, not wrong
        state.lastCheck = undefined;
        break;
      }
      state.lastCheck = {
        passed: outcome.passed ?? 0,
        total: outcome.total ?? step.checks.length,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      };
      // Progress means less left than on any look before (so going back and forth never counts twice).
      // (A look that broke has no failed checks and says nothing about progress.)
      const remaining = outcome.remaining ?? (outcome.failed.length > 0 ? outcome.failed.length : undefined);
      const closer = remaining !== undefined && state.bestRemaining !== undefined && remaining < state.bestRemaining - 1e-9;
      if (remaining !== undefined && (state.bestRemaining === undefined || remaining < state.bestRemaining)) state.bestRemaining = remaining;
      if (closer) state.lastProgressAt = now;
      if (outcome.status === "partial" || closer) {
        // Half-typed, or closer than ever: keep waiting quietly.
        state.phase = "settled";
        state.settledWhy = outcome.status === "partial" ? "typing" : "closer";
        state.settledAt = now;
        break;
      }
      state.phase = "stuck";
      if (state.firstFailAt === undefined) state.firstFailAt = now;
      // A further fail brings the next hint, but not faster than one every firstHintMs.
      if (state.hintLevel === 0 && now - state.firstFailAt >= TIMING.firstHintMs) showHint(1);
      else if (state.hintLevel > 0 && now - (state.lastHintAt ?? 0) >= TIMING.firstHintMs) showHint(state.hintLevel + 1);
      break;
    }

    case "strideResult": {
      if (step.who !== "stride" || state.phase !== "checking") break;
      if (event.ok) {
        state.phase = "passed";
        state.passedAt = now;
        setStep(state, step, { status: "done", doneAt: iso(now) }, now);
        effects.push({ type: "cheer", step });
        save();
      } else {
        state.phase = "stuck";
        effects.push({ type: "say", text: event.message ?? "That didn't work. You can try it yourself, or skip this step." });
      }
      break;
    }

    case "hintRequested": {
      if (state.phase === "passed") break;
      if (state.hintLevel < 3) showHint(state.hintLevel + 1);
      else if (canShowMe(lesson, state)) effects.push({ type: "say", text: "That's all the hints. Press Show me and I'll type it." });
      break;
    }

    case "showMe": {
      if (!canShowMe(lesson, state) || state.phase === "passed") break;
      typeItForThem();
      break;
    }

    case "doForMe": {
      if (step.who !== "learner" || state.phase === "passed" || state.doneForMe) break;
      state.doneForMe = true;
      typeItForThem();
      break;
    }

    case "letMeTry": {
      if (!state.doneForMe || state.phase === "passed") break;
      state.doneForMe = false;
      state.checkId += 1; // forget the check of Stride's code
      state.phase = "waiting";
      setStep(state, step, { status: state.hintLevel > 0 ? "hinted" : "todo" }, now);
      effects.push({ type: "revertCode", step });
      save();
      break;
    }

    case "skip": {
      const sp = stepProgress(state, step);
      advance(sp.status === "done" || sp.status === "shown" ? sp.status : "skipped");
      break;
    }

    case "continue": {
      if (step.who === "watch") advance("done");
      else if (step.who === "stride" && state.phase === "passed") advance(undefined);
      break;
    }

    case "resumed": {
      // Move every "since when" forward by the break, so no hint pops up the moment they come back.
      const away = Math.max(0, event.awayMs);
      const shift = (t: number | undefined) => (t === undefined ? undefined : t + away);
      state.stepOpenedAt += away;
      state.lastProgressAt += away;
      state.lastEditAt = shift(state.lastEditAt);
      state.firstFailAt = shift(state.firstFailAt);
      state.lastHintAt = shift(state.lastHintAt);
      state.settledAt = shift(state.settledAt);
      state.passedAt = shift(state.passedAt);
      break;
    }

    case "paceChanged": {
      if (state.progress.pace === event.pace) break;
      state.progress.pace = event.pace;
      state.progress.updatedAt = iso(now);
      save();
      break;
    }
  }
  return { state, effects };
}

// Fields that start over on every new step.
function freshStepFields(now: number): Partial<RunnerState> {
  return {
    phase: "waiting",
    hintLevel: 0,
    lastEditAt: undefined,
    stepOpenedAt: now,
    lastProgressAt: now,
    firstFailAt: undefined,
    lastHintAt: undefined,
    bestRemaining: undefined,
    settledWhy: undefined,
    settledAt: undefined,
    lastCheck: undefined,
    passedAt: undefined,
    hintOffered: false,
    doneForMe: false,
  };
}

function openStep(lesson: Lesson, state: RunnerState, step: Step, now: number, effects: Effect[], welcomeBack: boolean): void {
  const sp = stepProgress(state, step);
  if (!sp.startedAt) setStep(state, step, { startedAt: iso(now) }, now);
  state.stepOpenedAt = now;
  state.lastProgressAt = now;
  effects.push({ type: "openStep", index: state.progress.stepIndex, step, welcomeBack });
  if (step.who === "stride" && step.strideAction) {
    state.checkId += 1;
    state.phase = "checking"; // waiting for Stride's tool to finish
    effects.push({ type: "runStrideAction", step, tool: step.strideAction.tool, input: strideActionInput(step.strideAction) });
  }
}

// Time passing: start a check once typing stops, open the next step after the cheer, and bring hints when stuck.
function onTime(
  lesson: Lesson,
  state: RunnerState,
  step: Step,
  now: number,
  effects: Effect[],
  act: { startCheck: () => void; showHint: (level: number) => void; advance: (s: StepProgress["status"] | undefined) => void },
): void {
  if (state.phase === "passed") {
    if (now - (state.passedAt ?? now) >= TIMING.cheerMs) act.advance(undefined);
    return;
  }
  if (step.who !== "learner") return;
  if (state.phase === "typing") {
    if (now - (state.lastEditAt ?? now) >= TIMING.settleMs) act.startCheck();
    return; // never interrupt typing with hints
  }
  // Left half-typed (or "closer") with no more typing for a while: it's probably a real slip, so hints start.
  if (state.phase === "settled" && now - (state.settledAt ?? now) >= TIMING.settledStuckMs) {
    state.phase = "stuck";
    state.settledWhy = undefined;
    state.firstFailAt ??= now;
  }
  if (state.phase === "stuck") {
    if (state.hintLevel === 0 && now - (state.firstFailAt ?? now) >= TIMING.firstHintMs) act.showHint(1);
    else if (state.hintLevel > 0 && now - (state.lastHintAt ?? now) >= TIMING.nextHintMs) act.showHint(state.hintLevel + 1);
  }
  if ((state.phase === "waiting" || state.phase === "settled" || state.phase === "stuck") && !state.hintOffered && state.hintLevel === 0) {
    if (now - state.lastProgressAt >= TIMING.offerHintMs) {
      state.hintOffered = true;
      effects.push({ type: "offerHint" });
    }
  }
}

// ---------- The driver: does the effects with injected helpers ----------

export interface Clock {
  now(): number;
  // Calls `fn` every `ms`. Returns a function that stops it.
  every(ms: number, fn: () => void): () => void;
}

export interface StrideResult {
  ok: boolean;
  message?: string;
}

export interface RunnerDeps {
  check: (step: Step, lesson: Lesson) => Promise<CheckOutcome>;
  // Runs one of Stride's safe tools (the agent's tool runner in the app, a fake in tests).
  runStrideAction: (tool: string, input: Record<string, unknown>) => Promise<StrideResult>;
  clock: Clock;
  saveProgress?: (progress: Progress) => Promise<void> | void;
  typeCode?: (step: Step) => Promise<void> | void;
  revertCode?: (step: Step) => Promise<void> | void;
  // Every effect, for the UI (step card, hints, cheers, the finish screen).
  onEffect?: (effect: Effect, state: RunnerState) => void;
  // After every event, with the new state (some changes, like "typing", have no effect of their own).
  onState?: (state: RunnerState) => void;
}

export class LessonRunner {
  private stateNow: RunnerState;
  private stopTicking?: () => void;
  private stopSettle?: () => void; // the one-off timer that checks right when typing has been quiet long enough
  private pausedAt?: number;
  private pending = new Set<Promise<unknown>>();
  private typing: Promise<unknown> = Promise.resolve(); // Stride's typing runs in order, and checks wait for it

  constructor(
    readonly lesson: Lesson,
    progress: Progress,
    private readonly deps: RunnerDeps,
  ) {
    this.stateNow = initialState(lesson, progress, deps.clock.now());
  }

  get state(): RunnerState {
    return this.stateNow;
  }

  get step(): Step | undefined {
    return currentStep(this.lesson, this.stateNow);
  }

  get canShowMe(): boolean {
    return canShowMe(this.lesson, this.stateNow);
  }

  start(): void {
    this.stopTicking = this.deps.clock.every(TIMING.tickMs, () => this.send({ type: "tick" }));
    this.send({ type: "start" });
  }

  stop(): void {
    this.stopTicking?.();
    this.stopTicking = undefined;
    this.stopSettle?.();
    this.stopSettle = undefined;
  }

  send(event: RunnerEvent): void {
    const { state, effects } = reduce(this.lesson, this.stateNow, event, this.deps.clock.now());
    this.stateNow = state;
    for (const effect of effects) this.perform(effect);
    if (state.finished) this.stop();
    else if (event.type === "edit" && state.phase === "typing" && this.stopTicking) this.checkWhenQuiet();
    this.deps.onState?.(state);
  }

  get paused(): boolean {
    return this.pausedAt !== undefined;
  }

  // A break: time stops for the lesson (no checks on a timer, no hints), until resume().
  pause(): void {
    if (this.paused || !this.stopTicking || this.stateNow.finished) return;
    this.pausedAt = this.deps.clock.now();
    this.stop();
  }

  resume(): void {
    if (this.pausedAt === undefined) return;
    const awayMs = this.deps.clock.now() - this.pausedAt;
    this.pausedAt = undefined;
    this.stopTicking = this.deps.clock.every(TIMING.tickMs, () => this.send({ type: "tick" }));
    this.send({ type: "resumed", awayMs });
    if (this.stateNow.phase === "typing") this.checkWhenQuiet();
  }

  // The student just typed: look at their code exactly settleMs after this edit, unless they type again first.
  // (The half-second tick would also start the check, but up to half a second late.)
  private checkWhenQuiet(): void {
    this.stopSettle?.();
    const editAt = this.stateNow.lastEditAt ?? this.deps.clock.now();
    const wait = Math.max(1, editAt + TIMING.settleMs - this.deps.clock.now());
    const stop = this.deps.clock.every(wait, () => {
      stop();
      if (this.stopSettle === stop) this.stopSettle = undefined;
      if (this.stateNow.phase === "typing" && this.stateNow.lastEditAt === editAt) this.send({ type: "tick" });
    });
    this.stopSettle = stop;
  }

  // Waits until every check, tool run and save started so far has finished (handy in tests).
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private track(work: Promise<unknown>): void {
    const p = work.catch(() => undefined).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  private perform(effect: Effect): void {
    this.deps.onEffect?.(effect, this.stateNow);
    switch (effect.type) {
      case "runCheck":
        this.track(
          this.typing.then(() => this.deps.check(effect.step, this.lesson)).then(
            (outcome) => this.send({ type: "checkResult", checkId: effect.checkId, outcome }),
            () => this.send({ type: "checkResult", checkId: effect.checkId, outcome: { status: "fail", failed: [], message: "" } }),

          ),
        );
        break;
      case "runStrideAction":
        this.track(
          this.deps.runStrideAction(effect.tool, effect.input).then(
            (r) => this.send({ type: "strideResult", ok: r.ok, message: r.message }),
            (e: unknown) => this.send({ type: "strideResult", ok: false, message: e instanceof Error ? e.message : undefined }),
          ),
        );
        break;
      case "saveProgress":
        if (this.deps.saveProgress) this.track(Promise.resolve(this.deps.saveProgress(effect.progress)));
        break;
      case "typeCode":
        if (this.deps.typeCode) {
          const typeCode = this.deps.typeCode;
          this.typing = this.typing.then(() => typeCode(effect.step)).catch(() => undefined);
          this.track(this.typing);
        }
        break;
      case "revertCode":
        if (this.deps.revertCode) {
          const revertCode = this.deps.revertCode;
          this.typing = this.typing.then(() => revertCode(effect.step)).catch(() => undefined);
          this.track(this.typing);
        }
        break;
      default:
        break;
    }
  }
}

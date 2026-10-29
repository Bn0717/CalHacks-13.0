// Turns lesson runner state into what the lesson screen draws (LessonView in src/app/protocol.ts).
// Pure: no model, no files, no window. The app calls these after every runner effect and sends the result on "lesson".
import type { LessonBuildStage, LessonProgressView, LessonStepMark, LessonStepStatus, LessonStepView, LessonView } from "../app/protocol.js";
import type { Lesson, Progress } from "./lesson.js";
import { BUILD_STAGES, BUILD_TIME_TEXT, STAGE_LABELS, type BuildStage } from "./stages.js";
import { canShowMe, currentStep, type RunnerState } from "./runner.js";
import type { LessonSummary } from "./summary.js";

// The progress strip: one mark per step, grouped by chapter.
export function progressView(lesson: Lesson, progress: Progress): LessonProgressView {
  return {
    chapters: lesson.chapters.map((c) => ({ id: c.id, title: c.title })),
    steps: lesson.steps.map((s) => ({ chapter: s.chapter, mark: markOf(progress.steps[s.id]?.status) })),
    index: Math.min(progress.stepIndex, lesson.steps.length),
  };
}

function markOf(status: string | undefined): LessonStepMark {
  return status === "done" || status === "hinted" || status === "shown" || status === "skipped" ? status : "todo";
}

// The step card's status, from the runner's phase and who does the step.
export function stepStatus(lesson: Lesson, state: RunnerState): LessonStepStatus {
  const step = currentStep(lesson, state);
  if (!step) return "passed";
  if (state.phase === "passed") return "passed";
  if (step.who === "watch") return "watch";
  if (step.who === "stride") return state.phase === "stuck" ? "stride-failed" : "stride-working";
  const shown = state.progress.steps[step.id]?.status === "shown";
  switch (state.phase) {
    case "typing":
      return "typing";
    case "checking":
      return shown ? "showing" : "checking";
    case "settled":
      return "partial";
    case "stuck":
      return "stuck";
    default:
      return "your-turn";
  }
}

export interface StepExtras {
  line?: number; // from the VS Code helper
  note?: string; // e.g. the checker's message for a partial or stuck step
  open?: LessonStepView["open"];
  videoId?: string;
}

// The step card for the current step. Returns null when the lesson is finished.
export function stepView(lesson: Lesson, state: RunnerState, extras: StepExtras = {}): LessonStepView | null {
  const step = currentStep(lesson, state);
  if (!step || state.finished) return null;
  const chapter = lesson.chapters.find((c) => c.id === step.chapter);
  const hintLevel = Math.min(Math.max(state.hintLevel, 0), 3);
  return {
    screen: "step",
    lessonTitle: lesson.title,
    progress: progressView(lesson, state.progress),
    step: {
      id: step.id,
      number: state.progress.stepIndex + 1,
      total: lesson.steps.length,
      title: step.title,
      instruction: step.instruction,
      why: step.why,
      who: step.who,
      chapterTitle: chapter?.title ?? "",
      ...(step.file ? { file: step.file } : {}),
      ...(extras.line !== undefined ? { line: extras.line } : {}),
      ...(step.concept ? { concept: { title: step.concept.title, explain: step.concept.explain, links: step.concept.links } } : {}),
      ...(step.video ? { video: { ...(extras.videoId ? { videoId: extras.videoId } : {}), start: step.video.start, end: step.video.end } } : {}),
    },
    status: stepStatus(lesson, state),
    hints: step.hints.slice(0, hintLevel),
    hintOffered: state.hintOffered && hintLevel === 0,
    canShowMe: canShowMe(lesson, state),
    doneForMe: state.doneForMe,
    pace: state.progress.pace,
    ...(extras.note ? { note: extras.note } : {}),
    ...(extras.open ? { open: extras.open } : {}),
  };
}

// The estimate screen, with the simpler version offered first when the lesson has one.
export function estimateView(lesson: Lesson): LessonView {
  const s = lesson.simpler;
  return {
    screen: "estimate",
    title: lesson.title,
    outcome: lesson.outcome,
    learns: lesson.learns,
    estimate: { ...lesson.estimate },
    ...(s ? { simpler: { title: s.title, why: s.why, estimate: { ...s.estimate }, learns: simplerLearns(lesson) } } : {}),
  };
}

// What the simple version teaches: its own list, or the new ideas in its steps. Never the whole lesson's list,
// which would promise things the simple version doesn't cover.
export function simplerLearns(lesson: Lesson): string[] {
  const s = lesson.simpler;
  if (!s) return [];
  if (s.learns && s.learns.length > 0) return [...s.learns];
  const keep = new Set(s.stepIds ?? []);
  const out: string[] = [];
  for (const step of lesson.steps) {
    const title = step.concept?.title.trim();
    if (!keep.has(step.id) || !title) continue;
    if (!out.some((t) => t.toLowerCase() === title.toLowerCase())) out.push(title);
  }
  return out;
}

// The building screen, from the builder's real stages (src/learn/stages.ts): the app calls this from the builder's
// onStage with the stage that just started, or "done" when the lesson is ready.
export function buildingView(what: string, kind: keyof typeof BUILD_STAGES, current: BuildStage | "done", note?: string): LessonView {
  const order: readonly BuildStage[] = BUILD_STAGES[kind];
  const labels = order.map((s) => STAGE_LABELS[s]);
  const found = current === "done" ? labels.length : order.indexOf(current);
  const stage = found < 0 ? 0 : found;
  const stages: LessonBuildStage[] = labels.map((label, i) => ({ label, status: i < stage ? "done" : i === stage ? "running" : "todo" }));
  return { screen: "building", what, stages, labels, stage, time: BUILD_TIME_TEXT, ...(note ? { note } : {}) };
}

// "Welcome back! Step 4: Things you like." or the break screen.
export function pausedView(lesson: Lesson, progress: Progress, reason: "break" | "welcome-back"): LessonView {
  const index = Math.min(progress.stepIndex, lesson.steps.length - 1);
  const step = lesson.steps[index];
  const hintsUsed = progress.steps[step.id]?.hintsUsed ?? 0; // on this step only: those are the ones still on screen
  return {
    screen: "paused",
    reason,
    lessonTitle: lesson.title,
    step: { number: index + 1, total: lesson.steps.length, title: step.title },
    hintsUsed,
    progress: progressView(lesson, progress),
  };
}

// The chapter's quick question, from the last step of the chapter that has one.
export function quizView(lesson: Lesson, progress: Progress, stepId: string, picked?: number): LessonView | null {
  const step = lesson.steps.find((s) => s.id === stepId);
  if (!step?.quiz) return null;
  const chapter = lesson.chapters.find((c) => c.id === step.chapter);
  const answered = picked !== undefined;
  return {
    screen: "quiz",
    chapterTitle: chapter?.title ?? "",
    question: step.quiz.question,
    options: step.quiz.options,
    ...(answered ? { picked, answer: step.quiz.answer, explain: step.quiz.explain } : {}),
    progress: progressView(lesson, progress),
  };
}

// The finish screen, from the summary (src/learn/summary.ts).
export function finishedView(lesson: Lesson, summary: LessonSummary, picture?: string): LessonView {
  return {
    screen: "finished",
    title: summary.title,
    outcome: lesson.outcome,
    ...(picture ? { picture } : {}),
    learned: summary.concepts.length > 0 ? summary.concepts : lesson.learns,
    steps: summary.steps,
    allSteps: lesson.steps.length,
    alone: summary.alone,
    hinted: summary.hinted,
    shown: summary.shown,
    skipped: summary.skipped,
    minutes: summary.minutes,
    next: { ...summary.next },
  };
}

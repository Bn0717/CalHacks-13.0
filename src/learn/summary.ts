// The finish screen's data: how the student did, what they learned, how long it took and what to try next.
// Pure: no model, no files.
import type { Lesson, Progress } from "./lesson.js";

export interface NextLesson {
  title: string;
  why: string;
  minutes?: number;
}

export interface LessonSummary {
  lessonId: string;
  title: string;
  steps: number; // steps the student types (🧑 Your turn)
  alone: number; // done with no hints
  hinted: number; // done after one or more hints
  shown: number; // Stride typed it for them
  skipped: number;
  concepts: string[]; // concept titles from steps they got through, in lesson order
  minutes: number; // from the first step opened to the last step done
  next: NextLesson;
}

// Rough size of a follow-up lesson for one more part of their picture.
export const NEXT_LESSON_MINUTES = 20;

export function lessonSummary(lesson: Lesson, progress: Progress): LessonSummary {
  let alone = 0;
  let hinted = 0;
  let shown = 0;
  let skipped = 0;
  const learnerSteps = lesson.steps.filter((s) => s.who === "learner");
  for (const step of learnerSteps) {
    const status = progress.steps[step.id]?.status ?? "todo";
    if (status === "done") alone += 1;
    else if (status === "hinted") hinted += 1;
    else if (status === "shown") shown += 1;
    else if (status === "skipped") skipped += 1;
  }

  const concepts: string[] = [];
  const seen = new Set<string>();
  for (const step of lesson.steps) {
    const status = progress.steps[step.id]?.status;
    if (!step.concept || status === undefined || status === "todo" || status === "skipped") continue;
    const key = step.concept.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push(step.concept.title);
  }

  return {
    lessonId: lesson.id,
    title: lesson.title,
    steps: learnerSteps.length,
    alone,
    hinted,
    shown,
    skipped,
    concepts,
    minutes: minutesTaken(progress),
    next: suggestNext(lesson, { steps: learnerSteps.length, shown, skipped }),
  };
}

function minutesTaken(progress: Progress): number {
  const started = Object.values(progress.steps).flatMap((s) => (s.startedAt ? [Date.parse(s.startedAt)] : []));
  const done = Object.values(progress.steps).flatMap((s) => (s.doneAt ? [Date.parse(s.doneAt)] : []));
  if (started.length === 0 || done.length === 0) return 0;
  return Math.max(0, Math.round((Math.max(...done) - Math.min(...started)) / 60_000));
}

// A simple rule for what to try next:
// 1. If Stride had to show or skip most steps, try the smaller version (when the lesson has one) or do it again.
// 2. Otherwise, add a part of their picture this lesson didn't build.
// 3. Otherwise, make it their own with one more part.
export function suggestNext(lesson: Lesson, did: { steps: number; shown: number; skipped: number }): NextLesson {
  const struggled = did.steps > 0 && (did.shown + did.skipped) * 2 > did.steps;
  if (struggled) {
    if (lesson.simpler) return { title: lesson.simpler.title, why: lesson.simpler.why, minutes: lesson.simpler.estimate.minutes };
    return { title: `${lesson.title}, one more time`, why: "Doing it again on your own makes it stick.", minutes: lesson.estimate.minutes };
  }
  const unused = unusedPictureSections(lesson);
  if (unused.length > 0) {
    const part = unused[0];
    return { title: `Add the ${part.name.toLowerCase()} from your picture`, why: part.description, minutes: NEXT_LESSON_MINUTES };
  }
  return {
    title: `Add one more part to ${lesson.title.toLowerCase()}`,
    why: `Use what you learned (${lesson.learns.slice(0, 2).join(", ") || "this lesson"}) on something new.`,
    minutes: NEXT_LESSON_MINUTES,
  };
}

// Parts of the student's reference picture that no step mentions.
export function unusedPictureSections(lesson: Lesson): { name: string; description: string }[] {
  if (lesson.source.kind !== "idea" || !lesson.source.picture) return [];
  const text = lesson.steps.map((s) => `${s.title} ${s.instruction}`).join(" ").toLowerCase();
  return lesson.source.picture.sections.filter((section) => !text.includes(section.name.trim().toLowerCase()));
}

# Wiring the lesson screen into the Mac app

The lesson screen (`src/app/ui/lesson.html` + `lesson.css` + `lesson.js` + `lesson-model.js`) is built and checked in the
browser preview (`npm run learn:preview`, `npm run learn:screens`). It is driven only by messages, like the helper bar. These
are the small changes that open it from the app on the Mac. They touch Electron-only files, so they're done and tested on a Mac.

The message shapes are in `src/app/protocol.ts` (`LessonView`, `LessonLayout`, `LessonToApp`). `src/learn/view.ts` builds
every `LessonView` from runner state, so the app never assembles views by hand.

## 1. `src/app/preload.cjs`: allow the lesson channels

```js
// TO_APP: add
"lesson-answer", "lesson-extra", "lesson-picture", "lesson-choose", "lesson-setup", "lesson-hint", "lesson-show-me",
"lesson-skip", "lesson-continue", "lesson-do-for-me", "lesson-let-me-try", "lesson-pace", "lesson-watch",
"lesson-open-link", "lesson-wrong-step", "lesson-quiz", "lesson-quiz-next", "lesson-pause", "lesson-resume",
"lesson-retry", "lesson-open-settings", "lesson-other-video", "lesson-use-idea", "lesson-next-lesson", "lesson-close",
"lesson-layout", "lesson-rect",
// FROM_APP: add
"lesson", "lesson-layout",
```

## 2. `src/app/windows.ts`: a narrow window docked beside VS Code

Add next to the helper bar section (it reuses `makeWindow`, `whenLoaded` and `UI`):

```ts
import type { LessonLayout, LessonView } from "./protocol.js";

// ---------- Lesson screen: a narrow column docked beside the code, never over it ----------

const LESSON_W = 420; // the card is 25rem + padding at 1x text
let lesson: BrowserWindow | null = null;
let lessonLayout: LessonLayout = { dock: "right", expanded: false };

/** Puts the lesson window at the left or right edge of the screen VS Code is on, full height. */
function placeLesson(win: BrowserWindow, codeBounds?: Electron.Rectangle): void {
  const display = codeBounds ? screen.getDisplayMatching(codeBounds) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(LESSON_W, Math.round(area.width * 0.4)); // at big text sizes the card scrolls inside this width
  const x = lessonLayout.dock === "left" ? area.x : area.x + area.width - width;
  win.setBounds({ x, y: area.y, width, height: area.height });
}

export function ensureLesson(codeBounds?: Electron.Rectangle): BrowserWindow {
  if (lesson && !lesson.isDestroyed()) return lesson;
  lesson = makeWindow({ acceptFirstMouse: true, width: LESSON_W, height: 800, focusable: true });
  lesson.setAlwaysOnTop(true, "floating");
  lesson.loadFile(UI("lesson.html"));
  lesson.on("closed", () => (lesson = null));
  placeLesson(lesson, codeBounds);
  return lesson;
}

/** Shows a lesson view. "hidden" hides the window. showInactive: the student keeps typing in VS Code. */
export function showLesson(view: LessonView): void {
  const w = ensureLesson();
  whenLoaded(w, () => {
    w.webContents.send("lesson", view);
    if (view.screen === "hidden") w.hide();
    else if (!w.isVisible()) w.showInactive();
  });
}

/** The student moved the card (or opened/closed it): move the window, and make room for the code. */
export function setLessonLayout(layout: LessonLayout, codeBounds?: Electron.Rectangle): void {
  lessonLayout = layout;
  if (lesson && !lesson.isDestroyed()) placeLesson(lesson, codeBounds);
}
```

Make room for the code: when the lesson starts, shrink VS Code to the rest of the screen with the existing safe window tool
(`src/agent/tools.ts`, through `risk.ts`), so the two sit side by side. The window above is narrow and full height, so it never
covers the editor even if that step is skipped on a wide screen.

## 3. `src/learn/session.ts`: tell the screen what to draw ✅ done (tested on Linux)

`LessonSession` takes an optional `onView(view: LessonView)` and calls it whenever what the screen should show changes
(repeats are skipped). It's built by `src/learn/view.ts`, never by hand:

- after every runner change: open step, typing (no effect of its own, so the runner now has an `onState` hook), checking,
  a check result (partial / not quite yet, with the checker's plain message as `note`), hints, Show me, ✅;
- the line to type on (`step.line`, from the file and the step's anchor) and `open: "concept"` the first time an idea comes up;
- `pause()` → `pausedView(…, "break")` and the lesson's clock stops (no hints or checks during a break); `resume()` → the step;
- coming back to a saved lesson → `pausedView(…, "welcome-back")` (only this step's hints counted), and the lesson waits
  until "Pick up where I left off" (`resume()`) or the student starts typing;
- a step with a quick question → `quizView` after the ✅; the lesson waits; `answerQuiz(i)` shows the answer, `quizNext()`
  carries on (or shows the finish);
- the end → `finishedView` with how each step went and `allSteps` (so "5 steps you typed" matches "Step 3 of 6").

`send(event)` passes the screen's buttons to the runner (Hint, Show me, Skip, Do this one for me, Let me try, pace).
Tested in `tests/learn/session.test.ts` ("LessonSession: the Mac lesson screen (onView)"). The terminal keeps printing.

Left for the Mac (`main.ts`): pass `onView: showLesson`, and the finish screen's picture (a screenshot of their page) once
the app can take one; `finishedView(lesson, summary, picture)` already takes it.

The building screen: `buildingView(what, "idea" | "video", stage)` makes the view from the builder's real stages
(`src/learn/stages.ts`) with `BUILD_TIME_TEXT`; call it from the builder's `onStage` and with `"done"` at the end.

## 4. `src/app/main.ts`: turn the screen's taps into runner events

```ts
import { ensureLesson, setLessonLayout, showLesson } from "./windows.js";

const runnerEvent: Record<string, RunnerEvent> = {
  "lesson-hint": { type: "hintRequested" },
  "lesson-show-me": { type: "showMe" },
  "lesson-skip": { type: "skip" },
  "lesson-continue": { type: "continue" },
  "lesson-do-for-me": { type: "doForMe" },
  "lesson-let-me-try": { type: "letMeTry" },
};
for (const [channel, event] of Object.entries(runnerEvent)) ipcMain.on(channel, () => lessonSession?.send(event)); // LessonSession.send
ipcMain.on("lesson-pace", (_e, d: { pace?: string }) => lessonSession?.send({ type: "paceChanged", pace: d?.pace === "fast" ? "fast" : "learn" }));
ipcMain.on("lesson-layout", (_e, d: LessonLayout) => setLessonLayout({ dock: d?.dock === "left" ? "left" : "right", expanded: d?.expanded === true }));
ipcMain.on("lesson-open-link", (_e, d: { url?: string }) => {
  const url = String(d?.url ?? "");
  if (/^https:\/\//.test(url)) void shell.openExternal(url); // links come from the lesson; only https
});
ipcMain.on("lesson-watch", (_e, d: { start: number; end: number }) => playVideoPart(d.start, d.end)); // mini player, below
ipcMain.on("lesson-pause", () => lessonSession?.pause());   // shows pausedView(…, "break") and stops the clock
ipcMain.on("lesson-resume", () => lessonSession?.resume()); // break or welcome back → the step
ipcMain.on("lesson-quiz", (_e, d: { picked?: number }) => lessonSession?.answerQuiz(Number(d?.picked)));
ipcMain.on("lesson-quiz-next", () => lessonSession?.quizNext());
ipcMain.on("lesson-close", () => { lessonSession?.quit(); showLesson({ screen: "hidden" }); });
// Before the lesson: lesson-answer / lesson-extra (questions.ts), lesson-picture (picture.ts), lesson-choose (estimate →
// build the simple or full lesson), lesson-setup (add the VS Code helper), lesson-retry / lesson-open-settings /
// lesson-other-video / lesson-use-idea (errors), lesson-next-lesson.
```

Validate every `data` like the bar handlers do (treat it as untrusted). Errors map to `{ screen: "error", kind }`: no
`ANTHROPIC_API_KEY`/`GEMINI_API_KEY` → `"no-key"`; a network failure → `"no-internet"` (with `saved: true` mid-lesson);
`build-from-video` can't read the video → `"video-unreadable"`; anything else → `"other"` with a short plain message.

## 5. Buddy pointing at the line

The card's buddy already points toward the code and shows "Line 8 in index.html". To also point at the line on screen, send
the buddy layer a `point` command when a step opens and when the student is stuck, using the line rectangle from the VS Code
helper (`highlight` already scrolls to and marks the lines; the helper can report the line's screen position). Keep the
buddy's `idle`/look pose while typing; the card itself never moves while the student types.

## 6. The mini video (video lessons)

The expanded card shows a "This part of the video" box with a Play button that sends `lesson-watch`. On the Mac, replace the
box's contents with YouTube's official embedded player (`https://www.youtube-nocookie.com/embed/<videoId>?start=<s>&end=<e>`),
and add `frame-src https://www.youtube-nocookie.com` to `lesson.html`'s Content-Security-Policy. Never download videos.

## 7. Check on the Mac

- `npm start`, start the about-me lesson: the window sits beside VS Code, never over it; the card swaps sides with D.
- Text size: System Settings → Accessibility → Display → Text size, or Electron zoom; nothing is cut off at 200%. The
  preview already renders 2x text in the real 420 px window, and `npm run learn:screens` fails if the main button, a new
  hint or the estimate's numbers are out of sight; at big text the card folds the step's words under a hint and drops
  the chapter name (the screen reader still hears it).
- VoiceOver (⌘F5): every button has a name; status changes are read out; Tab order goes header → card → buttons.
- Reduce Motion on: no spinning or bouncing, still pictures instead.
- Light and dark mode follow the system.

# Lesson screen: screenshots and checks

Made by `npm run learn:screens` (scripts/lesson-screens.mjs) from `src/app/ui/lesson-preview.html` in headless Chromium,
at 1440x900, with Reduce Motion on so every picture is the settled state. Don't edit by hand.

Each view is checked for:

- **Contrast**: every visible bit of text is at least 4.5:1 against what's really behind it.
- **Names**: every button, field, group and the progress bar has a name a screen reader can say.
- **Overflow**: nothing is cut off or sticks out sideways, and the page never scrolls sideways (2x text too).
- **Overlap**: the lesson card never covers the code area.
- **In view**: the main button, a newly shown hint and the estimate's minutes · lines · steps are on screen without
  scrolling (the preview's lesson window is the real 420 px wide, so 2x text is the hard case).
- **Keyboard**: Tab reaches every control in reading order, each with a visible focus ring.
- **Words**: no jargon (DOM, selector, parse, runner, anchor, check…) and no script errors.

**37 states x 2 themes x 2 text sizes = 148 views. All checks pass.**

Lowest text contrast: light **4.78:1**, dark **4.78:1**.

| State | Light 1x | Light 2x | Dark 1x | Dark 2x |
|---|---|---|---|---|
| building | ✅ [png](light-1x-building.png) | ✅ [png](light-2x-building.png) | ✅ [png](dark-1x-building.png) | ✅ [png](dark-2x-building.png) |
| question | ✅ [png](light-1x-question.png) | ✅ [png](light-2x-question.png) | ✅ [png](dark-1x-question.png) | ✅ [png](dark-2x-question.png) |
| question-multi | ✅ [png](light-1x-question-multi.png) | ✅ [png](light-2x-question-multi.png) | ✅ [png](dark-1x-question-multi.png) | ✅ [png](dark-2x-question-multi.png) |
| question-look | ✅ [png](light-1x-question-look.png) | ✅ [png](light-2x-question-look.png) | ✅ [png](dark-1x-question-look.png) | ✅ [png](dark-2x-question-look.png) |
| picture | ✅ [png](light-1x-picture.png) | ✅ [png](light-2x-picture.png) | ✅ [png](dark-1x-picture.png) | ✅ [png](dark-2x-picture.png) |
| estimate | ✅ [png](light-1x-estimate.png) | ✅ [png](light-2x-estimate.png) | ✅ [png](dark-1x-estimate.png) | ✅ [png](dark-2x-estimate.png) |
| estimate-short | ✅ [png](light-1x-estimate-short.png) | ✅ [png](light-2x-estimate-short.png) | ✅ [png](dark-1x-estimate-short.png) | ✅ [png](dark-2x-estimate-short.png) |
| setup | ✅ [png](light-1x-setup.png) | ✅ [png](light-2x-setup.png) | ✅ [png](dark-1x-setup.png) | ✅ [png](dark-2x-setup.png) |
| setup-ask | ✅ [png](light-1x-setup-ask.png) | ✅ [png](light-2x-setup-ask.png) | ✅ [png](dark-1x-setup-ask.png) | ✅ [png](dark-2x-setup-ask.png) |
| stride-step | ✅ [png](light-1x-stride-step.png) | ✅ [png](light-2x-stride-step.png) | ✅ [png](dark-1x-stride-step.png) | ✅ [png](dark-2x-stride-step.png) |
| your-turn | ✅ [png](light-1x-your-turn.png) | ✅ [png](light-2x-your-turn.png) | ✅ [png](dark-1x-your-turn.png) | ✅ [png](dark-2x-your-turn.png) |
| docked-left | ✅ [png](light-1x-docked-left.png) | ✅ [png](light-2x-docked-left.png) | ✅ [png](dark-1x-docked-left.png) | ✅ [png](dark-2x-docked-left.png) |
| typing | ✅ [png](light-1x-typing.png) | ✅ [png](light-2x-typing.png) | ✅ [png](dark-1x-typing.png) | ✅ [png](dark-2x-typing.png) |
| checking | ✅ [png](light-1x-checking.png) | ✅ [png](light-2x-checking.png) | ✅ [png](dark-1x-checking.png) | ✅ [png](dark-2x-checking.png) |
| passed | ✅ [png](light-1x-passed.png) | ✅ [png](light-2x-passed.png) | ✅ [png](dark-1x-passed.png) | ✅ [png](dark-2x-passed.png) |
| partial | ✅ [png](light-1x-partial.png) | ✅ [png](light-2x-partial.png) | ✅ [png](dark-1x-partial.png) | ✅ [png](dark-2x-partial.png) |
| stuck | ✅ [png](light-1x-stuck.png) | ✅ [png](light-2x-stuck.png) | ✅ [png](dark-1x-stuck.png) | ✅ [png](dark-2x-stuck.png) |
| want-hint | ✅ [png](light-1x-want-hint.png) | ✅ [png](light-2x-want-hint.png) | ✅ [png](dark-1x-want-hint.png) | ✅ [png](dark-2x-want-hint.png) |
| hint-1 | ✅ [png](light-1x-hint-1.png) | ✅ [png](light-2x-hint-1.png) | ✅ [png](dark-1x-hint-1.png) | ✅ [png](dark-2x-hint-1.png) |
| hint-2 | ✅ [png](light-1x-hint-2.png) | ✅ [png](light-2x-hint-2.png) | ✅ [png](dark-1x-hint-2.png) | ✅ [png](dark-2x-hint-2.png) |
| hint-3 | ✅ [png](light-1x-hint-3.png) | ✅ [png](light-2x-hint-3.png) | ✅ [png](dark-1x-hint-3.png) | ✅ [png](dark-2x-hint-3.png) |
| hints-expanded | ✅ [png](light-1x-hints-expanded.png) | ✅ [png](light-2x-hints-expanded.png) | ✅ [png](dark-1x-hints-expanded.png) | ✅ [png](dark-2x-hints-expanded.png) |
| show-me | ✅ [png](light-1x-show-me.png) | ✅ [png](light-2x-show-me.png) | ✅ [png](dark-1x-show-me.png) | ✅ [png](dark-2x-show-me.png) |
| do-for-me | ✅ [png](light-1x-do-for-me.png) | ✅ [png](light-2x-do-for-me.png) | ✅ [png](dark-1x-do-for-me.png) | ✅ [png](dark-2x-do-for-me.png) |
| concept | ✅ [png](light-1x-concept.png) | ✅ [png](light-2x-concept.png) | ✅ [png](dark-1x-concept.png) | ✅ [png](dark-2x-concept.png) |
| video | ✅ [png](light-1x-video.png) | ✅ [png](light-2x-video.png) | ✅ [png](dark-1x-video.png) | ✅ [png](dark-2x-video.png) |
| watch-step | ✅ [png](light-1x-watch-step.png) | ✅ [png](light-2x-watch-step.png) | ✅ [png](dark-1x-watch-step.png) | ✅ [png](dark-2x-watch-step.png) |
| stride-failed | ✅ [png](light-1x-stride-failed.png) | ✅ [png](light-2x-stride-failed.png) | ✅ [png](dark-1x-stride-failed.png) | ✅ [png](dark-2x-stride-failed.png) |
| quiz | ✅ [png](light-1x-quiz.png) | ✅ [png](light-2x-quiz.png) | ✅ [png](dark-1x-quiz.png) | ✅ [png](dark-2x-quiz.png) |
| quiz-answered | ✅ [png](light-1x-quiz-answered.png) | ✅ [png](light-2x-quiz-answered.png) | ✅ [png](dark-1x-quiz-answered.png) | ✅ [png](dark-2x-quiz-answered.png) |
| paused | ✅ [png](light-1x-paused.png) | ✅ [png](light-2x-paused.png) | ✅ [png](dark-1x-paused.png) | ✅ [png](dark-2x-paused.png) |
| welcome-back | ✅ [png](light-1x-welcome-back.png) | ✅ [png](light-2x-welcome-back.png) | ✅ [png](dark-1x-welcome-back.png) | ✅ [png](dark-2x-welcome-back.png) |
| error-no-key | ✅ [png](light-1x-error-no-key.png) | ✅ [png](light-2x-error-no-key.png) | ✅ [png](dark-1x-error-no-key.png) | ✅ [png](dark-2x-error-no-key.png) |
| error-no-internet | ✅ [png](light-1x-error-no-internet.png) | ✅ [png](light-2x-error-no-internet.png) | ✅ [png](dark-1x-error-no-internet.png) | ✅ [png](dark-2x-error-no-internet.png) |
| error-video | ✅ [png](light-1x-error-video.png) | ✅ [png](light-2x-error-video.png) | ✅ [png](dark-1x-error-video.png) | ✅ [png](dark-2x-error-video.png) |
| error-other | ✅ [png](light-1x-error-other.png) | ✅ [png](light-2x-error-other.png) | ✅ [png](dark-1x-error-other.png) | ✅ [png](dark-2x-error-other.png) |
| finished | ✅ [png](light-1x-finished.png) | ✅ [png](light-2x-finished.png) | ✅ [png](dark-1x-finished.png) | ✅ [png](dark-2x-finished.png) |

# Stride Learn — cloud task briefs

Each task below is one cloud session. Read [PLAN.md](PLAN.md) and the repo's `CLAUDE.md` first.

**Order:** T0 runs first and alone, and is merged into `feat/learn-mode`. Then T1–T6 run in parallel, each on its own branch
off `feat/learn-mode`, each opening a PR into `feat/learn-mode` (not `main`).

**Every task:** `npm run typecheck` and `npm test` pass; new logic has tests in `tests/learn/`; no real API calls in tests
(inject a fake model function); no changes to fix-my-Mac files unless the brief says so; plain-English comments like the rest
of the repo.

---

## T0 — Lesson format (first, alone)

Branch: `learn/t0-lesson-format`

Create `src/learn/lesson.ts` with Zod schemas + inferred types, and nothing that calls a model:

- `Lesson`: `id`, `source` (`{kind:"idea", request, answers, picture?}` | `{kind:"video", url, videoId, title}`), `title`,
  `summary`, `outcome` (what they'll make), `learns: string[]`, `estimate` (`minutes`, `linesToType`, `steps`), `simpler?`
  (a smaller `Lesson` offer: title, estimate, why), `files` (the finished reference project: `{path, content}[]`), `chapters`,
  `steps`, `createdAt`, `version`.
- `Step`: `id`, `chapter`, `title`, `instruction`, `why` (one line), `who` (`"learner" | "stride" | "watch"`), `file?`,
  `anchor?` (where in the file: after which line/element), `expected` (the code this step adds, from the reference),
  `checks: Check[]`, `hints: [string, string, string]` (nudge → point → partial), `concept?` (`title`, `explain`, `links[]`,
  `imageQuery?`, `videoQuery?`), `video?` (`start`, `end` seconds), `strideAction?` (for `who:"stride"`: a tool name + input
  understood by `src/agent/tools.ts`), `quiz?`.
- `Check` (a discriminated union, all behaviour-based, never exact text): `parses` (file parses as HTML/CSS/JS),
  `selectorExists` (`selector`, optional `count`), `textIncludes` (`selector`, `text`, case-insensitive), `attribute`
  (`selector`, `name`, optional `value`), `cssProperty` (`selector`, `property`, optional `value` — checked on computed style),
  `fileExists`, `ai` (`question` — last resort, answered by Haiku).
- `Progress`: `lessonId`, `stepIndex`, per-step `{status: "todo"|"done"|"hinted"|"shown"|"skipped", hintsUsed, startedAt, doneAt}`,
  `pace` (`"learn" | "fast"`), `updatedAt`.
- Helpers: `estimateMinutes(steps)` (typing ~ lines × 0.6 min for beginners + 2 min per new concept + 0.5 min per stride/watch
  step — keep the constants in one place), `parseLesson(json)` (validate, friendly error), `lessonJsonSchema()` (the JSON schema
  for `askJson`'s structured output).

Also add `tests/learn/fixtures/about-me.lesson.json` — a hand-written, valid 6-step lesson for "a page about me" (HTML + a bit of CSS),
and `tests/learn/lesson.test.ts` (fixture validates, bad shapes are rejected with readable errors, estimate maths).

Done when: types compile, fixture validates, tests pass. Merge into `feat/learn-mode`.

---

## T1 — Idea lesson builder

Branch: `learn/t1-from-idea` · Files: `src/learn/build-from-idea.ts`, `src/learn/questions.ts`, `tests/learn/build-from-idea.test.ts`

1. `questionsFor(request)` → 2–4 short multiple-choice questions (purpose, contents, look) with tap-button options. Pure
   function for the common "website" asks; a model call only for unusual requests.
2. `buildFromIdea({request, answers, picture?}, deps)`:
   - Scope check first: if the ask is too big for a beginner (servers, accounts, payments, "make me Instagram"), return a
     `tooBig` result with the closest small version instead of a lesson.
   - Ask the model (`askJson`, `claude-opus-5-5` unless `CALHACK_LEARN_MODEL`) for the **finished reference project files**.
   - **Render the reference in a hidden browser (Playwright, see `src/agent/webform.ts` for how the repo launches it) and verify
     it**: no console errors, every page loads. If it fails, send the error back once and retry.
   - Ask the model to **cut the verified project into steps** (3–10 lines each, chapters, who/why/hints/checks/concepts), then
     **run every step's checks against the reference** — each must pass on the finished code and the first must fail on an
     empty project. Fix or drop checks that don't.
   - Compute the estimate with `estimateMinutes`. If over 60 minutes, also build the `simpler` offer (one page, core sections).
3. `deps` holds the model call and the browser so tests can fake both.

Done when: with fakes, a "page about me" request yields a valid `Lesson`; a "make me Instagram" request yields `tooBig` with
a small alternative; a lesson over 60 min carries a `simpler` offer; check self-validation is tested.

---

## T2 — Reference picture

Branch: `learn/t2-picture` · Files: `src/learn/picture.ts`, `tests/learn/picture.test.ts`

- `readPicture(image)` → `{ sections: {name, description}[], style: {colors[], fonts?, mood}, summary }` using Claude vision
  (`askJson` with an image content block). Shrink large images with `sharp` first (the repo already uses it).
- `describeForStudent(result)` → the one plain sentence Stride says ("a top menu, a big photo with a title, 3 cards, a footer").
- `applyCorrection(result, studentText)` → updated sections (model call).
- The idea builder (T1) accepts this result as `picture`; agree only on the type exported from this file.

Done when: tested with a fake model; image shrinking tested on a generated PNG.

---

## T3 — Video lesson builder + lesson cache

Branch: `learn/t3-from-video` · Files: `src/learn/build-from-video.ts`, `src/learn/gemini.ts`, `src/learn/cache.ts`, tests

- `gemini.ts`: a minimal client for Google's Gemini API using `fetch` and `GEMINI_API_KEY`, sending the public YouTube URL as
  video input. Ask for: chapters, and per segment the timestamp range, what is done, and the exact code visible on screen.
  Check Google's current docs for the request shape before writing it. If `GEMINI_API_KEY` is missing, return a clear
  "video lessons need GEMINI_API_KEY" error.
- `buildFromVideo(url, deps)`: video notes → Claude (`askJson`) → `Lesson` with `video.start/end` on steps. Reconstruct the
  finished project from the code segments, then run the same check self-validation as T1 (share the helper — put it in
  `src/learn/validate.ts`).
- `cache.ts`: save/load lessons by key (`video:<id>` or a hash of the idea + answers + picture summary) under
  `~/Library/Application Support/Stride/lessons` (use an injectable base dir so tests use a temp folder).
- Never download the video.

Done when: tested with a recorded fake Gemini response; cache round-trips; missing key gives the friendly error.

---

## T4 — Checker

Branch: `learn/t4-checker` · Files: `src/learn/check/*.ts`, `tests/learn/check.test.ts`

- `checkStep(step, projectFiles, deps)` → `{ status: "pass" | "partial" | "fail", failed: Check[], hintIndex, message }`.
- Level 1 (instant, pure): parse HTML/CSS/JS (add small, well-known parsers such as `parse5`, `css-tree`, `acorn`), and
  evaluate `selectorExists` / `textIncludes` / `attribute` on the parsed HTML.
- Level 2 (~0.5 s): render in a hidden Playwright page for `cssProperty` (computed style) and console errors. Reuse one browser.
- Level 3 (only for `ai` checks or when levels 1–2 can't decide): `claude-haiku-5-5` with the step, the student's code and the
  reference.
- `partial` when the code is mid-edit (fails to parse, or some but not all checks pass) — the runner waits instead of hinting.
- Pick the hint: the first failing check maps to the most relevant prepared hint.

Done when: table-driven tests cover each check type passing and failing, partial vs fail, and that level 3 is never called when
level 1–2 decide.

---

## T5 — Lesson runner, resume, finish summary

Branch: `learn/t5-runner` · Files: `src/learn/runner.ts`, `src/learn/progress.ts`, `src/learn/summary.ts`, tests

- A pure state machine driven by events: `edit`, `save`, `idle(ms)`, `checkResult`, `hintRequested`, `showMe`, `skip`,
  `paceChanged`, `doForMe`, `letMeTry`. States: `waiting`, `typing`, `settled`, `checking`, `passed`, `stuck`.
- Rules: no check while typing; check ~2 s after the last edit; `partial` → keep waiting; `fail` → hint level 1 after 10 s,
  next levels on further fails or after 30 s; offer "Want a hint?" after 30 s without progress; `who:"stride"` steps run their
  `strideAction` through an injected executor; *Learn more* hides "Show me" until hint 3 has been shown.
- `progress.ts`: save/load `Progress` (injectable dir) so a lesson resumes at the same step.
- `summary.ts`: the finish data — steps done alone / hinted / shown, concepts learned, time taken, suggested next lesson.
- Timers injected (fake clock in tests).

Done when: tests walk the about-me fixture from start to finish with fake check results, including stuck → hints → show me,
a stride step, resume after reload, and the summary counts.

---

## T6 — VS Code helper extension + bridge

Branch: `learn/t6-vscode` · Files: `extensions/vscode/` (its own `package.json`, TypeScript), `src/learn/bridge.ts`, tests

- Extension: on activate, connect to Stride over a local WebSocket (`ws://127.0.0.1:<port>`, port + one-time token read from
  `~/Library/Application Support/Stride/bridge.json`). Send debounced document changes (path, full text, version), saves,
  diagnostics (VS Code's error underlines), active file and cursor.
- Receive commands: `highlight` (decorate a line range, scroll to it), `clearHighlight`, `insert` (for "Show me": insert text
  at an anchor, then select it), `openFile`.
- `src/learn/bridge.ts` (Stride side): the WebSocket server, token check, typed messages shared with the extension
  (`extensions/vscode/src/protocol.ts` mirrors `src/learn/bridge-protocol.ts` — keep one source and copy at build).
- Only accept connections from 127.0.0.1 with the token. Never run commands from the extension other than the four above.
- Package with `vsce` into a `.vsix` the setup step can install with `code --install-extension`.

Done when: the bridge is unit-tested with a fake client; the extension compiles and its message handling is unit-tested;
`npx vsce package` produces a `.vsix`. (Running it inside VS Code is tested later on the Mac.)

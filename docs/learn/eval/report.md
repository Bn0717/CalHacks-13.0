# Stride Learn: lesson quality test (C2)

Ran 2026-10-29T05:49:18.084Z with `npm run learn:eval`. The raw results are in `report.json` next to this file.

**Claude:** not usable: no Claude key is set (ANTHROPIC_API_KEY / STRIDE_ANTHROPIC_API_KEY)

## Lessons

| Lesson | Source | Status | Automatic grade | Opus scores (1-5) | Estimate | Build cost |
|---|---|---|---|---|---|---|
| about-me fixture (hand-written) | fixture | graded | 6/8 pass | blocked (no Claude key) | 22 min · 25 lines · 6 steps | — |
| a page about me | — | blocked: needs a working Claude key | — | blocked (no Claude key) | — | — |
| a website for my small bakery | — | blocked: needs a working Claude key | — | blocked (no Claude key) | — | — |
| make me Instagram | built | graded: The full Instagram needs accounts, servers and a database to store everyone's posts, which is a lot for a first project. How about a profile page with a grid of photos, like an Instagram profile? | 1/1 pass | n/a | — | $0.0000 |
| a page like this picture | — | blocked: needs a working Claude key | — | blocked (no Claude key) | — | — |
| Create Your First HTML/CSS Project | — | blocked: needs a working Claude key | — | blocked (no Claude key) | — | — |
| HTML Tutorial for Beginners | — | blocked: needs a working Claude key | — | blocked (no Claude key) | — | — |
| How to Code Your First Website | — | blocked: needs a working Claude key | — | blocked (no Claude key) | — | — |

### about-me fixture (hand-written) (fixture)

- ✅ Valid lesson
- ✅ Every check passes on the finished project; the first fails on an empty one
- ❌ Every 🧑 step adds 3-10 lines
  - Step link-css adds 1 line.
  - Step intro adds 2 lines.
- ✅ 🧑 steps hold all the code to learn; 🤖/👀 steps add none
- ✅ Estimate matches the steps and is in a sensible range
- ❌ Each concept: one plain sentence, no jargon, with a link
  - skeleton "The parts of an HTML page": 2 sentences: "The <head> holds information about the page, like its title. The <body> holds what people see."
  - hobbies "Lists": 2 sentences: "<ul> makes a bullet list. Each thing in it goes in its own <li> (list item)."
  - link-css "Linking CSS": 2 sentences: "CSS is a separate file that says how the page looks. <link> connects it to the HTML."
- ✅ Hints get stronger, and hint 3 isn't the whole answer
- ➖ Video steps link to a real part of the video — Not a video lesson.

### make me Instagram (built)

- ✅ A huge ask gets a small offer, not a flat no

## Findings

- GOAL C3 (build under $0.50, hint under $0.01): no real Claude call ran, so there is no real lesson-build or hint cost yet. The about-me fixture is hand-written, so it has no cost data at all; it only gives the estimate shown above.
- Reading one 19-24 minute video with Gemini (low resolution) cost $0.22-$0.29 (average $0.25, upper-bound price). That is part of a video lesson's build, so it leaves about $0.25 of the $0.50 budget for the Opus steps call (projection, not measured).
- The 3 videos were picked as beginner HTML/CSS step-by-step builds; youtube.com is blocked here, so view counts and captions couldn't be checked. Gemini read two titles differently from the ones noted when picking them ("HTML Tutorial for Beginners - Full Course", "How to Code Your FIRST Website (in 10 minutes)"); the report shows what Gemini read.
- Found by this test: in wzWmZYi4qMg's real notes Gemini escaped the code twice (every line break arrived as a typed \\n, so each file was one long line). src/learn/gemini.ts now turns that back into real lines (unescapeCode); without it that video's lesson would have been built from 11 one-line code blobs.

## Blocked: no working Claude key

These need the Claude API and did not run. Nothing below is faked; run `npm run learn:eval` with a valid
`ANTHROPIC_API_KEY` (or `STRIDE_ANTHROPIC_API_KEY`) in `.env` to fill them in:

- Building real lessons (Opus) for: "a page about me", "a website for my small bakery", "a page like this picture"
  (reads `tests/learn/fixtures/mockup.png` first), and the 3 videos (Gemini notes are already recorded, so only Opus runs).
  Expected: each comes back as a valid lesson, graded on every criterion above; the bakery lesson over 60 min carries a
  smaller offer; build cost per lesson under $0.50 (GOAL C3), logged per call in `docs/learn/eval/cost.json`.
- The separate Opus grading call (`src/learn/judge-lesson.ts`) for each lesson: scores 1-5 on wording, step size,
  order, hints and fidelity, plus the worst steps.
- Haiku hint/check calls (`ai` checks) and their cost per hint (GOAL C3: under $0.01).
- Before/after for the prompt changes: compare this report with the first run's.
- Already done without Claude: "make me Instagram" (code-only scope check), the about-me fixture's automatic grade
  with the real hidden-browser checker, and the Gemini notes for all 3 videos.

## Video notes (Gemini, real calls)

| Video | Status | Title Gemini read | Chapters · segments · with code | Code lines | Last second | Tokens in / out | Cost |
|---|---|---|---|---|---|---|---|
| [wzWmZYi4qMg](https://www.youtube.com/watch?v=wzWmZYi4qMg) | reused | Create Your First HTML/CSS Project | 5 · 17 · 11 | 145 | 1156 | 105,242 / 6,515 | $0.22 |
| [WOvg00FnmsU](https://www.youtube.com/watch?v=WOvg00FnmsU) | reused | HTML Tutorial for Beginners - Full Course | 6 · 30 · 21 | 284 | 1446 | 131,708 / 9,945 | $0.29 |
| [zMTId2CUClw](https://www.youtube.com/watch?v=zMTId2CUClw) | reused | How to Code Your FIRST Website (in 10 minutes) | 5 · 13 · 8 | 41 | 1421 | 129,351 / 4,177 | $0.23 |

Gemini total for these notes: $0.74 (low media resolution). Gemini priced at $1.50 per million input tokens and $9.00 per million output + thinking tokens (Google Cloud's published 'Global' price for Gemini 3.5 Flash, Oct 2026; ai.google.dev was blocked from here, so the Gemini API's own page wasn't checked). Gemini actually served gemini-3.6-flash, which the same price list shows at an introductory $0.75 / $3.75 until 31 Dec 2026, so the real bill is likely about half of what is shown. Treat these as upper-bound estimates.

## Spend

This run: $0.0000. All eval runs so far (cost.json): $0.74. Hard cap: $8.00.

## Prompt changes

Before/after: pending a real run with a working Claude key.

| Where | Change | Why |
|---|---|---|
| idea: project | No code comments in the finished site. | Every line is typed by the student; comments are lines typed for nothing and inflate the estimate. |
| idea + video: steps | 3-10 non-blank lines, never more than 10; split long parts. | A4 / grader 'stepSize'. Now also enforced in code: steps over 12 lines are sent back. |
| idea: steps | Explicit teaching order: skeleton, then HTML content, then CSS, then JS; one new idea per step. | Judge 'teaching order'; A4. |
| idea + video: steps | 'watch' steps add no code; every line of the finished project is typed in some learner step. | A4 '🤖 steps are only setup'; grader 'whoTypes'. Enforced in code too. |
| idea + video: steps | Instructions say what to add and where in words, for a 14-year-old who never coded. | B1 / judge 'beginner wording'. |
| idea + video: hints | Each hint stronger: words only, then the spot + tag name, then part of the code with … gaps; hint 3 never the whole 'expected'. | A6. Enforced in code: a hint 3 holding the whole answer is sent back. |
| idea + video: concepts | ONE plain sentence under 25 words, banned jargon list, at least one MDN link. | A7; the about-me fixture's concepts are all 2 sentences. Links are now required by the schema. |
| idea + video: checks | Optional plain 'say' wording per check, no code words. | B1: the student never sees a CSS selector. The checker words one itself when it's missing. |
| video: timestamps | Every learner step has a video part from the notes' times, start < end, inside the video, in order. | A7 'video steps link to the right timestamp'. Enforced in code: parts past the video's end are sent back. |
| checker: Haiku judge | Reasons in plain words for a 14-year-old, never DOM/selector/element/parse. | B1. |

## Checker messages, before → after

- I can't find "body h1" yet. → **I can't see a big heading (<h1>) inside the page yet.**
- I see 2 "ul li", but this step needs 3. → **I see 2 list items (<li>) inside the bullet list (<ul>), but this step needs 3.**
- "title" should say "about me". → **The page title (<title>) should say "about me".**
- "head link" needs href="style.css". → **The link to a style file (<link>) inside the head part (<head>) needs href="style.css".**
- "img" needs a alt attribute. → **The picture (<img>) still needs a short description of the picture (alt).**
- "h1" doesn't have the right color yet. → **The big heading (<h1>) doesn't have the right text colour yet.**
- I can't find ".card h3" yet. → **I can't see a small heading (<h3>) inside the part with class="card" yet.**
- style.css doesn't exist yet. → **There's no file called style.css in your project folder yet.**
- The <ul> isn't closed yet. → **The <ul> you started still needs its closing </ul>.**
- The page also shows an error: Uncaught ReferenceError: x is not defined → **Your page also shows a problem when it opens, so check the code you just typed for a typo.**


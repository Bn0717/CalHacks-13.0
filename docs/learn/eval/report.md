# Stride Learn: lesson quality test (C2)

Ran 2026-10-29T06:38:14.579Z with `npm run learn:eval`. The raw results are in `report.json` next to this file.

**Claude:** working: a key is set

## Lessons

| Lesson | Source | Status | Automatic grade | Opus scores (1-5) | Estimate | Build cost |
|---|---|---|---|---|---|---|
| about-me fixture (hand-written) | fixture | graded | 9/9 pass | wording 3 · step size 3 · order 3 · hints 3 · fidelity 4 | 24 min · 28 lines · 6 steps | — |
| a page about me | built | graded | 8/9 pass | wording 3 · step size 3 · order 3 · hints 3 · fidelity 4 | 102 min · 116 lines · 20 steps | $0.36 |
| a website for my small bakery | — | error: The answer was cut off at 20000 tokens. | — | — | — | $0.49 |
| make me Instagram | built | graded: The full Instagram needs accounts, servers and a database to store everyone's posts, which is a lot for a first project. How about a profile page with a grid of photos, like an Instagram profile? | 1/1 pass | n/a | — | $0.0000 |
| a page like this picture | built | graded | 9/9 pass | wording 3 · step size 3 · order 4 · hints 3 · fidelity 4 | 113 min · 139 lines · 24 steps | $0.44 |
| Create Your First HTML/CSS Project | built | graded | 7/9 pass | wording 3 · step size 3 · order 2 · hints 3 · fidelity 3 | 61 min · 58 lines · 17 steps | $0.29 |
| HTML Tutorial for Beginners | — | error: The answer was cut off at 16000 tokens. | — | — | — | $0.37 |
| How to Code Your First Website | — | error: The lesson breaks Stride's step rules. | — | — | — | $0.20 |

### about-me fixture (hand-written) (fixture)

- ✅ Valid lesson
- ✅ Every check passes on the finished project; the first fails on an empty one
- ✅ Typing the steps in order rebuilds the finished project, and no step leaves a tag open
- ✅ Every 🧑 step adds 3-10 lines
- ✅ 🧑 steps hold all the code to learn; 🤖/👀 steps add none
- ✅ Estimate matches the steps and is in a sensible range
- ✅ Each concept: one plain sentence, no jargon, with a link
- ✅ Hints get stronger, and hint 3 isn't the whole answer
- ➖ Video steps link to a real part of the video — Not a video lesson.

Opus review: wording 3 · step size 3 · order 3 · hints 3 · fidelity 4. The content steps (intro, hobbies) are well-sized and match exactly what the student asked for: their name and hobbies. The head-related steps (skeleton, link-css) ask for unexplained code that the hints never cover, and the learner is never shown how to view the page.
  - link-css: Three unrelated new ideas in one step: a description meta, a viewport meta and the CSS link. The 'why' and all three hints only cover the <link>.
  - skeleton: The expected code has <meta charset="utf-8"> and lang="en", but neither the instruction nor the hints mention them. Doctype, html, head, title and body are also too many new ideas for one first step.
  - style: It never says to create style.css. 'font-family', 'sans-serif' and 'margin' go unexplained, and the hints only cover the h1 color, not the body rule.
  - intro: No step ever opens index.html in a browser, so the learner never sees their page or checks that the CSS link works.
  - link-css: Words like 'viewport' and 'initial-scale=1' (inside a 'line that makes it fit phone screens') would mean nothing to a first-time coder.

### a page about me (built)

- ✅ Valid lesson
- ✅ Every check passes on the finished project; the first fails on an empty one
- ❌ Typing the steps in order rebuilds the finished project, and no step leaves a tag open
  - index.html: typing every step's code at its anchor, in order, doesn't give the finished file (an anchor puts code in the wrong place, or a step's code isn't copied exactly from the finished file).
- ✅ Every 🧑 step adds 3-10 lines
- ✅ 🧑 steps hold all the code to learn; 🤖/👀 steps add none
- ✅ Estimate matches the steps and is in a sensible range
- ✅ Each concept: one plain sentence, no jargon, with a link
- ✅ Hints get stronger, and hint 3 isn't the whole answer
- ➖ Video steps link to a real part of the video — Not a video lesson.

Opus review: wording 3 · step size 3 · order 3 · hints 3 · fidelity 4. The lesson builds steadily from bare HTML to styling to interactivity, with well-placed 'look at it' checkpoints and friendly personal content that matches what the student asked for. But the JavaScript jumps badly at 'faces' (many new ideas at once, arrays used before they're taught), CSS terms like flex, vh and line-height are never explained, and the face-switching extra plus the emoji standing in for a real photo drift slightly from the request.
  - faces: Far too big for one step: arrays, let, if, functions, addEventListener, .length and textContent all at once, with code split between two places in the file.
  - faces: Uses an array before the idea is explained; the 'Lists in code' concept only comes later, in facts-list.
  - head-info: Four new tags with unexplained jargon ('letter set (UTF-8)', viewport, rel=stylesheet). Hint 2 names the tags but never shows the attributes a beginner can't guess.
  - card: Brings in main, div, h1, p, class and id together. Words like 'main part' and 'box' don't tell a beginner which tag to type.
  - skeleton: Hint 3 is basically the full answer, missing only </body>, so there's nothing left to work out.

### make me Instagram (built)

- ✅ A huge ask gets a small offer, not a flat no

### a page like this picture (built)

- ✅ Valid lesson
- ✅ Every check passes on the finished project; the first fails on an empty one
- ✅ Typing the steps in order rebuilds the finished project, and no step leaves a tag open
- ✅ Every 🧑 step adds 3-10 lines
- ✅ 🧑 steps hold all the code to learn; 🤖/👀 steps add none
- ✅ Estimate matches the steps and is in a sensible range
- ✅ Each concept: one plain sentence, no jargon, with a link
- ✅ Hints get stronger, and hint 3 isn't the whole answer
- ➖ Video steps link to a real part of the video — Not a video lesson.

Opus review: wording 3 · step size 3 · order 4 · hints 3 · fidelity 4. x
  - click-card: Packs a variable, querySelectorAll, forEach, a function, addEventListener and classList into one step, but the only concept note covers clicks; none of the others is explained to a first-time coder.

### Create Your First HTML/CSS Project (built)

- ✅ Valid lesson
- ✅ Every check passes on the finished project; the first fails on an empty one
- ❌ Typing the steps in order rebuilds the finished project, and no step leaves a tag open
  - resources/css/index.css: typing every step's code at its anchor, in order, doesn't give the finished file (an anchor puts code in the wrong place, or a step's code isn't copied exactly from the finished file).
- ✅ Every 🧑 step adds 3-10 lines
- ✅ 🧑 steps hold all the code to learn; 🤖/👀 steps add none
- ❌ Estimate matches the steps and is in a sensible range
  - 61 min with no smaller version offered first.
- ✅ Each concept: one plain sentence, no jargon, with a link
- ✅ Hints get stronger, and hint 3 isn't the whole answer
- ✅ Video steps link to a real part of the video

Opus review: wording 3 · step size 3 · order 2 · hints 3 · fidelity 3. The lesson follows the video's project closely, with friendly 'why' lines and a clear split between watching and typing. Its biggest weakness is front-loading the link tag and the class/id names into the HTML steps, which breaks the video's order and asks beginners to type things before they mean anything.
  - skeleton: The stylesheet link is typed before any CSS exists or is explained, while the video adds it at 724s. The later 'link-check' watch step then shows typing that the learner has already done.
  - banner: The learner types class="banner", id="small-gritty" and the full relative image path here. These come before the 'paths' step explains paths and before any styling gives classes and ids a purpose; the video adds them later, at 525s, 644s and 778s.
  - gritter: This one step introduces a span, an id, a class, a form and two kinds of input across 9 lines. It is too many new ideas at once, and class="bold" means nothing until the 'bold' step.
  - posts: The nested <div><div><span> is never explained, and the third hint gives that exact structure, leaving only the sentence to fill in.
  - meta: It shares the 332-498 video clip with 'skeleton', where the video auto-generates the boilerplate, and it asks a beginner to type X-UA-Compatible/ie=edge with no meaningful explanation.

## Findings

- GOAL C3 (build under $0.50): 3 real build(s), most expensive $0.44 — passes.
- GOAL C3 (hint under $0.01): 3 real Haiku check call(s), average $0.0002, most expensive $0.0002 — passes. The hint text itself is written into the lesson when it's built, so showing a hint costs nothing; only a check the code can't decide calls Haiku.
- Reading one 19-24 minute video with Gemini (low resolution) cost $0.22-$0.29 (average $0.25, upper-bound price). That is part of a video lesson's build, so it leaves about $0.25 of the $0.50 budget for the Opus steps call (projection, not measured).
- The 3 videos were picked as beginner HTML/CSS step-by-step builds; youtube.com is blocked here, so view counts and captions couldn't be checked. Gemini read two titles differently from the ones noted when picking them ("HTML Tutorial for Beginners - Full Course", "How to Code Your FIRST Website (in 10 minutes)"); the report shows what Gemini read.
- Found by this test: in wzWmZYi4qMg's real notes Gemini escaped the code twice (every line break arrived as a typed \\n, so each file was one long line). src/learn/gemini.ts now turns that back into real lines (unescapeCode); without it that video's lesson would have been built from 11 one-line code blobs.

## Video notes (Gemini, real calls)

| Video | Status | Title Gemini read | Chapters · segments · with code | Code lines | Last second | Tokens in / out | Cost |
|---|---|---|---|---|---|---|---|
| [wzWmZYi4qMg](https://www.youtube.com/watch?v=wzWmZYi4qMg) | reused | Create Your First HTML/CSS Project | 5 · 17 · 11 | 145 | 1156 | 105,242 / 6,515 | $0.22 |
| [WOvg00FnmsU](https://www.youtube.com/watch?v=WOvg00FnmsU) | reused | HTML Tutorial for Beginners - Full Course | 6 · 30 · 21 | 284 | 1446 | 131,708 / 9,945 | $0.29 |
| [zMTId2CUClw](https://www.youtube.com/watch?v=zMTId2CUClw) | reused | How to Code Your FIRST Website (in 10 minutes) | 5 · 13 · 8 | 41 | 1421 | 129,351 / 4,177 | $0.23 |

Gemini total for these notes: $0.74 (low media resolution). Gemini priced at $1.50 per million input tokens and $9.00 per million output + thinking tokens (Google Cloud's published 'Global' price for Gemini 3.5 Flash, Oct 2026; ai.google.dev was blocked from here, so the Gemini API's own page wasn't checked). Gemini actually served gemini-3.6-flash, which the same price list shows at an introductory $0.75 / $3.75 until 31 Dec 2026, so the real bill is likely about half of what is shown. Treat these as upper-bound estimates.

## Spend

This run: $2.35. All eval runs so far (cost.json): $3.09. Hard cap: $8.00.

## Hint-time checks (Haiku, real calls)

| Lesson | Step | Haiku said | Tokens in / out | Cost |
|---|---|---|---|---|
| a page about me | skeleton | yes: Your index.html starts with the web page line, wraps everything in the html part, and has the head and body parts in place, so the basic frame is there. | 1865 / 59 | $0.0002 |
| a page like this picture | skeleton | yes: Your page starts with the doctype line, the html tag, and a head that has the character set, screen-size line, the My Site title, and the link to style.css, and the head and html are both closed properly. | 1966 / 74 | $0.0002 |
| Create Your First HTML/CSS Project | skeleton | no: Your page skeleton looks great, but the body isn't empty yet. The step asked for an empty body, and yours already has the banner and gritter sections filled in, which is coming in a later step. | 1320 / 74 | $0.0002 |

## Prompt changes

Before/after: this is the first run with these prompts; the next run compares against it (`--before`).

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


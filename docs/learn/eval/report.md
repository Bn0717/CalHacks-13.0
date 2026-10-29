# Stride Learn: lesson quality test (C2)

Ran 2026-10-29T07:06:34.147Z with `npm run learn:eval`. The raw results are in `report.json` next to this file.

**Claude:** working: a key is set

## Lessons

| Lesson | Source | Status | Automatic grade | Opus scores (1-5) | Estimate | Build cost |
|---|---|---|---|---|---|---|
| about-me fixture (hand-written) | fixture | graded | 9/9 pass | wording 3 · step size 3 · order 3 · hints 3 · fidelity 4 | 24 min · 28 lines · 6 steps | — |
| a page about me | built | graded | 8/9 pass | wording 4 · step size 4 · order 3 · hints 2 · fidelity 4 | 68 min · 65 lines · 17 steps | $0.51 |
| a website for my small bakery | built | graded | 7/9 pass | wording 4 · step size 4 · order 4 · hints 4 · fidelity 5 | 79 min · 91 lines · 22 steps | $0.46 |
| make me Instagram | built | graded: The full Instagram needs accounts, servers and a database to store everyone's posts, which is a lot for a first project. How about a profile page with a grid of photos, like an Instagram profile? | 1/1 pass | n/a | — | $0.0000 |
| a page like this picture | built | graded | 8/9 pass | wording 4 · step size 4 · order 4 · hints 3 · fidelity 5 | 100 min · 104 lines · 24 steps | $0.47 |
| Create Your First HTML/CSS Project | — | error: The lesson breaks Stride's step rules. (Step bold needs a video part (start and end in seconds).) | — | — | — | $0.94 |
| HTML Tutorial for Beginners | — | error: The answer was cut off at 32000 tokens. | — | — | — | $0.69 |
| How to Code Your First Website | — | error: The lesson breaks Stride's step rules. (Step words needs a video part (start and end in seconds).) | — | — | — | $0.30 |

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
- ✅ Typing the steps in order rebuilds the finished project, and no step leaves a tag open
- ✅ Every 🧑 step adds 3-10 lines
- ✅ 🧑 steps hold all the code to learn; 🤖/👀 steps add none
- ✅ Estimate matches the steps and is in a sensible range
- ✅ Each concept: one plain sentence, no jargon, with a link
- ❌ Hints get stronger, and hint 3 isn't the whole answer
  - Step skeleton: hint 3 isn't the strongest (shows 0% → 100% → 84% of the answer's code).
  - Step head: hint 3 isn't the strongest (shows 6% → 100% → 81% of the answer's code).
  - Step section: hint 3 isn't the strongest (shows 0% → 94% → 76% of the answer's code).
- ➖ Video steps link to a real part of the video — Not a video lesson.

Opus review: wording 4 · step size 4 · order 3 · hints 2 · fidelity 4. The lesson matches the request closely (name, likes, photo spot), with clear plain-language explanations and small, even steps. Its biggest weakness is hints that get weaker instead of stronger, with hint 2 giving the full answer and hint 3 a vaguer skeleton, plus an odd build order and no chance to see the CSS changes along the way.
  - head: Hint 2 gives the exact full code, and hint 3 is a blanked skeleton that reveals less. The hints get weaker, not stronger, and this happens in nearly every step.
  - list-style: text-align: left on ul does nothing visible yet, because centering only arrives later in body-more. The learner adds a fix for a problem they have never seen.
  - footer: The footer is built before the header, so the learner signs the bottom of an empty page and then has to insert content above it.
  - section-card: Several CSS steps (section-card, photo-style) say to insert rules between existing ones instead of adding to the end. That jumping around is confusing for a first-timer.
  - body-style: There is no look/refresh step during the 9 CSS steps, so the learner never sees each style change take effect. Jargon like 'sans-serif' and the '#fdf3e7' code also goes unexplained when first used.

### a website for my small bakery (built)

- ✅ Valid lesson
- ✅ Every check passes on the finished project; the first fails on an empty one
- ✅ Typing the steps in order rebuilds the finished project, and no step leaves a tag open
- ❌ Every 🧑 step adds 3-10 lines
  - Step body-more adds 2 lines.
- ✅ 🧑 steps hold all the code to learn; 🤖/👀 steps add none
- ✅ Estimate matches the steps and is in a sensible range
- ✅ Each concept: one plain sentence, no jargon, with a link
- ❌ Hints get stronger, and hint 3 isn't the whole answer
  - Step skeleton: hint 3 isn't the strongest (shows 0% → 100% → 64% of the answer's code).
  - Step head-info: hint 3 isn't the strongest (shows 3% → 91% → 78% of the answer's code).
  - Step cakes-title: hint 3 isn't the strongest (shows 6% → 94% → 81% of the answer's code).
- ➖ Video steps link to a real part of the video — Not a video lesson.

Opus review: wording 4 · step size 4 · order 4 · hints 4 · fidelity 5. It follows the student's request closely (cakes with prices, hours, address and a contact page) and steadily builds a real two-page site with satisfying browser checkpoints. Its weakest spots are a few overloaded early steps (head-info, header) with unexplained jargon, and the odd footer-before-header order.
  - head-info: Three new tags and jargon (charset, utf-8, rel, href) arrive in one step with no plain explanation of what href or rel mean.
  - header: Too many new ideas at once: header, h1, the a tag, href and links nested inside a paragraph, plus a link to contact.html, a page that doesn't exist yet.
  - footer: Building the footer before the header is backwards. The learner then has to insert code above existing code, which is confusing for a first-timer.
  - body-style: Hex colour codes like #fff5e6 and the word serif are used without saying what they are, though the step briefly mentions 'a warm cream'.
  - contact-skel: An 11-line step whose third hint is almost the full answer. Copying could be suggested, but the hint ladder adds little.

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
- ❌ Hints get stronger, and hint 3 isn't the whole answer
  - Step skeleton: hint 3 isn't the strongest (shows 0% → 100% → 64% of the answer's code).
  - Step head-info: hint 3 isn't the strongest (shows 3% → 100% → 81% of the answer's code).
  - Step header: hint 3 isn't the strongest (shows 6% → 100% → 81% of the answer's code).
- ➖ Video steps link to a real part of the video — Not a video lesson.

Opus review: wording 4 · step size 4 · order 4 · hints 3 · fidelity 5. The lesson matches the picture very closely, building every section with sensible, well-explained HTML and CSS in a clear order. Its weakest point is the hints: hint 2 usually dictates the full answer while hint 3 is a vaguer template, so they get weaker instead of stronger, and a few terms (hex colours, px, two-value padding) are never or only belatedly explained.
  - card-title: Hint 2 ('Write .card h3 { } with color #3d3030') is the entire answer, so hint 3's blanked template is weaker than hint 2. This backwards order repeats in nav-hover, banner-title, footer-css and most CSS steps.
  - banner-css: Hint 3 starts with '….banner', which wrongly suggests something must be typed before the dot.
  - header-css: Uses 'px' and the two-value 'padding: 10px 30px' without explaining either. px is only explained later, in banner-title.
  - body-css: Hex colours like #f9f6f1 are used throughout but never explained, and 'sans-serif' is left unexplained.
  - skeleton: The first step packs in DOCTYPE, html, head and body (seven lines and four new tags) for someone who has never coded.

## Findings

- GOAL C3 (build under $0.50): 3 real build(s), most expensive $0.51 — FAILS.
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

This run: $3.52. All eval runs so far (cost.json): $6.61. Hard cap: $8.00.

## Hint-time checks (Haiku, real calls)

| Lesson | Step | Haiku said | Tokens in / out | Cost |
|---|---|---|---|---|
| a page about me | skeleton | yes: Your page has the starting line, the outer wrapper, and both the head and body sections, all properly closed. The extra content inside is fine for this step. | 1272 / 61 | $0.0002 |
| a website for my small bakery | skeleton | yes: Your index.html starts with the <!DOCTYPE html> line, then an html part that holds a head part and a body part, which is exactly the basic page start this step asks for. | 1612 / 69 | $0.0002 |
| a page like this picture | skeleton | yes: Your index.html starts with the DOCTYPE line, wraps everything in html tags, and has a head part and a body part each with its own closing tag, so this step is done. | 1559 / 68 | $0.0002 |

## Prompt changes

Before = the run of 2026-10-29T06:38:14.579Z; after = this run. Opus scores are wording · step size · order · hints · fidelity (1-5), then their average.

| Lesson | Automatic grade before → after | Opus scores before | Opus scores after | Average before → after | Build cost before → after |
|---|---|---|---|---|---|
| about-me fixture (hand-written) | 9/9 → 9/9 | 3 · 3 · 3 · 3 · 4 | 3 · 3 · 3 · 3 · 4 | 3.2 → 3.2 | — → — |
| a page about me | 8/9 → 8/9 | 3 · 3 · 3 · 3 · 4 | 4 · 4 · 3 · 2 · 4 | 3.2 → 3.4 | $0.36 → $0.51 |
| a page like this picture | 9/9 → 8/9 | 3 · 3 · 4 · 3 · 4 | 4 · 4 · 4 · 3 · 5 | 3.4 → 4.0 | $0.44 → $0.47 |

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


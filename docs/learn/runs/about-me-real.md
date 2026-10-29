# Terminal lesson run: "a page about me" (real AI build)

> This lesson was built by the real AI (Opus 5.5 builders, the lesson cache, the real checker with the hidden Chromium
> render). Only the student is pretend: `scripts/learn-simulate.ts` answers the questions, then writes each 🧑 step's
> `expected` code into the file at its anchor, with a typo first on two steps (to bring out the hints, asking for all
> three on one of them) and a half-typed save on one step (to show half-typed code isn't called wrong).

Run: `npx tsx scripts/learn-simulate.ts --idea "a page about me" docs/learn/runs/about-me-real.md` on 2026-10-29.

## Result

- CLI exit code: 0
- 🧑 steps typed: 7, wrong first tries: 2, half-typed saves: 1, hints shown: 4
- Finished files match what this lesson's steps build: yes (checked by the replay below; the student took the smaller version, so the whole project isn't typed, by design)
- Lesson build (questions answered → estimate shown): 161 s
- AI cost (cost.json total): $0.3792
- ✅ delay after the last write (correct code): average 1.72 s, min 1.50 s, max 2.32 s (skeleton 2.32, head-info 1.50, header 1.50, about 1.51, body-colours 1.73, body-font 1.77, header-style 1.70)
- Total time: 270 s

## C1 spend and what this run found

- C1 real API spend: this build $0.38 (Opus project + steps, Haiku checks; cost.json below). Two earlier attempts: the first
  stopped with a 400 at the steps call (the lesson answer shape broke the API's structured-output limits, fixed in
  `src/ai/schema-limit.ts`) after one Opus project call (about $0.05, not logged: fixed so a failed build now prints its
  cost); the second built a 20-step lesson for $0.40 and got stuck at step 4: the step opened `<main>` and its `</main>`
  came steps later, so the right answer stayed "Still typing?" forever (fixed in `src/learn/rebuild.ts`). **C1 total ≈ $0.83.**
- A5 (✅ within ~2 s of stopping typing, without pressing anything): measured from the student's last write to the ✅ line:
  average 1.72 s, 1.50-2.32 s (the first check of the session is the slowest). The settle time is 1.5 s.
- A6: half-typed code got "⏳ Still typing?", never "wrong"; a typo got "⏳ Almost there" then the hint offer; hints 1 → 2 → 3
  got stronger and hint 3 was an outline (`<meta charset="…">`, `<title>…</title>`, `<link rel="…" href="…">`), not the answer.
- A3: the estimate came first (64 min · 67 lines · 15 steps), then the smaller version was offered (about 35 min, 9 steps)
  and taken.
- Note: when a try is partly right ("Almost there"), the runner waits 30 s and offers a hint instead of showing hint 1 by
  itself; the pretend student takes the offer.

## Replay from the cache (no Opus call)

`npx tsx scripts/learn-simulate.ts --idea "a page about me"` again: the lesson came from the cache ("⚡ This lesson was made
before"), same student, so only the checker ran.

- CLI exit code: 0
- 🧑 steps typed: 7, wrong first tries: 2, half-typed saves: 1, hints shown: 4
- Finished files match what this lesson's steps build: yes (the smaller version: the whole project isn't typed, by design)
- Lesson build (questions answered → estimate shown): 0 s
- AI cost (cost.json total): $0.0001
- ✅ delay after the last write (correct code): average 1.79 s, min 1.50 s, max 2.57 s (skeleton 2.57, head-info 1.51, header 1.50, about 1.50, body-colours 1.76, body-font 1.76, header-style 1.93)
- Total time: 109 s

## Transcript

Seconds since start on the left. Lines marked 🧪 are the pretend student; everything else is what the CLI printed.

```text
  1.4s A few quick questions first.
  1.4s 
  1.4s 1/3 · What's it for?
  1.4s   1) Just for me
  1.4s   2) Show my work
  1.4s   3) For job applications
  1.4s   4) Share with friends
  1.4s Type a number, or press Enter to skip:
  1.8s 🧪 [student] presses 1
  1.8s > 
  1.8s 2/3 · What should it have?
  1.8s   1) My name and a short intro
  1.8s   2) My hobbies
  1.8s   3) My projects
  1.8s   4) Photos
  1.8s   5) How to contact me
  1.8s Type the numbers you like (e.g. 1 3), or press Enter to skip:
  2.1s 🧪 [student] presses 1 2
  2.1s > 
  2.1s 3/3 · A look you like?
  2.1s   1) Clean and simple
  2.1s   2) Warm and friendly
  2.1s   3) Bold and colourful
  2.1s   4) Dark and modern
  2.1s Type a number, or press Enter to skip:
  2.4s 🧪 [student] presses 2
  2.4s > 
  2.4s 🛠  Building your lesson. I make the finished website first, test it, then cut it into small steps. This takes usually a minute or two.
  2.4s   · Checking how big your idea is…
  2.4s   · Writing the finished website…
 10.7s   · Trying your site out to make sure it works…
 11.9s   · Cutting it into small steps…
142.2s   · Making sure every step can be checked…
158.6s   · Working out how long it takes…
163.8s 
163.8s 📚 A page about me
163.8s You'll build a warm, friendly one-page website with your name, a short intro about yourself and a list of your hobbies.
163.8s 
163.8s ⏱  About 64 minutes · you'll type about 67 lines · 15 steps
163.8s 🧠 You'll learn: Basic HTML page structure, Headings and paragraphs, Making a list, Linking a CSS file, Warm colors and fonts, Rounded boxes with padding
163.8s 🎯 At the end: A finished personal web page that opens in your browser straight from your project folder.
163.8s 
163.8s That's a big one. Get a real, styled page about you up quickly, then add hobbies, a footer and cards once the basics feel easy.
163.8s   1) The smaller version first: Just a hello and an about-me (about 35 min, 9 steps)
163.8s   2) The whole thing (about 64 min, 15 steps)
163.8s 🧪 [student] presses 1
163.8s Type a number: 
164.1s 🧪 [student] presses Enter
164.1s Press Enter to start (or type q to stop): 
164.1s 📁 Your project folder: <tmp>/lesson
164.1s Open it in VS Code (or any code editor) and keep this window next to it. Save your file and I'll check it.
164.1s ────────────────────────────────────────────────
164.1s Step 1/9 · 🧑 Your turn · Write the page
164.1s Build the page skeleton
164.1s 
164.1s Make a new file called index.html. At the very top, type <!DOCTYPE html>. Under it, add an html tag that opens and closes. Inside it, add a head part (opens and closes), then a body part (opens and closes).
164.1s Why: Every web page needs this frame: html wraps the whole page, head holds hidden info, and body holds everything people see.
164.1s 📄 First make a new file called index.html in your project folder.
164.1s 📍 In index.html, at the top
164.1s 
164.1s 💡 New idea · Tags: Tags are words in angle brackets that tell the browser what each part is; most come in an opening and closing pair.
164.1s    Read more: https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/Getting_started
164.1s 
164.1s Type it in, then stop for a moment. I'll check it by myself.
164.1s Keys: h hint · s show me · n skip · p pace · q quit
165.0s 🧪 [student] types the step's code in index.html
167.3s ✅ Nice, that works!
169.1s ────────────────────────────────────────────────
169.1s Step 2/9 · 🧑 Your turn · Write the page
169.1s Give the page a name
169.1s 
169.1s Inside the head, add three lines: a meta tag with charset="utf-8", a title tag with the words About Me, and a link tag with rel="stylesheet" and href="style.css".
169.1s Why: meta lets emojis and accents show properly, title names the browser tab, and link will connect your style file later.
169.1s 📍 In index.html, between <head> and </head>
169.1s 
169.1s 💡 New idea · The head: The head holds information about the page, like its tab name, that visitors don't see on the page itself.
169.1s    Read more: https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/The_head_metadata_in_HTML
169.1s 
169.1s Type it in, then stop for a moment. I'll check it by myself.
169.1s Keys: h hint · s show me · n skip · p pace · q quit
169.9s 🧪 [student] types a wrong first try (a typo) in index.html
171.5s ⏳ Almost there. I can't see the line that connects your style file yet.
201.7s Want a hint? Press h.
202.2s 🧪 [student] presses h
202.2s 💡 Hint 1/3: The hidden part of the page needs three bits of info: the letter type, the tab name and a link to a style file.
203.2s 🧪 [student] presses h
203.2s 💡 Hint 2/3: Inside <head>, type a meta tag with charset="utf-8", a title tag, and a link tag with rel="stylesheet" href="style.css".
204.2s 🧪 [student] presses h
204.2s 💡 Hint 3/3:
204.2s      <meta charset="…">
204.2s      <title>…</title>
204.2s      <link rel="…" href="…">
204.2s Still stuck? Press s and I'll type it for you.
205.2s 🧪 [student] types the step's code in index.html
206.7s ✅ Nice, that works!
208.7s ────────────────────────────────────────────────
208.7s Step 3/9 · 🧑 Your turn · Write the page
208.7s Say hello
208.7s 
208.7s Inside the body, add a header. In it, put a p (paragraph) with class="avatar" holding a smiley emoji 😊, then an h1 big heading saying Hi, I'm and your name.
208.7s Why: header is the top part of your page, h1 is the biggest heading, and p holds a piece of text.
208.7s 📍 In index.html, between <body> and </body>
208.7s 
208.7s 💡 New idea · Headings and paragraphs: h1 is the biggest title on a page, and p is a normal paragraph of text.
208.7s    Read more: https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/HTML_text_fundamentals
208.7s 
208.7s Type it in, then stop for a moment. I'll check it by myself.
208.7s Keys: h hint · s show me · n skip · p pace · q quit
209.5s 🧪 [student] saves half-typed code (stops mid-tag) in index.html
211.0s ⏳ Still typing? The <header> you started still needs its closing </header> (line 9).
215.0s 🧪 [student] types the step's code in index.html
216.5s ✅ Nice, that works!
218.2s ────────────────────────────────────────────────
218.2s Step 4/9 · 🧑 Your turn · Write the page
218.2s Write about yourself
218.2s 
218.2s Under the header, add a section. Inside it, put an h2 heading saying About me and a paragraph with a sentence or two about you.
218.2s Why: A section groups related things together, and h2 is a smaller heading for each part.
218.2s 📍 In index.html, under </header>
218.2s 
218.2s 💡 New idea · Sections: A section is a box that groups one topic of your page, like a chapter in a book.
218.2s    Read more: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/section
218.2s 
218.2s Type it in, then stop for a moment. I'll check it by myself.
218.2s Keys: h hint · s show me · n skip · p pace · q quit
219.0s 🧪 [student] types the step's code in index.html
220.5s ✅ Nice, that works!
222.2s ────────────────────────────────────────────────
222.2s Step 5/9 · 👀 Watch · Write the page
222.2s See your page
222.2s 
222.2s Open index.html in your web browser (double-click it). You'll see your words, plain and simple. Next we'll add colour!
222.2s Why: Seeing your work in the browser shows that your code really makes a page.
222.2s 
222.2s Press Enter when you're ready to go on.  (n skip · q quit)
222.7s 🧪 [student] presses Enter
222.7s ────────────────────────────────────────────────
222.7s Step 6/9 · 🧑 Your turn · Add colour
222.7s Colour the background
222.7s 
222.7s Make a new file called style.css. Type a rule for body that sets background to #fff4e6 and color to #5a3e2b.
222.7s Why: background paints behind your page, and color sets the colour of the text.
222.7s 📄 First make a new file called style.css in your project folder.
222.7s 📍 In style.css, at the top
222.7s 
222.7s 💡 New idea · CSS rules: CSS picks a part of your page, then lists how it should look inside curly brackets.
222.7s    Read more: https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/CSS_basics
222.7s 
222.7s Type it in, then stop for a moment. I'll check it by myself.
222.7s Keys: h hint · s show me · n skip · p pace · q quit
223.5s 🧪 [student] types the step's code in style.css
225.2s ✅ Nice, that works!
227.2s ────────────────────────────────────────────────
227.2s Step 7/9 · 🧑 Your turn · Add colour
227.2s Choose a font and spacing
227.2s 
227.2s Inside your body rule, under the color line, add font-family: Georgia, serif; then margin: 0; then padding: 20px;
227.2s Why: font-family picks the letter style, margin is the space outside a box, and padding is the space inside it.
227.2s 📍 In style.css, under color: #5a3e2b;
227.2s 
227.2s 💡 New idea · Margin and padding: Padding is the space inside a box around its content; margin is the space outside, pushing other things away.
227.2s    Read more: https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/The_box_model
227.2s 
227.2s Type it in, then stop for a moment. I'll check it by myself.
227.2s Keys: h hint · s show me · n skip · p pace · q quit
228.0s 🧪 [student] types a wrong first try (a typo) in style.css
229.7s ⏳ Almost there. Your letters haven't changed to the Georgia style yet.
260.2s Want a hint? Press h.
260.7s 🧪 [student] presses h
260.7s 💡 Hint 1/3: Give the page a friendlier letter style and some breathing room inside the edges.
261.7s 🧪 [student] types the step's code in style.css
263.5s ✅ Nice, that works!
265.2s ────────────────────────────────────────────────
265.2s Step 8/9 · 🧑 Your turn · Add colour
265.2s Centre the greeting
265.2s 
265.2s Under the body rule, add a header rule with text-align: center; Then add a rule for .avatar with font-size: 64px; and margin: 0;
265.2s Why: text-align centres the words, and font-size makes your smiley big.
265.2s 📍 In style.css, after line 7
265.2s 
265.2s 💡 New idea · Classes: A dot before a name, like .avatar, styles only the parts you gave that class name.
265.2s    Read more: https://developer.mozilla.org/en-US/docs/Web/CSS/Class_selectors
265.2s 
265.2s Type it in, then stop for a moment. I'll check it by myself.
265.2s Keys: h hint · s show me · n skip · p pace · q quit
266.0s 🧪 [student] types the step's code in style.css
267.7s ✅ Nice, that works!
269.7s ────────────────────────────────────────────────
269.7s Step 9/9 · 👀 Watch · Shape the boxes
269.7s Admire your page
269.7s 
269.7s Go back to your browser and refresh index.html. Your warm, friendly page is finished!
269.7s Why: Refreshing shows all your colours and cards together.
269.7s 
269.7s Press Enter when you're ready to go on.  (n skip · q quit)
270.2s 🧪 [student] presses Enter
270.2s 
270.2s ════════════════════════════════════════════════
270.2s 🎉 You finished "Just a hello and an about-me"!
270.2s You made: A finished personal web page that opens in your browser straight from your project folder.
270.2s 
270.2s Your steps: 7 · on your own 5 · with hints 2 · shown 0
270.2s What you learned: Tags, The head, Headings and paragraphs, Sections, CSS rules, Margin and padding, Classes
270.2s Time: 2 min
270.2s 
270.2s Next idea: Add one more part to just a hello and an about-me (about 20 min). Use what you learned (Basic HTML page structure, Headings and paragraphs) on something new.
270.2s 💸 AI cost: $0.38 this time (6 AI calls). Saved in <tmp>/lesson/cost.json
```

## The student's finished files

`index.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>About Me</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <p class="avatar">😊</p>
    <h1>Hi, I'm Sam!</h1>
  </header>
  <section>
    <h2>About me</h2>
    <p>I love learning new things, drinking hot cocoa and spending time with friends. This is my very own little corner of the web.</p>
  </section>
</body>
</html>
```

`style.css`

```css
body {
  background: #fff4e6;
  color: #5a3e2b;
  font-family: Georgia, serif;
  margin: 0;
  padding: 20px;
}

header {
  text-align: center;
}

.avatar {
  font-size: 64px;
  margin: 0;
}
```

## Saved progress (`.stride/idea-a-page-about-me-891eaef8-core.json`)

```json
{
  "lessonId": "idea-a-page-about-me-891eaef8-core",
  "stepIndex": 9,
  "steps": {
    "skeleton": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:45:03.062Z",
      "doneAt": "2026-10-29T06:45:06.215Z"
    },
    "head-info": {
      "status": "hinted",
      "hintsUsed": 3,
      "startedAt": "2026-10-29T06:45:08.064Z",
      "doneAt": "2026-10-29T06:45:45.657Z"
    },
    "header": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:45:47.579Z",
      "doneAt": "2026-10-29T06:45:55.418Z"
    },
    "about": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:45:57.082Z",
      "doneAt": "2026-10-29T06:45:59.411Z"
    },
    "look-page": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:46:01.085Z",
      "doneAt": "2026-10-29T06:46:01.591Z"
    },
    "body-colours": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:46:01.591Z",
      "doneAt": "2026-10-29T06:46:04.146Z"
    },
    "body-font": {
      "status": "hinted",
      "hintsUsed": 1,
      "startedAt": "2026-10-29T06:46:06.087Z",
      "doneAt": "2026-10-29T06:46:42.400Z"
    },
    "header-style": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:46:44.102Z",
      "doneAt": "2026-10-29T06:46:46.619Z"
    },
    "look-final": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:46:48.604Z",
      "doneAt": "2026-10-29T06:46:49.117Z"
    }
  },
  "pace": "learn",
  "updatedAt": "2026-10-29T06:46:49.117Z"
}
```

## cost.json

```json
{
  "entries": [
    {
      "at": "2026-10-29T06:42:29.648Z",
      "job": "project",
      "model": "claude-opus-5-5",
      "inputTokens": 1192,
      "outputTokens": 866,
      "usd": 0.022088
    },
    {
      "at": "2026-10-29T06:44:41.136Z",
      "job": "steps",
      "model": "claude-opus-5-5",
      "inputTokens": 5323,
      "outputTokens": 15130,
      "usd": 0.323892
    },
    {
      "at": "2026-10-29T06:44:42.374Z",
      "job": "check",
      "model": "claude-haiku-5-5",
      "inputTokens": 625,
      "outputTokens": 66,
      "usd": 0.0000955
    },
    {
      "at": "2026-10-29T06:44:56.639Z",
      "job": "fixChecks",
      "model": "claude-opus-5-5",
      "inputTokens": 3574,
      "outputTokens": 471,
      "usd": 0.023716
    },
    {
      "at": "2026-10-29T06:45:02.713Z",
      "job": "simpler",
      "model": "claude-opus-5-5",
      "inputTokens": 715,
      "outputTokens": 324,
      "usd": 0.00934
    },
    {
      "at": "2026-10-29T06:45:06.215Z",
      "job": "check",
      "model": "claude-haiku-5-5",
      "inputTokens": 625,
      "outputTokens": 66,
      "usd": 0.0000955
    }
  ],
  "total": {
    "calls": 6,
    "inputTokens": 12054,
    "outputTokens": 16923,
    "usd": 0.3792270000000001
  }
}
```

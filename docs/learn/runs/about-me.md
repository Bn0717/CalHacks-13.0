# Terminal lesson run: "a page about me"

> **Note:** this lesson came from the hand-written fixture `tests/learn/fixtures/about-me.lesson.json`, because
> `ANTHROPIC_API_KEY` was missing in the cloud session, so the real-AI lesson build couldn't run. **The real-AI run
> (`npm run learn -- "a page about me"` with the key set) is still to do.** Everything else below is real: the terminal
> CLI (`src/cli/learn.ts`), the lesson runner, the checker with the hidden Chromium render, the folder watcher, progress
> saving and the cost log. Only the student is pretend: `scripts/learn-simulate.ts` writes each 🧑 step's `expected`
> code into the file at its anchor, with a wrong first try on two steps (to bring out the hints), an almost-right try
> on one (so the hidden browser looks twice) and a half-typed save on one step (to show half-typed code isn't called
> wrong). No AI call was made, so the cost is $0; hint level 3
> (Haiku) wasn't needed because this lesson has no `ai` checks.

Run: `npx tsx scripts/learn-simulate.ts tests/learn/fixtures/about-me.lesson.json docs/learn/runs/about-me.md` on 2026-10-29.

## Result

- CLI exit code: 0
- 🧑 steps typed: 5, wrong first tries: 3, half-typed saves: 1, hints shown: 3
- Finished files match the lesson's reference project: yes
- ✅ came this long after the student's last write (no key pressed): skeleton 1.51 s, intro 1.50 s, hobbies 1.51 s, link-css 1.50 s, style 1.68 s
  (1.5 s of quiet time, then the look itself. The first look that opens the hidden browser to try the page also
  starts that browser, about 0.7 s once per lesson; after that a look in the browser takes about 0.2 s.)
- Total time: 59 s

## Transcript

Seconds since start on the left. Lines marked 🧪 are the pretend student; everything else is what the CLI printed.

```text
  1.2s 
  1.2s 📚 A page about me
  1.2s Build a one-page website with your name, a short intro and a list of things you like, then add a splash of colour.
  1.2s 
  1.2s ⏱  About 26 minutes · you'll type about 28 lines · 6 steps
  1.2s 🧠 You'll learn: the parts of an HTML page, headings, paragraphs and lists, linking a CSS file, changing colours and fonts with CSS
  1.2s 🎯 At the end: A web page about you that opens in any browser.
  1.2s 
  1.5s 🧪 [student] presses Enter
  1.5s Press Enter to start (or type q to stop): 
  1.5s 📁 Your project folder: <tmp>/about-me
  1.5s Open it in VS Code (or any code editor) and keep this window next to it. Save your file and I'll check it.
  1.5s ────────────────────────────────────────────────
  1.5s Step 1/6 · 🤖 Stride · Get ready
  1.5s Open VS Code
  1.5s 
  1.5s Stride opens VS Code, where you'll write your page.
  1.5s Why: VS Code is where you type code and see mistakes underlined.
  1.5s 
  1.5s 🤖 Stride would do this on the Mac app. Skipping it here.
  1.5s ────────────────────────────────────────────────
  1.5s Step 2/6 · 🧑 Your turn · Write the page
  1.5s The page skeleton
  1.5s 
  1.5s In index.html, type the basic parts every web page has: the doctype, <html>, <head> with a <title>, and an empty <body>.
  1.5s Why: Browsers need this skeleton to know it's a web page.
  1.5s 📍 In index.html, at the top
  1.5s 
  1.5s 💡 New idea · The parts of an HTML page: The <head> holds facts about the page, like its title, and the <body> holds everything people see.
  1.5s    Read more: https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/Getting_started
  1.5s 
  1.5s Type it in, then stop for a moment. I'll check it by myself.
  1.5s Keys: h hint · s show me · n skip · p pace · q quit
  2.4s 🧪 [student] types the step's code in index.html
  3.9s ✅ Nice, that works!
  5.5s ────────────────────────────────────────────────
  5.5s Step 3/6 · 🧑 Your turn · Write the page
  5.5s Say hi
  5.5s 
  5.5s Inside <body>, add a big heading with your name and two short paragraphs about you.
  5.5s Why: The heading is the first thing visitors read.
  5.5s 📍 In index.html, between <body> and </body>
  5.5s 
  5.5s 💡 New idea · Headings and paragraphs: An <h1> is the big heading at the top of a page, and each <p> is one paragraph of text.
  5.5s    Read more: https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/HTML_text_fundamentals
  5.5s 
  5.5s Type it in, then stop for a moment. I'll check it by myself.
  5.5s Keys: h hint · s show me · n skip · p pace · q quit
  6.3s 🧪 [student] types a wrong first try in index.html
  7.9s 🤔 I can't see a big heading (<h1>) inside the page yet.
 18.0s    What's wrong: I can't see a big heading (<h1>) inside the page yet.
 18.0s 💡 Hint 1/3: A big heading uses the <h1> tag.
 19.0s 🧪 [student] types the step's code in index.html
 20.6s ✅ Nice, that works!
 22.5s ────────────────────────────────────────────────
 22.5s Step 4/6 · 🧑 Your turn · Write the page
 22.5s Things you like
 22.5s 
 22.5s Under your paragraphs, add a smaller heading and a list of 3 things you like.
 22.5s Why: Lists keep related things together and easy to scan.
 22.5s 📍 In index.html, between <body> and </body>
 22.5s 
 22.5s 💡 New idea · Lists: A <ul> makes a bullet list, and each thing in it goes inside its own <li> (list item).
 22.5s    Read more: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ul
 22.5s 
 22.5s Type it in, then stop for a moment. I'll check it by myself.
 22.5s Keys: h hint · s show me · n skip · p pace · q quit
 23.4s 🧪 [student] saves half-typed code (stops mid-tag) in index.html
 24.9s ⏳ Still typing? A tag isn't finished yet (line 15).
 28.9s 🧪 [student] types the step's code in index.html
 30.4s ✅ Nice, that works!
 32.1s ────────────────────────────────────────────────
 32.1s Step 5/6 · 🧑 Your turn · Make it look nice
 32.1s Finish the head
 32.1s 
 32.1s In the <head>, under the <title>, add a short description of the page, a line that makes it fit phone screens, and a <link> that points to style.css.
 32.1s Why: This tells the page where its colours and fonts live.
 32.1s 📍 In index.html, under </title>
 32.1s 
 32.1s 💡 New idea · Linking CSS: A <link> in the <head> connects your page to a CSS file, which says how the page looks.
 32.1s    Read more: https://developer.mozilla.org/en-US/docs/Learn/CSS/First_steps
 32.1s 
 32.1s Type it in, then stop for a moment. I'll check it by myself.
 32.1s Keys: h hint · s show me · n skip · p pace · q quit
 32.9s 🧪 [student] types a wrong first try in index.html
 34.4s 🤔 I can't see a description line (<meta name="description">) yet.
 44.6s    What's wrong: I can't see a description line (<meta name="description">) yet.
 44.6s 💡 Hint 1/3: The <head> needs three new lines: two <meta> lines and a <link>.
 45.1s 🧪 [student] presses h
 45.1s 💡 Hint 2/3: One <meta> has name="description", the other has name="viewport", and the <link> needs rel="stylesheet" and an href.
 46.1s 🧪 [student] types the step's code in index.html
 47.6s ✅ Nice, that works!
 49.6s ────────────────────────────────────────────────
 49.6s Step 6/6 · 🧑 Your turn · Make it look nice
 49.6s Add some colour
 49.6s 
 49.6s In style.css, give the page a clean font and some space, and make your heading tomato red.
 49.6s Why: A few lines of CSS make the page feel like yours.
 49.6s 📄 First make a new file called style.css in your project folder.
 49.6s 📍 In style.css, at the top
 49.6s 
 49.6s Type it in, then stop for a moment. I'll check it by myself.
 49.6s Keys: h hint · s show me · n skip · p pace · q quit
 50.4s 🧪 [student] types an almost-right first try (the wrong colour) in style.css
 52.9s 🤔 Almost there. The big heading (<h1>) doesn't have the right text colour yet.
 54.9s 🧪 [student] types the step's code in style.css
 56.6s ✅ Nice, that works!
 56.6s ❓ Quick question (just for fun): Which tag connects a CSS file to your page?
 56.6s   1) <style>
 56.6s   2) <link>
 56.6s   3) <css>
 57.1s 🧪 [student] presses 2
 57.1s 🎯 Yes! <link rel="stylesheet"> loads a separate CSS file.
 58.5s 
 58.5s ════════════════════════════════════════════════
 58.5s 🎉 You finished "A page about me"!
 58.5s You made: A web page about you that opens in any browser.
 58.5s 
 58.5s Your steps: 5 · on your own 3 · with hints 2 · shown 0
 58.5s What you learned: The parts of an HTML page, Headings and paragraphs, Lists, Linking CSS
 58.5s Time: 1 min
 58.5s 
 58.5s Next idea: Add one more part to a page about me (about 20 min). Use what you learned (the parts of an HTML page, headings, paragraphs and lists) on something new.
 58.5s 💸 AI cost: $0 (no AI calls). Saved in <tmp>/about-me/cost.json
```

## The student's finished files

`index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>About Me</title>
    <meta name="description" content="A page about me, Sam.">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <h1>Hi, I'm Sam</h1>
    <p>I'm learning to make websites.</p>
    <p>This page is all about me.</p>
    <h2>Things I like</h2>
    <ul>
      <li>Drawing</li>
      <li>Basketball</li>
      <li>Cooking</li>
    </ul>
  </body>
</html>
```

`style.css`

```css
body {
  font-family: Arial, sans-serif;
  margin: 40px;
}

h1 {
  color: tomato;
}
```

## Saved progress (`.stride/about-me.json`)

```json
{
  "lessonId": "about-me",
  "stepIndex": 6,
  "steps": {
    "open-editor": {
      "status": "skipped",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:41:59.443Z",
      "doneAt": "2026-10-29T06:41:59.447Z"
    },
    "skeleton": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:41:59.447Z",
      "doneAt": "2026-10-29T06:42:01.799Z"
    },
    "intro": {
      "status": "hinted",
      "hintsUsed": 1,
      "startedAt": "2026-10-29T06:42:03.445Z",
      "doneAt": "2026-10-29T06:42:18.472Z"
    },
    "hobbies": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:42:20.456Z",
      "doneAt": "2026-10-29T06:42:28.320Z"
    },
    "link-css": {
      "status": "hinted",
      "hintsUsed": 2,
      "startedAt": "2026-10-29T06:42:29.964Z",
      "doneAt": "2026-10-29T06:42:45.550Z"
    },
    "style": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T06:42:47.472Z",
      "doneAt": "2026-10-29T06:42:54.530Z"
    }
  },
  "pace": "learn",
  "updatedAt": "2026-10-29T06:42:56.417Z"
}
```

## cost.json

```json
{
  "entries": [],
  "total": {
    "calls": 0,
    "inputTokens": 0,
    "outputTokens": 0,
    "usd": 0
  }
}
```

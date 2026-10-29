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
- ✅ came this long after the student's last write (no key pressed): skeleton 1.51 s, intro 1.51 s, hobbies 1.68 s, link-css 1.50 s, style 1.65 s
  (1.5 s of quiet time, then the look itself. The first look that opens the hidden browser to try the page also
  starts that browser, about 0.7 s once per lesson; after that a look in the browser takes about 0.2 s.)
- Total time: 59 s

## Transcript

Seconds since start on the left. Lines marked 🧪 are the pretend student; everything else is what the CLI printed.

```text
  1.1s 
  1.1s 📚 A page about me
  1.1s Build a one-page website with your name, a short intro and a list of things you like, then add a splash of colour.
  1.1s 
  1.1s ⏱  About 22 minutes · you'll type about 25 lines · 6 steps
  1.1s 🧠 You'll learn: the parts of an HTML page, headings, paragraphs and lists, linking a CSS file, changing colours and fonts with CSS
  1.1s 🎯 At the end: A web page about you that opens in any browser.
  1.1s 
  1.4s 🧪 [student] presses Enter
  1.4s Press Enter to start (or type q to stop): 
  1.4s 📁 Your project folder: <tmp>/about-me
  1.4s Open it in VS Code (or any code editor) and keep this window next to it. Save your file and I'll check it.
  1.4s ────────────────────────────────────────────────
  1.4s Step 1/6 · 🤖 Stride · Get ready
  1.4s Open VS Code
  1.4s 
  1.4s Stride opens VS Code, where you'll write your page.
  1.4s Why: VS Code is where you type code and see mistakes underlined.
  1.4s 
  1.4s 🤖 Stride would do this on the Mac app. Skipping it here.
  1.4s ────────────────────────────────────────────────
  1.4s Step 2/6 · 🧑 Your turn · Write the page
  1.4s The page skeleton
  1.4s 
  1.4s In index.html, type the basic parts every web page has: the doctype, <html>, <head> with a <title>, and an empty <body>.
  1.4s Why: Browsers need this skeleton to know it's a web page.
  1.4s 📍 In index.html, at the top
  1.4s 
  1.4s 💡 New idea · The parts of an HTML page: The <head> holds information about the page, like its title. The <body> holds what people see.
  1.4s    Read more: https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/Getting_started
  1.4s 
  1.4s Type it in, then stop for a moment. I'll check it by myself.
  1.4s Keys: h hint · s show me · n skip · p pace · q quit
  2.3s 🧪 [student] types the step's code in index.html
  3.8s ✅ Nice, that works!
  5.4s ────────────────────────────────────────────────
  5.4s Step 3/6 · 🧑 Your turn · Write the page
  5.4s Say hi
  5.4s 
  5.4s Inside <body>, add a big heading with your name and a short paragraph about you.
  5.4s Why: The heading is the first thing visitors read.
  5.4s 📍 In index.html, between <body> and </body>
  5.4s 
  5.4s Type it in, then stop for a moment. I'll check it by myself.
  5.4s Keys: h hint · s show me · n skip · p pace · q quit
  6.2s 🧪 [student] types a wrong first try in index.html
  7.7s 🤔 I can't find "body h1" yet.
 17.9s 💡 Hint 1/3: A big heading uses the <h1> tag.
 19.0s 🧪 [student] types the step's code in index.html
 20.5s ✅ Nice, that works!
 22.4s ────────────────────────────────────────────────
 22.4s Step 4/6 · 🧑 Your turn · Write the page
 22.4s Things you like
 22.4s 
 22.4s Under your paragraph, add a smaller heading and a list of 3 things you like.
 22.4s Why: Lists keep related things together and easy to scan.
 22.4s 📍 In index.html, under </p>
 22.4s 
 22.4s 💡 New idea · Lists: <ul> makes a bullet list. Each thing in it goes in its own <li> (list item).
 22.4s    Read more: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ul
 22.4s 
 22.4s Type it in, then stop for a moment. I'll check it by myself.
 22.4s Keys: h hint · s show me · n skip · p pace · q quit
 23.2s 🧪 [student] saves half-typed code (stops mid-tag) in index.html
 24.8s ⏳ Still typing? A tag isn't finished yet (line 14).
 28.8s 🧪 [student] types the step's code in index.html
 30.4s ✅ Nice, that works!
 32.4s ────────────────────────────────────────────────
 32.4s Step 5/6 · 🧑 Your turn · Make it look nice
 32.4s Connect a style file
 32.4s 
 32.4s In the <head>, under the <title>, add a <link> that points to style.css.
 32.4s Why: This tells the page where its colours and fonts live.
 32.4s 📍 In index.html, under </title>
 32.4s 
 32.4s 💡 New idea · Linking CSS: CSS is a separate file that says how the page looks. <link> connects it to the HTML.
 32.4s    Read more: https://developer.mozilla.org/en-US/docs/Learn/CSS/First_steps
 32.4s 
 32.4s Type it in, then stop for a moment. I'll check it by myself.
 32.4s Keys: h hint · s show me · n skip · p pace · q quit
 33.3s 🧪 [student] types a wrong first try in index.html
 34.8s 🤔 I can't find "head link" yet.
 45.0s 💡 Hint 1/3: Styles are connected with a <link> tag in the <head>.
 45.5s 🧪 [student] presses h
 45.5s 💡 Hint 2/3: The <link> needs rel="stylesheet" and an href.
 46.5s 🧪 [student] types the step's code in index.html
 48.0s ✅ Nice, that works!
 50.0s ────────────────────────────────────────────────
 50.0s Step 6/6 · 🧑 Your turn · Make it look nice
 50.0s Add some colour
 50.0s 
 50.0s In style.css, give the page a clean font and some space, and make your heading tomato red.
 50.0s Why: A few lines of CSS make the page feel like yours.
 50.0s 📄 First make a new file called style.css in your project folder.
 50.0s 📍 In style.css, at the top
 50.0s 
 50.0s Type it in, then stop for a moment. I'll check it by myself.
 50.0s Keys: h hint · s show me · n skip · p pace · q quit
 50.8s 🧪 [student] types an almost-right first try (the wrong colour) in style.css
 53.3s ⏳ Almost there. "h1" doesn't have the right color yet.
 55.3s 🧪 [student] types the step's code in style.css
 56.9s ✅ Nice, that works!
 56.9s ❓ Quick question (just for fun): Which tag connects a CSS file to your page?
 56.9s   1) <style>
 56.9s   2) <link>
 56.9s   3) <css>
 57.4s 🧪 [student] presses 2
 57.4s 🎯 Yes! <link rel="stylesheet"> loads a separate CSS file.
 58.8s 
 58.8s ════════════════════════════════════════════════
 58.8s 🎉 You finished "A page about me"!
 58.8s You made: A web page about you that opens in any browser.
 58.8s 
 58.8s Your steps: 5 · on your own 3 · with hints 2 · shown 0
 58.8s What you learned: The parts of an HTML page, Lists, Linking CSS
 58.8s Time: 1 min
 58.8s 
 58.8s Next idea: Add one more part to a page about me (about 20 min). Use what you learned (the parts of an HTML page, headings, paragraphs and lists) on something new.
 58.8s 💸 AI cost: $0 (no AI calls). Saved in <tmp>/about-me/cost.json
```

## The student's finished files

`index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>About Me</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <h1>Hi, I'm Sam</h1>
    <p>I'm learning to make websites.</p>
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
      "startedAt": "2026-10-29T05:47:14.274Z",
      "doneAt": "2026-10-29T05:47:14.278Z"
    },
    "skeleton": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T05:47:14.278Z",
      "doneAt": "2026-10-29T05:47:16.631Z"
    },
    "intro": {
      "status": "hinted",
      "hintsUsed": 1,
      "startedAt": "2026-10-29T05:47:18.278Z",
      "doneAt": "2026-10-29T05:47:33.339Z"
    },
    "hobbies": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T05:47:35.289Z",
      "doneAt": "2026-10-29T05:47:43.298Z"
    },
    "link-css": {
      "status": "hinted",
      "hintsUsed": 2,
      "startedAt": "2026-10-29T05:47:45.297Z",
      "doneAt": "2026-10-29T05:48:00.896Z"
    },
    "style": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T05:48:02.805Z",
      "doneAt": "2026-10-29T05:48:09.792Z"
    }
  },
  "pace": "learn",
  "updatedAt": "2026-10-29T05:48:11.693Z"
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

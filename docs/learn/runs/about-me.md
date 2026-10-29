# Terminal lesson run: "a page about me"

> **Note:** this lesson came from the hand-written fixture `tests/learn/fixtures/about-me.lesson.json`, because
> `ANTHROPIC_API_KEY` was missing in the cloud session, so the real-AI lesson build couldn't run. **The real-AI run
> (`npm run learn -- "a page about me"` with the key set) is still to do.** Everything else below is real: the terminal
> CLI (`src/cli/learn.ts`), the lesson runner, the checker with the hidden Chromium render, the folder watcher, progress
> saving and the cost log. Only the student is pretend: `scripts/learn-simulate.ts` writes each 🧑 step's `expected`
> code into the file at its anchor, with a wrong first try on two steps (to bring out the hints) and a half-typed save
> on one step (to show half-typed code isn't called wrong). No AI call was made, so the cost is $0; hint level 3
> (Haiku) wasn't needed because this lesson has no `ai` checks.

Run: `npx tsx scripts/learn-simulate.ts tests/learn/fixtures/about-me.lesson.json docs/learn/runs/about-me.md` on 2026-10-29.

## Result

- CLI exit code: 0
- 🧑 steps typed: 5, wrong first tries: 2, half-typed saves: 1, hints shown: 3
- Finished files match the lesson's reference project: yes
- Total time: 64 s

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
  1.5s 💡 New idea · The parts of an HTML page: The <head> holds information about the page, like its title. The <body> holds what people see.
  1.5s    Read more: https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/Getting_started
  1.5s 
  1.5s Type it in, then stop for a moment. I'll check it by myself.
  1.5s Keys: h hint · s show me · n skip · p pace · q quit
  2.3s 🧪 [student] types the step's code in index.html
  5.0s ✅ Nice, that works!
  7.0s ────────────────────────────────────────────────
  7.0s Step 3/6 · 🧑 Your turn · Write the page
  7.0s Say hi
  7.0s 
  7.0s Inside <body>, add a big heading with your name and a short paragraph about you.
  7.0s Why: The heading is the first thing visitors read.
  7.0s 📍 In index.html, between <body> and </body>
  7.0s 
  7.0s Type it in, then stop for a moment. I'll check it by myself.
  7.0s Keys: h hint · s show me · n skip · p pace · q quit
  7.8s 🧪 [student] types a wrong first try in index.html
 10.5s 🤔 I can't find "body h1" yet.
 20.5s 💡 Hint 1/3: A big heading uses the <h1> tag.
 21.5s 🧪 [student] types the step's code in index.html
 24.0s ✅ Nice, that works!
 26.0s ────────────────────────────────────────────────
 26.0s Step 4/6 · 🧑 Your turn · Write the page
 26.0s Things you like
 26.0s 
 26.0s Under your paragraph, add a smaller heading and a list of 3 things you like.
 26.0s Why: Lists keep related things together and easy to scan.
 26.0s 📍 In index.html, under </p>
 26.0s 
 26.0s 💡 New idea · Lists: <ul> makes a bullet list. Each thing in it goes in its own <li> (list item).
 26.0s    Read more: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ul
 26.0s 
 26.0s Type it in, then stop for a moment. I'll check it by myself.
 26.0s Keys: h hint · s show me · n skip · p pace · q quit
 26.8s 🧪 [student] saves half-typed code (stops mid-tag) in index.html
 29.5s ⏳ Still typing? A tag isn't finished yet (line 14).
 33.6s 🧪 [student] types the step's code in index.html
 36.0s ✅ Nice, that works!
 38.0s ────────────────────────────────────────────────
 38.0s Step 5/6 · 🧑 Your turn · Make it look nice
 38.0s Connect a style file
 38.0s 
 38.0s In the <head>, under the <title>, add a <link> that points to style.css.
 38.0s Why: This tells the page where its colours and fonts live.
 38.0s 📍 In index.html, under </title>
 38.0s 
 38.0s 💡 New idea · Linking CSS: CSS is a separate file that says how the page looks. <link> connects it to the HTML.
 38.0s    Read more: https://developer.mozilla.org/en-US/docs/Learn/CSS/First_steps
 38.0s 
 38.0s Type it in, then stop for a moment. I'll check it by myself.
 38.0s Keys: h hint · s show me · n skip · p pace · q quit
 38.8s 🧪 [student] types a wrong first try in index.html
 41.5s 🤔 I can't find "head link" yet.
 51.5s 💡 Hint 1/3: Styles are connected with a <link> tag in the <head>.
 52.0s 🧪 [student] presses h
 52.0s 💡 Hint 2/3: The <link> needs rel="stylesheet" and an href.
 53.1s 🧪 [student] types the step's code in index.html
 55.5s ✅ Nice, that works!
 57.5s ────────────────────────────────────────────────
 57.5s Step 6/6 · 🧑 Your turn · Make it look nice
 57.5s Add some colour
 57.5s 
 57.5s In style.css, give the page a clean font and some space, and make your heading tomato red.
 57.5s Why: A few lines of CSS make the page feel like yours.
 57.5s 📄 First make a new file called style.css in your project folder.
 57.5s 📍 In style.css, at the top
 57.5s 
 57.5s Type it in, then stop for a moment. I'll check it by myself.
 57.5s Keys: h hint · s show me · n skip · p pace · q quit
 58.3s 🧪 [student] types the step's code in style.css
 61.9s ✅ Nice, that works!
 61.9s ❓ Quick question (just for fun): Which tag connects a CSS file to your page?
 61.9s   1) <style>
 61.9s   2) <link>
 61.9s   3) <css>
 62.5s 🧪 [student] presses 2
 62.5s 🎯 Yes! <link rel="stylesheet"> loads a separate CSS file.
 63.6s 
 63.6s ════════════════════════════════════════════════
 63.6s 🎉 You finished "A page about me"!
 63.6s You made: A web page about you that opens in any browser.
 63.6s 
 63.6s Your steps: 5 · on your own 3 · with hints 2 · shown 0
 63.6s What you learned: The parts of an HTML page, Lists, Linking CSS
 63.6s Time: 1 min
 63.6s 
 63.6s Next idea: Add one more part to a page about me (about 20 min). Use what you learned (the parts of an HTML page, headings, paragraphs and lists) on something new.
 63.6s 💸 AI cost: $0 (no AI calls). Saved in <tmp>/about-me/cost.json
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
      "startedAt": "2026-10-29T05:05:35.749Z",
      "doneAt": "2026-10-29T05:05:35.754Z"
    },
    "skeleton": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T05:05:35.754Z",
      "doneAt": "2026-10-29T05:05:39.261Z"
    },
    "intro": {
      "status": "hinted",
      "hintsUsed": 1,
      "startedAt": "2026-10-29T05:05:41.252Z",
      "doneAt": "2026-10-29T05:05:58.264Z"
    },
    "hobbies": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T05:06:00.262Z",
      "doneAt": "2026-10-29T05:06:10.271Z"
    },
    "link-css": {
      "status": "hinted",
      "hintsUsed": 2,
      "startedAt": "2026-10-29T05:06:12.270Z",
      "doneAt": "2026-10-29T05:06:29.776Z"
    },
    "style": {
      "status": "done",
      "hintsUsed": 0,
      "startedAt": "2026-10-29T05:06:31.774Z",
      "doneAt": "2026-10-29T05:06:36.184Z"
    }
  },
  "pace": "learn",
  "updatedAt": "2026-10-29T05:06:37.810Z"
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

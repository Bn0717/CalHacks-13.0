# CalHack 🛡️

**Something on your Mac isn't working? Press ⌃⌥⌘D, or just say what's wrong. CalHack fixes it safely and shows you proof that it worked.**

It's built for people who aren't technical, like a parent who would otherwise call their kids for help.

## What it can do

- **"My printer won't print"**: finds the stuck jobs, fixes them, then shows **Before: Paused → After: Ready**.
- **"The sound is coming out of my AirPods"**: switches it back to the Mac's speakers.
- **"I can't find my resume"**: finds the file and shows it in Finder.
- **"Uninstall Zoom"**: closes Zoom and moves it to the Trash, so you can still get it back.
- **A how-to page or IT email**: follows the steps for you and skips anything unsafe.
- **Scams**: warns you about fake "verify you're human" pages and stops dangerous copied commands.
- **"Delete all my files"**: refuses, explains why and offers a safe option instead.

## Tech stack

| Technology | What it does in CalHack |
|---|---|
| **TypeScript + Node.js 22** | The language and runtime the whole app is written in. |
| **Electron** | Runs the desktop app: the menu bar icon, the helper bar and Stride, the red mascot. |
| **Claude (Anthropic SDK)** | The brain. It works out what's wrong, plans the fix, reads how-to pages and writes the final "here's what I did" summary. A separate Claude call checks the work. |
| **Factory Droid SDK** | The hands. It runs each approved command on the Mac, and only that command, behind our safety gate. It also judges whether a page is a scam. |
| **TypeSafe Jev** *(optional)* | Picks the next button to click and finds it on the screen. Claude Haiku takes over if Jev isn't set up. |
| **Swift + macOS APIs** | Small helper programs that talk to the Mac directly. **Accessibility** reads and clicks buttons by name, **ScreenCaptureKit** takes screenshots that leave out CalHack's own windows, and **CoreAudio** switches sound outputs. |
| **AppleScript** | Adds Calendar events and reads the address of the page open in Safari or Chrome. |
| **Playwright** | Fills in and submits web forms (like a clinic check-in) in a separate Chrome window. |
| **whisper.cpp** | Turns your voice into text, on your Mac. |
| **Kokoro** | Reads CalHack's answers out loud with a natural voice, on your Mac. |
| **pdf.js** | Reads the text of PDF guides. |
| **sharp** | Shrinks and crops screenshots before they're checked. |
| **Zod** | Makes sure every AI answer has the right shape before our code uses it. |
| **shell-quote** | Splits commands into parts so the safety rules can check each one. |
| **Vitest** | Runs the test suite (295+ tests). |

## How it works

1. **Look:** CalHack checks the Mac (and the screen, if needed) to find the problem.
2. **Check it's safe:** our code, not the AI, rates every step. Dangerous steps are refused and risky ones ask you first.
3. **Act:** Droid runs only the steps that passed.
4. **Prove it:** CalHack checks again and shows what changed. If it can't prove the fix worked, it tells you.

Everything can be undone: files go to the Trash, never deleted outright.

## Setup

You need a Mac and Node.js 22 or later.

```bash
npm install
cp .env.example .env
```

Then put your keys in `.env`:

- `ANTHROPIC_API_KEY`: required, from console.anthropic.com
- `FACTORY_API_KEY`: for Droid, from app.factory.ai. Without it, CalHack runs the steps itself.
- `TYPESAFE_API_KEY`: optional, for Jev

To use Droid, also install it with `brew install --cask droid`.

## Run

Open two terminal windows:

```bash
npm run demo:pages   # demo pages at http://localhost:4321
npm start            # the app (🛡️ appears in the menu bar)
```

The first time it runs, macOS asks for **Screen Recording**, **Accessibility** and **Automation** permissions. Allow them, then restart the app.

## Test

```bash
npm test
```

## Learn more

[docs/DETAILS.md](docs/DETAILS.md) explains the safety rules, how Droid is used, the demo script and the benchmarks.

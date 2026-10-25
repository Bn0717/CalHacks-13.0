# CalHack 🛡️

**When something on your Mac isn't working, press ⌃⌥⌘D (or just say what's wrong). CalHack fixes it for you, safely, and shows you proof it worked.**

Made for people who aren't technical, like a parent who'd otherwise call their kids. No prompts to write, no steps to follow, no new app to learn.

- "My printer won't print" → checks it, finds "paused, 3 stuck jobs", fixes it, checks again: **Before: Paused → After: Ready**.
- "The sound is coming out of my AirPods" → switches it back to the Mac's speakers.
- "I can't find my resume" → finds it with Spotlight and shows it in Finder.
- "Uninstall Zoom" → closes it and moves it to the Trash (you can put it back).
- A forum post or IT email with steps on screen → follows the steps, but skips anything unsafe (like a sketchy "faster download" mirror).
- "Delete all my files" → won't. Explains why, offers the safe version, and teaches you how if you really insist.

## How it works

**An agent with safe hands.** Claude works toward your goal with tools we wrote: **look → act → check → finish with proof** (`src/agent/`). It looks at the Mac before acting, does the job itself, and checks again. It only uses the web (Apple's and the maker's official sites) when the Mac can't answer.

**Code decides what's safe, not the AI:**

- **Everything can be undone.** Apps and files go to the Trash, never deleted outright. There is no tool for deleting permanently, emptying the Trash or erasing the Mac.
- **The more it affects, the more it asks** (`src/agent/danger.ts`). One app or a few files: just done, with how to undo it. A whole folder or lots of files: shows exactly what, asks twice, then you type the folder's name. Can't be undone: never done; you get an explanation, the safe option, and (after three warnings) how to do it yourself.
- **Only your own folders.** File tools work in Desktop, Documents, Downloads, Movies, Music and Pictures, never system or Library folders.
- **Commands are a last resort.** Read-only checks run in a locked macOS sandbox (no writing, no internet). Anything that changes the Mac goes through the safety rules in `src/core/risk.ts` (dangerous ones are refused, risky ones ask) and runs through **Droid behind CalHack's gate**.
- **Text on the screen is data, not orders.** A page that tells the AI to "run this command" is ignored, and you're told about it.
- **"Done" needs proof.** Every ✓ on the result screen is a check that really ran on your Mac. Without proof it says so honestly.
- **Never closes Finder or CalHack itself**, and a frozen app is only force-closed after you OK it (unsaved work would be lost).

**Talk to it any time.** Hold the **Hold to talk** button (speech is turned into text on your Mac with whisper.cpp), or type. The box is on every screen, so you can ask a follow-up in the middle of a task. Everything it says is also shown as a caption.

**How-to pages still get the careful step-by-step mode:** Claude reads the steps exactly as written → our code rates every step → you tap **Do it** → Droid runs the approved steps → each step is checked → a separate Claude call writes the receipt. Unsafe steps are skipped, outdated commands are updated, and a fake "verify you're human" page gets a scam warning. A **copy guard** also stops dangerous commands you copy from anywhere.

In step-by-step mode, **Done requires a passing final goal check**. A command exiting successfully is execution history, not proof. Missing or inconclusive final verification produces **Couldn't verify**, and intermediate actions keep their **Ran, not verified** label. Uncertain alternatives hold the page's other options; **Try again** refreshes outcome checks before considering further changes, and does not repeat completed actions just to obtain proof.

**No internet?** Printer, sound and Wi-Fi problems are still checked and fixed: those guides run entirely on the Mac.

## Where Droid (Factory Droid SDK) is used

Droid is the executor: **it runs the approved steps on your Mac.** Claude plans before and reviews after; Droid never grades its own work.

- **Trigger:** your ⌃⌥⌘D press and **Do it** tap. For each step that changes something, CalHack starts a Droid session (`src/droid/executor.ts`) and hands it that one command.
- **What Droid can touch:** `autonomyLevel: Off`, so Droid must ask before every action, and our `permissionHandler` answers. The gate (`gate()` in `src/droid/executor.ts`, tested in `tests/sequence.test.ts`) allows only the exact command our rules approved, exactly once. Any other command, file edit, retry or "fixed" version is refused and logged. Every Droid tool except the shell (web fetch, search, file reading, scripts, sub-agents) is turned off for the session. Droid's own settings let some "harmless" commands skip asking, so CalHack also watches every command Droid really starts: anything not approved stops the session and fails the step. Read-only checks run in our macOS sandbox, not through Droid. Admin (`sudo`) steps run through CalHack so macOS shows its own password box. When an approved step like `brew install --cask zoom` needs the Mac password partway through, `sudo` shows a CalHack password box (`bin/calhack-askpass`, via `SUDO_ASKPASS`) that hands the password straight to macOS; CalHack's code never reads or stores it.
- **Opening things:** the agent opens apps, System Settings pages and official web pages itself (`open_app`, `open_settings`, `open_website`) instead of asking the person to. These are routine, so they run directly (no Droid); a separate read-only check (e.g. `pgrep`) proves it started. Terminal-like apps are never opened.
- **Commands first, screen last:** CalHack takes the fastest route. A built-in tool or a tested command (`change_setting`: dark mode, Dock, Wi-Fi on; plus volume and sound output) changes a setting in about 0.1 s and reads it back to prove it took. Pointer size, text size and Do Not Disturb have no command, so CalHack does them itself through a fixed route in the app (the exact slider or Control Center switch, by name), reads them back, and closes what it opened. Only wallpaper is left to the person, because it's their choice. A final `check_screen` looks once to confirm what you can see. "Make my Dock hide automatically" takes about 3 s from start to proof.
- **Clicking by name, like Playwright for Mac apps:** to finish a step on screen, CalHack first reads the front window's buttons, rows and switches by name through macOS Accessibility (`src/mac/ui-elements.swift`), with no screenshot. Claude plans the next clicks from that list in one short call, and the clicks themselves take about 50 ms each. Reading the window again (about 0.2 s) checks each one worked. Password boxes are recognised by macOS itself and never typed into; personal choices like a wallpaper are pointed at, not picked. Routes that worked are remembered by name, so the next time needs no AI at all. Measured on a MacBook Air: "open the Wallpaper page" 3.4–4.3 s the first time, 0.7 s after that (it was about 25 s with a screenshot per click). Apps that don't list their buttons fall back to the screenshot way.
- **No fixed waits:** after each click, CalHack glances at a tiny 160-px copy of the screen every 0.3 s and carries on as soon as the screen has changed and settled (one glance at a time, slower on a busy Mac, never more than a few seconds). The tiny copies stay in memory, are never saved and never go to the AI. It costs under 1% of a MacBook Air's CPU.
- **Stop means stop:** Stop (or Esc) works on the first press, cancels the request to Claude mid-way, and leaves everything on screen as it is. **Continue** picks up where it stopped.
- **Finishing a step on screen (autopilot):** when a step only a click can finish, CalHack looks at the screen (`src/agent/autopilot.ts`; after each click it waits ~0.6 s and checks the screen has stopped moving, with a longer wait only while something loads) and does the next click, key press or typing itself. There are no word lists: for every action the AI reads the screen and judges **who** should do it (the agent, or the person for passwords, permissions, sign-in, payments and choices only they can make) and **how sensitive** it is. Our code builds each command from checked numbers and an allowlist of keys, and enforces the routing, failing closed: an unclear answer means the person does it, and an unclear sensitivity means sensitive. Ordinary, low-risk settings the step asks for (Night Shift, battery percentage, tap to click, and Accessibility features like text size, zoom, contrast and reduce motion) are changed by the agent on the AI's own judgement; settings that protect the Mac or data (firewall, sharing, camera/microphone access, and letting an app control the Mac under Privacy & Security → Accessibility) stay with the person. Wi-Fi, Bluetooth and volume also have direct tools (`set_wifi`, `set_bluetooth`, `set_volume`) that check the result. Routine actions run directly; sensitive, risky or personal ones the agent does run through Droid behind the gate. If the screen stops changing or it can't tell what to do, it asks the person. Needs the Accessibility and Screen Recording permissions.
- **Judging the page and its steps:** Droid reads the page, its address and the steps (`src/droid/judge.ts`) and says whether the page is a scam and whether each step is safe, instead of the old text-pattern scam check. For this it has **no tools at all**; it only reads and answers in a fixed JSON shape, and the page text is fenced as untrusted data. Its verdict can only make a step stricter: the command safety rules in `src/core/risk.ts` are a floor it can't loosen, and a missing or malformed answer makes a step ask first. If Droid is off or fails, the old text patterns are the fallback, so a missing judge never means a looser check. Details shows who judged.
- **Visible work:** every Droid action (what it asked to do, what we allowed or refused, the tool output, the exit code) is shown under **See steps → Details → What Droid did**, and the receipt shows which checks prove the result.
- **Without a key:** if `FACTORY_API_KEY` isn't set or the `droid` program isn't installed, CalHack runs the step itself and says so.

Setup: `brew install --cask droid`, put `FACTORY_API_KEY=...` in `.env`, then run `npm run droid:check` to see your models (Droid uses `claude-sonnet-5-5` by default; change it with `CALHACK_DROID_MODEL`) and Droid's tools.

## Setup (once)

```bash
npm install
npx electron --version        # downloads Electron the first time
cp .env.example .env          # then paste your key from console.anthropic.com
```

## Run

For local speech with Kokoro's Heart (`af_heart`) voice, run `npm run voice:heart:setup`
once, then restart CalHack. This installs an isolated Python runtime in `.kokoro/`
and downloads the model and voices (about 340 MB). Speech is generated locally,
without a cloud API key. The first phrase takes longer while the model loads;
later phrases reuse it. Captions, mute, and interruption work as before. If Kokoro
is missing or fails, the app falls back to macOS speech and logs the reason.
This is speech output; `npm run voice:setup` separately configures microphone transcription.

Two terminal windows:

```bash
npm run demo:pages            # 1. demo pages at http://localhost:4321
npm start                     # 2. the app (🛡️ CalHack appears in the menu bar)
```

The first time, macOS asks for permissions. Say **Allow**:

| Permission | Why | Where |
|---|---|---|
| Screen Recording | To see your screen (screenshots only when you press ⌃⌥⌘D) | System Settings → Privacy & Security → Screen & System Audio Recording |
| Automation (Safari / Chrome) | To get the address of the page you're on | Asked automatically |
| Accessibility | To find the PDF or document you have open | System Settings → Privacy & Security → Accessibility |

While developing, these permissions go to the app you started it from (Terminal or VS Code). **After turning on Screen Recording, quit and restart.**

## Demo (about 3 minutes)

**Fix a problem (the main story):** run `scripts/demo-break-printer.sh` (adds a fake "Office Printer", pauses it, and queues 3 stuck jobs), press ⌃⌥⌘D and say "my printer won't print". CalHack checks, fixes it (Droid runs the fixes), checks again, and shows **Before: Paused, 3 stuck jobs → After: Ready**. `scripts/demo-reset.sh` removes the fake printer. Other good ones: "the sound is coming out of my AirPods, I want it on the computer", "I can't find my resume", "delete all my files" (watch it refuse and teach).

**Follow a page** — open http://localhost:4321 in **Safari or Chrome**:

0. **"Install Zoom (forum post)"** (the hero demo): press ⌃⌥⌘D, then **Do it**. Option 1, a "faster mirror" that downloads a package over http and installs it as admin, is ⛔ blocked. CalHack moves to option 2, the official `brew install --cask zoom`, which Droid runs. It then opens Zoom and ends with "✅ Done. Zoom is installed and open", with the proof for each part.
1. **"How to install wget"**: press ⌃⌥⌘D, then **Do it**. "Install Homebrew" is ✅ already done, the rest runs by itself, and it ends with proof that wget works.
2. **"Install Rectangle (2018)"**: the old `brew tap caskroom/cask` step is skipped, and `brew cask install` is swapped for `brew install --cask` (the "Use the updated command" switch starts on; untick it to see the old command fail).
3. **"Add a printer"** (open the PDF in Preview): CalHack finds the printer on your network, adds it, and checks it shows as Ready. If there's no printer nearby (or several), it says so and points at **Add Printer…** instead.
4. **"Verify you are human"**: tick the box (it copies a command, like the real scam) → **"⛔ Stop! Don't paste that."** pops up. Pressing ⌃⌥⌘D on this page also marks the whole page as a scam.

**Before the demo:** run each page once with internet. Claude's answers get saved in `demo/cache/`, so the demo still works if the venue wifi dies.

The scam page is harmless: its hidden command points at a `.invalid` address, which can never exist.

## Terminal version (no app)

```bash
npm run demo -- http://localhost:4321/install-wget.html          # show the plan
npm run demo -- http://localhost:4321/install-wget.html --run    # run it (Droid runs the steps), then print the receipt
```

## Results table (real pages)

Put 10 to 20 real how-to addresses in `demo/eval-pages.txt`, then:

```bash
npm run eval -- demo/eval-pages.txt --csv     # reads and checks each page (runs nothing), prints a table
```

It counts steps that run on their own, ask first, are blocked, are outdated or are for the wrong computer.

## Tests

```bash
npm test              # 295+ tests: safety rules, scam tricks, the agent's tools and limits, fix guides
npm run agent:sim     # 28 requests a non-technical person would make, through the real agent
                      # (real read-only checks; anything that would change the Mac is faked)
```

## Project layout

| Folder | What's in it |
|---|---|
| `src/agent/` | **The agent.** `agent.ts` (the look → act → check loop), `tools.ts` (everything it can do), `danger.ts` (what needs extra confirmation, what's never done), `mac.ts` (the real Mac behind the tools), `offline.ts` (help without internet) |
| `src/core/` | **The safety part.** `risk.ts` (rules), `plan.ts` (final rating per step), `runner.ts` (check → ask → run → check), `recipes.ts` (fixed actions for click steps), `sequence.ts` (order, alternatives, stop on failure), `receipt.ts` (rules the receipt must follow), `exec.ts` (sandbox), `download.ts` (signature checks), `trusted.ts` (trusted/suspicious websites, easy to edit) |
| `src/ai/` | Claude: `parse.ts` (instructions → steps), `review.ts` (the separate reviewer that writes the receipt) |
| `src/droid/` | Droid (Factory): `executor.ts` runs one approved command, behind our permission gate |
| `src/mac/` | Front app, browser page address, open document, page/PDF → text, sound outputs (`audio.ts` + a small CoreAudio helper) |
| `src/app/` | The Electron app: `main.ts`, the helper bar (`ui/bar.*`), voice in (`voice-in.ts`, `ui/mic.js`) and out |
| `demo/pages/` | The four demo pages |
| `tests/` | Tests |

Shortcut: ⌃⌥⌘D by default. If another app already uses it, set `CALHACK_HOTKEY=Control+Alt+Shift+D` (or any other) in `.env`.

Model: Claude Opus 5.5 by default (`CALHACK_MODEL` in `.env` to change). One ⌃⌥⌘D press costs about $0.10.

## Screenshot pointer positioning: Jev and Haiku

The Accessibility-first route stays in place. When CalHack needs a screenshot, its existing Claude planner chooses the action and judges who should perform it. A separate positioner locates that exact target for clicks, double-clicks, and highlights. Keyboard actions and completion checks do not need positioning.

Add your **official TypeSafe AI** key to `.env` when ready:

```dotenv
TYPESAFE_API_KEY=your-key
CALHACK_POINTER_PROVIDER=auto
CALHACK_JEV_MODEL=jev-1.14.0
CALHACK_HAIKU_POINTER_MODEL=claude-haiku-5-5
CALHACK_JEV_MIN_PRESENCE=0.90
CALHACK_JEV_MIN_CONFIDENCE=0.80
```

`auto` uses Jev when its key is present and otherwise uses Haiku with `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`). `jev` explicitly tries Jev and retains Haiku fallback; `haiku` bypasses Jev. The planner still uses `CALHACK_AGENT_MODEL` / `CALHACK_MODEL` as before. Each screenshot click now includes a separate positioning call after planning.

Jev receives the screenshot and target through the [official TypeSafe image API](https://docs.typesafe.ai/images), with the experimental images header enabled. CalHack asks whether the target is present as well as asking for its bounding box, because [Box always returns a box, including for absent targets](https://docs.typesafe.ai/primitives/box). The presence and confidence cutoffs above are provisional application thresholds, not calibrated guarantees. Images outside TypeSafe's supported dimensions or size fall back to Haiku without resizing the coordinate frame.

Each attempt has a 10-second deadline. Errors, invalid coordinates, low confidence, or a missing target cause Jev to fall back to Haiku. Stop cancels positioning and prevents fallback or clicking. If both positioners fail, CalHack does not click; guidance can still appear without a highlight. Positioning cannot change the planner's safety judgment or authorize an action.

The existing `~/.cache/calhack/autopilot.jsonl` log records each positioning attempt, model, screenshot-pixel coordinates, timing, available confidence/token usage, selected provider, and fallback reason. Positioning logs contain neither images nor API keys.

### Quick browser comparison (Windows, macOS, or Linux)

```bash
# No keys needed: exercise real browser navigation and the production highlight renderer.
npm run pointer:compare -- --mock

# Once keys are configured: compare model responses on identical screenshots and targets.
npm run pointer:compare -- --live --runs 3
```

The command starts the existing demo server on port 4321, opens installed Chrome or Edge headlessly, and closes both when finished. If the demo server is already running, add `--url http://127.0.0.1:4321`. If browser discovery fails, pass `--browser <executable>` or set `CALHACK_BROWSER_PATH`. No Electron binary, desktop mouse events, or macOS permissions are needed.

Five cases cover three demo-page navigation links, a guide-heading highlight, and an absent button. Both positioners receive the same screenshot and target; DOM bounds are used only to score live responses. Comparison calls never fall back to the other provider. The table reports target hits, absent-target rejection, errors, browser clicks, rendered highlights, median/p95 positioning latency, and reported token totals. JSONL records, including a screenshot hash for each matched pair, go to `downloads/pointer-comparison-*.jsonl`; use `--output <path>` to choose another file.

Mock mode supplies DOM-derived oracle coordinates to test the browser/renderer plumbing. Its synthetic successes and timings are **not model quality or speed measurements**. Live mode explicitly skips providers without credentials. Positioning latency excludes action planning and browser operations; native macOS execution still needs a Mac smoke test.

On Windows, run the tests using threads if the default fork pool is blocked:

```bash
npm test -- --pool=threads --maxWorkers=1
```

# CalHack 🛡️

**Press ⌃⌥⌘D on any how-to, tap Do it, and CalHack does the steps for you, checks each one is safe, and shows proof it worked.**

No prompts, no new app, no explaining. It starts from the instructions already on your screen.

**How one run works:** Claude reads the steps exactly as written → our code rates every step → you tap **Do it** → **Droid (Factory) runs the approved steps** → each step is checked → a **separate Claude call** reviews the evidence and writes the receipt.

Clicky-style helpers ask permission to use your computer. CalHack also checks whether the instructions are safe to follow:

- **Code decides what's safe, not the AI.** Claude only reads the instructions and explains them. Plain rules in `src/core` rate every command 🟢 safe / 🟡 ask first / 🔴 blocked. The AI can make a step stricter, never safer.
- **Only commands that are really in the instructions run.** If a command isn't in the post word for word, it's blocked.
- **Checks before and after every step.** "Already done?" skips it; "did it work?" gives ✅ or stops.
- **Safe steps run in a locked box** (macOS sandbox: no writing files, no internet).
- **Copy guard.** If you copy a dangerous command from anywhere (like a fake "verify you're human" page), CalHack swaps it out of your clipboard and warns you.
- **Alternative fixes, one at a time.** If the page offers options ("Option 1… or try…"), an unsafe or failed option moves on to the next one, and it tells you if none worked. Otherwise each step runs once, and the first failure stops everything. No retrying.
- **A receipt that has to show proof.** A fresh Claude call (not the one that did the work) writes "Done" only if it can point at checks that really passed. Our rules drop any claim without proof, and turn "Done" into "Couldn't verify" if nothing proves it.
- **One tap, then hands off.** After **Do it** it runs every step by itself and shows one progress line. It only stops for a ⚠️ step. At the end it shows proof, like "✅ wget is installed and works".
- **Click steps get done for you, but never by clicking.** Fixed actions written in our own code (`src/core/recipes.ts`) do common ones, like adding your network printer or opening an app. Anything done differently from the page is listed before you tap **Do it**, with a switch to use the page's way instead. If an action can't run, CalHack draws an arrow and you click. It never moves your mouse.

## Where Droid (Factory Droid SDK) is used

Droid is the executor: **it runs the approved steps on your Mac.** Claude plans before and reviews after; Droid never grades its own work.

- **Trigger:** your ⌃⌥⌘D press and **Do it** tap. For each step that changes something, CalHack starts a Droid session (`src/droid/executor.ts`) and hands it that one command.
- **What Droid can touch:** `autonomyLevel: Off`, so Droid must ask before every action, and our `permissionHandler` answers. The gate (`gate()` in `src/droid/executor.ts`, tested in `tests/sequence.test.ts`) allows only the exact command our rules approved, exactly once. Any other command, file edit, retry or "fixed" version is refused and logged. Every Droid tool except the shell (web fetch, search, file reading, scripts, sub-agents) is turned off for the session. Droid's own settings let some "harmless" commands skip asking, so CalHack also watches every command Droid really starts: anything not approved stops the session and fails the step. Read-only checks run in our macOS sandbox, not through Droid. Admin (`sudo`) steps run through CalHack so macOS shows its own password box. When an approved step like `brew install --cask zoom` needs the Mac password partway through, `sudo` shows a CalHack password box (`bin/calhack-askpass`, via `SUDO_ASKPASS`) that hands the password straight to macOS; CalHack's code never reads or stores it.
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

## Demo (about 2 minutes)

Open http://localhost:4321 in **Safari or Chrome**:

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
npm test          # 102 tests: real-world commands, scam tricks, planning, running
```

## Project layout

| Folder | What's in it |
|---|---|
| `src/core/` | **The safety part.** `risk.ts` (rules), `plan.ts` (final rating per step), `runner.ts` (check → ask → run → check), `recipes.ts` (fixed actions for click steps), `sequence.ts` (order, alternatives, stop on failure), `receipt.ts` (rules the receipt must follow), `exec.ts` (sandbox), `download.ts` (signature checks), `trusted.ts` (trusted/suspicious websites, easy to edit) |
| `src/ai/` | Claude: `parse.ts` (instructions → steps), `review.ts` (the separate reviewer that writes the receipt), `locate.ts` (where to point the arrow) |
| `src/droid/` | Droid (Factory): `executor.ts` runs one approved command, behind our permission gate |
| `src/mac/` | Front app, browser page address, open document, page/PDF → text |
| `src/app/` | The Electron app: `main.ts`, plus `ui/` for the panel, arrow overlay and warning |
| `demo/pages/` | The four demo pages |
| `tests/` | Tests |

Shortcut: ⌃⌥⌘D by default. If another app already uses it, set `CALHACK_HOTKEY=Control+Alt+Shift+D` (or any other) in `.env`.

Model: Claude Opus 5.5 by default (`CALHACK_MODEL` in `.env` to change). One ⌃⌥⌘D press costs about $0.10.

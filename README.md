# CalHack 🛡️

**Press ⌃⌥D on any how-to, tap Do it, and CalHack does the steps for you, checks each one is safe, and shows proof it worked.**

Clicky-style helpers ask permission to use your computer. CalHack also checks whether the instructions are safe to follow:

- **Code decides what's safe, not the AI.** Claude only reads the instructions and explains them. Plain rules in `src/core` rate every command 🟢 safe / 🟡 ask first / 🔴 blocked. The AI can make a step stricter, never safer.
- **Only commands that are really in the instructions run.** If a command isn't in the post word for word, it's blocked.
- **Checks before and after every step.** "Already done?" skips it; "did it work?" gives ✅ or stops.
- **Safe steps run in a locked box** (macOS sandbox: no writing files, no internet).
- **Copy guard.** If you copy a dangerous command from anywhere (like a fake "verify you're human" page), CalHack swaps it out of your clipboard and warns you.
- **One tap, then hands off.** After **Do it** it runs every step by itself and shows one progress line. It only stops for a ⚠️ step. At the end it shows proof, like "✅ wget is installed and works".
- **Click steps get done for you, but never by clicking.** Fixed actions written in our own code (`src/core/recipes.ts`) do common ones, like adding your network printer or opening an app. If one can't run, CalHack draws an arrow and you click. It never moves your mouse.

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
| Screen Recording | To see your screen (screenshots only when you press ⌃⌥D) | System Settings → Privacy & Security → Screen & System Audio Recording |
| Automation (Safari / Chrome) | To get the address of the page you're on | Asked automatically |
| Accessibility | To find the PDF or document you have open | System Settings → Privacy & Security → Accessibility |

While developing, these permissions go to the app you started it from (Terminal or VS Code). **After turning on Screen Recording, quit and restart.**

## Demo (about 2 minutes)

Open http://localhost:4321 in **Safari or Chrome**:

1. **"How to install wget"**: press ⌃⌥D, then **Do it**. "Install Homebrew" is ✅ already done, the rest runs by itself, and it ends with proof that wget works.
2. **"Install Rectangle (2018)"**: the old `brew tap caskroom/cask` step is skipped, and `brew cask install` is swapped for `brew install --cask` (the "Use the updated command" switch starts on; untick it to see the old command fail).
3. **"Add a printer"** (open the PDF in Preview): CalHack finds the printer on your network, adds it, and checks it shows as Ready. If there's no printer nearby (or several), it says so and points at **Add Printer…** instead.
4. **"Verify you are human"**: tick the box (it copies a command, like the real scam) → **"⛔ Stop! Don't paste that."** pops up. Pressing ⌃⌥D on this page also marks the whole page as a scam.

**Before the demo:** run each page once with internet. Claude's answers get saved in `demo/cache/`, so the demo still works if the venue wifi dies.

The scam page is harmless: its hidden command points at a `.invalid` address, which can never exist.

## Terminal version (no app)

```bash
npm run demo -- http://localhost:4321/install-wget.html          # show the plan
npm run demo -- http://localhost:4321/install-wget.html --run    # run it, asking before each change
```

## Tests

```bash
npm test          # 86 tests: real-world commands, scam tricks, planning, running
```

## Project layout

| Folder | What's in it |
|---|---|
| `src/core/` | **The safety part.** `risk.ts` (rules), `plan.ts` (final rating per step), `runner.ts` (check → ask → run → check), `recipes.ts` (fixed actions for click steps), `exec.ts` (sandbox), `download.ts` (signature checks), `trusted.ts` (trusted/suspicious websites, easy to edit) |
| `src/ai/` | Claude: `parse.ts` (instructions → steps), `locate.ts` (where to point the arrow) |
| `src/mac/` | Front app, browser page address, open document, page/PDF → text |
| `src/app/` | The Electron app: `main.ts`, plus `ui/` for the panel, arrow overlay and warning |
| `demo/pages/` | The four demo pages |
| `tests/` | Tests |

Shortcut: ⌃⌥D by default. If another app already uses it, set `CALHACK_HOTKEY=Control+Alt+Command+D` (or any other) in `.env`.

Model: Claude Opus 5.5 by default (`CALHACK_MODEL` in `.env` to change). One ⌃⌥D press costs about $0.10.

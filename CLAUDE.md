# CalHack / Stride

A macOS Electron app (TypeScript, Node 22+) that fixes Mac problems safely, with a red buddy called Stride. A new **learning
mode** (Stride Learn) is being built on the `feat/learn-mode` branch: see `docs/learn/PLAN.md` and `docs/learn/TASKS.md`.

## Commands

- `npm run typecheck` — must pass
- `npm test` — Vitest, must pass (tests live in `tests/`, learning-mode tests in `tests/learn/`)
- `npm start` builds and opens the Electron app (macOS only)

## Conventions

- Code comments and user-facing text are short, plain English, for non-technical people.
- Model answers are validated with Zod; use `askJson` (`src/ai/json.ts`) for structured answers and `getClient()` /
  `MODEL()` from `src/ai/client.ts`. Never put API keys in code.
- Code decides what is safe, not the AI: anything that changes the Mac goes through `src/core/risk.ts` and the tools in
  `src/agent/tools.ts`.
- Tests never call real APIs: inject the model call, browser and clock as dependencies and fake them.
- Commit messages: conventional style, e.g. `feat(learn): …`, `fix(app): …`.

## Cloud sessions (Linux)

Cloud sessions run on Linux, so these can't run or be tested there — don't change them unless the task says so (UI renderer files in `src/app/ui/` may be built and tested through their preview pages):
`src/mac/*.swift`, `src/mac/*.ts` that call macOS tools, `src/app/main.ts`, `src/app/windows.ts`, `src/app/ui/`, and anything
needing the Electron window, Accessibility, AppleScript or Screen Recording.

- Set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` before `npm ci` (the Electron binary isn't needed for tests).
- Work on the branch named in the task brief, open the PR into `feat/learn-mode`, not `main`.

## Learning mode goal

`docs/learn/GOAL.md` is the definition of done. Review against it with a separate reviewer and keep `docs/learn/STATUS.md` current.

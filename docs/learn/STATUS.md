# Stride Learn — status against GOAL.md

Legend: ✅ passes (with evidence) · ❌ fails / not done · ⏳ Mac-only (needs the real app on a Mac) · 🔒 blocked (missing key / blocked site)

_Last updated: 2026-10-29 — C1 merged (PR #21); C2 + real-AI run running in a fresh session; C3 in progress._

## Blockers in this cloud environment

- 🔒 Cloud environments reserve the name `ANTHROPIC_API_KEY`, so the key never reached this session. Fixed: the app now
  also reads `STRIDE_ANTHROPIC_API_KEY` (`src/ai/client.ts`, `tests/client-key-alias.test.ts`). The key was added under that
  name; a fresh session (which loads it) does the real-AI runs (C1 real run + C2).
- ✅ `GEMINI_API_KEY` is set and Google's Gemini API is reachable.
- 🔒 `youtube.com` is blocked by the network proxy (Gemini reads YouTube videos on Google's side, so that path may still work).

## A. The student can learn, start to finish

| Line | Status | Evidence |
| --- | --- | --- |
| A1 | ❌ | Terminal lesson works end to end on the hand-written about-me lesson (`docs/learn/runs/about-me.md`); real-AI builds pending (C2 session). |
| A2 | ❌ | |
| A3 | ❌ | |
| A4 | ❌ | |
| A5 | ❌ | ✅ came 2.4–2.7 s after each save in `docs/learn/runs/about-me.md` (3.6 s on the first browser check) — a bit over ~2 s. |
| A6 | ❌ | Half-typed save → "Still typing?", no hint; wrong code → hint 1 then 2 (`docs/learn/runs/about-me.md`). Hint 3 wording not yet reviewed. |
| A7 | ❌ | |
| A8 | ❌ | Quit + resume returns to the same step and hint count (`tests/learn/session.test.ts`); not yet reviewed. |
| A9 | ❌ | |

## B. The Mac lesson screen

| Line | Status | Evidence |
| --- | --- | --- |
| B1–B8 | ❌ | C3 not started. |

## C. Engineering quality

| Line | Status | Evidence |
| --- | --- | --- |
| C1 | ✅ | After PR #21: `npm run typecheck` passes; `npm test`: 943 pass, 4 Mac-only fail (`tests/plan.test.ts` ×3, `tests/agent.test.ts` ×1). |
| C2 | ❌ | |
| C3 | ❌ | |
| C4 | ❌ | |
| C5 | ✅ | Fix-my-Mac tests pass (same run). |

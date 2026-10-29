# Stride Learn — status against GOAL.md

Legend: ✅ passes (with evidence) · ❌ fails / not done · ⏳ Mac-only (needs the real app on a Mac) · 🔒 blocked (missing key / blocked site)

_Last updated: 2026-10-29 — C1 (PR #21) and C3 (PR #22) merged; C2 being built without Claude; review round 1 running._

## Blockers in this cloud environment

- 🔒 Cloud environments reserve the name `ANTHROPIC_API_KEY`, so the key never reached this session. Fixed: the app now
  also reads `STRIDE_ANTHROPIC_API_KEY` (`src/ai/client.ts`, `tests/client-key-alias.test.ts`). The key was added under that
  name, but a fresh session found the stored value is **not a valid Claude API key** (401 from api.anthropic.com both as
  `x-api-key` and as a bearer token; it doesn't start with `sk-ant-api`). Real-AI runs wait for a valid key.
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
| B1–B8 | ❌ | C3 merged (PR #22): 37 states × light/dark × 1x/2x = 148 screenshots in `docs/learn/ui/`, audit `docs/learn/ui/REPORT.md` all pass (lowest contrast 4.78:1). Awaiting review round 1. |

## C. Engineering quality

| Line | Status | Evidence |
| --- | --- | --- |
| C1 | ✅ | After PR #22: 977 pass, 4 Mac-only fail. After PR #21: `npm run typecheck` passes; `npm test`: 943 pass, 4 Mac-only fail (`tests/plan.test.ts` ×3, `tests/agent.test.ts` ×1). |
| C2 | ❌ | |
| C3 | ❌ | |
| C4 | ❌ | |
| C5 | ✅ | Fix-my-Mac tests pass (same run). |

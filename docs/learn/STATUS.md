# Stride Learn — status against GOAL.md

Legend: ✅ passes (with evidence) · ❌ fails / not done · ⏳ Mac-only (needs the real app on a Mac) · 🔒 blocked (missing key / blocked site)

_Last updated: 2026-10-29 — C1 (PR #21), C3 (PR #22) merged; review round 1 done; fixing._

## Blockers in this cloud environment

- 🔒 Cloud environments reserve the name `ANTHROPIC_API_KEY`, so the key never reached this session. Fixed: the app now
  also reads `STRIDE_ANTHROPIC_API_KEY` (`src/ai/client.ts`, `tests/client-key-alias.test.ts`). The key was added under that
  name, but a fresh session found the stored value is **not a valid Claude API key** (401 from api.anthropic.com both as
  `x-api-key` and as a bearer token; it doesn't start with `sk-ant-api`). Real-AI runs wait for a valid key.
- ✅ `GEMINI_API_KEY` is set and Google's Gemini API is reachable.
- 🔒 `youtube.com` is blocked by the network proxy (Gemini reads YouTube videos on Google's side, so that path may still work).

## A. The student can learn, start to finish (review round 1 on b185cc9)

| Line | Status | Evidence |
| --- | --- | --- |
| A1 | 🔒 | No valid Claude key. Only the hand-written fixture ran end to end (`docs/learn/runs/about-me.md`). |
| A2 | ✅ | `build-from-idea.test.ts › answers 'make me Instagram' with a small alternative…`; CLI offers "a profile page with a grid of photos". |
| A3 | ✅ (terminal) | Transcript "⏱ About 22 minutes · you'll type about 25 lines · 6 steps". On screen at 200% the numbers were hidden → fixing (r1 #3). |
| A4 | 🔒 | Step-size / 🤖-only-setup rules were prompt-only → being enforced in code (C2); needs a real-AI lesson. |
| A5 | ❌ | ✅ came 2.4–3.6 s after the last edit → fixing (r1 #5). |
| A6 | 🔒 | Half-typed → "Still typing?", hints 1→2 escalate. Hint 3 never-the-full-answer not enforced in code → C2. |
| A7 | 🔒 | Concept links not required by schema → C2; video timestamp link tested (`terminal.test`). |
| A8 | ✅ | `session.test › q saves, and the next session opens the same step with the same hints`. |
| A9 | ✅ | `terminal.test › shows what they made, the counts and what they learned`; `docs/learn/ui/light-1x-finished.png`. |

## B. The Mac lesson screen (review round 1)

| Line | Status | Evidence |
| --- | --- | --- |
| B1 | ❌ | Checker said `I can't find "body h1" yet.` (jargon) → C2; "the doctype", "hidden browser" unexplained → r1 fixes. |
| B2 | ❌ | Tokens/font match bar.css; dark mode loses buddy's limbs; titles wrap beside header buttons → r1 fixes. |
| B3 | ⏳ | Dock side remembered (`lesson-ui.test`); window docking needs the Mac (`WIRING.md`). |
| B4 | ❌ | All 37 states have screenshots, but the screen wasn't fed by the real session (no `onView`) and build progress wasn't real → r1 fixes + C2 stages. |
| B5 | ⏳ | 160–240 ms motion, `prefers-reduced-motion` handled; OS setting needs a Mac. |
| B6 | ❌ | Tab order, focus, names, contrast ≥ 4.78 pass; at 200% the new hint / estimate numbers were hidden below the fold → r1 fixes. |
| B7 | ❌ | Jargon messages; simple option showed the full lesson's "You'll learn"; hint count wording → r1 fixes. |
| B8 | ✅ | 148 PNGs + `docs/learn/ui/REPORT.md`, re-generated and reviewed. |

## C. Engineering quality (review round 1)

| Line | Status | Evidence |
| --- | --- | --- |
| C1 | ✅ | typecheck passes; 977 pass, only the 4 Mac-only fail. |
| C2 | ✅ | `lesson-ui.test.ts`, `view.test`, `lesson-model.test` + ~300 learn tests. |
| C3 | 🔒 | Cost log built and tested (`cost.test`), no real build/hint cost measured yet (no key). |
| C4 | ✅ | Bridge 127.0.0.1-only + timing-safe token (`bridge.test`, 18); Gemini key in header; `cost.test › never anything but tokens and prices`. |
| C5 | ✅ | Fix-my-Mac tests pass. |

## Review log

- **Round 1** (fresh reviewer, b185cc9): 5 ✅, 7 ❌, 6 🔒, 4 ⏳. Fixes in progress on `learn/r1-fixes` (screen ↔ session, 200% text, ✅ timing,
  estimate, dark buddy, polish) and `learn/c2-quality` (plain checker messages, AI rules in code, real build stages).

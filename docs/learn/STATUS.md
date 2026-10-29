# Stride Learn — status against GOAL.md

Legend: ✅ passes (with evidence) · ❌ fails / not done · ⏳ Mac-only (needs the real app on a Mac) · 🔒 blocked (missing key / blocked site)

_Last updated: 2026-10-29 — PRs #21–#24 merged (C1, C3, C2, round-1 fixes). Key now works: real-AI runs in a fresh session. Round 2 done; fixing._

## Blockers in this cloud environment

- 🔒 Cloud environments reserve the name `ANTHROPIC_API_KEY`, so the key never reached this session. Fixed: the app now
  also reads `STRIDE_ANTHROPIC_API_KEY` (`src/ai/client.ts`, `tests/client-key-alias.test.ts`). The key was added under that
  name. The first stored value was rejected; the user replaced it and a test call now returns 200. Earlier: the stored value was **not a valid Claude API key** (401 from api.anthropic.com both as
  `x-api-key` and as a bearer token; it doesn't start with `sk-ant-api`). Real-AI runs wait for a valid key.
- ✅ `GEMINI_API_KEY` is set and Google's Gemini API is reachable.
- Real Gemini video notes for the 3 eval videos cost ≈ $0.74 total (upper bound; `docs/learn/eval/report.md`).
- 🔒 `youtube.com` is blocked by the network proxy (Gemini reads YouTube videos on Google's side, so that path may still work).

## A. The student can learn, start to finish (review round 2 on 1885751)

| Line | Status | Evidence |
| --- | --- | --- |
| A1 | 🔒 | Real-AI runs in progress in a separate session; only the fixture ran end to end (`docs/learn/runs/about-me.md`). |
| A2 | ✅ | `build-from-idea.test.ts › answers 'make me Instagram' with a small alternative…`; eval report shows the profile-grid offer. |
| A3 | ✅ | `⏱ About 24 minutes · you'll type about 28 lines · 6 steps` before step 1; visible at 200% in `docs/learn/ui/light-2x-estimate.png`. |
| A4 | 🔒 | Rules in code (`rules.ts`); hint-3 rule is text-only → r2 fix; needs a real-AI lesson. |
| A5 | ✅ | ✅ 1.50–1.71 s after the last write, no key pressed (`docs/learn/runs/about-me.md`, reviewer's sim). |
| A6 | ❌ | Wrong code that passes one check is "partial" → praised, never hinted; hint 1 can contradict the message → r2 fix. |
| A7 | 🔒 | Concept links required; "Say hi" step lacks a concept card → r2 fix; video timestamps need a real video lesson. |
| A8 | ✅ | `session.test › q saves, and the next session opens the same step with the same hints`; `› coming back … shows Welcome back`. |
| A9 | ✅ | `terminal.test › shows what they made, the counts and what they learned`; `light-1x-finished.png`. |

## B. The Mac lesson screen (review round 2)

| Line | Status | Evidence |
| --- | --- | --- |
| B1 | ❌ | Selector jargon fixed (`check/words.ts`), but AI-judge reasons reach the student unfiltered; "4 list items" when 3 typed → r2 fix. |
| B2 | ❌ | Dark buddy limbs ~1.7:1; building header wraps at 200%; lone "More" on passed card → r2 fix. |
| B3 | ⏳ | Overlap check + remembered dock side pass in the cloud; real window docking needs the Mac (`WIRING.md` §2). |
| B4 | ❌ | All 37 states + real build stages; but preview's stuck/partial text is nicer than what the product produces → r2 fix. |
| B5 | ⏳ | 160–240 ms motion, `prefers-reduced-motion` handled; OS setting needs the Mac. |
| B6 | ❌ | Keyboard/labels/contrast pass; at 200% stuck reason cut off, finish counts below fold, hint-3 code wraps → r2 fix. |
| B7 | ❌ | Wrong code gets "You're on the right track" (see A6) → r2 fix. |
| B8 | ✅ | 148 PNGs + `docs/learn/ui/REPORT.md`, regenerated identically. |

## C. Engineering quality (review round 2)

| Line | Status | Evidence |
| --- | --- | --- |
| C1 | ✅ | typecheck clean; 1046 pass, only the 4 Mac-only fail. |
| C2 | ✅ | `session.test` onView walk, `view.test`, `lesson-model.test`, `rules.test`, screenshot audit. |
| C3 | 🔒 | Gemini ≈ $0.25/video (real); Claude build/hint cost awaiting the real-AI session. |
| C4 | ✅ | `bridge.test` (127.0.0.1 only, Origin refused, bad token closed); `cost.test › never anything but tokens and prices`. |
| C5 | ✅ | Fix-my-Mac tests pass. |

## Review log

- **Round 1** (fresh reviewer, b185cc9): 5 ✅, 7 ❌, 6 🔒, 4 ⏳. Fixes merged in PR #24 (screen ↔ session via `onView`, 200% text + in-view audit, ✅ 1.5 s,
  estimate, dark buddy, polish, fixture now 8/8 on the grader). `learn/c2-quality` merged (PR #23): plain checker messages (`check/words.ts`), AI rules in code
  (`rules.ts`), real build stages (`stages.ts`), eval harness + grader (`docs/learn/eval/report.md`).
- **Round 2** (fresh reviewer, 1885751): 8 ✅, 7 ❌, 4 🔒, 2 ⏳. Fixing on `learn/r2-fixes` (partial vs wrong, matching hints, AI-judge jargon,
  200% fold, real messages in preview, polish).

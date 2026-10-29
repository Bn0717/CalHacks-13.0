# Stride Learn — definition of done

The work is reviewed against this list until **every line passes**. A reviewer that did not write the code checks each line,
with evidence (test name, screenshot path, transcript line). "Mostly" is a fail.

## A. The student can learn, start to finish

- [ ] A1. "a page about me" (idea), "a website for my small bakery" (idea + simpler offer), "a page like this picture", and one
      beginner YouTube video each become a real lesson with the real AI, and each can be completed end to end.
- [ ] A2. "make me Instagram" gets a friendly small alternative, never a flat refusal.
- [ ] A3. Every lesson tells the student the honest time, lines to type and steps **before** they start.
- [ ] A4. The student types every 🧑 step themselves; 🤖 steps are only setup; no step is more than ~10 lines.
- [ ] A5. A correct step is confirmed within ~2 s of the student stopping typing, without pressing anything.
- [ ] A6. Mid-typing code is never called wrong. Wrong code gets hints that get stronger; the third hint still doesn't give the whole answer.
- [ ] A7. Every new idea gets a one-sentence plain explanation and a link; video steps link to the right timestamp.
- [ ] A8. Quit and resume returns to the same step with the same hints used.
- [ ] A9. The finish screen shows what they built, what they learned, and done-alone / hinted / shown counts.

## B. The Mac lesson screen is genuinely good (senior UI/UX bar)

- [ ] B1. A 14-year-old who has never coded understands every screen without help: one clear next action per screen,
      no jargon (no "DOM", "selector", "parse", "runner").
- [ ] B2. Looks like it belongs on macOS and with Stride: the existing bar/buddy visual language (see `src/app/ui/bar.css`,
      `buddy.css`), SF system font, consistent spacing scale, rounded cards, subtle shadows, real light **and** dark mode.
- [ ] B3. Never covers the code being typed: compact by default, expands on demand, remembers where the student put it.
- [ ] B4. Every state is designed, not just the happy path: building (with honest progress), questions, picture confirm,
      estimate + simpler offer, setup ticks, your turn, typing, checking, ✅ passed, partial, hint 1/2/3, show me, stuck,
      concept card, chapter quiz, paused/resume, error (no key, no internet, video unreadable), finished.
- [ ] B5. Motion is calm and quick (150–250 ms), respects Reduce Motion; the ✅ moment feels rewarding, not noisy.
- [ ] B6. Fully usable by keyboard (Tab order, visible focus, Esc closes, shortcuts shown), VoiceOver labels on every control,
      text contrast ≥ 4.5:1, works at 200% text size.
- [ ] B7. Text is short, warm and encouraging; errors say what happened and what to do next.
- [ ] B8. Screenshots of every state in light and dark mode are saved in `docs/learn/ui/` and reviewed.

## C. Engineering quality

- [ ] C1. `npm run typecheck` passes; all tests pass (the 4 Mac-only tests may fail on Linux only).
- [ ] C2. New logic has tests; UI states are covered by the preview page and a screenshot test.
- [ ] C3. Real-AI lesson build costs under $0.50; a hint under $0.01; costs are logged.
- [ ] C4. No secret is ever logged or written to disk; the VS Code bridge only accepts local, token-checked connections.
- [ ] C5. Fix-my-Mac mode still works (its tests still pass) — learning mode is added, not swapped in.

## Review loop

1. Build or fix.
2. A **separate reviewer** (a fresh subagent told to act as a senior engineer and senior UI/UX designer who did not write the
   code) checks every line above, with evidence, and lists failures ranked by impact on the student.
3. Fix the failures. Repeat.
4. Stop when all lines pass, or after 4 review rounds, or if the work is blocked (missing key, blocked website) — then write
   what's left and why in `docs/learn/STATUS.md`.

Always keep `docs/learn/STATUS.md` up to date: each line above with ✅ / ❌ / ⏳ Mac-only, plus the evidence.

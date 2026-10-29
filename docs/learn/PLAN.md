# Stride Learn — approved plan

## Goal

Turn what a student wants to learn — **a tutorial video** or **just an idea** ("I want a website for my bakery", optionally with a
reference picture) — into a hands-on lesson. The student types the code themselves while Stride guides, checks and explains each
step, so they finish and understand it.

v1 succeeds when, tested with 5–10 real students:

- at least 7 in 10 finish a tutorial or project they'd normally give up on
- afterwards they can rebuild a small part without help
- the "✅ nice!" arrives about 2 s after they stop typing
- a lesson costs under $0.50 in API calls

## v1 scope

| In v1 | Later |
|---|---|
| macOS | Windows |
| Start from a YouTube video **or** an idea (+ optional reference picture) | Udemy, Coursera, docs pages |
| VS Code | Other editors |
| Beginner websites: HTML, CSS, a little JavaScript | AWS, Figma, Python, anything else |
| English | Other languages |

Fix-my-Mac mode keeps working next to learning mode.

## Three ways to start, one lesson format

| Start from | Example |
|---|---|
| 🎬 A video | "Teach me this YouTube tutorial" |
| 💡 An idea | "I want to make a website for my bakery" |
| 🖼️ An idea + a picture | "Make it look like this" + screenshot, photo or paper sketch |

All three produce the same `Lesson` (see `src/learn/lesson.ts`), so the runner, checker, hints, explanations, resume and finish
screen are shared.

## What the student experiences

1. **Start.** Press ⌃⌥⌘D on a video, or say "teach me this" / "I want to make a website". Stride hops on screen.
2. **Idea only: a few questions with tap buttons.** What's it for? What should it have? A look you like? [Add a picture] [Show me styles] [Skip].
3. **Picture (optional).** Stride says what it sees ("a top menu, a big photo with a title, 3 cards, a footer — right?") and the student confirms or corrects.
4. **Honest estimate.** "About 2 hours · you'll type about 150 lines · 32 steps · you'll learn: …". If it's long, Stride offers a
   **simpler version** first ("one page, 35 min, ~40 lines") and grows the rest later in small lessons.
   Huge asks ("make me Instagram") get the closest small version, never a flat refusal.
5. **Stride does the boring setup**, with ticks: VS Code installed, project folder made, opened with a live preview, Stride's VS Code helper added (asks once).
6. **The lesson screen.** VS Code + live preview; the step card shows "Step 3 of 18 · 🧑 Your turn", the instruction, a one-line
   "why", and [▶ Watch this part] (video lessons) [Hint] [Show me]. The buddy points at the exact line. Each step is labelled
   🧑 Your turn, 🤖 Stride (setup it does), or 👀 Watch.
7. **Automatic checking, no Next button.** About 2 s after typing stops, Stride checks: ✅ → a small cheer, the preview updates,
   the next step opens.
8. **Hints, not answers.** Wait quietly → nudge ("look at the end of line 3") → point at the spot → partial code → "Show me"
   (Stride types it and the step is marked *shown*). After ~30 s without progress: "Want a hint?"
9. **Fundamentals when needed.** Concept cards (simple diagram, MDN link, short explainer video). The student can ask out loud
   ("why do I need `<head>`?") and the answer uses their own code.
10. **Pace switch.** *Learn more* (they type almost everything) or *Go faster* (Stride does more). Per-step override: "do this one for me" / "let me try".
11. **Checkpoints.** One optional quick question at the end of each chapter.
12. **Resume.** Close the laptop; next day: "Welcome back! Step 12: styling the navbar."
13. **Finish.** Screenshot of their site, what they learned, how many steps they did alone vs with hints vs shown, and a next
    lesson ("add the 3 cards from your picture? ~20 min").

## How it works

| Part | What it does | Where |
|---|---|---|
| Lesson format | One shape for every lesson: steps, who does each, checks, hints, concepts, timestamps | `src/learn/lesson.ts` |
| Idea lesson builder | Questions → **builds the finished site itself, out of sight** → runs it and checks it → cuts it into steps → time estimate → simpler version | `src/learn/build-from-idea.ts` |
| Reference picture | Reads the layout from an image and lists the sections for the student to confirm | `src/learn/picture.ts` |
| Video lesson builder | Reads a public YouTube video (Gemini reads YouTube links directly) → steps with timestamps and the code shown → same format | `src/learn/build-from-video.ts` |
| Lesson cache | A built lesson is saved per video / per idea, so the next student gets it instantly and free | `src/learn/cache.ts` |
| Checker | Three levels: code checks (instant) → render the page in a hidden browser (~0.5 s) → Claude Haiku, only when stuck | `src/learn/check/` |
| Lesson runner | Current step; waiting / typing / settled / stuck; hint level; progress saved for resume; finish summary | `src/learn/runner.ts` |
| VS Code helper | Sends each edit and VS Code's error underlines to Stride over a local connection; highlights the target line; types code for "Show me" | `extensions/vscode/` |
| Lesson screen | Step card, mini video player (official YouTube embed at the right time), concept cards, progress dots, buddy pointing | `src/app/ui/` (Mac only) |
| Setup by Stride | Install VS Code, make the folder, open things — through the existing safe tools | `src/learn/setup.ts` + `src/agent/tools.ts` |

**Reused:** buddy and pointer, bar, screen capture, voice in/out, step plans, "who does this step" (`autopilot.ts`), safety rules
(`risk.ts`), Playwright, browser address reader (`front.ts`), receipt screen, `askJson` structured answers.

### Timing — why it feels instant

- All the expensive thinking happens **once, when the lesson is built** (20–60 s). Each step already carries its check and 3 hints.
- During the lesson: edit arrives ~0.05 s, code check ~0.01 s, hidden-browser check ~0.5 s, plus ~2 s of deliberate waiting after typing stops.
- A step is a small chunk (3–10 lines), not one line. A 30-minute tutorial is 20–40 steps.
- Claude is used only when stuck (about 1 step in 5), with Haiku (~1 s), and a hint can be prepared while the student is still typing.

## Models

| Job | Model | Why |
|---|---|---|
| Build a lesson (idea or video steps), read a picture | `claude-opus-5-5` (`CALHACK_LEARN_MODEL` overrides) | Done once per lesson, quality matters |
| Hints the prepared ones don't cover, "why?" questions | `claude-haiku-5-5` | Fast, about $0.0005 a hint |
| Read a YouTube video | Gemini (`GEMINI_API_KEY`) | Reads public YouTube links directly |

## Risks

| Risk | Plan |
|---|---|
| A video or idea is turned into wrong steps | Ideas: the finished site is built and checked before step 1. Videos: tested on chosen videos first. Both: a "this step looks wrong" button |
| Student code differs from the reference but works | Check behaviour (the page renders, the element exists), never exact text |
| Outdated tutorial commands | Reuse the existing "outdated command" handling |
| Students press "Show me" every time | Tracked and shown honestly in the summary; *Learn more* delays "Show me" |
| YouTube rules | Only YouTube's official embedded player; never download videos |
| A "do it for me" setup step is risky | Every action goes through `risk.ts` and the existing tools, like fix-my-Mac mode |

## Build phases

Cloud-ready tasks are briefed in [TASKS.md](TASKS.md). Mac-only tasks (lesson screen, setup, voice) are done locally.

| # | Task | Where it runs |
|---|---|---|
| T0 | Lesson format, shared types, test fixtures | ☁️ cloud, first, alone |
| T1 | Idea lesson builder (questions, hidden reference build, steps, estimate, simpler version) | ☁️ cloud |
| T2 | Reference picture reading | ☁️ cloud |
| T3 | Video lesson builder (Gemini) + lesson cache | ☁️ cloud |
| T4 | Checker, three levels | ☁️ cloud |
| T5 | Lesson runner, resume, finish summary | ☁️ cloud |
| T6 | VS Code helper extension + local bridge | ☁️ cloud (tested on the Mac after) |
| M1 | Lesson screen UI, buddy pointing at the line | 💻 Mac |
| M2 | Setup by Stride, mini video player | 💻 Mac |
| M3 | Voice questions, hint timing, end-to-end on the 3 test projects | 💻 Mac |
| M4 | Test with 5–10 students | 💻 + people |

Test projects: "a page about me", "a small business site", "a page like this picture", plus 3 beginner HTML/CSS YouTube videos.

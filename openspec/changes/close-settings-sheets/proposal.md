## Why

When CalHack opens a panel in System Settings (Text Size, Wi-Fi Details…), it never closes it. The panel then becomes the app's focused window, so the window reader only sees the panel's 3–8 items: the next route can't find its control (`pointer_size` times out looking for its slider after `text_size`), `uiPilot` answers `not_here` and drops to slower, less reliable screenshots, and the screenshot autopilot spends AI calls closing the leftover panel itself. This is one of the causes of the agent's inconsistent results.

## What Changes

- The window helper reports when the focused window is a panel (`AXSheet`), so code and the AI know one is open.
- A new helper command closes the open panel by pressing exactly one button from a fixed list of names: `Done`/`OK` to keep changes, `Cancel` to discard them. No other button is ever pressed (e.g. `Forget This Network…`), and the helper confirms the panel actually closed.
- The `text_size` route closes the panel it opens, keeping the new size.
- Every fixed Settings route gets a safety net: any panel that appeared during the route is closed before the route ends.
- The AI-driven paths (`uiPilot` and the screenshot autopilot) close a panel CalHack opened once a step is done. Panels the person opened, or is working in, are left alone.
- The AI is told when a panel is open, so it stops confusing panel buttons with page buttons.
- Each close attempt is written to `~/.cache/calhack/autopilot.jsonl` (which button, whether the panel closed).

## Capabilities

### New Capabilities
- `settings-sheet-cleanup`: Detecting panels (sheets) in System Settings and closing the ones CalHack opened, safely and verifiably, so each step leaves the window as it found it.

### Modified Capabilities

(none — no existing specs in `openspec/specs/`)

## Impact

- `src/mac/ui-elements.swift`: `list` output gains `sheet`; new `closesheet` command. The helper rebuilds itself automatically (it's newer than the cached binary).
- `src/mac/ui.ts`, `src/agent/uipilot.ts` (`UiDeps`, `UiWindow`): new `sheet` field and `closeSheet` call.
- `src/agent/tools.ts`: `text_size` route and `onSettingsPage`.
- `src/agent/uipilot.ts`, `src/agent/autopilot.ts`: close-after-done, panel note in `describeWindow`, log records.
- Tests: `tests/uipilot.test.ts`, `tests/settings.test.ts`, `tests/autopilot.test.ts` with fake `UiDeps`.
- No new dependencies. Needs the existing Accessibility permission only.

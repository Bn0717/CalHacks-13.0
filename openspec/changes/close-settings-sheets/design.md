## Context

CalHack works in System Settings in two ways:
- **Fixed routes** (`SCREEN_SETTINGS` in `src/agent/tools.ts`) use no AI. For example, `text_size` presses `Text size…`, moves the `Preferred reading size` slider and reads it back.
- **AI-driven steps** (`uiPilot` in `src/agent/uipilot.ts`, then the screenshot `autopilot` as fallback) plan clicks from the window's items or from a screenshot.

Neither closes the panels they open. Today the only cleanup is in `onSettingsPage`, which quits System Settings if it wasn't open before. When System Settings was already open, the panel stays.

A spike on macOS 26.5 (System Settings, Text Size and Wi-Fi Details) found:

| | Text Size | Wi-Fi Details |
|---|---|---|
| Focused window role | `AXSheet` (parent: the `AXWindow`) | `AXSheet` |
| `AXDefaultButton` / `AXCancelButton` | present but `nil` | present but `nil` |
| Buttons | `Done` | `Cancel`, `OK`, `Forget This Network…` |
| Escape | closes, **keeps** the change (6 → 7 stayed 7) | closes |

Also, while a sheet is open, the app's `AXWindows` reports 0 windows, and the helper's `frontWindow` (which uses `AXFocusedWindow`) returns the sheet. So `list` shows only the sheet's items.

## Goals / Non-Goals

**Goals:**
- Every panel CalHack opens is closed by CalHack, deterministically and without an AI call.
- Closing never presses anything except an explicit close button, and is checked afterwards.
- Code and the AI can tell when a panel is open.

**Non-Goals:**
- Closing panels the person opened, or panels in apps other than the one being worked in.
- Popovers, menus, alerts from other processes (e.g. `SecurityAgent` password prompts), and Control Center (it already closes its own panel).
- Changing how the AI decides who does what.

## Decisions

**1. Match close buttons by exact name, not by the default/cancel roles.**
The roles are `nil` in System Settings (SwiftUI), so they can't be used. Exact names from a short list (`Done`, `OK`, `Cancel`) are predictable and testable. A name like `Forget This Network…` never matches.
*Alternatives:* pressing the last or rightmost button (would hit destructive buttons); Escape (keeps live changes, so it isn't a real "discard"); asking the AI (not deterministic, which is the very problem being fixed). The helper still checks `AXDefaultButton`/`AXCancelButton` first when they are set, so apps that fill them in work too, but those buttons must also pass the name check.

**2. Two modes: `keep` and `discard`.**
- `keep` = `Done`, else `OK`.
- `discard` = `Cancel`, else `Done` only when there is no `OK` and no `Cancel`. A panel whose only button is `Done` applies changes live, so pressing it neither saves nor loses anything.

The fixed routes and AI-driven steps use `keep`, because they open a panel in order to change something the person asked for. `discard` exists for later "only looked" uses (e.g. reading Wi-Fi details) and for tests.

English names only for now. Localised names can be added to the list later.

**3. TypeScript chooses the button; the helper enforces the allowlist and does the close (`ui-elements closesheet <app> <Done|OK|Cancel>`).**
TypeScript reads the panel with `list`, which now reports `"sheet": true`, and picks the button by mode in `pickCloseButton`, a pure function with unit tests. The helper then, in one process:
1. refuses any name other than `Done`/`OK`/`Cancel`,
2. returns `{ok:true, pressed:null}` if the focused window isn't an `AXSheet`,
3. presses the `AXButton` with that exact name, searching only inside the sheet,
4. polls the focused window for up to about 1.5 s,
5. returns `{ok, pressed, closed}`.

The hard safety rule sits in the helper, the same way password boxes are handled there. The mode logic is testable from `npm test`.
*Changed during implementation:* the first draft had the helper take `keep|discard` and choose the button itself. That would have left the rule untested, or duplicated in TypeScript just for tests. The `AXDefaultButton`/`AXCancelButton` preference was dropped because both are `nil` in System Settings.

**4. Ownership: "it appeared while CalHack was working".**
- `onSettingsPage` and the pilots read `sheet` when they start.
- When they finish, they close only if a panel is open **now** and was **not** open at the start.
- A panel the person opened before the step, or one present when the step was handed to them, is never touched.

This is conservative and needs no tracking of individual clicks.

**5. Where closing happens.**
- `text_size` closes explicitly right after reading the slider back. The route knows it opened a panel.
- `onSettingsPage` closes in its `finally` as a safety net, before the existing "quit if it wasn't open".
- `uiPilot` / `autopilot` close after an outcome of `done`, but not `skipped`, `stopped`, or a person-finished `done`.
- Closing respects Stop: nothing is pressed once the signal is aborted.

**6. Sensitivity.**
Pressing `Done`/`Cancel` on a panel CalHack opened is routine and runs directly, not through Droid. `OK` in `keep` mode confirms edits CalHack already made as part of the person's request. It doesn't add new risk, and those edits went through the normal sensitivity routing when they were made.

**7. Logging.**
`fileRecord` in `autopilot.ts` gains an optional `sheetClose: {mode, pressed, closed, error?}` and an outcome `sheet_closed` / `sheet_close_failed`. Fixed routes write the same record with `round: 0`.

## Risks / Trade-offs

- [An `OK` in `keep` mode saves edits that came from a wrong AI click] → AI edits already pass the sensitivity routing. Fixed routes only touch named controls. The close is logged.
- [A panel without the English names never closes] → The helper reports `closed:false`, which is logged. The step still finishes, and the AI sees the panel note. Names can be extended.
- [A panel opened by the person during CalHack's step is treated as CalHack's] → It is only closed after a CalHack-finished `done`, when the person wasn't involved. Acceptable.
- [Polling for the close adds about 0.1–1.5 s] → Only when a panel was open.
- [The helper must rebuild] → `uiHelper()` already rebuilds when the Swift source is newer. On machines with broken Command Line Tools this fails the same way it does today. That's a separate fix, outside this change.

## Migration Plan

No data migration. Rolling back means reverting the change, after which the helper rebuilds from the old source. Old `autopilot.jsonl` lines stay readable, since the new fields are optional.

## Open Questions

- Does `Cancel` on Wi-Fi Details actually discard edits? It's standard macOS behaviour but still not verified. Closing it with `Cancel` was verified on a real Mac (task 6.2). The panel's first page lists no switches through Accessibility; its editable settings are in TCP/IP, DNS and Proxies, and editing those on a live network risks disconnecting. Check on a spare network (task 6.3). This only matters for `discard`, which nothing uses yet.
- Do other System Settings panels use other close names (e.g. `Close`, `Back`)? Add them only after seeing them, never by guessing.

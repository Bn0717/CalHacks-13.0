## 1. Window helper (Swift)

- [x] 1.1 In `src/mac/ui-elements.swift` `list`, add `"sheet": true` to the output when the focused window's role is `AXSheet`
- [x] 1.2 Add `closesheet <app> <Done|OK|Cancel>`: if the focused window isn't an `AXSheet`, return `{ok:true, pressed:null, closed:true}`; otherwise look for the button in the sheet's subtree only
- [x] 1.3 Hard safety rule in the helper: refuse any name other than `Done`/`OK`/`Cancel`, and press only an `AXButton` with that exact name inside the panel. (The keep/discard choice of button lives in TypeScript, see 2.1, so it can be unit-tested.)
- [x] 1.4 Press it, poll the focused window for up to ~1.5 s, return `{ok, pressed, closed}` (`ok:false` with the button name when it is still a sheet)
- [x] 1.5 Update the helper's header comment with the new command and the name rule

## 2. TypeScript bridge

- [x] 2.1 `src/mac/ui.ts`: add `sheet?: boolean` to `UiWindow` (parsed in `parseWindow`) and `closeSheet(app, mode)` calling the helper
- [x] 2.2 `src/agent/uipilot.ts` `UiDeps`: add optional `closeSheet`; wire it in `realMac` (`src/agent/mac.ts`)
- [x] 2.3 `src/agent/autopilot.ts`: add optional `sheetClose: {mode, pressed, closed, error?}` and outcomes `sheet_closed` / `sheet_close_failed` to `ActionRecord`
- [x] 2.4 Add one shared helper (e.g. `closeOpenedSheet(ctx, app, hadSheetAtStart, step)`) that skips when Stop is pressed or a sheet was there at the start, calls `closeSheet(app, "keep")`, writes the log record, and adds a trail/detail line

## 3. Fixed Settings routes

- [x] 3.1 `onSettingsPage` (`src/agent/tools.ts`): record whether a sheet was open after opening the page, and in `finally` call `closeOpenedSheet` before the existing "quit if it wasn't open"
- [x] 3.2 `text_size`: its panel is closed with `keep` right after the slider is read back, by `onSettingsPage`'s close (it runs as soon as the route's work returns, so a separate call in the route would only repeat it)
- [x] 3.3 Tests (`tests/commands-first.test.ts` or `tests/settings.test.ts`, fake `UiDeps` that opens a sheet on `Text size` press): text size closes with `Done`; a failed slider still closes; a sheet open before the route is left alone; `pointer_size` after `text_size` finds its slider

## 4. AI-driven steps

- [x] 4.1 `describeWindow`: when `w.sheet`, start the description with a line saying a panel is open in front of the page and only its items are listed
- [x] 4.2 `uiPilot` reports `personHelped`; the close happens once in `autopilot()` (which runs `uiPilot` first), on a CalHack-finished `done` (not when the person helped, not `skipped`/`stopped`). Remembered-route replays are covered the same way
- [x] 4.3 Screenshot `autopilot`: when `ctx.mac.ui` exists, check `sheet` at the start, and close after a `done` outcome on the same conditions
- [x] 4.4 Tests in `tests/uipilot.test.ts` / `tests/autopilot.test.ts`: closes after done; not after the person did their part; not after Stop; not when the sheet was there at the start; `describeWindow` panel note; log record written with mode, button, closed

## 5. Helper behaviour tests

- [x] 5.1 Unit-test the name rule in isolation (port it to a small pure TS function shared by the tests, or test via a fake helper output): `Forget This Network…` never chosen; `discard` on `[Cancel, OK]` → `Cancel`; `discard` on `[Done]` → `Done`; `keep` on `[Cancel, OK]` → `OK`; no match → nothing pressed
- [x] 5.2 `npm test` and the TypeScript build pass

## 6. Manual verification on a Mac

- [ ] 6.1 With System Settings already open: "make the text bigger" then "make the pointer bigger". Both succeed, no panel is left, and `autopilot.jsonl` has a `sheet_closed` line with `Done`
- [x] 6.2 Open Wi-Fi Details, change nothing, run `ui-elements closesheet "System Settings" Cancel`. `Cancel` is pressed and the Wi-Fi page is back (verified 2026-10-24: `list` reported `sheet: true` with `Forget This Network…`, `Cancel`, `OK`; result `{"pressed":"Cancel","closed":true}`, Wi-Fi page in front again)
- [ ] 6.3 Confirm that `Cancel` on Wi-Fi Details discards an edit (e.g. toggle "Low Data Mode", press Cancel, reopen: unchanged; restore if not). Record the result in `design.md` Open Questions
- [ ] 6.4 Open a panel yourself, then ask CalHack for an unrelated step: the panel is not closed

## ADDED Requirements

### Requirement: Report when a panel is open
The window reader SHALL report whether the app's focused window is a panel (an `AXSheet`), based on the focused window rather than the app's window list.

#### Scenario: Text Size panel is open
- **WHEN** System Settings shows the Text Size panel and CalHack lists its window
- **THEN** the result is marked as a panel and lists the panel's items (`Smaller`, `Preferred reading size`, `Larger`, `Done`)

#### Scenario: No panel is open
- **WHEN** System Settings shows an ordinary page and CalHack lists its window
- **THEN** the result is not marked as a panel

### Requirement: Close a panel by an exact button name
CalHack SHALL close a panel only by pressing a single button whose name exactly matches the list for the requested mode. In `keep` mode that is `Done`, otherwise `OK`. In `discard` mode it is `Cancel`, or `Done` only when the panel has no `OK` and no `Cancel` button (because such a panel already applied its changes live). It MUST NOT press any other button. It MUST NOT use the Escape key as a substitute for Cancel.

#### Scenario: Keep changes on Text Size
- **WHEN** the Text Size panel is open and CalHack closes it in `keep` mode
- **THEN** CalHack presses `Done` and the chosen size stays

#### Scenario: Discard on Wi-Fi Details
- **WHEN** the Wi-Fi Details panel is open and CalHack closes it in `discard` mode
- **THEN** CalHack presses `Cancel`, never `OK` or `Forget This Network…`

#### Scenario: Discard on a live panel
- **WHEN** a panel's only closing button is `Done` and CalHack closes it in `discard` mode
- **THEN** CalHack presses `Done`

#### Scenario: No matching button
- **WHEN** a panel has none of the allowed button names for the requested mode
- **THEN** CalHack presses nothing and reports that it couldn't close the panel

#### Scenario: Nothing to close
- **WHEN** CalHack is asked to close a panel and none is open
- **THEN** it does nothing and reports success with nothing pressed

### Requirement: Confirm the panel closed
After pressing a closing button, CalHack SHALL read the focused window again and report the panel closed only when that window is no longer a panel.

#### Scenario: Panel stays open
- **WHEN** CalHack presses `Done` but the focused window is still a panel afterwards
- **THEN** the close is reported as failed, naming the button that was pressed

### Requirement: Fixed Settings routes leave no panel open
Each fixed System Settings route SHALL close, in `keep` mode, any panel that opened while the route ran, whether the route succeeded or failed. A panel that was already open before the route started MUST NOT be closed.

#### Scenario: Text size then pointer size
- **WHEN** CalHack makes the text larger and then makes the pointer larger
- **THEN** the Text Size panel is closed after the first change, and the pointer route finds the `Pointer size` slider

#### Scenario: Route fails part-way
- **WHEN** the text size route opens its panel and then fails to move the slider
- **THEN** the panel is still closed before the route returns

#### Scenario: Panel was already open
- **WHEN** a panel was already open before a route started
- **THEN** the route does not close it

### Requirement: AI-driven steps close the panels CalHack opened
When an on-screen step (the window-reading pilot or the screenshot autopilot) ends as done, CalHack SHALL close, in `keep` mode, any panel that opened during that step through CalHack's own actions. It MUST NOT close the panel when the step ended with the person doing their part, when the step was skipped or stopped, or when the panel was already open when the step began.

#### Scenario: CalHack opened Wi-Fi Details and finished
- **WHEN** CalHack opened a panel during a step and the step ends as done
- **THEN** CalHack closes the panel without asking the AI

#### Scenario: The person did their part
- **WHEN** a step ends after the person pressed Done on their part while a panel is open
- **THEN** CalHack leaves the panel open

#### Scenario: Stop pressed
- **WHEN** the person presses Stop while a panel CalHack opened is open
- **THEN** CalHack does not press anything more

### Requirement: The AI is told a panel is open
When the focused window is a panel, the window description given to the AI SHALL say that a panel is open in front of the page and that its items are the only ones visible.

#### Scenario: Planning with a panel open
- **WHEN** the window-reading pilot plans a step while the Text Size panel is open
- **THEN** the prompt states that a panel is open

### Requirement: Log every close attempt
Each attempt to close a panel SHALL be recorded as one line in `~/.cache/calhack/autopilot.jsonl`, with the step, the mode, the button pressed (or none), whether the panel closed, and the error if it didn't.

#### Scenario: Successful close is logged
- **WHEN** CalHack closes the Text Size panel with `Done`
- **THEN** one log line records mode `keep`, button `Done`, closed `true`

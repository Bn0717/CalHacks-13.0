# Stride Learn Helper (VS Code)

Lets Stride follow along while you learn to code. It tells Stride about your edits, saves, error underlines, the file in
front and the cursor, and lets Stride highlight the line to work on and type code when you press "Show me".

It only talks to Stride on your own Mac (127.0.0.1), and it only does four things when Stride asks:
highlight lines, clear the highlight, insert code, open a file. Anything else is ignored.

## How it connects

1. Stride starts a small local server (`src/learn/bridge.ts`) on 127.0.0.1, on a random free port, and writes
   `~/Library/Application Support/Stride/bridge.json` (`{ port, token, pid, protocol }`, readable by you only).
   A new random token is made each time Stride starts.
2. The helper reads that file (or the path in `STRIDE_BRIDGE_FILE`), connects to `ws://127.0.0.1:<port>` and sends
   `{ type: "hello", token, client: "vscode", protocol, folders }` as its first message.
3. Stride closes the connection unless the token matches and the hello comes within 5 s. It also refuses anything not
   from 127.0.0.1, and anything with an `Origin` header (so web pages can't connect). Then it replies `welcome`.
4. If Stride isn't running, the helper tries again after 1 s, 2 s, 4 s … up to every 30 s.

All messages are defined once, with Zod, in `src/learn/bridge-protocol.ts`. `src/protocol.ts` here is an exact copy made by
`npm run copy-protocol` (part of `compile`). The copy is committed so this folder builds on its own; a root test checks the
two files are identical. Lines and columns are counted from 1; paths are full paths.

| Helper → Stride | When |
|---|---|
| `change` (path, text, version) | 300 ms after typing pauses |
| `save` (path, text, version) | on save |
| `diagnostics` (path, items) | when VS Code's error underlines change |
| `active` (path or null) | when the file in front changes |
| `cursor` (path, line, column) | when the cursor moves |
| `done` (id, command, ok, error?) | reply to each command |

| Stride → helper | What it does |
|---|---|
| `highlight` (path, startLine, endLine, message?) | marks the lines in red and scrolls to them |
| `clearHighlight` | removes the marks |
| `insert` (path, text, anchor `{afterLine}` or `{after: "some text"}`) | adds the code as whole lines below the anchor, then selects it |
| `openFile` (path, line?) | opens the file, optionally at a line |

Commands only work on files inside a folder open in VS Code (or files already open).

## Code layout

- `src/extension.ts` — the only file that uses the `vscode` API: wires VS Code events and editor actions.
- `src/commands.ts` — carries out the four commands against a small `Editor` interface (no `vscode` import).
- `src/reporter.ts` — waits for pauses and sends events (no `vscode` import).
- `src/connection.ts` — reads bridge.json, says hello, reconnects (no `vscode` import).

## Commands

```sh
npm ci                 # inside extensions/vscode
npm run compile        # copy the protocol, type-check, bundle with esbuild into dist/extension.js
npm test               # the helper's tests (fake editor, fake clock, fake socket)
npx vsce package       # makes stride-learn-helper-<version>.vsix
code --install-extension stride-learn-helper-0.1.0.vsix
```

The tests in `tests/` here also run as part of the root `npm test` (they only need packages the root already has), together
with `tests/learn/bridge.test.ts`, which runs the real bridge against a real WebSocket client and the helper's real
connection code.

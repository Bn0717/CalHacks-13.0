// Tells Stride what the student is doing in VS Code: edits, saves, error underlines, which file is in front and the cursor.
// Edits wait for a short pause in typing, so Stride gets one message per pause instead of one per key.
// Nothing here imports vscode, so it can be tested with fake timers.
import { MAX_TEXT, type Diagnostic, type EditorEvent } from "./protocol";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ReporterOptions {
  changeDelayMs?: number;
  diagnosticsDelayMs?: number;
  cursorDelayMs?: number;
  timers?: Timers;
}

export class Reporter {
  private readonly pending = new Map<string, unknown>(); // timer per "kind:path"
  private lastActive: string | null | undefined;
  private readonly changeDelayMs: number;
  private readonly diagnosticsDelayMs: number;
  private readonly cursorDelayMs: number;
  private readonly timers: Timers;

  constructor(
    private readonly send: (event: EditorEvent) => void,
    options: ReporterOptions = {},
  ) {
    this.changeDelayMs = options.changeDelayMs ?? 300;
    this.diagnosticsDelayMs = options.diagnosticsDelayMs ?? 300;
    this.cursorDelayMs = options.cursorDelayMs ?? 150;
    this.timers = options.timers ?? realTimers;
  }

  // The file changed. The text is read only when the pause comes, so typing stays fast.
  change(path: string, text: () => string, version: number): void {
    this.later(`change:${path}`, this.changeDelayMs, () => {
      const t = text();
      if (t.length <= MAX_TEXT) this.send({ type: "change", path, text: t, version });
    });
  }

  // A save is sent straight away, and replaces any edit still waiting for that file.
  save(path: string, text: string, version: number): void {
    this.cancel(`change:${path}`);
    if (text.length <= MAX_TEXT) this.send({ type: "save", path, text, version });
  }

  diagnostics(path: string, items: Diagnostic[]): void {
    this.later(`diagnostics:${path}`, this.diagnosticsDelayMs, () => this.send({ type: "diagnostics", path, items: items.slice(0, 500) }));
  }

  // Sent straight away, but only when the file in front actually changes.
  active(path: string | null, languageId?: string): void {
    if (path === this.lastActive) return;
    this.lastActive = path;
    this.send(languageId === undefined ? { type: "active", path } : { type: "active", path, languageId });
  }

  cursor(path: string, line: number, column: number): void {
    this.later("cursor", this.cursorDelayMs, () => this.send({ type: "cursor", path, line, column }));
  }

  // Forget what was sent, e.g. after reconnecting, so the next update goes out again.
  reset(): void {
    this.lastActive = undefined;
  }

  dispose(): void {
    for (const handle of this.pending.values()) this.timers.clear(handle);
    this.pending.clear();
  }

  private later(key: string, ms: number, fn: () => void): void {
    this.cancel(key);
    this.pending.set(
      key,
      this.timers.set(() => {
        this.pending.delete(key);
        fn();
      }, ms),
    );
  }

  private cancel(key: string): void {
    const handle = this.pending.get(key);
    if (handle !== undefined) this.timers.clear(handle);
    this.pending.delete(key);
  }
}

// VS Code's diagnostic shape, just the parts we read (lines and columns counted from 0, severity 0 = error … 3 = hint).
export interface CodeDiagnostic {
  severity: number;
  message: string;
  source?: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

const SEVERITY = ["error", "warning", "info", "hint"] as const;

// Turn VS Code's error underlines into the protocol's shape (counted from 1, like the editor shows them).
export function toDiagnostics(list: readonly CodeDiagnostic[]): Diagnostic[] {
  return list.slice(0, 500).map((d) => ({
    severity: SEVERITY[d.severity] ?? "info",
    message: d.message.slice(0, 2000),
    line: d.range.start.line + 1,
    column: d.range.start.character + 1,
    endLine: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    ...(d.source ? { source: d.source.slice(0, 100) } : {}),
  }));
}

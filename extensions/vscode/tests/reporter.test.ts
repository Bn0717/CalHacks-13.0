import { describe, expect, it } from "vitest";
import type { EditorEvent } from "../src/protocol";
import { Reporter, toDiagnostics, type Timers } from "../src/reporter";

// A clock we move by hand.
class FakeClock implements Timers {
  now = 0;
  private next = 1;
  private jobs = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.jobs.set(id, { at: this.now + ms, fn });
    return id;
  }
  clear(handle: unknown): void {
    this.jobs.delete(handle as number);
  }
  tick(ms: number): void {
    this.now += ms;
    for (const [id, job] of [...this.jobs].sort((a, b) => a[1].at - b[1].at)) {
      if (job.at <= this.now) {
        this.jobs.delete(id);
        job.fn();
      }
    }
  }
}

function setup() {
  const clock = new FakeClock();
  const sent: EditorEvent[] = [];
  const reporter = new Reporter((e) => sent.push(e), { timers: clock, changeDelayMs: 300, diagnosticsDelayMs: 300, cursorDelayMs: 150 });
  return { clock, sent, reporter };
}

describe("Reporter", () => {
  it("sends one change per pause in typing, with the latest text", () => {
    const { clock, sent, reporter } = setup();
    let reads = 0;
    const text = (t: string) => () => {
      reads++;
      return t;
    };
    reporter.change("/p/a.html", text("<h"), 1);
    clock.tick(100);
    reporter.change("/p/a.html", text("<h1"), 2);
    clock.tick(100);
    reporter.change("/p/a.html", text("<h1>"), 3);
    clock.tick(299);
    expect(sent).toEqual([]);
    clock.tick(1);
    expect(sent).toEqual([{ type: "change", path: "/p/a.html", text: "<h1>", version: 3 }]);
    expect(reads).toBe(1);
  });

  it("keeps changes to different files apart", () => {
    const { clock, sent, reporter } = setup();
    reporter.change("/p/a.html", () => "a", 1);
    reporter.change("/p/b.css", () => "b", 1);
    clock.tick(300);
    expect(sent.map((e) => (e as { path: string }).path).sort()).toEqual(["/p/a.html", "/p/b.css"]);
  });

  it("sends a save straight away and drops the change still waiting", () => {
    const { clock, sent, reporter } = setup();
    reporter.change("/p/a.html", () => "x", 4);
    reporter.save("/p/a.html", "x", 4);
    clock.tick(1000);
    expect(sent).toEqual([{ type: "save", path: "/p/a.html", text: "x", version: 4 }]);
  });

  it("debounces diagnostics per file and the cursor", () => {
    const { clock, sent, reporter } = setup();
    reporter.diagnostics("/p/a.css", []);
    reporter.cursor("/p/a.html", 1, 1);
    reporter.cursor("/p/a.html", 2, 7);
    clock.tick(150);
    expect(sent).toEqual([{ type: "cursor", path: "/p/a.html", line: 2, column: 7 }]);
    clock.tick(150);
    expect(sent.at(-1)).toEqual({ type: "diagnostics", path: "/p/a.css", items: [] });
  });

  it("sends the active file only when it changes, and again after reset", () => {
    const { sent, reporter } = setup();
    reporter.active("/p/a.html", "html");
    reporter.active("/p/a.html", "html");
    reporter.active(null);
    reporter.reset();
    reporter.active(null);
    expect(sent).toEqual([
      { type: "active", path: "/p/a.html", languageId: "html" },
      { type: "active", path: null },
      { type: "active", path: null },
    ]);
  });

  it("sends nothing after dispose", () => {
    const { clock, sent, reporter } = setup();
    reporter.change("/p/a.html", () => "x", 1);
    reporter.dispose();
    clock.tick(1000);
    expect(sent).toEqual([]);
  });
});

describe("toDiagnostics", () => {
  it("turns VS Code's underlines into lines and columns counted from 1", () => {
    expect(
      toDiagnostics([
        { severity: 0, message: "Unexpected }", source: "css", range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } } },
        { severity: 3, message: "Unused", range: { start: { line: 0, character: 4 }, end: { line: 1, character: 2 } } },
      ]),
    ).toEqual([
      { severity: "error", message: "Unexpected }", source: "css", line: 4, column: 1, endLine: 4, endColumn: 2 },
      { severity: "hint", message: "Unused", line: 1, column: 5, endLine: 2, endColumn: 3 },
    ]);
  });
});

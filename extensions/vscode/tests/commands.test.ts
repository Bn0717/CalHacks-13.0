import { describe, expect, it } from "vitest";
import { handleCommand, planInsert, type Editor } from "../src/commands";

// A pretend VS Code: files are plain strings, and every call is written down.
class FakeEditor implements Editor {
  calls: string[] = [];
  files = new Map<string, string>([["/proj/index.html", "<body>\n  <h1>Hi</h1>\n</body>\n"]]);
  acceptEdits = true;

  allowed(path: string): boolean {
    return path.startsWith("/proj/");
  }
  async open(path: string, line?: number): Promise<string> {
    this.calls.push(`open ${path}${line ? `:${line}` : ""}`);
    const text = this.files.get(path);
    if (text === undefined) throw new Error("File not found");
    return text;
  }
  async insertAt(path: string, offset: number, text: string): Promise<boolean> {
    this.calls.push(`insert ${path}@${offset}`);
    if (!this.acceptEdits) return false;
    const doc = this.files.get(path)!;
    this.files.set(path, doc.slice(0, offset) + text + doc.slice(offset));
    return true;
  }
  select(path: string, startLine: number, endLine: number): void {
    this.calls.push(`select ${path} ${startLine}-${endLine}`);
  }
  highlight(path: string, startLine: number, endLine: number, message?: string): void {
    this.calls.push(`highlight ${path} ${startLine}-${endLine}${message ? ` "${message}"` : ""}`);
  }
  clearHighlights(): void {
    this.calls.push("clear");
  }
}

describe("planInsert", () => {
  const doc = "a\nb\nc\n";
  it("adds code below a line number", () => {
    expect(planInsert(doc, { afterLine: 1 }, "x")).toEqual({ offset: 2, text: "x\n", startLine: 2, endLine: 2 });
    expect(planInsert(doc, { afterLine: 0 }, "x\ny\n")).toEqual({ offset: 0, text: "x\ny\n", startLine: 1, endLine: 2 });
  });

  it("adds code at the end, with a line break if the file has none", () => {
    expect(planInsert(doc, { afterLine: 3 }, "x")).toEqual({ offset: 6, text: "x\n", startLine: 4, endLine: 4 });
    expect(planInsert(doc, { afterLine: 99 }, "x")).toMatchObject({ offset: 6, startLine: 4 });
    expect(planInsert("a\nb", { afterLine: 2 }, "x")).toEqual({ offset: 3, text: "\nx\n", startLine: 3, endLine: 3 });
    expect(planInsert("", { afterLine: 5 }, "x")).toEqual({ offset: 0, text: "x\n", startLine: 1, endLine: 1 });
  });

  it("adds code below the line holding some text", () => {
    expect(planInsert("<body>\n</body>\n", { after: "<body>" }, "  <p>Hi</p>")).toEqual({
      offset: 7,
      text: "  <p>Hi</p>\n",
      startLine: 2,
      endLine: 2,
    });
    expect(planInsert(doc, { after: "zzz" }, "x")).toEqual({ error: 'Couldn\'t find "zzz" in the file.' });
  });
});

describe("handleCommand", () => {
  it("highlights lines after opening the file", async () => {
    const ed = new FakeEditor();
    const done = await handleCommand({ type: "highlight", id: "1", path: "/proj/index.html", startLine: 2, endLine: 2, message: "Type here" }, ed);
    expect(done).toEqual({ type: "done", id: "1", command: "highlight", ok: true });
    expect(ed.calls).toEqual(["open /proj/index.html:2", 'highlight /proj/index.html 2-2 "Type here"']);
  });

  it("clears highlights", async () => {
    const ed = new FakeEditor();
    expect(await handleCommand({ type: "clearHighlight" }, ed)).toMatchObject({ ok: true, command: "clearHighlight" });
    expect(ed.calls).toEqual(["clear"]);
  });

  it("opens a file at a line", async () => {
    const ed = new FakeEditor();
    expect(await handleCommand({ type: "openFile", path: "/proj/index.html", line: 3 }, ed)).toMatchObject({ ok: true });
    expect(ed.calls).toEqual(["open /proj/index.html:3"]);
  });

  it("inserts \"Show me\" code at the anchor, then selects it", async () => {
    const ed = new FakeEditor();
    const done = await handleCommand(
      { type: "insert", id: "s1", path: "/proj/index.html", text: "  <p>About me</p>\n  <p>I bake.</p>", anchor: { after: "</h1>" } },
      ed,
    );
    expect(done).toEqual({ type: "done", id: "s1", command: "insert", ok: true, startLine: 3, endLine: 4 });
    expect(ed.files.get("/proj/index.html")).toBe("<body>\n  <h1>Hi</h1>\n  <p>About me</p>\n  <p>I bake.</p>\n</body>\n");
    expect(ed.calls.at(-1)).toBe("select /proj/index.html 3-4");
  });

  it("reports when the anchor isn't there or VS Code refuses the edit", async () => {
    const ed = new FakeEditor();
    expect(await handleCommand({ type: "insert", path: "/proj/index.html", text: "x", anchor: { after: "<footer>" } }, ed)).toMatchObject({
      ok: false,
      error: expect.stringContaining("<footer>"),
    });
    ed.acceptEdits = false;
    expect(await handleCommand({ type: "insert", path: "/proj/index.html", text: "x", anchor: { afterLine: 1 } }, ed)).toMatchObject({ ok: false });
    expect(ed.calls).not.toContain("select /proj/index.html 2-2");
  });

  it("refuses files outside the project and relative paths", async () => {
    const ed = new FakeEditor();
    expect(await handleCommand({ type: "openFile", path: "/etc/passwd" }, ed)).toMatchObject({ ok: false });
    expect(await handleCommand({ type: "openFile", path: "proj/index.html" }, ed)).toMatchObject({ ok: false });
    expect(ed.calls).toEqual([]);
  });

  it("turns errors from VS Code into a failed reply", async () => {
    const ed = new FakeEditor();
    expect(await handleCommand({ type: "openFile", path: "/proj/missing.html" }, ed)).toMatchObject({ ok: false, error: "File not found" });
  });

  it("ignores anything that isn't one of the four commands", async () => {
    const ed = new FakeEditor();
    for (const msg of [
      { type: "runShell", command: "rm -rf ~" },
      { type: "executeCommand", command: "workbench.action.terminal.new" },
      { type: "highlight", path: "/proj/index.html", startLine: 4, endLine: 1 },
      { type: "insert", path: "/proj/index.html", text: "x", anchor: {} },
      { type: "welcome", protocol: 1 },
      "highlight",
      null,
    ]) {
      expect(await handleCommand(msg, ed)).toBeUndefined();
    }
    expect(ed.calls).toEqual([]);
  });
});

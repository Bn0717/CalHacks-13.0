import { describe, expect, it } from "vitest";
import { anchorLine, hasCode, insertAtAnchor, pointLine } from "../../src/learn/anchor.js";
import { aboutMe } from "./runner-fakes.js";

const page = "<!DOCTYPE html>\n<html>\n  <head>\n    <title>About Me</title>\n  </head>\n  <body>\n  </body>\n</html>\n";

describe("insertAtAnchor", () => {
  it("puts code at the top of an empty file", () => {
    expect(insertAtAnchor("", { afterLine: 0 }, "<p>hi</p>")).toEqual({ content: "<p>hi</p>\n", line: 1, found: true });
  });

  it("puts code after a line number", () => {
    const r = insertAtAnchor("a\nb\nc\n", { afterLine: 2 }, "X\n");
    expect(r.content).toBe("a\nb\nX\nc\n");
    expect(r.line).toBe(3);
  });

  it("puts code after the line holding some text", () => {
    const r = insertAtAnchor(page, { after: "</title>" }, '    <link rel="stylesheet" href="style.css">\n');
    expect(r.content).toContain('<title>About Me</title>\n    <link rel="stylesheet" href="style.css">\n  </head>');
    expect(r.line).toBe(5);
  });

  it("puts code inside an element, just before it closes", () => {
    const r = insertAtAnchor(page, { inside: "body" }, "    <h1>Hi</h1>\n");
    expect(r.content).toContain("  <body>\n    <h1>Hi</h1>\n  </body>");
    expect(r.line).toBe(7);
  });

  it("splits the line when the element opens and closes on one line", () => {
    const r = insertAtAnchor("<body></body>\n", { inside: "<body>" }, "<h1>Hi</h1>");
    expect(r.content).toBe("<body>\n<h1>Hi</h1>\n</body>\n");
    expect(r.found).toBe(true);
  });

  it("puts code inside a CSS rule", () => {
    const r = insertAtAnchor("h1 {\n  color: red;\n}\n", { inside: "h1" }, "  font-size: 40px;\n");
    expect(r.content).toBe("h1 {\n  color: red;\n  font-size: 40px;\n}\n");
  });

  it("adds at the end when the anchor isn't in the file", () => {
    const r = insertAtAnchor("<p>one</p>\n", { after: "</nav>" }, "<p>two</p>");
    expect(r).toEqual({ content: "<p>one</p>\n<p>two</p>\n", line: 2, found: false });
  });

  it("rebuilds the about-me project from its steps' expected code", () => {
    const lesson = aboutMe();
    const files = new Map<string, string>();
    for (const step of lesson.steps.filter((s) => s.who === "learner")) {
      files.set(step.file!, insertAtAnchor(files.get(step.file!) ?? "", step.anchor, step.expected).content);
    }
    for (const f of lesson.files) expect(files.get(f.path)).toBe(f.content);
  });
});

describe("helpers", () => {
  it("anchorLine says null when the anchor is missing", () => {
    expect(anchorLine(page, { after: "</nav>" })).toBeNull();
    expect(anchorLine(page, { inside: "main" })).toBeNull();
  });

  it("pointLine points at the anchor line", () => {
    expect(pointLine(page, { after: "</title>" })).toBe(4);
    expect(pointLine("", { afterLine: 0 })).toBe(1);
  });

  it("hasCode ignores spacing", () => {
    expect(hasCode("<ul>\n    <li>A</li>\n</ul>", "<ul> <li>A</li> </ul>")).toBe(true);
    expect(hasCode("<ul></ul>", "<li>A</li>")).toBe(false);
    expect(hasCode("anything", "   ")).toBe(false);
  });
});

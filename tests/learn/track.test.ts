// "Not finished yet" vs "wrong": the lines the student added are the first lines of the step's code (src/learn/check/track.ts).
import { describe, expect, it } from "vitest";
import { addedLines, lineShape, onTrack } from "../../src/learn/check/track.js";

const start = "<body>\n</body>\n</html>\n";
const expected = "    <h1>Hi, I'm Sam</h1>\n    <p>I'm learning to make websites.</p>\n    <p>This page is all about me.</p>\n";
const now = (lines: string) => `<body>\n${lines}</body>\n</html>\n`;

describe("onTrack", () => {
  it("ignores spacing, case and the student's own words inside tags", () => {
    expect(lineShape("  <H1>Hi, I'm Bryan</H1> ")).toBe(lineShape("<h1>Hi, I'm Sam</h1>"));
    expect(lineShape("<li>Drawing<li>")).not.toBe(lineShape("<li>Drawing</li>"));
  });

  it("finds the lines added between the lines that were already there", () => {
    expect(addedLines(start, now("<h1>Yo</h1>\n"))).toEqual(["<h1></h1>"]);
  });

  it.each([
    { name: "the first line, right", lines: "  <h1>Hi, I'm Bryan</h1>\n", n: 1 },
    { name: "the first two lines, right", lines: "<h1>Hey</h1>\n<p>I skate.</p>\n", n: 2 },
    { name: "nothing added", lines: "", n: 0 },
    { name: "a wrong first line", lines: "<h2>Hi</h2>\n", n: 0 },
    { name: "a right line after a wrong one", lines: "<h2>Hi</h2>\n<p>I skate.</p>\n", n: 0 },
    { name: "every line (then it's done or wrong, not unfinished)", lines: "<h1>a</h1>\n<p>b</p>\n<p>c</p>\n", n: 0 },
  ])("$name -> $n", ({ lines, n }) => {
    expect(onTrack(start, now(lines), expected)).toBe(n);
  });
});

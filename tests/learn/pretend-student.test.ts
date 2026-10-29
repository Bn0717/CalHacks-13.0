import { describe, expect, it } from "vitest";
import { halfTyped, mistakePlan, wrongTry } from "../../src/learn/pretend-student.js";
import type { Step } from "../../src/learn/lesson.js";

const step = (id: string, file: string, expected: string, who: Step["who"] = "learner") => ({ id, file, expected, who }) as Step;

describe("the pretend student", () => {
  it("misspells the first HTML tag everywhere, but only whole tag names", () => {
    expect(wrongTry(step("a", "index.html", "<h1>Hi</h1>\n<h1x>no</h1x>\n"))).toBe("<h>Hi</h>\n<h1x>no</h1x>\n");
    expect(wrongTry(step("a", "index.html", "<p>Hi</p>\n"))).toBe("<pp>Hi</pp>\n");
  });

  it("writes herf for a link and scr for a picture", () => {
    expect(wrongTry(step("a", "index.html", '<link rel="stylesheet" href="style.css">\n'))).toBe('<link rel="stylesheet" herf="style.css">\n');
    expect(wrongTry(step("a", "index.html", '<img src="a.png" alt="a">\n'))).toBe('<img scr="a.png" alt="a">\n');
  });

  it("misspells the first CSS property", () => {
    expect(wrongTry(step("a", "style.css", "h1 {\n  color: tomato;\n}\n"))).toBe("h1 {\n  colorr: tomato;\n}\n");
  });

  it("cuts HTML off in the middle of the last tag", () => {
    expect(halfTyped(step("a", "index.html", "<ul>\n  <li>A</li>\n</ul>\n"))).toBe("<ul>\n  <li>A</li>\n</");
    expect(halfTyped(step("a", "style.css", "h1 {}\n"))).toBeNull();
  });

  it("plans two wrong tries and one half-typed save on different learner steps", () => {
    const steps = [
      step("setup", "index.html", "", "stride"),
      ...["a", "b", "c", "d", "e"].map((id) => step(id, "index.html", `<p>${id}</p>\n<p>${id}</p>\n`)),
    ];
    const plan = mistakePlan({ steps });
    expect(plan.wrong).toEqual(["b", "d"]);
    expect(plan.half).toEqual(["c"]);
  });
});

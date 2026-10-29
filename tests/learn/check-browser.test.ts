// Runs the checker against a real hidden Chromium. Skipped when no browser can start (e.g. on a machine without one).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { checkStep, playwrightRenderer } from "../../src/learn/check/index.js";
import { parseLesson, type Check, type ProjectFile, type Step } from "../../src/learn/lesson.js";

const lesson = parseLesson(readFileSync(new URL("./fixtures/about-me.lesson.json", import.meta.url), "utf8"));
const renderer = playwrightRenderer();

const canLaunch = await renderer
  .render({ page: "index.html", files: [{ path: "index.html", content: "<p>hi</p>" }], probes: [{ kind: "count", selector: "p" }] })
  .then((r) => r.answers[0] === 1)
  .catch(() => false);

function step(checks: Check[], file = "index.html"): Step {
  return { id: "s", chapter: "c", title: "t", instruction: "i", why: "w", who: "learner", file, expected: "", checks, hints: ["a", "b", "c"] };
}

const withCss = (css: string, extra = ""): ProjectFile[] => [
  { path: "index.html", content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hi</h1><p>Text</p>${extra}</body></html>` },
  { path: "style.css", content: css },
];

describe.skipIf(!canLaunch)("checker with a real hidden browser", () => {
  afterAll(() => renderer.close());

  it("every check in the about-me lesson passes on its finished files", async () => {
    for (const s of lesson.steps) {
      const r = await checkStep(s, lesson.files, { renderer });
      expect(r.status, `step ${s.id}: ${r.message}`).toBe("pass");
    }
  });

  it("applies the linked stylesheet and compares computed colours", async () => {
    const tomato: Check = { type: "cssProperty", file: "index.html", selector: "h1", property: "color", value: "rgb(255, 99, 71)" };
    expect((await checkStep(step([tomato]), withCss("h1 { color: tomato; }"), { renderer })).status).toBe("pass");
    expect((await checkStep(step([tomato]), withCss("h1 { color: blue; }"), { renderer })).status).toBe("fail");
    // The expected value can be written the way a student would, too.
    const named: Check = { ...tomato, value: "tomato" };
    expect((await checkStep(step([named]), withCss("h1 { color: #ff6347; }"), { renderer })).status).toBe("pass");
  });

  it("tells 'set by the student' from the browser default", async () => {
    const weight: Check = { type: "cssProperty", file: "index.html", selector: "p", property: "font-weight" };
    expect((await checkStep(step([weight]), withCss("p { font-weight: bold; }"), { renderer })).status).toBe("pass");
    expect((await checkStep(step([weight]), withCss("h1 { color: red; }"), { renderer })).status).toBe("fail");
  });

  it("answers selectors the quick matcher can't read, and collects console errors", async () => {
    const r = await checkStep(
      step([{ type: "selectorExists", selector: "h1 + p" }, { type: "cssProperty", selector: "h1", property: "color" }]),
      withCss("", "<script>notDefined()</script>"),
      { renderer },
    );
    expect(r.status).toBe("partial");
    expect(r.failed.map((c) => c.type)).toEqual(["cssProperty"]);
    expect(r.consoleErrors.join(" ")).toContain("notDefined");
  });

  // tsx (used by npm run learn) wraps named helpers in __name(...), which doesn't exist inside the page.
  it("still reads styles when the checker runs through tsx", async () => {
    const tsx = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));
    const script = fileURLToPath(new URL("./fixtures/render-under-tsx.ts", import.meta.url));
    const { stdout } = await promisify(execFile)(tsx, [script], { timeout: 60_000 });
    expect(JSON.parse(stdout)).toEqual({ answers: [{ values: [{ value: "rgb(255, 99, 71)", base: "rgb(0, 0, 0)" }], want: "rgb(255, 99, 71)" }], consoleErrors: [] });
  }, 60_000);
});

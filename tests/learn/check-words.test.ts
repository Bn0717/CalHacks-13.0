// The checker's messages are for a 14-year-old who has never coded: plain words, never raw CSS selectors or code jargon.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reasons } from "../../src/learn/check/hint.js";
import { checkStep, type Renderer } from "../../src/learn/check/index.js";
import { describeSelector, JARGON, propertyWords, withArticle } from "../../src/learn/check/words.js";
import { parseLesson, type Check, type Step } from "../../src/learn/lesson.js";

const say = (selector: string) => withArticle(describeSelector(selector));

describe("selectors in words", () => {
  it.each([
    ["h1", "a big heading (<h1>)"],
    ["body h1", "a big heading (<h1>) inside the page"],
    ["header nav a", "a link (<a>) inside the menu (<nav>)"],
    ["ul li", "a list item (<li>) inside the bullet list (<ul>)"],
    ["body > ul > li", "a list item (<li>) inside the bullet list (<ul>)"],
    ["head link", "a link to a style file (<link>) inside the head part (<head>)"],
    ["title", "the page title (<title>)"],
    [".card", 'a part with class="card"'],
    ["div.card h3", 'a small heading (<h3>) inside the box (<div>) with class="card"'],
    ["#menu", 'the part with id="menu"'],
    ["img[alt]", "a picture (<img>) with an alt"],
    ["li:first-child", "the first list item (<li>)"],
    ["a:hover", "a link (<a>) when the mouse is over it"],
    ["h1, h2", "a big heading (<h1>) or smaller heading (<h2>)"],
    ["marquee", "a <marquee> part"],
    ["*", "everything"],
    ["h1 + p", "the part of the page"],
  ])("%j -> %j", (selector, words) => {
    expect(say(selector)).toBe(words);
  });

  it("names CSS properties in words", () => {
    expect(propertyWords("color")).toBe("text colour");
    expect(propertyWords("margin-top")).toBe("space around the outside (margin) on the top");
    expect(propertyWords("zoom")).toBe("zoom setting");
  });
});

describe("the about-me lesson's wrong tries", () => {
  const lesson = parseLesson(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/about-me.lesson.json"), "utf8")));
  // A fake browser that never finds the style, so CSS checks fail with a message too.
  const renderer: Renderer = { render: async (r) => ({ answers: r.probes.map(() => ({ values: [] })), consoleErrors: [] }), close: async () => {} };

  it("never show code jargon or a raw selector, whatever the student typed", async () => {
    const tries = (expected: string) => ["", expected.slice(0, Math.floor(expected.length / 2)), expected.replace(/<\/\w+>/, ""), "<p>hello</p>"];
    const messages: string[] = [];
    for (const step of lesson.steps.filter((s) => s.who === "learner")) {
      const others = lesson.files.filter((f) => f.path !== step.file);
      for (const typed of tries(step.expected)) {
        const files = [...others, { path: step.file!, content: typed }];
        const r = await checkStep(step, typed === "" ? others : files, { renderer });
        if (r.status === "pass") continue;
        messages.push(r.message);
        expect(r.message, r.message).not.toMatch(JARGON);
        for (const c of step.checks) if ("selector" in c && c.selector.includes(" ")) expect(r.message).not.toContain(c.selector);
      }
    }
    expect(messages.length).toBeGreaterThan(10);
  });

  it("uses a check's own plain words when it has them, but not when they hold code words", async () => {
    const step = lesson.steps.find((s) => s.id === "intro")!;
    const page = { path: "index.html", content: "<html><body></body></html>" };
    const plain = { ...step, checks: [{ type: "selectorExists" as const, selector: "body h1", say: "I can't see your name as a big heading yet." }] };
    expect((await checkStep(plain, [page])).message).toBe("I can't see your name as a big heading yet.");
    const jargon = { ...step, checks: [{ type: "selectorExists" as const, selector: "body h1", say: "The selector body h1 matches no element." }] };
    expect((await checkStep(jargon, [page])).message).toBe("I can't see a big heading (<h1>) inside the page yet.");
  });
});

describe("checker messages", () => {
  it("say what's missing in words, like the brief's example", () => {
    expect(reasons.notFound("body h1")).toBe("I can't see a big heading (<h1>) inside the page yet.");
    expect(reasons.wrongCount("ul li", 2, 3)).toBe("I see 2 list items (<li>) inside the bullet list (<ul>), but this step needs 3.");
    expect(reasons.wrongCount("ul li", 1, 3)).toBe("I see 1 list item (<li>) inside the bullet list (<ul>), but this step needs 3.");
    expect(reasons.wrongText("title", "about me")).toBe('The page title (<title>) should say "about me".');
    expect(reasons.missingAttr("img", "alt")).toBe("The picture (<img>) still needs a short description of the picture (alt).");
    expect(reasons.missingAttr("head link", "href", "style.css")).toBe(
      'The link to a style file (<link>) inside the head part (<head>) needs href="style.css".',
    );
    expect(reasons.wrongStyle("h1", "color")).toBe("The big heading (<h1>) doesn't have the right text colour yet.");
    expect(reasons.wrongStyle("body", "font-family", true)).toBe("The page body (<body>) doesn't have its own font yet.");
    expect(reasons.missingFile("style.css")).toBe("There's no file called style.css in your project folder yet.");
  });

  it("never use code jargon or raw selectors, for any kind of check", async () => {
    const page = { path: "index.html", content: "<!DOCTYPE html><html><head><title>Hi</title></head><body><ul><li>a</li></ul></body></html>" };
    const checks: Check[] = [
      { type: "selectorExists", selector: "body h1" },
      { type: "selectorExists", selector: "ul li", count: 3 },
      { type: "textIncludes", selector: "title", text: "about me" },
      { type: "attribute", selector: "head link", name: "href", value: "style.css" },
      { type: "attribute", selector: "html", name: "lang" },
      { type: "selectorExists", selector: "nav > a.active" },
      { type: "fileExists", file: "style.css" },
    ];
    for (const check of checks) {
      const step = { id: "s", chapter: "c", title: "t", instruction: "i", why: "w", who: "learner", file: "index.html", expected: "", checks: [check], hints: ["a", "b", "c"] } as Step;
      const { message } = await checkStep(step, [page]);
      expect(message).not.toMatch(JARGON);
      if ("selector" in check) expect(message).not.toContain(`"${check.selector}"`);
    }
  });
});

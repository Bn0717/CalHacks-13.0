import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { haikuJudge } from "../../src/learn/check/ai.js";
import { checkRunner, checkStep, type Judge, type Probe, type Renderer, type RenderResult } from "../../src/learn/check/index.js";
import { cssProblem, jsProblem, readHtml } from "../../src/learn/check/parse.js";
import { parseSelector, querySelectorAll, UnsupportedSelector } from "../../src/learn/check/selector.js";
import { parseLesson, type Check, type ProjectFile, type Step } from "../../src/learn/lesson.js";
import { selfValidateSteps } from "../../src/learn/validate.js";

const lesson = parseLesson(readFileSync(new URL("./fixtures/about-me.lesson.json", import.meta.url), "utf8"));

function step(checks: Check[], file = "index.html", expected = ""): Step {
  return { id: "s", chapter: "c", title: "A step", instruction: "Do it", why: "w", who: "learner", file, expected, checks, hints: ["a", "b", "c"] };
}

const html = (body: string, head = "<title>About Me</title>"): ProjectFile => ({
  path: "index.html",
  content: `<!DOCTYPE html>\n<html>\n<head>${head}</head>\n<body>\n${body}\n</body>\n</html>\n`,
});

const PAGE = html(
  `<header><h1 id="top" class="big title">Hi, I'm Sam</h1></header>
<p>I like <b>drawing</b>.</p>
<ul class="list"><li>A</li><li>B</li><li>C</li></ul>
<img src="me.png" alt="Me">
<a href="https://example.com" target="_blank">Link</a>`,
  `<title>About Me</title><link rel="stylesheet" href="style.css">`,
);

// A browser that must never be used.
function noRenderer(): Renderer & { render: ReturnType<typeof vi.fn> } {
  return { render: vi.fn(async () => Promise.reject(new Error("level 2 should not run"))), close: vi.fn(async () => {}) };
}

// A judge that must never be asked.
function noJudge(): Judge & ReturnType<typeof vi.fn> {
  return vi.fn(async () => Promise.reject(new Error("level 3 should not run")));
}

// A fake browser that answers each probe with `answer(probe)`.
function fakeRenderer(answer: (p: Probe) => RenderResult["answers"][number], consoleErrors: string[] = []) {
  const render = vi.fn(async ({ probes }: { probes: Probe[] }) => ({ answers: probes.map(answer), consoleErrors }));
  return { render, close: vi.fn(async () => {}) };
}

describe("level 1: each check type, decided without a browser or model", () => {
  const cases: { name: string; check: Check; files?: ProjectFile[]; file?: string; status: "pass" | "partial" | "fail" }[] = [
    { name: "parses: good HTML", check: { type: "parses" }, status: "pass" },
    { name: "parses: unclosed <ul>", check: { type: "parses" }, files: [html("<ul><li>A</li>")], status: "partial" },
    { name: "parses: tag cut off", check: { type: "parses" }, files: [html("<h1>Hi</h1><p")], status: "partial" },
    { name: "parses: missing file", check: { type: "parses" }, files: [], status: "fail" },
    { name: "parses: good CSS", check: { type: "parses", file: "style.css" }, files: [{ path: "style.css", content: "h1 { color: red; }" }], status: "pass" },
    { name: "parses: CSS missing }", check: { type: "parses", file: "style.css" }, files: [{ path: "style.css", content: "h1 { color: red;" }], status: "partial" },
    { name: "parses: CSS empty value", check: { type: "parses", file: "style.css" }, files: [{ path: "style.css", content: "h1 { color: }" }], status: "partial" },
    { name: "parses: good JS", check: { type: "parses", file: "app.js" }, files: [{ path: "app.js", content: "const a = 1;\nexport {};" }], status: "pass" },
    { name: "parses: broken JS", check: { type: "parses", file: "app.js" }, files: [{ path: "app.js", content: "function f( {" }], status: "partial" },
    { name: "fileExists: there", check: { type: "fileExists", file: "index.html" }, status: "pass" },
    { name: "fileExists: missing", check: { type: "fileExists", file: "style.css" }, status: "fail" },
    { name: "selectorExists: descendant", check: { type: "selectorExists", selector: "body h1" }, status: "pass" },
    { name: "selectorExists: missing", check: { type: "selectorExists", selector: "footer" }, status: "fail" },
    { name: "selectorExists: child combinator", check: { type: "selectorExists", selector: "header > h1" }, status: "pass" },
    { name: "selectorExists: child combinator miss", check: { type: "selectorExists", selector: "body > h1" }, status: "fail" },
    { name: "selectorExists: id and classes", check: { type: "selectorExists", selector: "h1#top.big.title" }, status: "pass" },
    { name: "selectorExists: wrong class", check: { type: "selectorExists", selector: "h1.small" }, status: "fail" },
    { name: "selectorExists: attribute selector", check: { type: "selectorExists", selector: 'a[target="_blank"]' }, status: "pass" },
    { name: "selectorExists: comma list", check: { type: "selectorExists", selector: "footer, nav, ul.list" }, status: "pass" },
    { name: "selectorExists: :first-child", check: { type: "selectorExists", selector: "li:first-child", count: 1 }, status: "pass" },
    { name: "selectorExists: :nth-child", check: { type: "selectorExists", selector: "ul li:nth-child(3)", count: 1 }, status: "pass" },
    { name: "selectorExists: exact count", check: { type: "selectorExists", selector: "ul li", count: 3 }, status: "pass" },
    { name: "selectorExists: wrong count", check: { type: "selectorExists", selector: "ul li", count: 4 }, status: "fail" },
    { name: "selectorExists: count 0", check: { type: "selectorExists", selector: "footer", count: 0 }, status: "pass" },
    { name: "textIncludes: ignores case", check: { type: "textIncludes", selector: "title", text: "about me" }, status: "pass" },
    { name: "textIncludes: nested text", check: { type: "textIncludes", selector: "p", text: "like drawing" }, status: "pass" },
    { name: "textIncludes: wrong text", check: { type: "textIncludes", selector: "h1", text: "Hello" }, status: "fail" },
    { name: "textIncludes: no element", check: { type: "textIncludes", selector: "h2", text: "Hi" }, status: "fail" },
    { name: "attribute: has it", check: { type: "attribute", selector: "img", name: "alt" }, status: "pass" },
    { name: "attribute: right value", check: { type: "attribute", selector: "head link", name: "href", value: "style.css" }, status: "pass" },
    { name: "attribute: wrong value", check: { type: "attribute", selector: "head link", name: "href", value: "main.css" }, status: "fail" },
    { name: "attribute: missing", check: { type: "attribute", selector: "img", name: "title" }, status: "fail" },
  ];

  it.each(cases)("$name -> $status", async ({ check, files, status }) => {
    const renderer = noRenderer();
    const judge = noJudge();
    const r = await checkStep(step([check]), files ?? [PAGE], { renderer, judge });
    expect(r.status).toBe(status);
    expect(r.failed).toEqual(status === "pass" ? [] : [check]);
    expect(r.level).toBe(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("uses the step's file when a check has none", async () => {
    const files = [PAGE, { path: "other.html", content: "<p>no heading</p>" }];
    expect((await checkStep(step([{ type: "selectorExists", selector: "h1" }], "other.html"), files)).status).toBe("fail");
    expect((await checkStep(step([{ type: "selectorExists", selector: "h1" }], "index.html"), files)).status).toBe("pass");
    expect((await checkStep(step([{ type: "selectorExists", selector: "h1", file: "index.html" }], "other.html"), files)).status).toBe("pass");
  });
});

describe("parsers", () => {
  it("doesn't flag HTML the browser is happy with", () => {
    expect(readHtml("<p>one<p>two<ul><li>a<li>b</ul><br><img src=x>").problem).toBeUndefined();
    expect(readHtml(lesson.files[0]!.content).problem).toBeUndefined();
    expect(readHtml("").problem).toBeUndefined();
  });

  it("says what's unclosed and where", () => {
    expect(readHtml("<div>\n  <ul>\n    <li>a</li>\n</div>").problem).toEqual({ message: "The <ul> you started still needs its closing </ul>.", line: 2 });
  });

  it("checks CSS and JS", () => {
    expect(cssProblem(lesson.files[1]!.content)).toBeUndefined();
    expect(cssProblem("a { color: red; } }")?.message).toBe("There's an extra }.");
    expect(cssProblem("/* note")?.message).toContain("*/");
    expect(cssProblem("h1 color: red }")).toBeDefined();
    expect(jsProblem("let x = ;")).toBeDefined();
    expect(jsProblem("import x from './x.js';")).toBeUndefined();
  });
});

describe("selector matcher", () => {
  it.each(["h1 + p", "h1 ~ p", "p::before", "a:hover", "li:nth-child(2n+1)", "", "> p", "a,", "a[href^=http]"])("leaves %j to the browser", (sel) => {
    expect(() => parseSelector(sel)).toThrow(UnsupportedSelector);
  });

  it("matches like a browser for simple selectors", () => {
    const { doc } = readHtml(PAGE.content);
    const names = (sel: string) => querySelectorAll(doc, sel).map((e) => e.tagName);
    expect(names("*").length).toBeGreaterThan(10);
    expect(names("header h1, p")).toEqual(["h1", "p"]);
    expect(names("body > ul > li")).toEqual(["li", "li", "li"]);
    expect(names("li:last-child")).toEqual(["li"]);
    expect(names("[alt]")).toEqual(["img"]);
    expect(names("a[target=_blank]")).toEqual(["a"]);
    expect(names("H1")).toEqual(["h1"]);
  });
});

describe("level 2: the hidden browser", () => {
  const red: Check = { type: "cssProperty", selector: "h1", property: "color", value: "rgb(255, 0, 0)" };

  it.each([
    { name: "matching computed value", answer: { values: [{ value: "rgb(255, 0, 0)", base: "rgb(0, 0, 0)" }] }, status: "pass" },
    { name: "value the browser computed from a name", answer: { values: [{ value: "rgb(255, 0, 0)", base: "x" }], want: "rgb(255, 0, 0)" }, status: "pass" },
    { name: "wrong value", answer: { values: [{ value: "rgb(0, 0, 255)", base: "rgb(0, 0, 0)" }] }, status: "fail" },
    { name: "no matching element", answer: { values: [] }, status: "fail" },
  ])("cssProperty: $name -> $status", async ({ answer, status }) => {
    const renderer = fakeRenderer(() => answer);
    const judge = noJudge();
    const r = await checkStep(step([red]), [PAGE], { renderer, judge });
    expect(r.status).toBe(status);
    expect(r.level).toBe(2);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render.mock.calls[0]![0]).toMatchObject({ page: "index.html", probes: [{ kind: "style", selector: "h1", property: "color" }] });
    expect(judge).not.toHaveBeenCalled();
  });

  it("cssProperty without a value passes when the student's CSS changed it", async () => {
    const check: Check = { type: "cssProperty", selector: "h1", property: "color" };
    const set = fakeRenderer(() => ({ values: [{ value: "rgb(255, 0, 0)", base: "rgb(0, 0, 0)" }] }));
    const unset = fakeRenderer(() => ({ values: [{ value: "rgb(0, 0, 0)", base: "rgb(0, 0, 0)" }] }));
    expect((await checkStep(step([check]), [PAGE], { renderer: set })).status).toBe("pass");
    expect((await checkStep(step([check]), [PAGE], { renderer: unset })).status).toBe("fail");
  });

  it("renders the page that loads a CSS file, once for all its probes", async () => {
    const css = { path: "style.css", content: "h1 { color: red; }" };
    const renderer = fakeRenderer(() => ({ values: [{ value: "rgb(255, 0, 0)", base: "rgb(0, 0, 0)" }] }));
    const checks: Check[] = [red, { ...red, selector: "p" }];
    const r = await checkStep(step(checks, "style.css"), [{ path: "about.html", content: "<p>x</p>" }, PAGE, css], { renderer });
    expect(r.status).toBe("pass");
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render.mock.calls[0]![0].page).toBe("index.html");
    expect(renderer.render.mock.calls[0]![0].probes).toHaveLength(2);
  });

  it("asks the browser about selectors the quick matcher can't read", async () => {
    const renderer = fakeRenderer((p) => (p.kind === "count" ? 1 : p.kind === "text" ? ["Hello there"] : ["x"]));
    const judge = noJudge();
    const checks: Check[] = [
      { type: "selectorExists", selector: "h1 + p" },
      { type: "textIncludes", selector: "h1 ~ p", text: "hello" },
      { type: "attribute", selector: "a:hover", name: "href" },
    ];
    const r = await checkStep(step(checks), [PAGE], { renderer, judge });
    expect(r.status).toBe("pass");
    expect(renderer.render.mock.calls[0]![0].probes.map((p: Probe) => p.kind)).toEqual(["count", "text", "attr"]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("mentions console errors when the step isn't done", async () => {
    const renderer = fakeRenderer(() => ({ values: [] }), ["Uncaught ReferenceError: x is not defined"]);
    const r = await checkStep(step([red]), [PAGE], { renderer });
    expect(r.consoleErrors).toEqual(["Uncaught ReferenceError: x is not defined"]);
    // The student hears that there's a problem, not the browser's code words.
    expect(r.message).toContain("shows a problem when it opens");
    expect(r.message).not.toContain("ReferenceError");
  });

  it("falls back to the model when the browser can't open", async () => {
    const renderer: Renderer = { render: async () => Promise.reject(new Error("no Chrome")), close: async () => {} };
    const judge = vi.fn<Judge>(async () => ({ answer: "yes", reason: "The heading is red." }));
    const r = await checkStep(step([red], "index.html", "h1 { color: red; }"), [PAGE], { renderer, judge });
    expect(r.status).toBe("pass");
    expect(r.level).toBe(3);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0]![0]).toMatchObject({ question: expect.stringContaining("color"), reference: "h1 { color: red; }" });
    expect(judge.mock.calls[0]![0].code).toContain("--- index.html ---");
  });

  it("with no browser and no model, an undecided check doesn't pass", async () => {
    const r = await checkStep(step([red]), [PAGE], {});
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/^I couldn't check this part yet\./);
  });
});

describe("level 3: the model", () => {
  const ai: Check = { type: "ai", question: "Does the paragraph describe the student?" };

  it.each([
    { answer: "yes" as const, status: "pass" },
    { answer: "no" as const, status: "fail" },
  ])("ai check answered $answer -> $status", async ({ answer, status }) => {
    const judge = vi.fn<Judge>(async () => ({ answer, reason: "It talks about drawing." }));
    const renderer = noRenderer();
    const r = await checkStep(step([ai], "index.html", "<p>About me</p>"), [PAGE], { judge, renderer });
    expect(r.status).toBe(status);
    expect(r.level).toBe(3);
    expect(judge.mock.calls[0]![0]).toMatchObject({ question: ai.question, stepTitle: "A step", file: "index.html", reference: "<p>About me</p>" });
    expect(renderer.render).not.toHaveBeenCalled();
    if (status === "fail") expect(r.message).toBe("It talks about drawing.");
  });

  it("isn't asked when the step is already partial without it", async () => {
    const judge = noJudge();
    const checks: Check[] = [{ type: "selectorExists", selector: "h1" }, { type: "selectorExists", selector: "footer" }, ai];
    const r = await checkStep(step(checks), [PAGE], { judge });
    expect(r.status).toBe("partial");
    expect(r.failed).toEqual([checks[1], ai]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("isn't asked when the code is half-typed", async () => {
    const judge = noJudge();
    const r = await checkStep(step([ai]), [html("<ul><li>a")], { judge });
    expect(r.status).toBe("partial");
    expect(judge).not.toHaveBeenCalled();
  });

  it("a model error counts as not passing yet", async () => {
    const judge = vi.fn<Judge>(async () => Promise.reject(new Error("offline")));
    const r = await checkStep(step([{ type: "selectorExists", selector: "h1" }, ai]), [PAGE], { judge });
    expect(r.status).toBe("partial");
    expect(r.failed).toEqual([ai]);
  });

  it("haikuJudge uses Haiku and validates the answer with Zod", async () => {
    const ask = vi.fn(async () => ({ answer: "yes", reason: "Looks right." }));
    const judge = haikuJudge(ask as never);
    const request = { stepTitle: "t", instruction: "i", question: "q?", file: "index.html", code: "<p>", reference: "<p>x</p>" };
    expect(await judge(request)).toEqual({ answer: "yes", reason: "Looks right." });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-haiku-5-5" }));
    ask.mockResolvedValueOnce({ answer: "maybe", reason: "" } as never);
    await expect(judge(request)).rejects.toThrow();
  });
});

describe("status: pass, partial, fail", () => {
  const h1: Check = { type: "selectorExists", selector: "h1" };
  const h2: Check = { type: "selectorExists", selector: "h2" };
  const nav: Check = { type: "selectorExists", selector: "nav" };

  it.each([
    { name: "all pass", checks: [h1], files: [PAGE], status: "pass" },
    { name: "some pass", checks: [h1, h2], files: [PAGE], status: "partial" },
    { name: "none pass", checks: [h2, nav], files: [PAGE], status: "fail" },
    { name: "file missing", checks: [h1], files: [], status: "fail" },
    { name: "empty file", checks: [h1], files: [{ path: "index.html", content: "" }], status: "fail" },
    { name: "checks pass but code is half-typed", checks: [h1], files: [html("<h1>Hi</h1>\n<p")], status: "partial" },
    { name: "nothing passes and code is half-typed", checks: [h2], files: [html("<h2")], status: "partial" },
  ])("$name -> $status", async ({ checks, files, status }) => {
    expect((await checkStep(step(checks), files)).status).toBe(status);
  });

  it("messages are short and plain", async () => {
    expect((await checkStep(step([h1]), [PAGE])).message).toBe("Nice, that works!");
    expect((await checkStep(step([h1, h2]), [PAGE])).message).toBe("Almost there. I can't see a smaller heading (<h2>) yet.");
    expect((await checkStep(step([h2]), [PAGE])).message).toBe("I can't see a smaller heading (<h2>) yet.");
    expect((await checkStep(step([h1]), [html("<ul>\n<li>a")])).message).toBe(
      "Still typing? The <ul> you started still needs its closing </ul> (line 5).",
    );
    expect((await checkStep(step([{ type: "selectorExists", selector: "li", count: 2 }]), [PAGE])).message).toBe(
      "I see 3 list items (<li>), but this step needs 2.",
    );
    expect((await checkStep(step([{ type: "fileExists", file: "style.css" }]), [PAGE])).message).toBe(
      "There's no file called style.css in your project folder yet.",
    );
  });
});

describe("hint selection", () => {
  const ok = (selector: string): Check => ({ type: "selectorExists", selector: `${selector}` });
  const P: Check[] = [ok("h1"), ok("p"), ok("ul")]; // all present in PAGE
  const F: Check[] = [ok("h2"), ok("nav"), ok("footer")]; // all missing

  it.each([
    { name: "nothing passes yet", checks: [F[0]!, F[1]!], files: [PAGE], hint: 0 },
    { name: "half-typed code", checks: [P[0]!, F[0]!], files: [html("<h1>x</h1><p")], hint: 0 },
    { name: "first failing check is a missing file", checks: [P[0]!, { type: "fileExists", file: "style.css" } as Check, F[0]!], files: [PAGE], hint: 0 },
    { name: "first failing check is 'parses'", checks: [{ type: "fileExists", file: "a.css" } as Check, { type: "parses", file: "a.css" } as Check], files: [PAGE, { path: "a.css", content: "}" }], hint: 0 },
    { name: "some progress, two things left", checks: [P[0]!, F[0]!, F[1]!], files: [PAGE], hint: 1 },
    { name: "nearly done, one thing left", checks: [P[0]!, P[1]!, F[0]!], files: [PAGE], hint: 2 },
    { name: "one of two left", checks: [P[0]!, F[0]!], files: [PAGE], hint: 2 },
  ])("$name -> hint $hint", async ({ checks, files, hint }) => {
    expect((await checkStep(step(checks), files)).hintIndex).toBe(hint);
  });
});

describe("the about-me lesson", () => {
  // A fake browser that knows the finished page: the h1 is tomato.
  const finishedBrowser = () => fakeRenderer((p) => (p.kind === "style" ? { values: [{ value: "rgb(255, 99, 71)", base: "rgb(0, 0, 0)" }] } : null));

  it("every check passes on the finished files", async () => {
    const renderer = finishedBrowser();
    const judge = noJudge();
    for (const s of lesson.steps) {
      const r = await checkStep(s, lesson.files, { renderer, judge });
      expect(r.status, `step ${s.id}: ${r.message}`).toBe("pass");
    }
    expect(renderer.render).toHaveBeenCalledTimes(1); // only the cssProperty step needs the browser
    expect(judge).not.toHaveBeenCalled();
  });

  it("self-validation keeps every check (passes when finished, first check fails on an empty project)", async () => {
    const r = await selfValidateSteps(lesson.steps, lesson.files, checkRunner({ renderer: finishedBrowser(), judge: noJudge() }));
    expect(r.problems).toEqual([]);
    expect(r.needsFix).toEqual([]);
  });

  it("a nearly-done skeleton is partial and gets the last hint", async () => {
    const skeleton = lesson.steps.find((s) => s.id === "skeleton")!;
    const r = await checkStep(skeleton, [{ path: "index.html", content: "<!DOCTYPE html>\n<html>\n<head>\n<title>My page</title>\n</head>\n<body>\n</body>\n</html>" }]);
    expect(r.status).toBe("partial");
    expect(r.failed.map((c) => c.type)).toEqual(["textIncludes"]);
    expect(r.hintIndex).toBe(2);
    expect(r.message).toBe('Almost there. The page title (<title>) should say "about me".');
  });
});

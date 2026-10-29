// The lesson screen in a real headless Chromium, through its preview page (src/app/ui/lesson-preview.html).
// Every state renders in light and dark at 1x and 2x text with no script errors, readable contrast, named controls, nothing
// cut off and the card never over the code; plus keys, Esc, remembering where the card is, and a whole lesson played through.
// Skipped when no browser can start (e.g. a machine without Chromium).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import { launchBrowser, openPreview, runLessonScreens, showState, startServer } from "../../scripts/lesson-screens.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */
const canLaunch = await launchBrowser()
  .then(async (b: any) => (await b.close(), true))
  .catch(() => false);

// GOAL.md B4: every state the lesson screen must have a design for.
const B4_STATES = [
  "building", "question", "question-multi", "picture", "estimate", "setup", "setup-ask", "your-turn", "typing", "checking",
  "passed", "partial", "hint-1", "hint-2", "hint-3", "show-me", "stuck", "want-hint", "concept", "quiz", "quiz-answered",
  "paused", "welcome-back", "error-no-key", "error-no-internet", "error-video", "finished",
];

describe.skipIf(!canLaunch)("lesson screen in a real browser", () => {
  let server: any;
  let browser: any;
  beforeAll(async () => {
    server = await startServer();
    browser = await launchBrowser();
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  // Opens the preview and records what the screen sends to the app.
  async function open() {
    const p = await openPreview(browser, server.url);
    await p.page.evaluate(() => {
      const w = window as any;
      w.__sent = [];
      const real = w.calhack.send;
      w.calhack.send = (channel: string, data: unknown) => { w.__sent.push({ channel, data }); real(channel, data); };
    });
    const sent = (): Promise<{ channel: string; data: any }[]> => p.page.evaluate(() => (window as any).__sent.filter((m: any) => m.channel !== "lesson-rect"));
    return { ...p, sent };
  }

  it("every state passes contrast, names, overflow, overlap, keyboard and words checks", async () => {
    const summary = await runLessonScreens({ quick: true, log: () => {} });
    for (const s of B4_STATES) expect(summary.states, `missing state ${s}`).toContain(s);
    const problems = summary.failed.map((r: any) => `${r.theme} ${r.size}x ${r.state}: ${r.failures.join("; ")}`);
    expect(problems).toEqual([]);
    expect(summary.results.length).toBe(summary.states.length * 4);
  }, 240_000);

  it("shortcut keys press the right buttons, and Esc closes the open card", async () => {
    const { page, context, errors, sent } = await open();
    await showState(page, "hint-3", "light", 1);
    await page.keyboard.press("s");
    await page.keyboard.press("n");
    expect((await sent()).map((m) => m.channel)).toEqual(expect.arrayContaining(["lesson-show-me", "lesson-skip"]));

    await showState(page, "concept", "light", 1);
    expect(await page.evaluate(() => (window as any).StrideLesson.layout.expanded)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as any).StrideLesson.layout.expanded)).toBe(false);
    await page.waitForFunction(() => (document.activeElement as HTMLElement)?.dataset.key === "more");
    await page.keyboard.press("m");
    expect(await page.evaluate(() => document.getElementById("lesson-card")!.classList.contains("is-expanded"))).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("remembers which side the card is on, and tells the app", async () => {
    const { page, context, sent } = await open();
    await page.evaluate(() => localStorage.clear());
    await showState(page, "your-turn", "light", 1);
    await page.keyboard.press("d");
    expect((await sent()).filter((m) => m.channel === "lesson-layout").pop()?.data).toEqual({ dock: "left", expanded: false });
    await page.reload();
    await page.evaluate(() => (window as any).lessonPreview.ready);
    expect(await page.evaluate(() => (window as any).StrideLesson.layout.dock)).toBe("left");
    expect(await page.evaluate(() => document.getElementById("lesson-root")!.dataset.dock)).toBe("left");
    await page.evaluate(() => localStorage.clear());
    await context.close();
  });

  it("tells screen readers what changed", async () => {
    const { page, context } = await open();
    await showState(page, "your-turn", "light", 1);
    expect(await page.textContent("#l-live")).toContain("Your turn. Say hi.");
    await showState(page, "passed", "light", 1);
    expect(await page.textContent("#l-live")).toContain("Nice, that works!");
    await showState(page, "error-no-internet", "light", 1);
    expect(await page.textContent("#l-alert")).toContain("You're offline");
    await context.close();
  });

  it("multi-pick questions send every pick, single ones answer on tap", async () => {
    const { page, context, sent } = await open();
    await showState(page, "question-multi", "light", 1);
    await page.click("text=Photos");
    expect(await page.getAttribute("[data-key=opt-3]", "aria-pressed")).toBe("true");
    await page.click("[data-key=next]");
    const answer = (await sent()).find((m) => m.channel === "lesson-answer");
    expect(answer?.data).toEqual({ id: "contents", answers: ["My name and a short intro", "My hobbies", "Photos"] });
    await context.close();
  });

  it("plays the whole about-me lesson from building to the finish screen", async () => {
    const { page, context, errors } = await open();
    await page.clock.install();
    await page.evaluate(() => (window as any).lessonPreview.play());
    const seen = new Set<string>();
    for (let i = 0; i < 160; i++) {
      await page.clock.runFor(500);
      const v = await page.evaluate(() => { const v = (window as any).StrideLesson.view; return v.screen === "step" ? "step:" + v.status : v.screen; });
      seen.add(v);
      if (v === "finished") break;
    }
    expect([...seen]).toEqual(expect.arrayContaining(["building", "question", "estimate", "setup", "step:stride-working", "step:typing", "step:checking", "step:partial", "step:stuck", "step:passed", "quiz", "finished"]));
    const finished = await page.evaluate(() => (window as any).StrideLesson.view);
    expect(finished).toMatchObject({ screen: "finished", steps: 5, alone: 4, hinted: 1 });
    expect(errors).toEqual([]);
    await context.close();
  }, 60_000);
});

import { describe, expect, it } from "vitest";
import { actionCommand, autopilot, type Action, type ActionRecord, type Shot } from "../src/agent/autopilot.js";
import type { AgentUI, MacDeps, ToolContext } from "../src/agent/tools.js";

const shot = (n = 0): Shot => ({ data: "img" + n, mediaType: "image/jpeg", width: 1000, height: 600, toScreen: 2 });
const act = (a: Partial<Action>): Action => ({ kind: "click", target: "the Add button", screen: "normal", personalChoice: false, effect: "navigates", stepNamesOption: false, handling: "agent", sensitivity: "routine", reason: "", x: 100, y: 50, ...a });

function setup(actions: Action[], guideAnswers: ("done" | "skip")[] = []) {
  const ran: string[] = [];
  const direct: string[] = [];
  const guided: string[] = [];
  let n = 0;
  const ui = { status() {}, say() {}, detail() {}, guide: async (g: { instruction: string }) => (guided.push(g.instruction), guideAnswers.shift() ?? "done") } as unknown as AgentUI;
  const mac = {
    execute: async (c: string) => (ran.push(c), { code: 0, output: "", timedOut: false, ranBy: "droid" as const }),
    run: async (c: string) => (direct.push(c), { code: 0, output: "", timedOut: false }),
    screen: { capture: async () => shot(n++) },
  } as unknown as MacDeps;
  const ctx: ToolContext = { mac, ui, evidence: [], diagnoses: new Map(), beforeAfter: [] };
  const queue = [...actions];
  const run = () => autopilot(ctx, { instruction: "Change the wallpaper", intervalMs: 0, wait: async () => {}, decide: async () => queue.shift() ?? act({ kind: "done" }) });
  return { run, ran, direct, guided, ctx };
}

describe("autopilot commands", () => {
  it("scales screenshot pixels to screen points", () => {
    const c = actionCommand(act({ x: 100, y: 50 }), shot())!;
    expect(c).toContain("const X = 200, Y = 100, N = 1;");
    expect(c).toContain("AXIsProcessTrusted");
    expect(actionCommand(act({ kind: "double_click", x: 100, y: 50 }), shot())).toContain("N = 2;");
  });
  it("refuses clicks outside the screenshot, odd keys and long or control-character text", () => {
    expect(actionCommand(act({ x: 5000 }), shot())).toBeNull();
    expect(actionCommand(act({ kind: "key", key: "cmd+q" }), shot())).toBeNull();
    expect(actionCommand(act({ kind: "type", text: "a\nb" }), shot())).toBeNull();
    expect(actionCommand(act({ kind: "type", text: "x".repeat(101) }), shot())).toBeNull();
  });
  it("can't be broken out of when typing", () => {
    const c = actionCommand(act({ kind: "type", text: `a" & (do shell script "x") & "` }), shot())!;
    expect(c).toContain('\\"');
    expect(c.startsWith("osascript -e '")).toBe(true);
  });
});

describe("autopilot loop: the AI's judgment decides the route", () => {
  it("routine actions the agent handles run directly, and the loop ends when the screen shows it's done", async () => {
    const t = setup([act({ target: "Wallpaper in the sidebar" }), act({ kind: "done", reason: "Wallpaper page is open" })]);
    const r = await t.run();
    expect(r.outcome).toBe("done");
    expect(t.direct).toHaveLength(1);
    expect(t.ran).toEqual([]);
    expect(t.guided).toEqual([]);
    expect(t.ctx.evidence.at(-1)).toMatchObject({ kind: "run", code: 0 });
  });

  it("sensitive actions the agent handles go through Droid", async () => {
    const t = setup([act({ kind: "key", key: "return", sensitivity: "sensitive", reason: "confirms a change" })]);
    await t.run();
    expect(t.ran).toHaveLength(1);
    expect(t.direct).toEqual([]);
  });

  it("hands an action to the person when the AI says it needs them, and carries on afterwards", async () => {
    const t = setup([act({ handling: "person", target: "the password box", reason: "Please enter your password" }), act({ target: "OK" })]);
    const r = await t.run();
    expect(t.guided).toEqual(["Please enter your password (the password box)"]);
    expect(t.ran).toEqual([]);
    expect(t.direct).toHaveLength(1);
    expect(r.outcome).toBe("done");
  });

  it("explains the one-time Accessibility permission instead of a vague failure, and opens that page", async () => {
    const t = setup([act({})]);
    (t.ctx.mac as { run: unknown }).run = async (c: string) =>
      c.startsWith("osascript") ? (t.direct.push(c), { code: 1, output: "osascript is not allowed assistive access. (-25211)", timedOut: false }) : (t.direct.push(c), { code: 0, output: "", timedOut: false });
    const r = await t.run();
    expect(r.needsAccessibility).toBe(true);
    expect(r.trail.at(-1)).toMatch(/Accessibility/);
    expect(t.direct.some((c) => c.includes("Privacy_Accessibility"))).toBe(true);
  });

  it.each(["sign_in", "payment", "permission_prompt", "personal_details"] as const)("never clicks or types on a %s screen, even if the AI says the agent can", async (screen) => {
    const t = setup([act({ screen, handling: "agent", target: "the submit button" }), act({ kind: "type", screen, handling: "agent", text: "hi" }), act({ kind: "key", key: "return", screen, handling: "agent" })]);
    await t.run();
    expect(t.direct).toEqual([]);
    expect(t.ran).toEqual([]);
    expect(t.guided).toHaveLength(3);
  });

  it("leaves a personal choice (like which wallpaper) to the person even if the AI said the agent could", async () => {
    const t = setup([act({ target: "the pink wallpaper", personalChoice: true, handling: "agent" }), act({ kind: "done" })]);
    await t.run();
    expect(t.direct).toEqual([]);
    expect(t.ran).toEqual([]);
    expect(t.guided).toHaveLength(1);
  });

  it("stops at once when Stop is pressed: no more clicks, and the person isn't asked again", async () => {
    let stop = false;
    const t = setup([act({ target: "one" }), act({ target: "two" }), act({ target: "three" })]);
    const r = await autopilot(t.ctx, { instruction: "x", intervalMs: 0, wait: async () => {}, stopped: () => stop, decide: async () => { const a = act({ target: "next" }); stop = t.direct.length >= 1; return a; } });
    expect(r.outcome).toBe("stopped");
    expect(t.direct).toHaveLength(1);
    expect(t.guided).toEqual([]);
  });

  it("does not click when Stop was pressed while the model was thinking", async () => {
    let stop = false;
    const t = setup([]);
    const r = await autopilot(t.ctx, { instruction: "x", intervalMs: 0, wait: async () => {}, stopped: () => stop, decide: async () => { stop = true; return act({}); } });
    expect(r.outcome).toBe("stopped");
    expect(t.direct).toEqual([]);
  });

  it("stops if the person skips", async () => {
    const t = setup([act({ handling: "person", reason: "Click Allow" })], ["skip"]);
    expect((await t.run()).outcome).toBe("skipped");
  });

  it("makes no keyword guesses: the same words can be agent or person depending on the AI's call", async () => {
    const t = setup([act({ target: "Privacy & Security in the sidebar", reason: "just opening the page" }), act({ kind: "done" })]);
    await t.run();
    expect(t.guided).toEqual([]);
    expect(t.direct).toHaveLength(1);
  });

  it("gives up without a screen", async () => {
    const t = setup([]);
    delete (t.ctx.mac as { screen?: unknown }).screen;
    expect((await t.run()).outcome).toBe("gave_up");
  });

  it("falls back to the person when the AI call fails", async () => {
    const t = setup([]);
    const r = await autopilot(t.ctx, { instruction: "x", intervalMs: 0, wait: async () => {}, decide: async () => { throw new Error("boom"); } });
    expect(r.outcome).toBe("gave_up");
    expect(t.direct).toEqual([]);
    expect(t.ran).toEqual([]);
  });
});

describe("autopilot: Stop and pointing", () => {
  it("Stop while Claude is deciding: its answer is never acted on", async () => {
    const t = setup([]);
    const stop = new AbortController();
    t.ctx.signal = stop.signal;
    const r = await autopilot(t.ctx, {
      instruction: "Change the wallpaper",
      intervalMs: 0,
      wait: async () => {},
      decide: async () => {
        stop.abort(); // the person presses Stop while the request is in flight
        return act({ target: "Wallpaper" });
      },
    });
    expect(r.outcome).toBe("stopped");
    expect(t.direct).toEqual([]);
    expect(t.ran).toEqual([]);
  });

  it("Stop ends the wait between looks at once", async () => {
    const t = setup([act({ kind: "wait" })]);
    const stop = new AbortController();
    t.ctx.signal = stop.signal;
    setTimeout(() => stop.abort(), 20);
    const started = Date.now();
    const r = await autopilot(t.ctx, { instruction: "x", intervalMs: 60_000, decide: async () => act({ kind: "wait" }) });
    expect(r.outcome).toBe("stopped");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("points at the thing the person should click, in screen points", async () => {
    const points: unknown[] = [];
    const t = setup([act({ handling: "person", target: "Pick a wallpaper you like", x: 300, y: 200 })]);
    t.ctx.ui.guide = async (g) => (points.push(g.point), "done");
    await t.run();
    expect(points[0]).toEqual({ x: 600, y: 400, label: "Pick a wallpaper you like" });
  });
});

describe("per-action records: decision and outcome", () => {
  function recorded(actions: Action[], opts: { stop?: () => boolean; guide?: "done" | "skip"; code?: number } = {}) {
    const t = setup(actions, opts.guide ? [opts.guide] : []);
    if (opts.code !== undefined) (t.ctx.mac as { run: unknown }).run = async (c: string) => (t.direct.push(c), { code: opts.code!, output: "boom", timedOut: false });
    const records: ActionRecord[] = [];
    const queue = [...actions];
    const run = () => autopilot(t.ctx, { instruction: "Turn on tap to click", intervalMs: 0, wait: async () => {}, stopped: opts.stop, record: (r) => records.push(r), decide: async () => queue.shift() ?? act({ kind: "done" }) });
    return { ...t, run, records };
  }

  it("records the decision together with what was done, the route and the timings", async () => {
    const t = recorded([act({ target: "Tap to click", reason: "ordinary switch", effect: "changes_setting" }), act({ kind: "done" })]);
    await t.run();
    const [first, last] = t.records;
    expect(first).toMatchObject({
      step: "Turn on tap to click",
      decision: { kind: "click", target: "Tap to click", effect: "changes_setting", handling: "agent", sensitivity: "routine", reason: "ordinary switch" },
      action: { taken: "click", route: "direct", label: "Clicking Tap to click" },
      outcome: "executed",
      exitCode: 0,
      cancelled: false,
    });
    expect(first.delay.decisionMs).toBeGreaterThanOrEqual(0);
    expect(first.delay.executionMs).toBeGreaterThanOrEqual(0);
    expect(first.delay.sinceCaptureMs).toBeGreaterThanOrEqual(first.delay.decisionMs! + first.delay.executionMs! - 1);
    expect(first.cancelledAt).toBeUndefined();
    expect(last).toMatchObject({ outcome: "done", action: { taken: "none" } });
    expect(Number.isNaN(Date.parse(first.ts))).toBe(false);
  });

  it("records the route: Droid for sensitive actions, the person for handoffs", async () => {
    const t = recorded([act({ sensitivity: "sensitive" }), act({ handling: "person", target: "the code box" }), act({ kind: "done" })]);
    await t.run();
    expect(t.records.map((r) => [r.action.route, r.outcome])).toEqual([["droid", "executed"], ["person", "person_did_it"], ["none", "done"]]);
  });

  it("records a failed action with its exit code", async () => {
    const t = recorded([act({})], { code: 1 });
    await t.run();
    expect(t.records[0]).toMatchObject({ outcome: "failed", exitCode: 1, cancelled: false });
  });

  it("records a cancelled action: when, where it stopped, and the instruction that ran just before", async () => {
    let stop = false;
    const t = recorded([act({ target: "Sound" }), act({ target: "Tap to click" })], { stop: () => stop });
    const queue = [act({ target: "Sound" }), act({ target: "Tap to click" })];
    const before = Date.now();
    const records: ActionRecord[] = [];
    // Stop is pressed while the model is deciding the second action.
    const r = await autopilot(t.ctx, { instruction: "Turn on tap to click", intervalMs: 0, wait: async () => {}, stopped: () => stop, record: (x) => records.push(x), decide: async () => { const a = queue.shift()!; if (a.target === "Tap to click") stop = true; return a; } });
    expect(r.outcome).toBe("stopped");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ outcome: "executed", cancelled: false });
    const c = records[1];
    expect(c).toMatchObject({
      outcome: "cancelled",
      cancelled: true,
      cancelledDuring: "model_answer_dropped",
      previousInstruction: "Clicking Sound",
      decision: { target: "Tap to click" },
      action: { taken: "none", route: "none" },
    });
    expect(Date.parse(c.cancelledAt!)).toBeGreaterThanOrEqual(before);
    expect(t.direct).toHaveLength(1);
  });

  it("a cancel before anything ran has no previous instruction", async () => {
    const t = recorded([act({})], { stop: () => true });
    await t.run();
    expect(t.records).toHaveLength(1);
    expect(t.records[0]).toMatchObject({ outcome: "cancelled", cancelled: true, cancelledDuring: "before_look" });
    expect(t.records[0].previousInstruction).toBeUndefined();
    expect(t.records[0].decision).toBeUndefined();
  });

  it("records a cancel that happens during the person's turn", async () => {
    let stop = false;
    const t = recorded([act({ handling: "person", target: "the code box" })], { stop: () => stop });
    (t.ctx.ui as { guide: unknown }).guide = async () => ((stop = true), "done");
    await t.run();
    expect(t.records.at(-1)).toMatchObject({ outcome: "cancelled", cancelledDuring: "during_person_turn", cancelled: true });
  });
});

describe("pacing between steps", () => {
  function paced(actions: Action[], frames: (n: number) => string) {
    const waits: number[] = [];
    let captures = 0;
    const ui = { status() {}, say() {}, detail() {}, guide: async () => "done" } as unknown as AgentUI;
    const mac = {
      execute: async () => ({ code: 0, output: "", timedOut: false }),
      run: async () => ({ code: 0, output: "", timedOut: false }),
      screen: { capture: async () => ({ ...shot(), data: frames(captures++) }) },
    } as unknown as MacDeps;
    const ctx: ToolContext = { mac, ui, evidence: [], diagnoses: new Map(), beforeAfter: [] };
    const queue = [...actions];
    const run = () => autopilot(ctx, { instruction: "x", wait: async (ms) => void waits.push(ms), decide: async () => queue.shift() ?? act({ kind: "done" }) });
    return { run, waits, captures: () => captures };
  }

  it("waits about 0.6 s after a click, not 3 s, then confirms the screen has settled", async () => {
    // Frames: 0 (first look) then a stable screen "s".
    const t = paced([act({})], (n) => (n === 0 ? "a" : "s"));
    await t.run();
    expect(t.waits[0]).toBe(600);
    expect(t.waits.slice(1)).toEqual([250]);
    expect(Math.max(...t.waits)).toBeLessThan(3000);
  });

  it("keeps looking while the screen is still moving, but not forever", async () => {
    const t = paced([act({})], (n) => `frame${n}`);
    await t.run();
    const settleLooks = t.waits.filter((w) => w === 250).length;
    expect(settleLooks).toBe(4);
  });

  it("keeps the long wait only for 'wait' actions", async () => {
    const t = paced([act({ kind: "wait", reason: "loading" })], () => "same");
    await t.run();
    expect(t.waits[0]).toBe(3000);
  });

  it("gives a short beat after the person's turn", async () => {
    const t = paced([act({ handling: "person" })], (n) => `f${n}`);
    await t.run();
    expect(t.waits[0]).toBe(1000);
  });
});

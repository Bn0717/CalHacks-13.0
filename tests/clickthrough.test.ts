import { describe, expect, it, vi } from "vitest";
import { ClickHolds, shouldIgnoreMouse } from "../src/app/clickthrough.js";
import { autopilot, type Action, type Shot } from "../src/agent/autopilot.js";
import type { AgentUI, MacDeps, ToolContext } from "../src/agent/tools.js";

const card = { x: 400, y: 600, width: 500, height: 300 };

describe("when the bar lets the mouse through", () => {
  it("takes the mouse only on its card", () => {
    expect(shouldIgnoreMouse({ x: 500, y: 700 }, card, 0)).toBe(false);
    expect(shouldIgnoreMouse({ x: 50, y: 50 }, card, 0)).toBe(true);
    expect(shouldIgnoreMouse({ x: 500, y: 700 }, null, 0)).toBe(true);
  });
  it("lets every click through while CalHack is clicking, even right on the card", () => {
    expect(shouldIgnoreMouse({ x: 500, y: 700 }, card, 1)).toBe(true);
    expect(shouldIgnoreMouse({ x: 500, y: 700 }, card, 2)).toBe(true);
  });
});

describe("click holds", () => {
  it("count overlapping holds, end after the grace period, and never go below zero", () => {
    vi.useFakeTimers();
    const h = new ClickHolds();
    const a = h.hold(300);
    const b = h.hold(300);
    expect(h.count).toBe(2);
    a();
    expect(h.count).toBe(2);
    vi.advanceTimersByTime(300);
    expect(h.count).toBe(1);
    a();
    b();
    vi.advanceTimersByTime(300);
    expect(h.count).toBe(0);
    vi.useRealTimers();
  });
  it("end by themselves if never released", () => {
    vi.useFakeTimers();
    const h = new ClickHolds();
    h.hold(300, 5000);
    vi.advanceTimersByTime(5000);
    expect(h.count).toBe(0);
    vi.useRealTimers();
  });
});

describe("autopilot never clicks its own window", () => {
  const shot: Shot = { data: "x", mediaType: "image/jpeg", width: 1000, height: 600, toScreen: 1 };
  const act = (a: Partial<Action>): Action => ({ kind: "click", target: "t", screen: "normal", personalChoice: false, effect: "navigates", stepNamesOption: false, handling: "agent", sensitivity: "routine", reason: "", x: 5, y: 5, ...a });

  function run(a: Action) {
    const events: string[] = [];
    let n = 0;
    const ui = { status() {}, say() {}, detail() {}, guide: async () => "done" } as unknown as AgentUI;
    const mac = {
      execute: async () => (events.push("execute"), { code: 0, output: "", timedOut: false }),
      run: async () => (events.push("run"), { code: 0, output: "", timedOut: false }),
      screen: { capture: async () => ({ ...shot, data: "s" + n++ }), beforeClick: () => (events.push("hold"), () => events.push("release")) },
    } as unknown as MacDeps;
    const ctx: ToolContext = { mac, ui, evidence: [], diagnoses: new Map(), beforeAfter: [] };
    const queue = [a];
    return autopilot(ctx, { instruction: "x", intervalMs: 0, wait: async () => {}, decide: async () => queue.shift() ?? act({ kind: "done" }) }).then(() => events);
  }

  it("holds the bar click-through around a direct click, releasing after it", async () => {
    expect(await run(act({}))).toEqual(["hold", "run", "release"]);
  });
  it("and around a click that goes through Droid", async () => {
    expect(await run(act({ sensitivity: "sensitive" }))).toEqual(["hold", "execute", "release"]);
  });
  it("and around a double-click", async () => {
    expect(await run(act({ kind: "double_click" }))).toEqual(["hold", "run", "release"]);
  });
  it("but not for typing or key presses", async () => {
    expect(await run(act({ kind: "key", key: "tab" }))).toEqual(["run"]);
  });
});

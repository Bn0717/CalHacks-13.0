import { describe, expect, it } from "vitest";
import { screenChanged, waitForSettle, type ScreenDeps } from "../src/agent/autopilot.js";
import { TOOLS, type AgentUI, type MacDeps, type ToolContext } from "../src/agent/tools.js";

const px = (v: number, n = 160 * 104) => new Uint8Array(n * 4).fill(v);

/** A fake clock and a screen that plays back a list of tiny screen copies. */
function fakeScreen(frames: Uint8Array[], glanceMs = 10) {
  let t = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const sleeps: number[] = [];
  const screen: ScreenDeps = {
    capture: async () => null,
    glance: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      t += glanceMs;
      const f = frames.length > 1 ? frames.shift()! : frames[0];
      inFlight--;
      return f;
    },
  };
  return { screen, now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps, maxInFlight: () => maxInFlight };
}

describe("waiting for the screen instead of a fixed 3 seconds", () => {
  it("ignores a few changed pixels (a blinking cursor) but sees a real change", () => {
    const a = px(10);
    const cursor = px(10);
    cursor[0] = 250;
    expect(screenChanged(a, cursor)).toBe(false);
    expect(screenChanged(a, px(200))).toBe(true);
  });

  it("carries on as soon as the screen changed and then held still", async () => {
    const f = fakeScreen([px(10), px(200), px(200)]);
    const r = await waitForSettle(f.screen, { before: px(10), now: f.now, sleep: f.sleep });
    expect(r.reason).toBe("settled");
    expect(r.ms).toBeLessThan(1500); // the old way always waited 3000 ms
  });

  it("doesn't wait long when a click changed nothing", async () => {
    const f = fakeScreen([px(10)]);
    const r = await waitForSettle(f.screen, { before: px(10), reactMs: 1500, now: f.now, sleep: f.sleep });
    expect(r.reason).toBe("no-change");
    expect(r.ms).toBeLessThan(2000);
  });

  it("stops waiting at the time limit when the screen never holds still (a video)", async () => {
    let v = 0;
    const f = fakeScreen([px(0)]);
    f.screen.glance = async () => px((v += 60) % 256);
    const r = await waitForSettle(f.screen, { before: px(1), maxMs: 4000, now: f.now, sleep: f.sleep });
    expect(r.reason).toBe("time-limit");
    expect(r.ms).toBeLessThanOrEqual(4400);
  });

  it("glances one at a time, and less often when glances are slow", async () => {
    const f = fakeScreen([px(10), px(10), px(10), px(10), px(10), px(10)], 250);
    await waitForSettle(f.screen, { before: px(10), reactMs: 3000, now: f.now, sleep: f.sleep });
    expect(f.maxInFlight()).toBe(1);
    expect(f.sleeps.slice(1).every((ms) => ms === 600)).toBe(true);
  });

  it("ends at once on Stop", async () => {
    const stop = new AbortController();
    stop.abort();
    const f = fakeScreen([px(10)]);
    const r = await waitForSettle(f.screen, { before: px(10), signal: stop.signal, now: f.now, sleep: f.sleep });
    expect(r.reason).toBe("stopped");
    expect(r.glances).toBe(0);
  });
});

function setup(reads: string[]) {
  const ran: string[] = [];
  const viaDroid: string[] = [];
  const mac = {
    run: async (c: string) => {
      ran.push(c);
      const out = /^(osascript -e 'tell application "System Events" to tell appearance preferences to get|defaults read|networksetup -getairportpower)/.test(c) ? reads.shift() ?? "" : "";
      return { code: 0, output: out, timedOut: false };
    },
    execute: async (c: string) => (viaDroid.push(c), { code: 0, output: "", timedOut: false }),
  } as unknown as MacDeps;
  const ui = { status() {}, say() {}, detail() {} } as unknown as AgentUI;
  const ctx: ToolContext = { mac, ui, evidence: [], diagnoses: new Map(), beforeAfter: [] };
  return { ctx, ran, viaDroid };
}
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe("change_setting: a tested command, then read it back", () => {
  it("turns on dark mode instantly and proves it", async () => {
    const t = setup(["false", "true"]);
    const out = await tool("change_setting").run({ setting: "dark_mode", value: "on" }, t.ctx);
    expect(out).toMatch(/now on \(checked\)/);
    expect(t.ran.some((c) => c.includes("set dark mode to true"))).toBe(true);
    expect(t.viaDroid).toEqual([]);
    expect(t.ctx.beforeAfter).toEqual([{ label: "Dark mode", before: "Off", after: "On" }]);
    expect(t.ctx.evidence.at(-1)).toMatchObject({ kind: "after", code: 0 });
  });

  it("changes nothing when it's already set", async () => {
    const t = setup(["true"]);
    expect(await tool("change_setting").run({ setting: "dark_mode", value: "on" }, t.ctx)).toMatch(/already on/);
    expect(t.ran).toHaveLength(1);
  });

  it("says so when macOS silently ignored the change", async () => {
    const t = setup(["0", "0", "0", "0", "0", "0"]);
    const out = await tool("change_setting").run({ setting: "dock_autohide", value: "on" }, t.ctx);
    expect(out).toMatch(/didn't change/);
    expect(t.ctx.evidence.at(-1)).toMatchObject({ kind: "after", code: 1 });
  });

  it("refuses settings it has no tested command for, and turning Wi-Fi off", async () => {
    const t = setup([]);
    expect(await tool("change_setting").run({ setting: "wallpaper", value: "blue" }, t.ctx)).toMatch(/Refused/);
    expect(await tool("change_setting").run({ setting: "wifi", value: "off" }, t.ctx)).toMatch(/Refused.*cut me off/);
    expect(await tool("change_setting").run({ setting: "dark_mode", value: "rm -rf ~" }, t.ctx)).toMatch(/Refused/);
    expect(t.ran).toEqual([]);
  });
});

describe("check_screen", () => {
  it("says plainly when it can't see the screen", async () => {
    const t = setup([]);
    expect(await tool("check_screen").run({ question: "dark mode is on" }, t.ctx)).toMatch(/can't see the screen/);
  });
});

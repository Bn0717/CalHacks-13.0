import { describe, expect, it } from "vitest";
import { describeWindow, uiPilot, type UiDecision, type UiDeps } from "../src/agent/uipilot.js";
import type { UiItem, UiWindow } from "../src/mac/ui.js";
import type { AgentUI, MacDeps, ToolContext } from "../src/agent/tools.js";

const item = (name: string, role = "AXButton", extra: Partial<UiItem> = {}): UiItem => ({ path: name, role, name, frame: { x: 100, y: 200, w: 40, h: 20 }, ...extra });
const page = (...items: UiItem[]): UiWindow => ({ app: "System Settings", window: "", items });
const plan = (p: Partial<UiDecision>): UiDecision => ({ status: "act", steps: [], point_at: null, handling: "agent", sensitivity: "routine", target: "", reason: "", ...p });

function setup(windows: UiWindow[], decisions: UiDecision[]) {
  const acted: string[] = [];
  const typed: string[] = [];
  const droid: string[] = [];
  const guided: { instruction: string; point?: unknown }[] = [];
  let shown = windows[0];
  const ui: UiDeps = {
    list: async () => shown,
    act: async (_app, it) => {
      acted.push(it.name);
      if (windows.length > 1) shown = windows.splice(0, 1) && windows[0];
      return { ok: true };
    },
    type: async (_app, it, text) => (typed.push(`${it.name}=${text}`), { ok: true }),
    command: (_app, it, how) => `ui-elements act ${it.name} ${how}`,
  };
  const mac = { execute: async (c: string) => (droid.push(c), { code: 0, output: '{"ok":true}', timedOut: false }) } as unknown as MacDeps;
  const agentUi = { status() {}, say() {}, detail() {}, guide: async (g: { instruction: string; point?: unknown }) => (guided.push(g), "done") } as unknown as AgentUI;
  const ctx: ToolContext = { mac, ui: agentUi, evidence: [], diagnoses: new Map(), beforeAfter: [] };
  const queue = [...decisions];
  let asked = 0;
  const run = (signal?: AbortSignal) => {
    ctx.signal = signal;
    return uiPilot(ctx, ui, { instruction: "Open the Wallpaper settings", settleMs: 0, sleep: async () => {}, decide: async () => (asked++, queue.shift() ?? plan({ status: "done" })) });
  };
  return { run, acted, typed, droid, guided, ctx, asked: () => asked };
}

const sidebar = page(item("General", "AXStaticText"), item("Wallpaper", "AXStaticText"));
const wallpaperPage = page(item("General", "AXStaticText"), item("Wallpaper", "AXStaticText", { selected: true }), item("Add Photo…"));

describe("finishing a step by reading the window (no screenshots)", () => {
  it("lists the window for the AI with numbers, roles and state", () => {
    expect(describeWindow(page(item("Dark", "AXButton", { selected: true }), item("", "AXSecureTextField", { secure: true })))).toBe(
      'App: System Settings\n#1 button "Dark" (selected)\n#2 PASSWORD box "" (only the person types here)',
    );
  });

  it("acts on the item by name, then the window shows it's done", async () => {
    const t = setup([sidebar, wallpaperPage], [plan({ steps: [{ item: 2, do: "select", text: null }], target: "Wallpaper" })]);
    const r = await t.run();
    expect(r.outcome).toBe("done");
    expect(t.acted).toEqual(["Wallpaper"]);
    expect(r.decisions).toBe(2);
    expect(t.ctx.evidence.at(-1)).toMatchObject({ kind: "after", code: 0 });
  });

  it("never types into a password box: it points at it and waits for the person", async () => {
    const login = page(item("Email", "AXTextField"), item("", "AXSecureTextField", { secure: true, frame: { x: 300, y: 400, w: 200, h: 30 } }));
    const t = setup([login], [plan({ steps: [{ item: 2, do: "type", text: "hunter2" }], handling: "agent", target: "the password box" })]);
    await t.run();
    expect(t.typed).toEqual([]);
    expect(t.guided[0].point).toEqual({ x: 400, y: 415, label: "the password box" });
  });

  it("points at a personal choice instead of choosing", async () => {
    const t = setup([wallpaperPage], [plan({ status: "person", point_at: 3, handling: "person", target: "Pick a wallpaper you like" })]);
    await t.run();
    expect(t.acted).toEqual([]);
    expect(t.guided[0].point).toMatchObject({ label: "Pick a wallpaper you like" });
  });

  it("sensitive actions go through Droid", async () => {
    const t = setup([sidebar, wallpaperPage], [plan({ steps: [{ item: 2, do: "select", text: null }], sensitivity: "sensitive" })]);
    await t.run();
    expect(t.droid).toEqual(["ui-elements act Wallpaper select"]);
    expect(t.acted).toEqual([]);
  });

  it("hands over to the screenshot way when the list doesn't have it", async () => {
    const t = setup([sidebar], [plan({ status: "not_here" })]);
    expect((await t.run()).outcome).toBe("fallback");
  });

  it("hands over when its clicks change nothing", async () => {
    const t = setup([sidebar], [plan({ steps: [{ item: 1, do: "select", text: null }] }), plan({ steps: [{ item: 1, do: "select", text: null }] }), plan({ steps: [{ item: 1, do: "select", text: null }] })]);
    expect((await t.run()).outcome).toBe("fallback");
  });

  it("Stop while the AI is planning: its plan is never carried out", async () => {
    const stop = new AbortController();
    const t = setup([sidebar, wallpaperPage], []);
    t.ctx.signal = stop.signal;
    const r = await uiPilot(t.ctx, { list: async () => sidebar, act: async (_a, it) => (t.acted.push(it.name), { ok: true }), type: async () => ({ ok: true }), command: () => "" }, {
      instruction: "x",
      settleMs: 0,
      sleep: async () => {},
      decide: async () => {
        stop.abort(); // the person presses Stop while Claude is thinking
        return plan({ steps: [{ item: 2, do: "select", text: null }] });
      },
    });
    expect(r.outcome).toBe("stopped");
    expect(t.acted).toEqual([]);
  });

  it("CalHack's own window in front: uses the screen instead", async () => {
    const t = setup([{ app: "Electron", window: "", items: [item("Stop"), item("Done")] }], []);
    expect((await t.run()).outcome).toBe("fallback");
    expect(t.asked()).toBe(0);
  });
});

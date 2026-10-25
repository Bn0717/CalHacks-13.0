import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentUI, MacDeps, ToolContext } from "../src/agent/tools.js";
import type { UiItem } from "../src/mac/ui.js";

// Remembered routes and logs go to a throwaway folder. Set before the modules load: they read the folder when imported.
const home = mkdtempSync(join(tmpdir(), "calhack-test-"));
vi.stubEnv("HOME", home);
// homedir() uses USERPROFILE on Windows; isolate these route/log fixtures on every OS.
vi.mock("node:os", async (original) => ({ ...await original<typeof import("node:os")>(), homedir: () => home }));
// These tests inject screenshot decisions and must never call a live UI model.
vi.mock("../src/agent/ui-decision.js", async (original) => ({ ...await original<typeof import("../src/agent/ui-decision.js")>(),
  routeDecision: async () => ({ status: "not_here", steps: [], point_at: null, handling: "person", sensitivity: "sensitive", target: "", reason: "Use the injected screenshot decision." }) }));
const { autopilot, fileRecord } = await import("../src/agent/autopilot.js");
const { closeOpenedSheet, describeWindow, pickCloseButton } = await import("../src/agent/uipilot.js");
type Action = import("../src/agent/autopilot.js").Action;

const button = (name: string): UiItem => ({ path: name, role: "AXButton", name, frame: { x: 10, y: 10, w: 40, h: 20 } });
const WIFI_DETAILS = [button("Forget This Network…"), button("Cancel"), button("OK")];
const act = (a: Partial<Action>): Action => ({ kind: "click", target: "Details", screen: "normal", personalChoice: false, effect: "navigates", stepNamesOption: false, handling: "agent", sensitivity: "routine", reason: "", x: 100, y: 50, ...a });

/** System Settings on the Wi-Fi page. A click (by CalHack or the person) opens the Wi-Fi Details panel. */
function wifiMac(opts: { panelOpen?: boolean; page?: UiItem[]; panel?: UiItem[] } = {}) {
  const state = { sheet: !!opts.panelOpen };
  const pressed: string[] = [];
  const panel = opts.panel ?? WIFI_DETAILS;
  // One item only: the window reader hands over to the screenshot way, like an app that doesn't list its buttons.
  const page = opts.page ?? [button("Details…")];
  const guided: string[] = [];
  let n = 0;
  const mac = {
    run: async (c: string) => ((state.sheet = true), { code: 0, output: c, timedOut: false }),
    execute: async () => ({ code: 0, output: "", timedOut: false }),
    screen: { capture: async () => ({ data: "img" + n++, mediaType: "image/jpeg", width: 1000, height: 600, toScreen: 1 }) },
    ui: {
      list: async () => ({ app: "System Settings", window: "Wi-Fi", sheet: state.sheet, items: state.sheet ? panel : page }),
      act: async (_app: string, it: UiItem) => (it.name === "Details…" && (state.sheet = true), { ok: true }),
      type: async () => ({ ok: true }),
      command: () => "",
      closeSheet: async (_app: string, b: string) => {
        if (!state.sheet) return { ok: true, pressed: null, closed: true };
        pressed.push(b);
        state.sheet = false;
        return { ok: true, pressed: b, closed: true };
      },
    },
  } as unknown as MacDeps;
  const ui = { status() {}, say() {}, detail() {}, guide: async (g: { instruction: string }) => (guided.push(g.instruction), (state.sheet = true), "done") } as unknown as AgentUI;
  const ctx: ToolContext = { mac, ui, evidence: [], diagnoses: new Map(), beforeAfter: [] };
  const records: import("../src/agent/autopilot.js").ActionRecord[] = [];
  const run = (decisions: Action[], instruction = "Open the Wi-Fi details") => {
    const queue = [...decisions];
    return autopilot(ctx, { instruction, intervalMs: 0, wait: async () => {}, record: (r) => records.push(r), decide: async () => queue.shift() ?? act({ kind: "done" }) });
  };
  return { ctx, state, pressed, guided, records, run };
}

describe("which button closes a panel", () => {
  it("keep: Done, else OK", () => {
    expect(pickCloseButton(["Smaller", "Larger", "Done"], "keep")).toBe("Done");
    expect(pickCloseButton(["Forget This Network…", "Cancel", "OK"], "keep")).toBe("OK");
  });
  it("discard: Cancel, else Done only on a panel with no OK", () => {
    expect(pickCloseButton(["Forget This Network…", "Cancel", "OK"], "discard")).toBe("Cancel");
    expect(pickCloseButton(["Smaller", "Larger", "Done"], "discard")).toBe("Done");
    expect(pickCloseButton(["Done", "OK"], "discard")).toBeNull();
  });
  it("never anything else, even a button that sounds like closing", () => {
    expect(pickCloseButton(["Forget This Network…", "Close", "Back", "Remove"], "keep")).toBeNull();
    expect(pickCloseButton(["Forget This Network…", "Close", "Back", "Remove"], "discard")).toBeNull();
    expect(pickCloseButton(["done", "ok"], "keep")).toBeNull();
  });
});

describe("telling the AI a panel is open", () => {
  it("adds a note when the window is a panel, and none otherwise", () => {
    expect(describeWindow({ app: "System Settings", window: "", sheet: true, items: [button("Done")] })).toBe(
      'App: System Settings\nA panel is open in front of the page: only the panel\'s items are listed.\n#1 button "Done"',
    );
    expect(describeWindow({ app: "System Settings", window: "", items: [button("Done")] })).not.toMatch(/panel/);
  });
});

describe("closing the panels CalHack opened, after a step", () => {
  it("closes a panel its own click opened once the screen shows the step is done, never with Forget", async () => {
    const t = wifiMac();
    const r = await t.run([act({ target: "Details…" }), act({ kind: "done" })]);
    expect(r.outcome).toBe("done");
    expect(t.pressed).toEqual(["OK"]);
    expect(t.state.sheet).toBe(false);
    expect(r.trail.at(-1)).toBe("Closed the panel (OK)");
    expect(t.records.at(-1)).toMatchObject({ outcome: "sheet_closed", action: { taken: "close_panel" }, sheetClose: { mode: "keep", pressed: "OK", closed: true } });
  });

  it("leaves the panel open when the person did a part of the step", async () => {
    const t = wifiMac();
    const r = await t.run([act({ handling: "person", target: "Details…", reason: "Pick the network" }), act({ kind: "done" })]);
    expect(r.outcome).toBe("done");
    expect(t.guided).toHaveLength(1);
    expect(t.pressed).toEqual([]);
    expect(t.state.sheet).toBe(true);
  });

  it("leaves a panel that was already open when the step began", async () => {
    const t = wifiMac({ panelOpen: true });
    await t.run([act({ kind: "done" })]);
    expect(t.pressed).toEqual([]);
  });

  it("presses nothing once Stop was pressed", async () => {
    const t = wifiMac();
    const stop = new AbortController();
    t.ctx.signal = stop.signal;
    t.ctx.mac.run = async () => ((t.state.sheet = true), stop.abort(), { code: 0, output: "", timedOut: false });
    const r = await t.run([act({ target: "Details…" }), act({ kind: "done" })]);
    expect(r.outcome).toBe("stopped");
    expect(t.pressed).toEqual([]);
  });

  it("closes after a remembered route and a fresh completion check", async () => {
    const page = [button("Details…"), button("Advanced…")];
    mkdirSync(join(home, ".cache", "calhack"), { recursive: true });
    writeFileSync(join(home, ".cache", "calhack", "routes.json"), JSON.stringify({ "System Settings|open the wi fi details": [{ role: "AXButton", name: "Details…", do: "press" }] }));
    const t = wifiMac({ page });
    const r = await t.run([], "Open the Wi-Fi details");
    expect(r.outcome).toBe("done");
    expect(r.trail[0]).toBe("Clicked Details…");
    expect(r.trail.some((line) => line.startsWith("The screen shows it's done"))).toBe(true);
    expect(t.pressed).toEqual(["OK"]);
  });

  it("presses nothing and logs the failure when the panel has no closing button", async () => {
    const t = wifiMac({ panel: [button("Forget This Network…"), button("Close")] });
    t.state.sheet = true;
    const c = await closeOpenedSheet(t.ctx, t.ctx.mac.ui!, { app: "System Settings", hadSheet: false, step: "test", record: fileRecord });
    expect(c).toMatchObject({ pressed: null, closed: false });
    expect(t.pressed).toEqual([]);
    const log = readFileSync(join(home, ".cache", "calhack", "autopilot.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.at(-1)).toMatchObject({ outcome: "sheet_close_failed", sheetClose: { pressed: null, closed: false } });
  });
});

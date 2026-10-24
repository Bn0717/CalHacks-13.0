import { describe, expect, it } from "vitest";
import { bluetoothSetCommand, parseBluetooth } from "../src/mac/bluetooth.js";
import { TOOLS, type AgentUI, type ConfirmRequest, type MacDeps, type ToolContext } from "../src/agent/tools.js";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const ok = (output = "") => ({ code: 0, output, timedOut: false });

const btJson = (state: "attrib_on" | "attrib_off", devices: Record<string, string>[] = []) =>
  JSON.stringify({ SPBluetoothDataType: [{ controller_properties: { controller_state: state }, device_connected: devices.map((d) => Object.fromEntries(Object.entries(d).map(([n, t]) => [n, { device_minorType: t }]))) }] });

function setup(read: (cmd: string) => string, confirms: boolean[] = [true]) {
  const ran: string[] = [];
  const asked: ConfirmRequest[] = [];
  const ui = { status() {}, say() {}, detail() {}, confirm: async (c: ConfirmRequest) => (asked.push(c), confirms.shift() ?? true) } as unknown as AgentUI;
  const mac = { sandboxed: async (c: string) => ok(read(c)), execute: async (c: string) => (ran.push(c), { ...ok(), ranBy: "droid" as const }) } as unknown as MacDeps;
  const ctx: ToolContext = { mac, ui, evidence: [], diagnoses: new Map(), beforeAfter: [] };
  return { ctx, ran, asked };
}

describe("reading Bluetooth", () => {
  it("reads state and connected input devices", () => {
    const s = parseBluetooth(btJson("attrib_on", [{ "Dad's Magic Keyboard": "Keyboard" }, { "Bose QC": "Headphones" }]));
    expect(s).toEqual({ on: true, connected: ["Dad's Magic Keyboard", "Bose QC"], inputDevices: ["Dad's Magic Keyboard"] });
    expect(parseBluetooth(btJson("attrib_off")).on).toBe(false);
    expect(parseBluetooth("not json").on).toBeNull();
  });
  it("builds the command from a boolean only", () => {
    expect(bluetoothSetCommand(true)).toContain("SetControllerPowerState(1)");
    expect(bluetoothSetCommand(false)).toContain("SetControllerPowerState(0)");
  });
});

describe("set_bluetooth", () => {
  it("turns it on automatically and checks the result with a different tool", async () => {
    let on = false;
    const t = setup((c) => (c.startsWith("system_profiler") ? btJson(on ? "attrib_on" : "attrib_off") : ""));
    const real = t.ctx.mac.execute;
    t.ctx.mac.execute = async (c) => ((on = true), real(c));
    const out = await tool("set_bluetooth").run({ on: true }, t.ctx);
    expect(t.asked).toHaveLength(0);
    expect(t.ran).toHaveLength(1);
    expect(out).toMatch(/now on/);
    expect(t.ctx.evidence.at(-1)).toMatchObject({ kind: "after", outcome: "passed" });
  });

  it("does nothing when it's already in the state asked for", async () => {
    const t = setup(() => btJson("attrib_on"));
    expect(await tool("set_bluetooth").run({ on: true }, t.ctx)).toMatch(/already on/);
    expect(t.ran).toEqual([]);
  });

  it("turning it off automatically when nothing important is connected", async () => {
    let on = true;
    const t = setup((c) => btJson(on ? "attrib_on" : "attrib_off", [{ "Bose QC": "Headphones" }]));
    const real = t.ctx.mac.execute;
    t.ctx.mac.execute = async (c) => ((on = false), real(c));
    await tool("set_bluetooth").run({ on: false }, t.ctx);
    expect(t.asked).toHaveLength(0);
    expect(t.ran).toHaveLength(1);
  });

  it("asks before cutting off a Bluetooth keyboard or mouse, and respects no", async () => {
    const t = setup(() => btJson("attrib_on", [{ "Magic Mouse": "Mouse" }]), [false]);
    const out = await tool("set_bluetooth").run({ on: false }, t.ctx);
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0].message).toContain("Magic Mouse");
    expect(t.ran).toEqual([]);
    expect(out).toMatch(/said no/);
  });

  it("reports a failed switch instead of claiming success", async () => {
    const t = setup(() => btJson("attrib_off"));
    const out = await tool("set_bluetooth").run({ on: true }, t.ctx);
    expect(out).toMatch(/didn't switch/);
    expect(t.ctx.evidence.at(-1)).toMatchObject({ outcome: "failed" });
  });
});

describe("set_wifi", () => {
  const ports = "Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa";
  function wifi(initial: boolean, route: string) {
    let on = initial;
    const t = setup((c) => (c.includes("listallhardwareports") ? ports : c.includes("getairportpower") ? `Wi-Fi Power (en0): ${on ? "On" : "Off"}` : c.startsWith("route") ? route : ""));
    const real = t.ctx.mac.execute;
    t.ctx.mac.execute = async (c) => ((on = /\bon$/.test(c)), real(c));
    return t;
  }

  it("turns Wi-Fi on automatically and checks it", async () => {
    const t = wifi(false, "");
    const out = await tool("set_wifi").run({ on: true }, t.ctx);
    expect(t.ran).toEqual(["networksetup -setairportpower en0 on"]);
    expect(t.asked).toHaveLength(0);
    expect(out).toMatch(/now on/);
    expect(t.ctx.autoFinish).toBeUndefined();
  });

  it("when turning it off ends the connection to Claude, the run finishes by itself with the proof", async () => {
    const t = wifi(true, "   interface: en0\n   gateway: 1.2.3.4");
    await tool("set_wifi").run({ on: false }, t.ctx);
    expect(t.ran).toEqual(["networksetup -setairportpower en0 off"]);
    expect(t.ctx.autoFinish?.headline).toMatch(/Wi-Fi is off/);
    expect(t.ctx.autoFinish?.proofRefs).toHaveLength(1);
  });

  it("doesn't end the run when the Mac is online some other way", async () => {
    const t = wifi(true, "   interface: en7");
    await tool("set_wifi").run({ on: false }, t.ctx);
    expect(t.ctx.autoFinish).toBeUndefined();
  });

  it("does nothing if it's already in that state", async () => {
    const t = wifi(true, "");
    expect(await tool("set_wifi").run({ on: true }, t.ctx)).toMatch(/already on/);
    expect(t.ran).toEqual([]);
  });
});

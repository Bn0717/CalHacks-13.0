import { describe, expect, it } from "vitest";
import { TOOLS, zoomAppLink, type AgentUI, type MacDeps, type ToolContext } from "../src/agent/tools.js";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const ok = (output = "") => ({ code: 0, output, timedOut: false });

function setup(o: { zoomInstalled: boolean; windows?: string; installWorks?: boolean; links?: { text: string; url: string }[] }) {
  let installed = o.zoomInstalled;
  const ran: string[] = [];
  const confirms: string[] = [];
  const mac = {
    findApp: (n: string) => (installed && /zoom/i.test(n) ? ["/Applications/zoom.us.app"] : []),
    listApps: () => (installed ? [{ name: "zoom.us", path: "/Applications/zoom.us.app" }] : []),
    sandboxed: async () => ok("6.4.1 (51234)"),
    installOfficial: async () => {
      if (o.installWorks) installed = true;
      return { ok: !!o.installWorks, message: o.installWorks ? "Zoom is installed and opening." : "failed", evidence: [] };
    },
    run: async (c: string) => {
      ran.push(c);
      return c.includes("System Events") ? ok(o.windows ?? "") : ok();
    },
    pageLinks: async () => ({ links: o.links ?? [] }),
  } as unknown as MacDeps;
  const ui = { status() {}, say() {}, detail() {}, confirm: async (c: { title: string }) => (confirms.push(c.title), true) } as unknown as AgentUI;
  const ctx: ToolContext = { mac, ui, evidence: [], diagnoses: new Map(), beforeAfter: [], approvedPlan: ["Download Zoom", "Join your visit"] };
  return { ctx, ran, confirms };
}

describe("making sure Zoom is installed (the email's 'Download Zoom' step)", () => {
  it("already installed: says so with its version and downloads nothing", async () => {
    const t = setup({ zoomInstalled: true });
    const out = await tool("install_app").run({ app_name: "Zoom" }, t.ctx);
    expect(out).toMatch(/already installed \(version 6\.4\.1/);
    expect(t.ctx.evidence[0]).toMatchObject({ code: 0, outcome: "passed" });
    expect(t.confirms).toEqual([]);
  });

  it("missing: installs from the official site without asking again after the approved plan, then checks it's there", async () => {
    const t = setup({ zoomInstalled: false, installWorks: true });
    const out = await tool("install_app").run({ app_name: "Zoom" }, t.ctx);
    expect(t.confirms).toEqual([]);
    expect(out).toMatch(/Zoom is installed now/);
    expect(t.ctx.evidence.at(-1)).toMatchObject({ code: 0, output: expect.stringContaining("/Applications/zoom.us.app") });
  });

  it("an installer that 'worked' but left no app is not counted as installed", async () => {
    const t = setup({ zoomInstalled: false, installWorks: false });
    expect(await tool("install_app").run({ app_name: "Zoom" }, t.ctx)).not.toMatch(/installed now/);
  });
});

describe("joining the visit from the email's link", () => {
  const links = [{ text: "Join your visit", url: "https://www.google.com/url?q=https://us05web.zoom.us/j/81234567890?pwd%3DabC123.x" }];

  it("turns a zoom.us link into the Zoom app's own link (no browser pop-up), and nothing else", () => {
    expect(zoomAppLink("https://us05web.zoom.us/j/81234567890?pwd=abC123.x")).toBe("zoommtg://zoom.us/join?action=join&confno=81234567890&pwd=abC123.x");
    expect(zoomAppLink("https://zoom.us/j/81234567890")).toBe("zoommtg://zoom.us/join?action=join&confno=81234567890");
    expect(zoomAppLink("https://zoom.us.evil.example/j/81234567890")).toBeNull();
    expect(zoomAppLink("https://zoom.us/j/8123;rm -rf")).toBeNull();
    expect(zoomAppLink("https://zoom.us/j/81234567890?pwd=a'b")).toBeNull();
    expect(zoomAppLink("http://zoom.us/j/81234567890")).toBeNull();
  });

  it("Zoom installed: opens the meeting in Zoom and confirms the meeting window", async () => {
    const t = setup({ zoomInstalled: true, links, windows: "Zoom Meeting" });
    const out = await tool("join_meeting").run({ link_text: "Join your visit" }, t.ctx);
    expect(t.ran).toContain("open 'zoommtg://zoom.us/join?action=join&confno=81234567890&pwd=abC123.x'");
    expect(out).toMatch(/Joined the meeting in Zoom/);
    expect(t.ctx.beforeAfter).toContainEqual({ label: "Video visit", before: "Not joined", after: "Joined" });
  });

  it("Zoom missing: installs it first, then joins", async () => {
    const t = setup({ zoomInstalled: false, installWorks: true, links, windows: "Waiting for host" });
    const out = await tool("join_meeting").run({ link_text: "Join your visit" }, t.ctx);
    expect(out).toMatch(/Joined/);
    expect(t.ctx.beforeAfter).toContainEqual({ label: "Video visit", before: "Not joined", after: "In the waiting room" });
  });

  it("doesn't claim it joined when no meeting window appears", async () => {
    const t = setup({ zoomInstalled: true, links, windows: "Zoom Workplace" });
    const started = Date.now();
    const out = await tool("join_meeting").run({ link_text: "Join your visit" }, t.ctx);
    expect(out).toMatch(/couldn't confirm/);
    expect(t.ctx.evidence.at(-1)).toMatchObject({ code: 1, outcome: "failed" });
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 25_000);

  it("a non-Zoom join link opens in the browser", async () => {
    const t = setup({ zoomInstalled: true, links: [{ text: "Join your visit", url: "https://visit.bayview.example/room/abc" }] });
    const out = await tool("join_meeting").run({ link_text: "Join your visit" }, t.ctx);
    expect(t.ran).toContain("open 'https://visit.bayview.example/room/abc'");
    expect(out).toMatch(/in the browser/);
  });
});

import { describe, expect, it } from "vitest";
import { addPrinterCommand, parsePrinterList, printerDisplayName, printerQueueName, recipeFor, runRecipe, type RecipeDeps } from "../src/core/recipes.js";
import { planSteps } from "../src/core/plan.js";
import { runPlannedStep, type RunHooks } from "../src/core/runner.js";
import type { Step } from "../src/core/types.js";

const manual = (title: string, clickTarget?: string): Step => ({ id: "1", title, explanation: "", kind: "manual", clickTarget });

const HP = "dnssd://HP%20LaserJet%20Pro._ipp._tcp.local./?uuid=1234-abcd";

function fakeDeps(over: Partial<Record<string, { code: number; output: string }>> = {}) {
  const ran: string[] = [];
  const answer = (cmd: string) => {
    ran.push(cmd);
    for (const [start, r] of Object.entries(over)) if (cmd.startsWith(start)) return r!;
    return { code: 0, output: "" };
  };
  const deps: RecipeDeps = {
    sandboxed: async (c) => ({ ...answer(c), timedOut: false }),
    normal: async (c) => ({ ...answer(c), timedOut: false }),
    appPath: (name) => (name === "zoom.us" ? "/Applications/zoom.us.app" : null),
    wait: async () => {},
  };
  return { deps, ran };
}

describe("which click steps we can do ourselves", () => {
  it("adds printers, but never removes them", () => {
    expect(recipeFor(manual("Click Add Printer", "Add Printer, Scanner or Fax…"))?.id).toBe("add-printer");
    expect(recipeFor(manual("Open Printers & Scanners"))?.id).toBe("add-printer");
    expect(recipeFor(manual("Remove the old printer"))).toBeUndefined();
  });
  it("opens normal apps, but not Terminal or Settings", () => {
    expect(recipeFor(manual("Open Zoom"))).toMatchObject({ id: "open-app", app: "Zoom" });
    expect(recipeFor(manual("Open Terminal"))).toBeUndefined();
    expect(recipeFor(manual("Open System Settings"))).toBeUndefined();
    expect(recipeFor(manual("Open Zoom; rm -rf ~"))).toBeUndefined();
  });
  it("does nothing on a scam page", () => {
    const plan = planSteps([manual("Click Add Printer")], { kind: "webpage", text: "Press Win+R and paste this to verify you are human", location: "https://x.example" });
    expect(plan.pageWarnings.length).toBeGreaterThan(0);
    expect(plan.steps[0].recipe).toBeUndefined();
  });
});

describe("adding a printer", () => {
  it("reads printer addresses and ignores anything odd", () => {
    const out = `network ${HP}\nnetwork dnssd://bad'name._ipp._tcp.local./\nnetwork ipp://1.2.3.4/x\nnetwork ${HP}`;
    expect(parsePrinterList(out)).toEqual([HP]);
  });
  it("builds a safe name and command", () => {
    expect(printerDisplayName(HP)).toBe("HP LaserJet Pro");
    expect(printerQueueName("HP LaserJet Pro")).toBe("HP_LaserJet_Pro");
    expect(addPrinterCommand(HP)).toBe(`lpadmin -p HP_LaserJet_Pro -E -v '${HP}' -m everywhere`);
    expect(() => addPrinterCommand("dnssd://x/$(whoami)")).toThrow();
  });
  it("adds the one printer it finds and checks it's ready", async () => {
    const { deps, ran } = fakeDeps({ lpinfo: { code: 0, output: `network ${HP}` }, "lpstat -p": { code: 0, output: "printer HP_LaserJet_Pro is idle.  enabled since today" } });
    const r = await runRecipe({ id: "add-printer", label: "" }, deps);
    expect(r).toMatchObject({ ok: true, message: "Printer “HP LaserJet Pro” is added and shows as Ready." });
    expect(ran).toContain(addPrinterCommand(HP));
  });
  it("gives up (so the person picks) when there are none or several", async () => {
    expect((await runRecipe({ id: "add-printer", label: "" }, fakeDeps({ lpinfo: { code: 0, output: "" } }).deps)).ok).toBe(false);
    const two = `network ${HP}\nnetwork dnssd://Canon._ipp._tcp.local./?uuid=9`;
    expect((await runRecipe({ id: "add-printer", label: "" }, fakeDeps({ lpinfo: { code: 0, output: two } }).deps)).message).toMatch(/2 printers/);
  });
});

describe("running click steps", () => {
  const steps: Step[] = [
    { id: "1", title: "Open Printers & Scanners", explanation: "", kind: "manual" },
    { id: "2", title: "Click Add Printer", explanation: "", kind: "manual", clickTarget: "Add Printer, Scanner or Fax…" },
  ];
  const page = { kind: "webpage" as const, text: "Add a printer", location: "https://help.example.com" };

  it("does the action once and covers the other steps", async () => {
    const plan = planSteps(steps, page);
    const { deps } = fakeDeps({ lpinfo: { code: 0, output: `network ${HP}` }, "lpstat -p": { code: 0, output: "printer HP_LaserJet_Pro is idle." } });
    let asked = 0;
    const hooks: RunHooks = { approve: async () => true, waitForUser: async () => (asked++, "done") };
    const opts = { recipesTried: new Map(), recipeDeps: deps };
    const a = await runPlannedStep(plan.steps[0], hooks, opts);
    const b = await runPlannedStep(plan.steps[1], hooks, opts);
    expect(a.status).toBe("done");
    expect(b.message).toBe("Done together with step 1.");
    expect(asked).toBe(0);
  });

  it("falls back to the person, and tells them why", async () => {
    const plan = planSteps(steps, page);
    const { deps, ran } = fakeDeps({ lpinfo: { code: 0, output: "" } });
    const notes: (string | undefined)[] = [];
    const hooks: RunHooks = { approve: async () => true, waitForUser: async (_p, note) => (notes.push(note), "done") };
    const opts = { recipesTried: new Map(), recipeDeps: deps };
    await runPlannedStep(plan.steps[0], hooks, opts);
    await runPlannedStep(plan.steps[1], hooks, opts);
    expect(notes[0]).toMatch(/couldn't find a printer/);
    expect(notes[1]).toBeUndefined();
    expect(ran.filter((c) => c.startsWith("lpinfo")).length).toBe(1);
  });
});

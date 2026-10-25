import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const locate = vi.hoisted(() => vi.fn());
vi.mock("../src/ai/positioner.js", async (original) => ({ ...await original<typeof import("../src/ai/positioner.js")>(), locatePointer: locate }));
vi.mock("../src/ai/client.js", () => ({ getClient: () => ({ messages: { create } }), MODEL: () => "test-model", loadEnv: () => {} }));
// The real router stays; only Jev itself is replaced, to prove form steps never go to it.
const jevScreen = vi.hoisted(() => vi.fn(async () => { throw new Error("jev not expected"); }));
const jevWindow = vi.hoisted(() => vi.fn(async () => { throw new Error("jev not expected"); }));
vi.mock("../src/agent/ui-decision.js", async (original) => ({ ...await original<typeof import("../src/agent/ui-decision.js")>(), jevScreenAction: jevScreen, jevWindowAction: jevWindow }));

import { decideNext } from "../src/agent/autopilot.js";
import { formPageProblem, matchFact, safeFacts } from "../src/agent/fill.js";
import { uiPilot, type UiDecision, type UiDeps } from "../src/agent/uipilot.js";
import { addEventCommand, findEventCommand, parseEvent, parseFound } from "../src/mac/calendar.js";
import type { UiItem, UiWindow } from "../src/mac/ui.js";
import type { AgentUI, MacDeps, ToolContext } from "../src/agent/tools.js";

const facts = safeFacts([
  { label: "Name", value: "Linda" },
  { label: "Appointment number", value: "BV-48213" },
]);

describe("which details CalHack may type", () => {
  it("keeps plain details and drops secrets, whatever the AI passed", () => {
    expect(
      safeFacts([
        { label: "Name", value: "Linda" },
        { label: "Password", value: "hunter2" },
        { label: "Insurance member ID", value: "XJ12345" },
        { label: "Card", value: "4111 1111 1111 1111" },
        { label: "Notes", value: "4111-1111-1111-1111" },
        { label: "ID", value: "123-45-6789" },
        { label: "Code", value: "line\nbreak" },
        { label: "", value: "x" },
        "junk",
      ]),
    ).toEqual([{ label: "Name", value: "Linda" }]);
    expect(safeFacts(null)).toEqual([]);
  });

  it("matches only an exact value", () => {
    expect(matchFact(" bv-48213 ", facts)?.label).toBe("Appointment number");
    expect(matchFact("Linda Smith", facts)).toBeNull();
    expect(matchFact("", facts)).toBeNull();
  });

  it("only fills in forms on https pages that aren't scam-prone hosts", () => {
    expect(formPageProblem("https://bayview.example.com/checkin")).toBeNull();
    expect(formPageProblem("http://localhost:4321/checkin.html")).toBeNull();
    expect(formPageProblem("http://bayview.example.com/checkin")).toMatch(/secure/);
    expect(formPageProblem("https://bit.ly/abc")).toMatch(/scams/);
    expect(formPageProblem("https://203.0.113.5/form")).toMatch(/scams/);
    expect(formPageProblem(null)).toMatch(/can't tell/);
  });
});

describe("screenshot autopilot on a form", () => {
  const shot = { data: "AAAA", mediaType: "image/png" as const, width: 100, height: 100, toScreen: 1 };
  const answer = (input: Record<string, unknown>) => create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(input) }] });
  const base = { screen: "personal_details", personal_choice: false, effect: "other", step_names_option: false, handling: "agent", sensitivity: "routine", key: null, target: "Name box", reason: "r" };

  beforeEach(() => {
    create.mockReset();
    jevScreen.mockClear();
    process.env.CALHACK_UI_DECISION_PROVIDER = "claude";
    locate.mockReset().mockResolvedValue({ attempts: [], selected: "haiku", point: { x: 10, y: 10 } });
  });

  it("sends form steps to Claude even when Jev is set up (Jev doesn't type or know the details)", async () => {
    process.env.CALHACK_UI_DECISION_PROVIDER = "auto";
    const key = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "test-key";
    try {
      answer({ ...base, kind: "type", text: "Linda" });
      expect(await decideNext("Fill in the form", shot, [], undefined, undefined, facts)).toMatchObject({ fillsDetail: true });
      expect(jevScreen).not.toHaveBeenCalled();
      expect(create.mock.calls[0][0].system).toContain("Details you may fill in");
    } finally {
      if (key === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = key;
    }
  });

  it("types a given detail on a details screen, as a sensitive action", async () => {
    answer({ ...base, kind: "type", text: "Linda" });
    const a = await decideNext("Fill in the check-in form", shot, [], undefined, undefined, facts);
    expect(a).toMatchObject({ handling: "agent", fillsDetail: true, sensitivity: "sensitive" });
    expect(create.mock.calls[0][0].messages[0].content[1].text).toContain("Appointment number: BV-48213");
  });

  it("hands over anything that isn't an exact given detail", async () => {
    answer({ ...base, kind: "type", text: "linda@example.com" });
    expect(await decideNext("x", shot, [], undefined, undefined, facts)).toMatchObject({ handling: "person" });
  });

  it("without details, a details screen stays the person's", async () => {
    answer({ ...base, kind: "type", text: "Linda" });
    expect(await decideNext("x", shot, [])).toMatchObject({ handling: "person" });
  });

  it("never presses a submit-like button, even if the AI calls it navigation", async () => {
    answer({ ...base, kind: "click", effect: "navigates", target: "Check in button", text: null });
    expect(await decideNext("x", shot, [], undefined, undefined, facts)).toMatchObject({ handling: "person" });
    answer({ ...base, kind: "click", effect: "navigates", target: "Name box", text: null });
    expect(await decideNext("x", shot, [], undefined, undefined, facts)).toMatchObject({ handling: "agent", fillsDetail: true });
  });

  it("never fills on sign-in or payment screens", async () => {
    for (const screen of ["sign_in", "payment", "permission_prompt"]) {
      answer({ ...base, screen, kind: "type", text: "Linda" });
      expect(await decideNext("x", shot, [], undefined, undefined, facts)).toMatchObject({ handling: "person" });
    }
  });
});

describe("window-reading pilot on a form", () => {
  const item = (name: string, role = "AXTextField"): UiItem => ({ path: name, role, name, frame: { x: 10, y: 10, w: 40, h: 20 } });
  const form: UiWindow = { app: "Google Chrome", window: "Check in", items: [item("Name"), item("Appointment number"), item("Check in", "AXButton")] };
  const plan = (p: Partial<UiDecision>): UiDecision => ({ status: "act", steps: [], point_at: null, handling: "agent", sensitivity: "routine", target: "", reason: "", ...p });

  function setup(decisions: UiDecision[], url: string | null = "https://bayview.example.com/checkin", consent = false) {
    const typed: string[] = [];
    const pressed: string[] = [];
    const guided: string[] = [];
    const asked: string[] = [];
    const values: Record<string, string> = {};
    let n = 0;
    const ui: UiDeps = {
      // Like a real form, a box shows what was typed into it.
      list: async () => ({ ...form, window: `Check in ${n++}`, items: form.items.map((it) => ({ ...it, value: values[it.name]?.length })) }),
      act: async (_a, it) => (pressed.push(it.name), { ok: true }),
      type: async (_a, it, text) => (typed.push(`${it.name}=${text}`), (values[it.name] = text), { ok: true }),
      command: () => "x",
    };
    const mac = { execute: async () => ({ code: 0, output: "", timedOut: false }) } as unknown as MacDeps;
    const agentUi = {
      status() {}, say() {}, detail() {},
      guide: async (g: { instruction: string }) => (guided.push(g.instruction), "done"),
      confirm: async (c: { message: string }) => (asked.push(c.message), consent),
    } as unknown as AgentUI;
    const ctx: ToolContext = { mac, ui: agentUi, evidence: [], diagnoses: new Map(), beforeAfter: [] };
    const queue = [...decisions];
    const run = () => uiPilot(ctx, ui, { instruction: "Fill in the check-in form", settleMs: 0, sleep: async () => {}, facts, pageUrl: async () => url, decide: async () => queue.shift() ?? plan({ status: "done" }) });
    return { run, typed, pressed, guided, asked, ctx };
  }

  it("types the given details, then leaves the Check in button to the person", async () => {
    // One action per decision (the window is read again after each).
    const t = setup([
      plan({ steps: [{ item: 1, do: "type", text: "Linda" }] }),
      plan({ steps: [{ item: 2, do: "type", text: "BV-48213" }] }),
      plan({ steps: [{ item: 3, do: "press", text: null }] }),
    ]);
    await t.run();
    expect(t.typed).toEqual(["Name=Linda", "Appointment number=BV-48213"]);
    expect(t.pressed).toEqual([]);
    expect(t.guided.at(-1)).toMatch(/send the form yourself/);
    expect(t.ctx.evidence.map((e) => e.command).join(" ")).not.toContain("Linda");
  });

  it("hands the field over when the value isn't a given detail", async () => {
    const t = setup([plan({ steps: [{ item: 1, do: "type", text: "Linda Smith" }] })]);
    await t.run();
    expect(t.typed).toEqual([]);
    expect(t.guided[0]).toMatch(/isn't one of the details/);
  });

  it("asks before typing details on a page that isn't https, and respects a no", async () => {
    const t = setup([plan({ steps: [{ item: 1, do: "type", text: "Linda" }] })], "http://bayview.example.com/checkin");
    await t.run();
    expect(t.asked[0]).toMatch(/secure.*bayview\.example\.com/);
    expect(t.typed).toEqual([]);
    expect(t.guided[0]).toMatch(/chose to fill it in yourself/);
  });

  it("fills it in after a yes, and asks only once per site", async () => {
    const t = setup([plan({ steps: [{ item: 1, do: "type", text: "Linda" }] }), plan({ steps: [{ item: 2, do: "type", text: "BV-48213" }] })], "http://bayview.example.com/checkin", true);
    await t.run();
    expect(t.typed).toEqual(["Name=Linda", "Appointment number=BV-48213"]);
    expect(t.asked).toHaveLength(1);
  });

  it("never asks on a normal https page", async () => {
    const t = setup([plan({ steps: [{ item: 1, do: "type", text: "Linda" }] })]);
    await t.run();
    expect(t.asked).toEqual([]);
    expect(t.typed).toEqual(["Name=Linda"]);
  });
});

describe("calendar events", () => {
  const now = new Date(2026, 9, 24, 18, 0).getTime();
  const ok = { title: "Video visit with Dr. Priya Patel", start: "2026-10-26T10:00", durationMinutes: null, alertMinutesBefore: 15, notes: "Appointment BV-48213", url: "" };

  it("checks the date, length and alert", () => {
    expect(parseEvent(ok, now)).toMatchObject({ year: 2026, month: 10, day: 26, hour: 10, minute: 0, durationMinutes: 30, alertMinutesBefore: 15 });
    expect(parseEvent({ ...ok, start: "2025-10-26T10:00" }, now)).toMatchObject({ problem: expect.stringMatching(/already passed/) });
    expect(parseEvent({ ...ok, start: "2026-02-30T10:00" }, now)).toMatchObject({ problem: expect.stringMatching(/doesn't exist/) });
    expect(parseEvent({ ...ok, start: "Oct 26 10am" }, now)).toHaveProperty("problem");
    expect(parseEvent({ ...ok, alertMinutesBefore: -5 }, now)).toHaveProperty("problem");
    expect(parseEvent({ ...ok, url: "http://example.com" }, now)).toHaveProperty("problem");
    expect(parseEvent({ ...ok, title: "  " }, now)).toHaveProperty("problem");
  });

  it("passes the event's text as arguments, never inside the script", () => {
    const e = parseEvent({ ...ok, title: `x" & (do shell script "touch /tmp/pwned") & "` }, now);
    if ("problem" in e) throw new Error(e.problem);
    const cmd = addEventCommand(e);
    const script = cmd.slice(0, cmd.indexOf("end run") + 7);
    expect(script).not.toContain("pwned");
    expect(cmd).toContain(`'x" & (do shell script "touch /tmp/pwned") & "'`);
    expect(findEventCommand(e)).toContain("summary is t and start date is s");
  });

  it("drops a leading dash so osascript can't read a title as an option", () => {
    const e = parseEvent({ ...ok, title: "-e do shell script" }, now);
    expect(e).toMatchObject({ title: "e do shell script" });
  });

  it("reads the lookup result", () => {
    expect(parseFound("found|Home|-15\n")).toEqual({ found: true, calendar: "Home", alertMinutesBefore: 15, url: "" });
    expect(parseFound("found|Work|")).toEqual({ found: true, calendar: "Work", alertMinutesBefore: null, url: "" });
    expect(parseFound("found|Home|-15|https://us05web.zoom.us/j/81234567890?pwd=x")).toEqual({ found: true, calendar: "Home", alertMinutesBefore: 15, url: "https://us05web.zoom.us/j/81234567890?pwd=x" });
    expect(parseFound("found|Home||")).toEqual({ found: true, calendar: "Home", alertMinutesBefore: null, url: "" });
    expect(parseFound("missing")).toEqual({ found: false });
  });
});

import { signedInPage, signInWall } from "../src/app/gather.js";
import { TOOLS } from "../src/agent/tools.js";

describe("webmail is read from the screen, not downloaded", () => {
  it("knows signed-in pages and sign-in walls", () => {
    expect(signedInPage("https://mail.google.com/mail/u/0/#inbox/abc")).toBe(true);
    expect(signedInPage("https://support.apple.com/en-us/102345")).toBe(false);
    expect(signInWall("Gmail\n\nSign in\nto continue to Gmail\n\nEmail or phone\n\nForgot email?")).toBe(true);
    expect(signInWall("How to install wget. Step 1: open Terminal and sign in to the App Store if asked. ".repeat(10))).toBe(false);
  });
});

describe("a message that may not be genuine", () => {
  const plan = TOOLS.find((t) => t.name === "propose_plan")!;
  const guidePerson = TOOLS.find((t) => t.name === "guide_person")!;
  const steps = [{ text: "Add the visit to your calendar", by: "me", why: null }, { text: "Check in online", by: "me", why: null }];
  function ctxWith(answer: boolean) {
    const confirms: { title: string; tone?: string; yes: string }[] = [];
    const ui = { say() {}, status() {}, detail() {}, confirm: async (c: { title: string; tone?: string; yes: string }) => (confirms.push(c), answer) } as unknown as AgentUI;
    const ctx: ToolContext = { mac: {} as MacDeps, ui, evidence: [], diagnoses: new Map(), beforeAfter: [] };
    return { ctx, confirms };
  }

  it("warns and lets the person choose to go ahead; then nothing is held back", async () => {
    const { ctx, confirms } = ctxWith(true);
    const out = await plan.run({ goal: "Get ready for your video visit", warning: "It says it's from Bayview Family Medicine, but it was sent from a gmail.com address.", steps }, ctx);
    expect(confirms[0]).toMatchObject({ title: "This message might not be real", tone: "danger", yes: "I trust it, go ahead" });
    expect(ctx.personTrusts).toBe(true);
    expect(ctx.approvedPlan).toEqual(["Add the visit to your calendar", "Check in online"]);
    expect(out).toMatch(/fill its forms with fill_details/);
  });

  it("stops when the person says no", async () => {
    const { ctx } = ctxWith(false);
    const out = await plan.run({ goal: "x", warning: "Odd sender.", steps }, ctx);
    expect(ctx.personTrusts).toBeUndefined();
    expect(ctx.approvedPlan).toBeUndefined();
    expect(out).toMatch(/Do nothing/);
  });

  it("brings the email back to the front before clicking its link", async () => {
    const ran: string[] = [];
    const guided: string[] = [];
    const ui = { say() {}, status() {}, detail() {}, guide: async (g: { instruction: string }) => (guided.push(g.instruction), "done") } as unknown as AgentUI;
    const mac = { run: async (c: string) => (ran.push(c), { code: 0, output: "", timedOut: false }) } as unknown as MacDeps;
    const ctx: ToolContext = { mac, ui, evidence: [], diagnoses: new Map(), beforeAfter: [], sourceApp: "Google Chrome" };
    await guidePerson.run({ instruction: "Click the Check in link in the email", click_target: "Check in", settings_url: null, in_message: true, fill_details: null }, ctx);
    expect(ran[0]).toBe("open -a 'Google Chrome'");
    // Never brings back Terminal-like apps.
    ran.length = 0;
    await guidePerson.run({ instruction: "x", click_target: null, settings_url: null, in_message: true, fill_details: null }, { ...ctx, sourceApp: "Terminal" });
    expect(ran).toEqual([]);
  });
});

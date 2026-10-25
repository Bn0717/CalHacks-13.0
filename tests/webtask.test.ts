import { describe, expect, it } from "vitest";
import { grounded, proofOnPage, refuseStep, runWebTask, type Planner, type WebDecision, type WebDeps, type WebStep, type WebUi } from "../src/browser/webtask.js";
import type { PageItem, PageSnapshot } from "../src/browser/snapshot.js";
import { calendarScript, parseLocal } from "../src/agent/tools.js";
import { unwrapRedirects } from "../src/mac/ui.js";

const EMAIL = `Hi Linda, Your video visit with Dr. Priya Patel is on Monday, October 26 at 10:00 AM (appointment BV-48213).
Check in for your visit online: Check in <https://calhacks.vzhsiao.com/checkin> Call us at (555) 014-2290.`;

const field = (ref: string, label: string, extra: Partial<PageItem> = {}): PageItem => ({ ref, kind: "text", label, value: "", ...extra });

describe("values must come from the person's text", () => {
  it("accepts exact, reformatted phone and reordered names", () => {
    expect(grounded("BV-48213", EMAIL)).toBe(true);
    expect(grounded("bv-48213", EMAIL)).toBe(true);
    expect(grounded("555-014-2290", EMAIL)).toBe(true);
    expect(grounded("Patel Priya", EMAIL)).toBe(true);
  });
  it("refuses made-up details", () => {
    expect(grounded("linda@example.com", EMAIL)).toBe(false);
    expect(grounded("1955-03-02", EMAIL)).toBe(false);
  });
});

describe("refuseStep: rules in code", () => {
  const step = (s: Partial<WebStep>): WebStep => ({ ref: "r1", action: "fill", field: "x", ...s });
  it("never types into private fields", () => {
    expect(refuseStep(step({ value: "BV-48213" }), field("r1", "Password", { kind: "password", private: "a password" }), EMAIL)).toMatch(/only the person/);
  });
  it("never presses a payment button", () => {
    expect(refuseStep(step({ action: "click" }), field("r1", "Pay $20", { kind: "button", payment: true }), EMAIL)).toMatch(/spends money/);
  });
  it("refuses a value that isn't in the text", () => {
    expect(refuseStep(step({ value: "Linda Smith" }), field("r1", "Full name"), EMAIL)).toMatch(/isn't in the person's text/);
  });
  it("allows a date field reformatted from the text's words", () => {
    expect(refuseStep(step({ value: "2026-10-26", from_text: "Monday, October 26" }), field("r1", "Visit date", { kind: "date" }), EMAIL)).toBeNull();
  });
  it("needs the element to still be there", () => {
    expect(refuseStep(step({ value: "x" }), undefined, EMAIL)).toMatch(/no r1/);
  });
});

describe("proofOnPage", () => {
  const page: PageSnapshot = { url: "https://x.test/", title: "", text: "You're checked in. Thanks, Linda.", items: [], alerts: [] };
  it("finds quoted words on the page", () => expect(proofOnPage("you're checked in", page)).toBe(true));
  it("rejects words that aren't there", () => expect(proofOnPage("Appointment confirmed", page)).toBe(false));
});

/** A fake check-in page: three fields and a button; sending shows the thank-you. */
function fakePage(): { deps: WebDeps; state: { values: Record<string, string>; sent: boolean; clicks: string[] } } {
  const state = { values: {} as Record<string, string>, sent: false, clicks: [] as string[] };
  const items = (): PageItem[] => [
    field("r1", "Appointment number", { value: state.values.r1 ?? "" }),
    field("r2", "Visit date", { kind: "date", value: state.values.r2 ?? "" }),
    { ref: "r3", kind: "select", label: "Visit type", value: state.values.r3 ?? "", options: ["In-person visit", "Video visit"] },
    { ref: "r4", kind: "submit", label: "Check in", submit: true },
  ];
  const deps: WebDeps = {
    open: async () => {},
    snapshot: async () =>
      state.sent
        ? { url: "https://x.test/checkin", title: "Done", text: "You're checked in. Thanks, Linda.", items: [], alerts: [] }
        : { url: "https://x.test/checkin", title: "Check in", text: "Check in for your visit", items: items(), alerts: [] },
    act: async (s) => {
      if (s.action === "click") {
        state.clicks.push(s.ref);
        if (s.ref === "r4") state.sent = true;
        return { ok: true };
      }
      state.values[s.ref] = s.value ?? "";
      return { ok: true, readBack: s.value };
    },
    settle: async () => {},
  };
  return { deps, state };
}

const quietUi = (over: Partial<WebUi> = {}): WebUi => ({ status: () => {}, detail: () => {}, ask: async () => "stop", confirm: async () => true, ...over });

const fill: WebDecision = {
  understanding: "Check-in form.",
  status: "act",
  message: "",
  proof: "",
  steps: [
    { ref: "r1", action: "fill", field: "Appointment number", value: "BV-48213", from_text: "appointment BV-48213" },
    { ref: "r2", action: "fill", field: "Visit date", value: "2026-10-26", from_text: "Monday, October 26" },
    { ref: "r3", action: "select", field: "Visit type", value: "Video visit", from_text: "video visit" },
    { ref: "r4", action: "click", field: "Check in", sends: true },
  ],
};
const done: WebDecision = { understanding: "", status: "done", steps: [], message: "", proof: "You're checked in" };

describe("runWebTask", () => {
  it("fills every field, sends it, and finishes only with proof on the page", async () => {
    const { deps, state } = fakePage();
    const answers = [fill, done];
    const planner: Planner = async () => answers.shift()!;
    const plans: number[] = [];
    const r = await runWebTask(deps, quietUi({ plan: (_l, d) => plans.push(d) }), { url: "https://x.test/checkin", task: "Check in", sourceText: EMAIL, sendApproved: true }, { planner });
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(true);
    expect(state.values).toEqual({ r1: "BV-48213", r2: "2026-10-26", r3: "Video visit" });
    expect(r.filled.map((f) => f.field)).toEqual(["Appointment number", "Visit date", "Visit type"]);
    expect(plans.at(-1)).toBe(4);
  });

  it("asks once before sending when the person hasn't asked to send", async () => {
    const { deps, state } = fakePage();
    const answers = [fill];
    let asked = 0;
    const r = await runWebTask(deps, quietUi({ confirm: async () => (asked++, false) }), { url: "https://x.test/checkin", task: "Check in", sourceText: EMAIL, sendApproved: false }, { planner: async () => answers.shift()! });
    expect(asked).toBe(1);
    expect(state.sent).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("doesn't accept 'done' without the proof on the page", async () => {
    const { deps } = fakePage();
    const answers: WebDecision[] = [{ ...done, proof: "Appointment confirmed" }, { ...done, status: "stuck", message: "Gave up" }];
    const history: string[][] = [];
    const r = await runWebTask(deps, quietUi(), { url: "https://x.test/checkin", task: "Check in", sourceText: EMAIL, sendApproved: true }, {
      planner: async (_t, _p, h) => (history.push([...h]), answers.shift()!),
    });
    expect(r.ok).toBe(false);
    expect(history[1].join(" ")).toMatch(/aren't on the page/);
  });

  it("refuses a made-up value and tells the planner", async () => {
    const { deps, state } = fakePage();
    const answers: WebDecision[] = [
      { ...fill, steps: [{ ref: "r1", action: "fill", field: "Appointment number", value: "BV-99999" }] },
      { ...done, status: "stuck", message: "x" },
    ];
    const history: string[][] = [];
    await runWebTask(deps, quietUi(), { url: "https://x.test/checkin", task: "Check in", sourceText: EMAIL, sendApproved: true }, { planner: async (_t, _p, h) => (history.push([...h]), answers.shift()!) });
    expect(state.values.r1).toBeUndefined();
    expect(history[1].join(" ")).toMatch(/isn't in the person's text/);
  });

  it("asks the person for missing information and uses the answer", async () => {
    const { deps, state } = fakePage();
    const answers: WebDecision[] = [
      { understanding: "", status: "ask", steps: [], message: "What's your appointment number?", proof: "" },
      { ...fill, steps: [{ ref: "r1", action: "fill", field: "Appointment number", value: "BV-77777" }] },
      { ...done, status: "stuck", message: "x" },
    ];
    await runWebTask(deps, quietUi({ ask: async () => "BV-77777" }), { url: "https://x.test/checkin", task: "Check in", sourceText: "no number here", sendApproved: true }, { planner: async () => answers.shift()! });
    expect(state.values.r1).toBe("BV-77777");
  });

  it("stops at once when Stop is pressed", async () => {
    const { deps, state } = fakePage();
    let stop = false;
    const r = await runWebTask(deps, quietUi({ status: () => {} }), { url: "https://x.test/checkin", task: "Check in", sourceText: EMAIL, sendApproved: true }, {
      planner: async () => ((stop = true), fill),
      stopped: () => stop,
    });
    expect(r.ok).toBe(false);
    expect(state.values).toEqual({});
  });
});

describe("calendar", () => {
  it("reads local date and time", () => {
    expect(parseLocal("2026-10-26T10:00")).toEqual({ y: 2026, mo: 10, d: 26, h: 10, mi: 0 });
    expect(parseLocal("Oct 26")).toBeNull();
  });
  it("builds a script with the event, its reminder and a read-back", () => {
    const sc = calendarScript({ title: 'Visit "Dr. Patel"', start: "2026-10-26T10:00", minutes: 30, reminder: 15, location: "", notes: "BV-48213" })!;
    expect(sc).toContain('summary:"Visit \\"Dr. Patel\\""');
    expect(sc).toContain("trigger interval:-15");
    expect(sc).toContain("whose uid is u");
  });
});

describe("email links", () => {
  it("unwraps Gmail's redirect to the real address", () => {
    expect(unwrapRedirects("Join <https://www.google.com/url?q=https://zoom.us/j/123&source=gmail&sa=E>")).toBe("Join <https://zoom.us/j/123>");
    expect(unwrapRedirects("Check in <https://calhacks.vzhsiao.com/checkin>")).toBe("Check in <https://calhacks.vzhsiao.com/checkin>");
  });
});

import { stepsOnScreen } from "../src/agent/tools.js";
describe("steps on screen", () => {
  it("counts the email's steps", () => {
    const email = `Hi Linda,
Your video visit with Dr. Priya Patel is on Monday, October 26 at 10:00 AM (appointment BV-48213). Please complete these steps before your visit:
Add your appointment to your calendar with a reminder 15 minutes before.
Check in for your visit online: Check in <https://calhacks.vzhsiao.com/checkin> Download Zoom from zoom.us/download, or update it if you already have it.
Allow Zoom to use your camera and microphone so Dr. Patel can see and hear you.
Make sure your volume is turned up and your computer isn't muted.`;
    expect(stepsOnScreen(email)).toBeGreaterThanOrEqual(4);
  });
  it("doesn't see steps in ordinary text", () => expect(stepsOnScreen("Hi! Lunch on Friday?\nSee you soon.")).toBe(0));
});

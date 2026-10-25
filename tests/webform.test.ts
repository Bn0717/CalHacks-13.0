import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI only says which detail goes in which box; it's faked here so the tests show what our code does with its answer.
const create = vi.fn();
vi.mock("../src/ai/client.js", () => ({ getClient: () => ({ messages: { create } }), MODEL: () => "test-model" }));

import { safeFacts } from "../src/agent/fill.js";
import { choosable, fillable, fillWebForm, optionStated, valueFor, type FormField, type WebFormDeps } from "../src/agent/webform.js";
import { TOOLS, type AgentUI, type MacDeps, type ToolContext } from "../src/agent/tools.js";

const facts = safeFacts([
  { label: "Name", value: "Linda" },
  { label: "Appointment number", value: "BV-48213" },
  { label: "Visit date", value: "2026-10-26" },
]);
const field = (i: number, label: string, extra: Partial<FormField> = {}): FormField => ({ i, tag: "input", type: "text", label, autocomplete: "", value: "", ...extra });
const FORM = [
  field(0, "Full name"),
  field(1, "Appointment number"),
  field(2, "Visit date", { type: "date" }),
  field(3, "Password", { type: "password" }),
  field(4, "Insurance member ID"),
  field(5, "Card number", { autocomplete: "cc-number" }),
  field(6, "I agree", { type: "checkbox" }),
  field(7, "Clinic", { tag: "select", type: "" }),
  field(8, "Visit type", { tag: "radio", type: "radio", options: ["In person at the clinic", "Video visit", "Phone call"] }),
  field(9, "Language for your visit", { tag: "select", type: "", options: ["Choose…", "English", "Spanish"] }),
  field(10, "I agree to", { tag: "radio", type: "radio", options: ["Yes", "No"] }),
];
const answer = (matches: { field: number; detail: string; option?: number | null; quote?: string | null }[]) => create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ matches }) }] });

function fakeBrowser(opts: { readBack?: (i: number, v: string) => string; fail?: boolean } = {}) {
  const typed: string[] = [];
  const chosen: string[] = [];
  let closed = false;
  const deps: WebFormDeps = {
    open: async () => {
      if (opts.fail) throw new Error("Chrome or Edge isn't installed");
      return {
        fields: async () => FORM,
        fill: async (i, v) => (typed.push(`${FORM[i].label}=${v}`), opts.readBack ? opts.readBack(i, v) : v),
        choose: async (i, k) => (chosen.push(`${FORM[i].label}=${FORM[i].options![k]}`), FORM[i].options![k]),
        markSubmit: async () => "Check in",
        close: async () => void (closed = true),
      };
    },
  };
  return { deps, typed, chosen, closed: () => closed };
}

function fakeCtx(extra: Partial<ToolContext> = {}, mac: Partial<MacDeps> = {}) {
  const guided: string[] = [];
  const confirms: string[] = [];
  const ui = {
    status() {}, say() {}, detail() {},
    confirm: async (c: { message: string }) => (confirms.push(c.message), true),
    guide: async (g: { instruction: string }) => (guided.push(g.instruction), "done"),
  } as unknown as AgentUI;
  const ctx: ToolContext = { mac: mac as MacDeps, ui, evidence: [], diagnoses: new Map(), beforeAfter: [], ...extra };
  return { ctx, guided, confirms };
}

beforeEach(() => create.mockReset());

describe("which boxes Playwright may type into", () => {
  it("only plain, non-secret text boxes", () => {
    expect(FORM.filter(fillable).map((f) => f.label)).toEqual(["Full name", "Appointment number", "Visit date"]);
  });

  it("only values that fit the box", () => {
    expect(valueFor(field(0, "d", { type: "date" }), "2026-10-26")).toBe("2026-10-26");
    expect(valueFor(field(0, "d", { type: "date" }), "Oct 26")).toBeNull();
    expect(valueFor(field(0, "e", { type: "email" }), "Linda")).toBeNull();
  });
});

describe("filling a web form", () => {
  it("fills matched boxes with the given values, reads them back, and leaves Submit", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }, { field: 2, detail: "Visit date" }]);
    const { ctx } = fakeCtx();
    const r = await fillWebForm(ctx, "https://bayview.example.com/checkin", facts, b.deps);
    expect(b.typed).toEqual(["Full name=Linda", "Appointment number=BV-48213", "Visit date=2026-10-26"]);
    expect(r).toMatchObject({ submit: "Check in", evidenceRef: "E1" });
    // The proof names the details, never their values.
    expect(ctx.evidence[0].output).not.toContain("Linda");
    // The AI is told only box labels and the details; the boxes it may not touch are never offered.
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toMatch(/Password|Insurance|Card number/);
  });

  it("ignores an AI answer that points a detail at a box it may not type into", async () => {
    const b = fakeBrowser();
    answer([{ field: 4, detail: "Name" }, { field: 3, detail: "Appointment number" }]);
    const r = await fillWebForm(fakeCtx().ctx, "https://bayview.example.com/checkin", facts, b.deps);
    expect(b.typed).toEqual([]);
    expect(r).toBeNull();
    expect(b.closed()).toBe(true);
  });

  it("counts only boxes that really hold the value afterwards", async () => {
    const b = fakeBrowser({ readBack: (i, v) => (i === 1 ? "" : v) });
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    const r = await fillWebForm(fakeCtx().ctx, "https://bayview.example.com/checkin", facts, b.deps);
    expect(r?.filled.map((f) => f.detail)).toEqual(["Name"]);
  });

  it("gives up quietly (so the screen route can try) when Chrome isn't there", async () => {
    const r = await fillWebForm(fakeCtx().ctx, "https://bayview.example.com/checkin", facts, fakeBrowser({ fail: true }).deps);
    expect(r).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("asks before filling on a page that isn't https", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }]);
    const { ctx, confirms } = fakeCtx();
    await fillWebForm(ctx, "http://bayview.example.com/checkin", facts, b.deps);
    expect(confirms[0]).toMatch(/secure/);
    expect(b.typed).toEqual(["Full name=Linda"]);
  });
});

describe("guide_person with a form: click on screen, fill with Playwright", () => {
  const guidePerson = TOOLS.find((t) => t.name === "guide_person")!;

  it("clicks the email's link, then fills the page that opened and hands the person Submit", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    // No screen access in this fake, so the link click is "done by the person" (the screen route is tested elsewhere).
    const { ctx, guided } = fakeCtx({ sourceApp: "Google Chrome" }, {
      run: async () => ({ code: 0, output: "", timedOut: false }),
      pageUrl: async () => "http://localhost:4321/checkin.html",
      webForm: b.deps,
    });
    const out = await guidePerson.run(
      { instruction: "Click the Check in link in the email, then fill in the form", click_target: "Check in", settings_url: null, in_message: true, fill_details: [{ label: "Name", value: "Linda" }, { label: "Appointment number", value: "BV-48213" }] },
      ctx,
    );
    expect(guided[0]).toMatch(/Click the "Check in" link/);
    expect(b.typed).toEqual(["Full name=Linda", "Appointment number=BV-48213"]);
    expect(guided[1]).toMatch(/press "Check in" yourself/);
    expect(out).toMatch(/\[E1\] CalHack clicked the link and filled Full name \(Name\), Appointment number/);
  });

  it("falls back to filling on screen when the page that opened is still the email", async () => {
    const b = fakeBrowser();
    const { ctx, guided } = fakeCtx({}, { pageUrl: async () => "https://mail.google.com/mail/u/0/#inbox", webForm: b.deps });
    await guidePerson.run({ instruction: "Fill in the form", click_target: null, settings_url: null, in_message: false, fill_details: [{ label: "Name", value: "Linda" }] }, ctx);
    expect(b.typed).toEqual([]);
    expect(guided).toEqual(["Fill in the form"]);
  });
});

describe("choosing an option the message states (e.g. the visit type)", () => {
  const visitType = FORM[8];
  const video = { label: "Visit type", value: "Video visit" };

  it("only radio groups and menus, never consent questions", () => {
    expect(FORM.filter(choosable).map((f) => f.label)).toEqual(["Visit type", "Language for your visit"]);
  });

  it("accepts an option only when the quote is in the detail and names that option and no other", () => {
    expect(optionStated(visitType, 1, video, "Video visit")).toBe(true);
    expect(optionStated(visitType, 1, { label: "Appointment", value: "your video visit with Dr. Patel" }, "video visit")).toBe(true);
    // Wrong option for the same words.
    expect(optionStated(visitType, 0, video, "Video visit")).toBe(false);
    // A quote that isn't in the detail.
    expect(optionStated(visitType, 1, { label: "Visit", value: "Monday at 10" }, "video")).toBe(false);
    // A word every option could share proves nothing.
    const generic = { ...visitType, options: ["Office visit", "Video visit"] };
    expect(optionStated(generic, 1, { label: "x", value: "a visit" }, "visit")).toBe(false);
    expect(optionStated(visitType, 7, video, "Video visit")).toBe(false);
  });

  it("picks the stated option, reads it back, and leaves unstated choices alone", async () => {
    const b = fakeBrowser();
    answer([
      { field: 8, detail: "Visit type", option: 1, quote: "Video visit" },
      // The AI guessing a language from nothing is refused: no detail says it.
      { field: 9, detail: "Name", option: 1, quote: "Linda" },
    ]);
    const facts2 = safeFacts([{ label: "Name", value: "Linda" }, video]);
    const { ctx } = fakeCtx();
    const r = await fillWebForm(ctx, "https://bayview.example.com/checkin", facts2, b.deps);
    expect(b.chosen).toEqual(["Visit type=Video visit"]);
    expect(r?.filled).toEqual([{ field: "Visit type", detail: "Visit type", chose: "Video visit" }]);
    expect(ctx.evidence[0].output).toContain("Visit type: Video visit");
  });

  it("never offers consent questions to the AI, and ignores an answer that targets one", async () => {
    const b = fakeBrowser();
    answer([{ field: 10, detail: "Visit type", option: 0, quote: "Video visit" }]);
    await fillWebForm(fakeCtx().ctx, "https://bayview.example.com/checkin", safeFacts([video]), b.deps);
    expect(b.chosen).toEqual([]);
    expect(create.mock.calls[0][0].messages[0].content).not.toContain("I agree");
  });

  it("counts a choice only when the page shows that option selected afterwards", async () => {
    const b = fakeBrowser();
    const deps: WebFormDeps = { open: async () => ({ ...(await b.deps.open("x")), choose: async () => "" }) };
    answer([{ field: 8, detail: "Visit type", option: 1, quote: "Video visit" }]);
    expect(await fillWebForm(fakeCtx().ctx, "https://bayview.example.com/checkin", safeFacts([video]), deps)).toBeNull();
  });
});

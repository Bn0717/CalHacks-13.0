import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI only says which detail goes in which box, and whether the page confirms the form was sent. It's faked here, so
// the tests show what our code does with its answers.
const create = vi.fn();
vi.mock("../src/ai/client.js", () => ({ getClient: () => ({ messages: { create } }), MODEL: () => "test-model" }));

import { safeFacts, type Fact } from "../src/agent/fill.js";
import { choosable, confirmSubmitted, fillable, fillWebForm, optionStated, valueFor, type FormField, type WebFormDeps } from "../src/agent/webform.js";
import { cardIsThePerson, parseCard } from "../src/mac/contacts.js";
import { TOOLS, type AgentUI, type MacDeps, type ToolContext } from "../src/agent/tools.js";

const facts = safeFacts([
  { label: "Name", value: "Linda" },
  { label: "Appointment number", value: "BV-48213" },
  { label: "Visit date", value: "2026-10-26" },
]);
const field = (i: number, label: string, extra: Partial<FormField> = {}): FormField => ({ i, tag: "input", type: "text", label, autocomplete: "", value: "", ...extra });
function makeForm(): FormField[] {
  return [
    field(0, "Full name", { required: true }),
    field(1, "Appointment number", { required: true }),
    field(2, "Visit date", { type: "date" }),
    field(3, "Password", { type: "password" }),
    field(4, "Insurance member ID"),
    field(5, "Card number", { autocomplete: "cc-number" }),
    field(6, "I agree to a video visit", { type: "checkbox", required: true, checked: false }),
    field(7, "Clinic", { tag: "select", type: "" }),
    field(8, "Visit type", { tag: "radio", type: "radio", options: ["In person at the clinic", "Video visit", "Phone call"] }),
    field(9, "Language for your visit", { tag: "select", type: "", options: ["Choose…", "English", "Spanish"] }),
    field(10, "I agree to", { tag: "radio", type: "radio", options: ["Yes", "No"] }),
    field(11, "Phone", { type: "tel" }),
  ];
}
const FORM = makeForm();
const answer = (matches: { field: number; detail: string; option?: number | null; quote?: string | null }[]) =>
  create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ matches }) }] });
const verdict = (accepted: boolean, quote: string) => create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ accepted, quote }) }] });

/** A fake form that behaves like the demo page: boxes hold values, Check in needs the required ones, then confirms. */
function fakeBrowser(opts: { readBack?: (i: number, v: string) => string; fail?: boolean; form?: FormField[]; confirmation?: string } = {}) {
  const form = opts.form ?? makeForm();
  const typed: string[] = [];
  const chosen: string[] = [];
  const ticked: string[] = [];
  let submitted = 0;
  let sent = false;
  let closed = false;
  const missing = () => form.filter((f) => f.required && (f.type === "checkbox" ? !f.checked : !f.value)).map((f) => f.label);
  const deps: WebFormDeps = {
    open: async () => {
      if (opts.fail) throw new Error("Chrome or Edge isn't installed");
      return {
        fields: async () => form.map((f) => ({ ...f })),
        fill: async (i, v) => {
          typed.push(`${form[i].label}=${v}`);
          const now = opts.readBack ? opts.readBack(i, v) : v;
          form[i].value = now;
          return now;
        },
        choose: async (i, k) => (chosen.push(`${form[i].label}=${form[i].options![k]}`), (form[i].value = form[i].options![k])),
        markSubmit: async () => "Check in",
        tick: async (i) => (ticked.push(form[i].label), (form[i].checked = true)),
        submit: async () => {
          submitted++;
          sent = missing().length === 0;
        },
        state: async () => ({
          url: "https://bayview.example.com/checkin",
          text: sent ? opts.confirmation ?? "✅ You're checked in. See you Monday." : "Check in for your video visit. Full name. Appointment number.",
          invalid: submitted && !sent ? missing() : [],
        }),
        close: async () => void (closed = true),
      };
    },
  };
  return { deps, form, typed, chosen, ticked, submitted: () => submitted, closed: () => closed };
}

function fakeCtx(extra: Partial<ToolContext> = {}, mac: Partial<MacDeps> = {}, confirmAnswer = true) {
  const guided: string[] = [];
  const confirms: { title: string; message: string; details?: string[] }[] = [];
  const said: string[] = [];
  const asked: string[] = [];
  const ui = {
    status() {}, detail() {},
    say: (t: string) => void said.push(t),
    ask: async (q: string) => (asked.push(q), ""),
    confirm: async (c: { title: string; message: string; details?: string[] }) => (confirms.push(c), confirmAnswer),
    guide: async (g: { instruction: string }) => (guided.push(g.instruction), "done"),
  } as unknown as AgentUI;
  const ctx: ToolContext = { mac: mac as MacDeps, ui, evidence: [], diagnoses: new Map(), beforeAfter: [], ...extra };
  return { ctx, guided, confirms, said, asked };
}

const URL = "https://bayview.example.com/checkin";
beforeEach(() => create.mockReset());

describe("which boxes Playwright may type into", () => {
  it("only plain, non-secret text boxes", () => {
    expect(FORM.filter(fillable).map((f) => f.label)).toEqual(["Full name", "Appointment number", "Visit date", "Phone"]);
  });

  it("only values that fit the box", () => {
    expect(valueFor(field(0, "d", { type: "date" }), "2026-10-26")).toBe("2026-10-26");
    expect(valueFor(field(0, "d", { type: "date" }), "Oct 26")).toBeNull();
    expect(valueFor(field(0, "e", { type: "email" }), "Linda")).toBeNull();
  });
});

describe("filling and submitting a web form", () => {
  it("after the approved plan: fills, ticks the required agreement, submits, and checks the site confirmed it", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }, { field: 2, detail: "Visit date" }]);
    verdict(true, "✅ You're checked in.");
    const { ctx, confirms, asked } = fakeCtx();
    const r = await fillWebForm(ctx, URL, facts, b.deps, { approved: true });
    expect(b.typed).toEqual(["Full name=Linda", "Appointment number=BV-48213", "Visit date=2026-10-26"]);
    expect(b.ticked).toEqual(["I agree to a video visit"]);
    expect(b.submitted()).toBe(1);
    expect(r).toMatchObject({ submitted: true, confirmation: "✅ You're checked in.", evidenceRef: "E1" });
    // Never asks the person anything: no questions, no extra confirmation after the approved plan.
    expect(asked).toEqual([]);
    expect(confirms).toEqual([]);
    expect(ctx.evidence[0]).toMatchObject({ code: 0, outcome: "passed" });
    // The proof names the details, never their values.
    expect(ctx.evidence[0].output).not.toContain("Linda");
    // Boxes it may not touch are never offered to the AI.
    expect(create.mock.calls[0][0].messages[0].content as string).not.toMatch(/Password|Insurance|Card number/);
  });

  it("without an approved plan, shows one summary first (including the box it will tick)", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    verdict(true, "✅ You're checked in.");
    const { ctx, confirms } = fakeCtx();
    const r = await fillWebForm(ctx, URL, facts, b.deps);
    expect(confirms[0]).toMatchObject({ title: "Send this check-in?" });
    expect(confirms[0].details).toEqual(["Full name: Linda", "Appointment number: BV-48213", "☑ I agree to a video visit"]);
    expect(r?.submitted).toBe(true);
  });

  it("a no on the summary sends nothing", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    const r = await fillWebForm(fakeCtx({}, {}, false).ctx, URL, facts, b.deps);
    expect(b.submitted()).toBe(0);
    expect(b.ticked).toEqual([]);
    expect(r).toMatchObject({ submitted: false, problem: expect.stringMatching(/chose not to send/) });
  });

  it("never makes up a required detail: it says what's missing and doesn't send", async () => {
    const form = makeForm();
    form.push(field(12, "Date of birth", { type: "date", required: true }));
    const b = fakeBrowser({ form });
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    const { ctx, asked } = fakeCtx();
    const r = await fillWebForm(ctx, URL, facts, b.deps, { approved: true });
    expect(b.submitted()).toBe(0);
    expect(asked).toEqual([]);
    expect(r).toMatchObject({ submitted: false, problem: expect.stringMatching(/Date of birth.*didn't send/) });
    expect(ctx.evidence[0]).toMatchObject({ code: 1, outcome: "failed" });
  });

  it("a required secret (insurance number) also stops it before sending", async () => {
    const form = makeForm();
    form[4].required = true;
    const b = fakeBrowser({ form });
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    const r = await fillWebForm(fakeCtx().ctx, URL, facts, b.deps, { approved: true });
    expect(b.submitted()).toBe(0);
    expect(r?.problem).toMatch(/Insurance member ID/);
  });

  it("ignores an AI answer that points a detail at a box it may not type into", async () => {
    const b = fakeBrowser();
    answer([{ field: 4, detail: "Name" }, { field: 3, detail: "Appointment number" }]);
    const r = await fillWebForm(fakeCtx().ctx, URL, facts, b.deps, { approved: true });
    expect(b.typed).toEqual([]);
    expect(r).toBeNull();
    expect(b.closed()).toBe(true);
  });

  it("counts only boxes that really hold the value afterwards (and then can't send)", async () => {
    const b = fakeBrowser({ readBack: (i, v) => (i === 1 ? "" : v) });
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    const r = await fillWebForm(fakeCtx().ctx, URL, facts, b.deps, { approved: true });
    expect(r?.filled.map((f) => f.detail)).toEqual(["Name"]);
    expect(r?.submitted).toBe(false);
    expect(b.submitted()).toBe(0);
  });

  it("gives up quietly when Chrome isn't there", async () => {
    const r = await fillWebForm(fakeCtx().ctx, URL, facts, fakeBrowser({ fail: true }).deps);
    expect(r).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("asks before filling on a page that isn't https", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    verdict(true, "✅ You're checked in.");
    const { ctx, confirms } = fakeCtx();
    await fillWebForm(ctx, "http://bayview.example.com/checkin", facts, b.deps, { approved: true });
    expect(confirms[0].message).toMatch(/secure/);
    expect(b.typed).toEqual(["Full name=Linda", "Appointment number=BV-48213"]);
  });
});

describe("checking the site accepted the form", () => {
  const before = { url: URL, text: "Check in for your visit" };
  it("needs a new confirmation sentence that is really on the page", async () => {
    verdict(true, "You're checked in");
    expect(await confirmSubmitted(before, { url: URL, text: "✅ You're checked in. See you Monday." })).toMatchObject({ submitted: true });
    // A quote that isn't on the page doesn't count, whatever the AI says.
    verdict(true, "Thank you for checking in");
    expect(await confirmSubmitted(before, { url: URL, text: "Please fix the errors below" })).toMatchObject({ submitted: false });
    // Text that was already there before sending isn't a confirmation.
    verdict(true, "Check in for your visit");
    expect(await confirmSubmitted(before, { url: URL, text: "Check in for your visit. Error: try again" })).toMatchObject({ submitted: false });
  });
  it("nothing changed means not sent, without asking the AI", async () => {
    expect(await confirmSubmitted(before, before)).toMatchObject({ submitted: false, problem: expect.stringMatching(/nothing changed/) });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("the person's own contact card", () => {
  const card = parseCard("first=Linda\nlast=Chen\nphone=(555) 010-2030\nemail=missing value\nbirthday=1950-03-07\n");
  it("reads My Card into details, dropping empty ones", () => {
    expect(card).toEqual([
      { label: "First name", value: "Linda" },
      { label: "Last name", value: "Chen" },
      { label: "Full name", value: "Linda Chen" },
      { label: "Phone", value: "(555) 010-2030" },
      { label: "Date of birth", value: "1950-03-07" },
    ]);
  });
  it("is used only when it's the person the message is addressed to", () => {
    expect(cardIsThePerson(card, [{ label: "Name", value: "Linda" }])).toBe(true);
    expect(cardIsThePerson(card, [{ label: "Name", value: "Linda Chen" }])).toBe(true);
    expect(cardIsThePerson(card, [{ label: "Name", value: "Vincent" }])).toBe(false);
    expect(cardIsThePerson([], [{ label: "Name", value: "Linda" }])).toBe(false);
  });
});

describe("guide_person with a form: click on screen, then Playwright fills and submits", () => {
  const guidePerson = TOOLS.find((t) => t.name === "guide_person")!;
  const input = (fill: Fact[]) => ({ instruction: "Click the Check in link in the email, then fill in the form", click_target: "Check in", settings_url: null, in_message: true, fill_details: fill });

  it("clicks the link, fills from the email and the person's contact card, submits, and reports the site's confirmation", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }, { field: 11, detail: "Phone" }]);
    verdict(true, "✅ You're checked in.");
    const card: Fact[] = [{ label: "First name", value: "Linda" }, { label: "Phone", value: "(555) 010-2030" }];
    let reads = 0;
    const { ctx, guided, said } = fakeCtx({ sourceApp: "Google Chrome", approvedPlan: ["Check in online"] }, {
      run: async () => ({ code: 0, output: "", timedOut: false }),
      // The email first; the check-in page once the link was clicked.
      pageUrl: async () => (++reads > 1 ? "http://localhost:4321/checkin.html" : "https://mail.google.com/mail/u/0/#inbox/abc"),
      webForm: b.deps,
      myCard: async () => card,
    });
    const out = await guidePerson.run(input([{ label: "Name", value: "Linda" }, { label: "Appointment number", value: "BV-48213" }]), ctx);
    // Nothing is ever handed to the person.
    expect(guided).toEqual([]);
    expect(b.typed).toEqual(["Full name=Linda", "Appointment number=BV-48213", "Phone=(555) 010-2030"]);
    expect(b.submitted()).toBe(1);
    expect(said.at(-1)).toMatch(/You're checked in/);
    expect(out).toMatch(/\[E1\] CalHack opened the link, filled .* pressed "Check in". The site confirmed it/);
  });

  it("doesn't use a contact card that belongs to someone else (a forwarded email)", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    verdict(true, "✅ You're checked in.");
    const { ctx } = fakeCtx({ approvedPlan: ["Check in online"] }, {
      pageUrl: async () => "http://localhost:4321/checkin.html",
      webForm: b.deps,
      myCard: async () => [{ label: "First name", value: "Bryan" }, { label: "Phone", value: "(555) 999-0000" }],
    });
    await guidePerson.run({ ...input([{ label: "Name", value: "Linda" }, { label: "Appointment number", value: "BV-48213" }]), in_message: false, click_target: null }, ctx);
    expect(create.mock.calls[0][0].messages[0].content as string).not.toContain("999-0000");
  });

  it("when the page isn't one it can open, it tries on screen and reports a failure: it never hands the form to the person", async () => {
    const b = fakeBrowser();
    const { ctx, guided } = fakeCtx({}, { pageUrl: async () => "https://mail.google.com/mail/u/0/#inbox", webForm: b.deps });
    const out = await guidePerson.run({ instruction: "Fill in the form", click_target: null, settings_url: null, in_message: false, fill_details: [{ label: "Name", value: "Linda" }] }, ctx);
    expect(b.typed).toEqual([]);
    expect(guided).toEqual([]);
    expect(out).toMatch(/couldn't finish this on screen/);
  });

  it("if the link can't be opened, it says so and moves on, without asking the person to click", async () => {
    const b = fakeBrowser();
    const { ctx, guided } = fakeCtx({ approvedPlan: ["Check in"] }, { pageUrl: async () => "https://mail.google.com/mail/u/0/#inbox", webForm: b.deps });
    const out = await guidePerson.run({ instruction: "x", click_target: "Check in", settings_url: null, in_message: true, fill_details: [{ label: "Name", value: "Linda" }] }, ctx);
    expect(guided).toEqual([]);
    expect(out).toMatch(/couldn't open the "Check in" link.*carry on/);
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
    expect(optionStated(visitType, 0, video, "Video visit")).toBe(false);
    expect(optionStated(visitType, 1, { label: "Visit", value: "Monday at 10" }, "video")).toBe(false);
    const generic = { ...visitType, options: ["Office visit", "Video visit"] };
    expect(optionStated(generic, 1, { label: "x", value: "a visit" }, "visit")).toBe(false);
    expect(optionStated(visitType, 7, video, "Video visit")).toBe(false);
  });

  it("picks the stated option, reads it back, and leaves unstated choices alone", async () => {
    const b = fakeBrowser();
    answer([
      { field: 0, detail: "Name" },
      { field: 1, detail: "Appointment number" },
      { field: 8, detail: "Visit type", option: 1, quote: "Video visit" },
      // The AI guessing a language from nothing is refused: no detail says it.
      { field: 9, detail: "Visit date", option: 1, quote: "2026" },
    ]);
    verdict(true, "✅ You're checked in.");
    const { ctx } = fakeCtx();
    const r = await fillWebForm(ctx, URL, safeFacts([...facts, video]), b.deps, { approved: true });
    expect(b.chosen).toEqual(["Visit type=Video visit"]);
    expect(r?.filled).toContainEqual({ field: "Visit type", detail: "Visit type", chose: "Video visit" });
    expect(ctx.evidence[0].output).toContain("Visit type: Video visit");
  });

  it("never offers consent questions to the AI, and ignores an answer that targets one", async () => {
    const b = fakeBrowser();
    answer([{ field: 10, detail: "Visit type", option: 0, quote: "Video visit" }]);
    await fillWebForm(fakeCtx().ctx, URL, safeFacts([video]), b.deps, { approved: true });
    expect(b.chosen).toEqual([]);
    expect(create.mock.calls[0][0].messages[0].content).not.toContain("I agree");
  });

  it("counts a choice only when the page shows that option selected afterwards", async () => {
    const b = fakeBrowser();
    const deps: WebFormDeps = { open: async () => ({ ...(await b.deps.open("x")), choose: async () => "" }) };
    answer([{ field: 8, detail: "Visit type", option: 1, quote: "Video visit" }]);
    expect(await fillWebForm(fakeCtx().ctx, URL, safeFacts([video]), deps, { approved: true })).toBeNull();
  });
});

import { uiPilot, type UiDeps } from "../src/agent/uipilot.js";

describe("the link step ends as soon as the page opens (checked by code)", () => {
  it("stops before asking the AI anything once doneWhen says the page is open", async () => {
    const decide = vi.fn();
    const ui = { list: async () => ({ app: "Google Chrome", window: "Check in", items: [{ path: "a", role: "AXButton", name: "Check in", frame: { x: 0, y: 0, w: 10, h: 10 } }, { path: "b", role: "AXTextField", name: "Appointment number", frame: { x: 0, y: 0, w: 10, h: 10 } }] }) } as unknown as UiDeps;
    const { ctx } = fakeCtx();
    const r = await uiPilot(ctx, ui, { instruction: 'Click the "Check in" link in the message', decide, doneWhen: async () => true, settleMs: 0, sleep: async () => {} });
    expect(r.outcome).toBe("done");
    expect(decide).not.toHaveBeenCalled();
  });

  it("waits for the new page's address, then hands the form to Playwright", async () => {
    const b = fakeBrowser();
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    verdict(true, "✅ You're checked in.");
    let reads = 0;
    const guidePerson = TOOLS.find((t) => t.name === "guide_person")!;
    const { ctx } = fakeCtx({ approvedPlan: ["Check in online"] }, {
      // The new tab takes a moment: the email's address is still showing for the first few reads.
      pageUrl: async () => (++reads < 2 ? "https://mail.google.com/mail/u/0/#inbox/abc" : "https://checkin.bayview.example/visit"),
      webForm: b.deps,
    });
    await guidePerson.run({ instruction: "x", click_target: "Check in", settings_url: null, in_message: true, fill_details: [{ label: "Name", value: "Linda" }, { label: "Appointment number", value: "BV-48213" }] }, ctx);
    expect(b.submitted()).toBe(1);
  });
});

describe("no handoffs in the email's link-and-form step", () => {
  it("a part the AI calls the person's ends the step instead of asking them", async () => {
    const ui = { list: async () => ({ app: "Google Chrome", window: "Mail", items: [{ path: "a", role: "AXLink", name: "Check in", frame: { x: 0, y: 0, w: 10, h: 10 } }, { path: "b", role: "AXButton", name: "Reply", frame: { x: 0, y: 0, w: 10, h: 10 } }] }) } as unknown as UiDeps;
    const decide = vi.fn(async () => ({ status: "person" as const, steps: [], point_at: 1, handling: "person" as const, sensitivity: "sensitive" as const, target: "Check in", reason: "Please click it" }));
    const { ctx, guided } = fakeCtx();
    const r = await uiPilot(ctx, ui, { instruction: 'Click the "Check in" link', decide, noHandoff: true, settleMs: 0, sleep: async () => {} });
    expect(r.outcome).toBe("gave_up");
    expect(guided).toEqual([]);
  });
});

import { linkFor, parseLinks } from "../src/mac/front.js";

describe("opening the email's link with Playwright directly", () => {
  const links = parseLinks(JSON.stringify([
    ["Check in", "https://www.google.com/url?q=https://checkin.bayview.example/visit?id%3DBV-48213&sa=D"],
    ["zoom.us/download", "https://zoom.us/download"],
    ["Join your visit", "https://join.example/v"],
  ]));

  it("finds the link by its words and unwraps webmail redirects", () => {
    expect(linkFor(links, "Check in")).toBe("https://checkin.bayview.example/visit?id=BV-48213");
    expect(linkFor(links, "join your visit")).toBe("https://join.example/v");
    expect(linkFor(links, "Pay now")).toBeNull();
    // Two different links with the same words: unclear, so not guessed.
    expect(linkFor([...links, { text: "Check in", url: "https://other.example/" }], "Check in")).toBeNull();
    expect(parseLinks("not json")).toEqual([]);
  });

  it("reads the link's address from the email, and Playwright opens and submits that page with no clicking on screen", async () => {
    const b = fakeBrowser();
    const opened: string[] = [];
    const deps: WebFormDeps = { open: async (u) => (opened.push(u), b.deps.open(u)) };
    answer([{ field: 0, detail: "Name" }, { field: 1, detail: "Appointment number" }]);
    verdict(true, "✅ You're checked in.");
    const guidePerson = TOOLS.find((t) => t.name === "guide_person")!;
    const screenUsed = vi.fn(async () => null);
    const { ctx, guided } = fakeCtx({ approvedPlan: ["Check in"], sourceApp: "Google Chrome" }, {
      run: async () => ({ code: 0, output: "", timedOut: false }),
      pageUrl: async () => "https://mail.google.com/mail/u/0/#inbox/abc",
      pageLinks: async () => ({ links }),
      webForm: deps,
      screen: { capture: screenUsed } as unknown as MacDeps["screen"],
    });
    const out = await guidePerson.run({ instruction: "x", click_target: "Check in", settings_url: null, in_message: true, fill_details: [{ label: "Name", value: "Linda" }, { label: "Appointment number", value: "BV-48213" }] }, ctx);
    expect(opened).toEqual(["https://checkin.bayview.example/visit?id=BV-48213"]);
    expect(screenUsed).not.toHaveBeenCalled();
    expect(guided).toEqual([]);
    expect(b.submitted()).toBe(1);
    expect(out).toMatch(/The site confirmed it/);
  });
});

import { describe, expect, it } from "vitest";
import { cleanTriage, triage, triageKey, type TriageAnswer } from "../src/ai/triage.js";

const base: TriageAnswer = { screen_problem: null, kind: "clarify", guide_id: null, goal: null, query: null, install_app: null, question: null, suggestions: [], say: "" };
const ids = ["printer-paused", "no-sound"];
const t = (a: Partial<TriageAnswer>) => cleanTriage({ ...base, ...a }, ids);

describe("cleanTriage", () => {
  it("keeps instructions as is", () => {
    expect(t({ kind: "instructions", say: "ignored" })).toEqual({ kind: "instructions" });
  });

  it("keeps a known guide", () => {
    expect(t({ kind: "guide", guide_id: "printer-paused", goal: "Fix a paused printer", say: "Let me check your printer." })).toEqual({
      kind: "guide",
      guideId: "printer-paused",
      goal: "Fix a paused printer",
      say: "Let me check your printer.",
    });
  });

  it("uses the screen problem when there's no goal", () => {
    const r = t({ kind: "guide", guide_id: "printer-paused", screen_problem: "The printer is paused", say: "Okay." });
    expect(r).toMatchObject({ kind: "guide", goal: "The printer is paused" });
  });

  it("turns an unknown guide into a search when it knows the goal", () => {
    const r = t({ kind: "guide", guide_id: "made-up", goal: "Fix Wi-Fi", say: "One moment." });
    expect(r).toEqual({ kind: "search", goal: "Fix Wi-Fi", query: "Fix Wi-Fi", installApp: undefined, say: "One moment." });
  });

  it("turns an unknown guide with nothing else into a question", () => {
    const r = t({ kind: "guide", guide_id: "made-up" });
    expect(r.kind).toBe("clarify");
  });

  it("fills in a missing search query for installs", () => {
    const r = t({ kind: "search", install_app: "Zoom", say: "Let me find Zoom for you." });
    expect(r).toEqual({ kind: "search", goal: "Install Zoom", query: "Zoom download for Mac", installApp: "Zoom", say: "Let me find Zoom for you." });
  });

  it("cleans the app name", () => {
    const r = t({ kind: "search", query: "zoom", install_app: "Zoom; rm -rf ~" });
    expect(r.kind === "search" && r.installApp).toBe("Zoom rm -rf");
  });

  it("asks when a search has nothing to search for", () => {
    expect(t({ kind: "search", query: "  " }).kind).toBe("clarify");
  });

  it("never says a command or a link out loud", () => {
    const r = t({ kind: "guide", guide_id: "no-sound", goal: "Fix sound", say: "Run `sudo killall coreaudiod`" });
    expect(r.kind === "guide" && r.say).toBe("Let me take a look.");
    const s = t({ kind: "search", query: "zoom", say: "Go to https://zoom.us" });
    expect(s.kind === "search" && s.say).toBe("Let me find the official help for that.");
  });

  it("gives a question and exactly 3 suggestions", () => {
    const r = t({ kind: "clarify", question: "What would you like help with?", suggestions: ["Print a page"], say: "Hi there!" });
    expect(r).toEqual({ kind: "clarify", question: "What would you like help with?", suggestions: ["Print a page", "My printer won't print", "I can't hear anything"], say: "Hi there!" });
    const empty = t({ kind: "clarify", suggestions: ["a", "b", "c", "d", "e"] });
    expect(empty.kind === "clarify" && empty.suggestions).toEqual(["a", "b", "c"]);
    expect(empty.kind === "clarify" && empty.question).toBe("Hi! What's going on?");
  });

  it("shortens long lines", () => {
    const r = t({ kind: "clarify", say: "word ".repeat(100) });
    expect(r.kind === "clarify" && r.say.length).toBeLessThanOrEqual(120);
  });
});

describe("triage", () => {
  it("asks right away when there's nothing to go on", async () => {
    const r = await triage({ guides: [], environment: "macOS" });
    expect(r).toMatchObject({ kind: "clarify", question: "Hi! What's going on?" });
  });

  it("keys the cache on words and screen text, not the screenshot", () => {
    const g = [{ id: "a", title: "A", describe: "", examples: [] }];
    expect(triageKey({ text: "my printer", screenText: "", guides: g })).toBe(triageKey({ text: " my printer ", guides: g }));
    expect(triageKey({ text: "my printer", guides: g })).not.toBe(triageKey({ text: "my sound", guides: g }));
  });
});


describe("removal requests", () => {
  it("keeps the explicit removal goal even if the model says install", () => {
    expect(cleanTriage({ ...base, kind: "search", goal: "Install Zoom", install_app: "Zoom" }, [], "uninstall Zoom"))
      .toMatchObject({ kind: "search", goal: "uninstall Zoom" });
    expect(cleanTriage({ ...base, kind: "search", goal: "Install Zoom", install_app: "Zoom" }, [], "uninstall Zoom"))
      .not.toHaveProperty("installApp");
  });
  it("never routes a removal goal to the installer", () => {
    const result = cleanTriage({ ...base, kind: "search", goal: "Remove Zoom", install_app: "Zoom" }, []);
    expect(result.kind === "search" && result.installApp).toBeUndefined();
  });
});

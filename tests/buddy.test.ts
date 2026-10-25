import { describe, expect, it } from "vitest";
import { poseForBar, seatOnCard } from "../src/app/buddy-pose.js";
import type { BarState, ReceiptView } from "../src/app/protocol.js";

const receipt = (verdict: ReceiptView["verdict"]): ReceiptView => ({ verdict, headline: "", beforeAfter: [], proofs: [], problems: [], reviewedBy: "rules" });
const done = (verdict: ReceiptView["verdict"]): BarState => ({ phase: "done", receipt: receipt(verdict), steps: [], detail: [], canRetry: false, canSendSummary: false });

describe("the buddy's pose for each bar moment", () => {
  it("goes away with the bar", () => {
    expect(poseForBar({ phase: "hidden" })).toBeNull();
  });
  it("looks around while CalHack reads the screen or runs checks", () => {
    expect(poseForBar({ phase: "looking", message: "Let me take a look…" })).toBe("scan");
    expect(poseForBar({ phase: "checking", title: "Checking", checks: [] })).toBe("scan");
  });
  it("waves when asking, and thinks while listening", () => {
    expect(poseForBar({ phase: "ask", question: "?", suggestions: [], listening: false, transcribing: false })).toBe("wave");
    expect(poseForBar({ phase: "ask", question: "?", suggestions: [], listening: true, transcribing: false })).toBe("think");
  });
  it("types while working", () => {
    expect(poseForBar({ phase: "working", goal: "", current: 1, total: 2, line: "", steps: [], detail: [] })).toBe("type");
  });
  it("holds up a stop sign for blocked plans and dangerous questions", () => {
    const plan = { phase: "plan", goal: "", steps: [], okLabel: "OK", cancelLabel: "No" } as const;
    expect(poseForBar({ ...plan, notes: [{ tone: "blocked", text: "This looks like a scam." }] })).toBe("stop");
    expect(poseForBar({ ...plan, notes: [] })).toBe("wave");
    expect(poseForBar({ phase: "confirm", title: "", message: "", yes: "Yes", no: "No", tone: "danger" })).toBe("stop");
  });
  it("celebrates success, stops on can't-do, and is sad otherwise", () => {
    expect(poseForBar(done("done"))).toBe("celebrate");
    expect(poseForBar(done("answered"))).toBe("celebrate");
    expect(poseForBar(done("cant-do"))).toBe("stop");
    expect(poseForBar(done("not-done"))).toBe("sad");
    expect(poseForBar(done("couldnt-verify"))).toBe("sad");
    expect(poseForBar({ phase: "error", message: "Oops" })).toBe("sad");
  });
});

describe("where the buddy sits on the bar", () => {
  const display = { x: 0, y: 0, width: 1440, height: 900 };
  it("stands on the card's top-left, in the layer's own coordinates", () => {
    expect(seatOnCard({ x: 500, y: 600, width: 480, height: 200 }, display)).toEqual({ x: 554, y: 606 });
    expect(seatOnCard({ x: 500, y: 600, width: 480, height: 200 }, { ...display, x: 100, y: 50 })).toEqual({ x: 454, y: 556 });
  });
  it("has no seat until the card is measured, or when the bar is on another screen", () => {
    expect(seatOnCard(null, display)).toBeNull();
    expect(seatOnCard({ x: 2000, y: 600, width: 480, height: 200 }, display)).toBeNull();
  });
});

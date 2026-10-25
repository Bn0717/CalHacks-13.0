import { describe, expect, it, vi } from "vitest";

// The model is faked: it first tries to finish leaving the check-in to the person, then does it.
const create = vi.fn();
vi.mock("../src/ai/client.js", () => ({ getClient: () => ({ beta: { messages: { create } } }), MODEL: () => "test-model" }));

import { handedBack, runAgent } from "../src/agent/agent.js";
import type { AgentUI, MacDeps } from "../src/agent/tools.js";

const STILL_YOURS = "Still yours: check in with the link, allow Zoom your camera and microphone, turn on captions if needed, and join at 10:00 AM.";

describe("finish can't quietly hand back steps CalHack can do", () => {
  it("spots a link or form left to the person, not real person-only parts", () => {
    expect(handedBack({ headline: "Ready for your visit", details: [STILL_YOURS] })).toBe(STILL_YOURS);
    expect(handedBack({ headline: "Ready", details: ["Still yours: allow Zoom your camera and microphone."] })).toBeNull();
    expect(handedBack({ headline: "Your visit is in Calendar", details: ["Volume is on."] })).toBeNull();
  });

  it("after an approved plan, sends the agent back once to do the check-in", async () => {
    const tool = (name: string, input: unknown, id: string) => ({ type: "tool_use", id, name, input });
    const reply = (...content: unknown[]) => ({ stop_reason: "tool_use", content });
    create
      .mockResolvedValueOnce(reply(tool("finish", { verdict: "done", headline: "Ready for your visit", details: [STILL_YOURS], proofs: [] }, "f1")))
      .mockResolvedValueOnce(reply(tool("finish", { verdict: "done", headline: "Ready for your visit", details: [STILL_YOURS], proofs: [] }, "f2")));
    const ui = { status() {}, say() {}, detail() {}, confirm: async () => true, ask: async () => "", explain: async () => {}, guide: async () => "done" } as unknown as AgentUI;
    const r = await runAgent({ request: "do the steps", environment: "test" }, ui, {} as MacDeps, { approvedPlan: ["Check in online"], webSearch: false });
    // The first finish was refused with a nudge to use guide_person; the second (unchanged) one is accepted.
    const blocks = create.mock.calls[1][0].messages.flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : []));
    const nudge = blocks.find((b: { tool_use_id?: string }) => b.tool_use_id === "f1");
    expect(nudge).toMatchObject({ type: "tool_result", is_error: true });
    expect(nudge.content).toMatch(/guide_person \(in_message true/);
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.turns).toBe(2);
  });
});

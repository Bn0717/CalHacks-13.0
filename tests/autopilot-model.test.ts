import { beforeEach, describe, expect, it, vi } from "vitest";

// The model call is replaced, so this proves where the decision comes from: whatever the model returns, not the words.
const create = vi.fn();
vi.mock("../src/ai/client.js", () => ({ getClient: () => ({ messages: { create } }), MODEL: () => "test-model" }));

import { decideNext } from "../src/agent/autopilot.js";

const shot = { data: "AAAA", mediaType: "image/png" as const, width: 100, height: 100, toScreen: 1 };
const answer = (input: Record<string, unknown>) => create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "next_action", input }] });
const base = { screen: "normal", kind: "click", x: 5, y: 5, text: null, key: null, target: "x", reason: "r" };

describe("decideNext uses the model, not words", () => {
  beforeEach(() => create.mockReset());

  it("sends the screenshot and the step to the model", async () => {
    answer({ ...base, handling: "agent", sensitivity: "routine" });
    await decideNext("Change desktop wallpaper", shot, ["Clicked Sound"]);
    const req = create.mock.calls[0][0];
    expect(req.messages[0].content[0]).toMatchObject({ type: "image", source: { data: "AAAA" } });
    expect(req.messages[0].content[1].text).toContain("Change desktop wallpaper");
    expect(req.messages[0].content[1].text).toContain("Clicked Sound");
    expect(req.tool_choice).toEqual({ type: "tool", name: "next_action" });
  });

  it("a harmless-sounding step can be handed to the person, and a scary-sounding one can be done, as the model says", async () => {
    answer({ ...base, target: "Wallpaper picture choices", handling: "person", sensitivity: "sensitive" });
    expect(await decideNext("Wallpaper", shot, [])).toMatchObject({ handling: "person", sensitivity: "sensitive" });
    answer({ ...base, target: "Privacy & Security in the sidebar", handling: "agent", sensitivity: "routine" });
    expect(await decideNext("Open Privacy & Security", shot, [])).toMatchObject({ handling: "agent", sensitivity: "routine" });
  });

  it("an agent answer on a sign-in or payment screen becomes the person", async () => {
    for (const screen of ["sign_in", "payment", "permission_prompt", "personal_details"]) {
      answer({ ...base, screen, handling: "agent", sensitivity: "routine" });
      expect(await decideNext("Click Continue", shot, [])).toMatchObject({ screen, handling: "person" });
    }
  });

  it("fails closed when the answer is missing or unclear", async () => {
    answer({ ...base, screen: "who knows", handling: "agent", sensitivity: "whatever" });
    expect(await decideNext("x", shot, [])).toMatchObject({ screen: "personal_details", handling: "person", sensitivity: "sensitive" });
    create.mockResolvedValueOnce({ content: [] });
    await expect(decideNext("x", shot, [])).rejects.toThrow(/no usable action/);
  });
});

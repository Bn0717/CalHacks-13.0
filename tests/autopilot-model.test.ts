import { beforeEach, describe, expect, it, vi } from "vitest";

// The model call is replaced, so this proves where the decision comes from: whatever the model returns, not the words.
const create = vi.fn();
vi.mock("../src/ai/client.js", () => ({ getClient: () => ({ messages: { create } }), MODEL: () => "test-model" }));

import { decideNext } from "../src/agent/autopilot.js";

const shot = { data: "AAAA", mediaType: "image/png" as const, width: 100, height: 100, toScreen: 1 };
const answer = (input: Record<string, unknown>) => create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "next_action", input }] });
const base = { screen: "normal", personal_choice: false, effect: "navigates", step_names_option: false, kind: "click", x: 5, y: 5, text: null, key: null, target: "x", reason: "r" };

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

  it("a personal choice is the person's, whatever else the model says", async () => {
    answer({ ...base, personal_choice: true, handling: "agent", sensitivity: "routine" });
    expect(await decideNext("Change wallpaper", shot, [])).toMatchObject({ personalChoice: true, handling: "person" });
  });

  it("picking among alternatives is the person's unless the step names the option, even if personal_choice said no", async () => {
    answer({ ...base, personal_choice: false, effect: "selects_option", step_names_option: false, handling: "agent" });
    expect(await decideNext("Pick a new wallpaper", shot, [])).toMatchObject({ personalChoice: true, handling: "person" });
    answer({ ...base, personal_choice: false, effect: "selects_option", step_names_option: true, handling: "agent" });
    expect(await decideNext("Set it to the blue picture", shot, [])).toMatchObject({ personalChoice: false, handling: "agent" });
    answer({ ...base, personal_choice: false, effect: "navigates", handling: "agent" });
    expect(await decideNext("Open Wallpaper", shot, [])).toMatchObject({ handling: "agent" });
  });

  it("fails closed when the answer is missing or unclear", async () => {
    answer({ ...base, screen: "who knows", personal_choice: undefined, handling: "agent", sensitivity: "whatever" });
    expect(await decideNext("x", shot, [])).toMatchObject({ screen: "personal_details", personalChoice: true, handling: "person", sensitivity: "sensitive" });
    create.mockResolvedValueOnce({ content: [] });
    await expect(decideNext("x", shot, [])).rejects.toThrow(/no usable action/);
  });
});

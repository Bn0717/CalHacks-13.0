import { beforeEach, describe, expect, it, vi } from "vitest";

// The model call is replaced, so this proves where the decision comes from: whatever the model returns, not the words.
const create = vi.fn();
vi.mock("../src/agent/ui-decision.js", async (original) => {
  const actual = await original<typeof import("../src/agent/ui-decision.js")>();
  return { ...actual, routeDecision: <T>(jev: unknown, claude: () => Promise<T>) => claude() };
});
const locate = vi.hoisted(() => vi.fn());
vi.mock("../src/ai/positioner.js", async (original) => ({ ...await original<typeof import("../src/ai/positioner.js")>(), locatePointer: locate }));
vi.mock("../src/ai/client.js", () => ({ getClient: () => ({ messages: { create } }), MODEL: () => "test-model" }));

import { decideNext } from "../src/agent/autopilot.js";

const shot = { data: "AAAA", mediaType: "image/png" as const, width: 100, height: 100, toScreen: 1 };
const answer = (input: Record<string, unknown>) => create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(input) }] });
const base = { screen: "normal", personal_choice: false, effect: "navigates", step_names_option: false, kind: "click", x: 5, y: 5, text: null, key: null, target: "x", reason: "r" };

describe("decideNext uses the model, not words", () => {
  beforeEach(() => {
    create.mockReset();
    locate.mockReset().mockResolvedValue({ attempts: [], selected: "jev", point: { x: 21, y: 32 } });
  });

  it("sends the screenshot and the step to the model", async () => {
    answer({ ...base, handling: "agent", sensitivity: "routine" });
    await decideNext("Change desktop wallpaper", shot, ["Clicked Sound"]);
    const req = create.mock.calls[0][0];
    expect(req.messages[0].content[0]).toMatchObject({ type: "image", source: { data: "AAAA" } });
    expect(req.messages[0].content[1].text).toContain("Change desktop wallpaper");
    expect(req.messages[0].content[1].text).toContain("Clicked Sound");
    // A fixed answer shape (structured output) rather than a forced tool, so it works on every model.
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.tool_choice).toBeUndefined();
    expect(req.output_config.format.schema.properties.x).toBeUndefined();
    expect(locate).toHaveBeenCalledWith("x", shot, undefined);
  });

  it("uses only positioner coordinates, and cannot use planner coordinates after a failed lookup", async () => {
    answer({ ...base, handling: "agent", sensitivity: "routine" });
    expect(await decideNext("x", shot, [])).toMatchObject({ x: 21, y: 32 });
    locate.mockResolvedValueOnce({ attempts: [] });
    answer({ ...base, handling: "agent", sensitivity: "routine" });
    const a = await decideNext("x", shot, []);
    expect(a.x).toBeUndefined();
    expect(a.y).toBeUndefined();
  });

  it.each(["done", "wait", "type", "key"])("skips positioning for agent %s actions", async (kind) => {
    answer({ ...base, kind, handling: "agent", sensitivity: "routine" });
    await decideNext("x", shot, []);
    expect(locate).not.toHaveBeenCalled();
  });

  it("positions handoff highlights even when the action was typing", async () => {
    answer({ ...base, kind: "type", screen: "sign_in", handling: "agent" });
    expect(await decideNext("x", shot, [])).toMatchObject({ handling: "person", x: 21, y: 32 });
    expect(locate).toHaveBeenCalledOnce();
  });

  it("passes Stop through the positioning request", async () => {
    const controller = new AbortController();
    answer({ ...base, handling: "agent", sensitivity: "routine" });
    locate.mockImplementationOnce(async (_target, _shot, signal: AbortSignal) => { controller.abort(); signal.throwIfAborted(); });
    await expect(decideNext("x", shot, [], undefined, controller.signal)).rejects.toThrow();
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

  it("lets the agent take access away without asking, but only by clicking and never on a sign-in, payment or details screen", async () => {
    answer({ ...base, screen: "permission_prompt", effect: "changes_setting", reduces_risk: true, handling: "person", sensitivity: "sensitive" });
    expect(await decideNext("Turn off notifications from this site", shot, [])).toMatchObject({ reducesRisk: true, handling: "agent" });
    answer({ ...base, effect: "changes_setting", reduces_risk: true, handling: "person", sensitivity: "sensitive" });
    expect(await decideNext("Block notifications in Chrome", shot, [])).toMatchObject({ reducesRisk: true, handling: "agent" });
    for (const screen of ["sign_in", "payment", "personal_details"]) {
      answer({ ...base, screen, reduces_risk: true, handling: "agent", sensitivity: "sensitive" });
      expect(await decideNext("x", shot, [])).toMatchObject({ reducesRisk: false, handling: "person" });
    }
    answer({ ...base, kind: "type", text: "hi", screen: "permission_prompt", reduces_risk: true, handling: "agent", sensitivity: "sensitive" });
    expect(await decideNext("x", shot, [])).toMatchObject({ reducesRisk: false, handling: "person" });
    answer({ ...base, screen: "permission_prompt", handling: "agent", sensitivity: "sensitive" });
    expect(await decideNext("x", shot, [])).toMatchObject({ reducesRisk: false, handling: "person" });
  });
});

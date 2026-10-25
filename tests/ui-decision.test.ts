import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("../src/ai/client.js", () => ({ loadEnv() {}, MODEL: () => "claude-test", hasApiKey: () => true, getClient: () => ({ messages: { create } }) }));
import { decideScreen, screenShows, type Shot } from "../src/agent/autopilot.js";
import { decideWindow, uiPilot, type UiDeps } from "../src/agent/uipilot.js";
import type { ToolContext } from "../src/agent/tools.js";
import type { UiWindow } from "../src/mac/ui.js";
import { choose } from "../src/ai/typesafe.js";

const shot: Shot = { data: "AAAA", mediaType: "image/png", width: 1000, height: 600, toScreen: 2 };
const window: UiWindow = { app: "Fixture", window: "Settings", items: [
  { path: "0", role: "AXButton", name: "Display", frame: { x: 10, y: 20, w: 100, h: 40 } },
  { path: "1", role: "AXButton", name: "Sound", frame: { x: 10, y: 80, w: 100, h: 40 } },
] };
const defaults: Record<string, unknown> = { mode: "act", kind: "click", key: "tab", target: "unlisted", item: "item_1", operation: "press",
  complete: 0, person_remains: 0, visible: 1, location: { left: 0.1, right: 0.2, top: 0.2, bottom: 0.3 }, confirmation: { left: 0.1, right: 0.2, top: 0.2, bottom: 0.3 },
  screen: "normal", handling: "agent", sensitivity: "routine", effect: "navigates", personal: 0, named: 0, reduces: 0, matches: 1, shows: 1 };
function reply(body: any, overrides: Record<string, unknown> = {}) {
  const values = { ...defaults, ...overrides };
  const answers = Object.fromEntries(Object.entries(body.questions).map(([name, definition]) => {
    const q = definition as any;
    if (q.type === "choice") {
      const selected = values[name] as string;
      return [name, { type: "choice", choice: selected, confidence: 0.99,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map((key) => [key, key === selected ? 0.99 : 0.01 / (Object.keys(q.criteria).length - 1)])) }];
    }
    if (q.type === "box") return [name, { type: "box", box: values[name], confidence: 0.99 }];
    return [name, { type: "noul", noul: values[name] }];
  }));
  return Response.json({ model: "jev-1.14.0", answers, usage: { input_tokens: 100, output_tokens: 20 } });
}
const fetched = vi.fn();
beforeEach(() => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-key");
  vi.stubEnv("CALHACK_UI_DECISION_PROVIDER", "jev");
  vi.stubEnv("CALHACK_POINTER_PROVIDER", "haiku");
  vi.stubEnv("CALHACK_JEV_MODEL", "jev-1.14.0");
  create.mockReset().mockResolvedValue({ model: "claude-test", content: [{ type: "text", text: JSON.stringify({ kind: "done", status: "done", steps: [], reason: "done" }) }], usage: { input_tokens: 30, output_tokens: 10 } });
  fetched.mockReset().mockImplementation(async (_url, options) => reply(JSON.parse(options.body)));
  vi.stubGlobal("fetch", fetched);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Jev UI engine", () => {
  it("grounds and checks a screenshot action in two calls with zero Anthropic calls", async () => {
    const action = await decideScreen("Open Display", shot, []);
    expect(action).toMatchObject({ kind: "click", x: 150, y: 150, handling: "agent", sensitivity: "routine" });
    expect(action.positioning).toBeUndefined();
    expect(fetched).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetched.mock.calls[0][1].body);
    const second = JSON.parse(fetched.mock.calls[1][1].body);
    expect(second.state.proposed.point).toEqual({ x: 150, y: 150 });
    expect(Object.values(first.assets)[0]).toEqual(Object.values(second.assets)[0]);
    expect(second.state.screenshot_size).toEqual({ width: 1000, height: 600 });
    expect(action.decisionTrace).toMatchObject({ provider: "jev", attempts: [{ stage: "selection_and_grounding" }, { stage: "safety" }] });
    expect(create).not.toHaveBeenCalled();
  });

  it("chooses an Accessibility item, validates it, and returns only one action", async () => {
    const result = await decideWindow("Open Display", window, []);
    expect(result).toMatchObject({ status: "act", steps: [{ item: 1, do: "press", text: null }], target: "Display", handling: "agent" });
    expect(JSON.parse(fetched.mock.calls[1][1].body).state.proposed.item.path).toBe("0");
    expect(create).not.toHaveBeenCalled();
  });

  it("resolves activation to native selection for a row without another model choice", async () => {
    const result = await decideWindow("Open Display", { ...window, items: [{ ...window.items[0], role: "AXRow" }] }, []);
    expect(result.steps).toEqual([{ item: 1, do: "select", text: null }]);
    expect(create).not.toHaveBeenCalled();
  });

  it("can ground an exact literal task label without generating target text", async () => {
    fetched.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      const target = body.questions.target ? Object.keys(body.questions.target.criteria).find((key) => body.questions.target.criteria[key] === "Display") : "unlisted";
      return reply(body, { target });
    });
    const result = await decideScreen("Open Display", shot, []);
    expect(result.target).toBe("Display");
    expect(result.decisionTrace?.attempts.map((a) => a.stage)).toEqual(["selection_and_grounding", "target_grounding", "safety"]);
    expect(JSON.parse(fetched.mock.calls[1][1].body).state.target).toBe("Display");
    expect(create).not.toHaveBeenCalled();
  });

  it("uses the shared interior of two boxes and refuses inconsistent grounding", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { confirmation: { left: 0.1, right: 0.18, top: 0.2, bottom: 0.28 } }));
    const result = await decideScreen("Open Display", shot, []);
    expect(result.x).toBeCloseTo(140);
    expect(result.y).toBeCloseTo(144);
    expect(create).not.toHaveBeenCalled();
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { confirmation: { left: 0.7, right: 0.8, top: 0.6, bottom: 0.7 } }));
    expect((await decideScreen("Open Display", shot, [])).decisionTrace).toMatchObject({ provider: "claude", fallbackReason: "uncertain_decision" });
  });

  it("ignores irrelevant option-naming uncertainty during navigation", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { named: 0.5 }));
    expect((await decideScreen("Open Display", shot, [])).decisionTrace?.provider).toBe("jev");
    expect(create).not.toHaveBeenCalled();
  });

  it("refines small controls in an enlarged in-memory crop and maps back to full-screen pixels", async () => {
    const { default: sharp } = await import("sharp");
    const data = await sharp({ create: { width: 1000, height: 600, channels: 3, background: "white" } }).png().toBuffer();
    fetched.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      return reply(body, { location: body.state.crop ? { left: 0.4, right: 0.6, top: 0.4, bottom: 0.6 } : { left: 0.1, right: 0.2, top: 0.2, bottom: 0.23 } });
    });
    const result = await decideScreen("Open Display", { ...shot, data: data.toString("base64") }, []);
    expect(result.decisionTrace?.attempts.map((a) => a.stage)).toEqual(["selection_and_grounding", "precision_grounding", "safety"]);
    const cropRequest = JSON.parse(fetched.mock.calls[1][1].body);
    expect(cropRequest.state.screenshot_size).toEqual({ width: 640, height: 640 });
    expect(result.x).toBeCloseTo(150);
    expect(result.y).toBeCloseTo(132.5);
    expect(create).not.toHaveBeenCalled();
  });

  it("groups all 400 items without truncating or accepting an invented item", async () => {
    const large = { ...window, items: Array.from({ length: 400 }, (_, i) => ({ ...window.items[0], name: `Control ${i + 1}`, path: String(i) })) };
    fetched.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      return reply(body, { item: body.questions.item?.criteria.group_0 ? "group_1" : "item_400" });
    });
    const result = await decideWindow("Open Control 400", large, []);
    expect(result.steps[0].item).toBe(400);
    expect(fetched).toHaveBeenCalledTimes(3);
    const groups = JSON.parse(fetched.mock.calls[0][1].body).questions.item.criteria;
    expect(groups.group_0.length + groups.group_1.length).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["sign_in", "payment", "permission_prompt", "personal_details"])("keeps %s in the person's hands even when handling says agent", async (screen) => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { screen }));
    expect(await decideScreen("Click Continue", shot, [])).toMatchObject({ handling: "person", screen });
    expect(create).not.toHaveBeenCalled();
  });

  it("never chooses a personal option unless explicitly named", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { effect: "selects_option", personal: 0, named: 0 }));
    expect(await decideScreen("Change wallpaper", shot, [])).toMatchObject({ handling: "person", personalChoice: true });
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { effect: "selects_option", personal: 0, named: 1 }));
    expect(await decideScreen("Choose the blue wallpaper", shot, [])).toMatchObject({ handling: "agent", personalChoice: false });
  });

  it("keeps secure fields in the person's hands and does not generate secrets", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { mode: "person", operation: "type", screen: "sign_in" }));
    const result = await decideWindow("Sign in", { ...window, items: [{ ...window.items[0], secure: true }] }, []);
    expect(result).toMatchObject({ status: "person", steps: [], handling: "person" });
    expect(create).not.toHaveBeenCalled();
  });

  it("only allows risk-reducing clicks on permission prompts, never payments", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { screen: "permission_prompt", handling: "person", reduces: 1, effect: "changes_setting" }));
    expect(await decideScreen("Block notifications", shot, [])).toMatchObject({ handling: "agent", reducesRisk: true });
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { screen: "payment", handling: "agent", reduces: 1 }));
    expect(await decideScreen("Click Pay", shot, [])).toMatchObject({ handling: "person", reducesRisk: false });
  });

  it("requires visible completion proof, rather than previous clicks or an elapsed delay", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { mode: "done", complete: 0.8 }));
    const uncertain = await decideScreen("Open Display", shot, ["Clicked Display"]);
    expect(uncertain.decisionTrace).toMatchObject({ provider: "claude", fallbackReason: "uncertain_decision" });
    create.mockClear();
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { mode: "done", complete: 1 }));
    expect(await decideScreen("Open Display", shot, [])).toMatchObject({ kind: "done", decisionTrace: { provider: "jev" } });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not mark a task done while a person's permission or personal choice remains", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { mode: "done", complete: 1, person_remains: 1 }));
    expect(await decideScreen("Open camera settings and let me decide", shot, [])).toMatchObject({ kind: "click", handling: "person" });
    expect(await decideWindow("Open camera settings and let me decide", window, [])).toMatchObject({ status: "person", steps: [] });
    expect(create).not.toHaveBeenCalled();
  });

  it("waits and rereads an Accessibility window without acting", async () => {
    let n = 0;
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), n++ === 0 ? { mode: "wait" } : { mode: "done", complete: 1 }));
    const list = vi.fn().mockResolvedValue(window), act = vi.fn();
    const ui = { list, act } as unknown as UiDeps;
    const ctx = { signal: undefined, evidence: [], ui: { detail() {} } } as unknown as ToolContext;
    expect((await uiPilot(ctx, ui, { instruction: "Open Display", sleep: async () => {} })).outcome).toBe("done");
    expect(list).toHaveBeenCalledTimes(2);
    expect(act).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("supports allowlisted keys without a second positioner request", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { kind: "key", key: "down" }));
    expect(await decideScreen("Move down", shot, [])).toMatchObject({ kind: "key", key: "down", x: undefined });
    expect(fetched).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it("falls back on the same screenshot for text generation", async () => {
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { kind: "type" }));
    await decideScreen("Search for Display", shot, []);
    expect(create.mock.calls[0][0].messages[0].content[0].source.data).toBe(shot.data);
    expect(create).toHaveBeenCalledOnce();
  });

  it.each(["invalid_response", "uncertain_decision", "timeout"])("falls back safely on %s", async (reason) => {
    if (reason === "invalid_response") fetched.mockResolvedValue(Response.json({ answers: {} }));
    if (reason === "uncertain_decision") fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { visible: 0.5 }));
    if (reason === "timeout") {
      vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(AbortSignal.abort());
      fetched.mockImplementation(async (_url, options) => { options.signal.throwIfAborted(); });
    }
    expect((await decideScreen("Open Display", shot, [])).decisionTrace).toMatchObject({ provider: "claude", fallbackReason: reason });
    expect(create).toHaveBeenCalledOnce();
  });

  it("checks results through Jev and fails closed for negative or inconclusive evidence", async () => {
    expect(await screenShows("Display is open", shot)).toMatchObject({ shows: true, decisionTrace: { provider: "jev" } });
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { shows: 0 }));
    expect(await screenShows("Display is open", shot)).toMatchObject({ shows: false, decisionTrace: { provider: "jev" } });
    expect(create).not.toHaveBeenCalled();
    fetched.mockImplementation(async (_url, options) => reply(JSON.parse(options.body), { shows: 0.7 }));
    create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ shows: false, seen: "unclear" }) }] });
    expect(await screenShows("Display is open", shot)).toMatchObject({ shows: false, decisionTrace: { provider: "claude", fallbackReason: "uncertain_decision" } });
  });

  it("Stop during or after a request discards the answer without falling back", async () => {
    const controller = new AbortController();
    fetched.mockImplementation(async (_url, options) => { controller.abort(); return reply(JSON.parse(options.body)); });
    await expect(decideScreen("Open Display", shot, [], controller.signal)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    await expect(decideWindow("Open Display", window, [], AbortSignal.abort())).rejects.toThrow();
  });

  it("explicit Claude mode bypasses Jev entirely", async () => {
    await decideScreen("Open Display", shot, [], undefined, { provider: "claude" });
    expect(fetched).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });

  it("validates probabilities and rejects hallucinated choice identifiers", () => {
    expect(() => choose({ mode: { type: "choice", choice: "invented", confidence: 1, probabilities: { invented: 1 } } }, "mode", { act: "act", done: "done" })).toThrow("invalid_response");
  });
});

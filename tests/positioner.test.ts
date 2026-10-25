import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("../src/ai/client.js", () => ({
  loadEnv() {},
  hasApiKey: () => !!process.env.ANTHROPIC_API_KEY,
  getClient: () => ({ messages: { create } }),
}));
import { locatePointer, locateWithProvider, screenPoint } from "../src/ai/positioner.js";

const image = { data: "AAAA", mediaType: "image/png" as const, width: 1000, height: 600, toScreen: 2 };
const response = () => ({ model: "jev-1.14.0", answers: {
  visible: { type: "noul", noul: 0.99 },
  location: { type: "box", box: { left: 0.2, right: 0.4, top: 0.2, bottom: 0.4 }, confidence: 0.95 },
}, usage: { input_tokens: 200, output_tokens: 25 } });
const fetched = vi.fn();

beforeEach(() => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-jev-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("CALHACK_POINTER_PROVIDER", "auto");
  vi.stubEnv("CALHACK_JEV_MODEL", "");
  vi.stubEnv("CALHACK_HAIKU_POINTER_MODEL", "");
  vi.stubEnv("CALHACK_JEV_MIN_PRESENCE", "");
  vi.stubEnv("CALHACK_JEV_MIN_CONFIDENCE", "");
  create.mockReset().mockResolvedValue({ model: "claude-haiku-5-5", content: [{ type: "text", text: JSON.stringify({ visible: true, x: 300, y: 180 }) }], usage: { input_tokens: 100, output_tokens: 10 } });
  fetched.mockReset().mockImplementation(async () => Response.json(response()));
  vi.stubGlobal("fetch", fetched);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Jev screenshot positioning", () => {
  it("uses the official image API, one asset reference, a presence gate and a normalized box", async () => {
    const result = await locateWithProvider("jev", "Add Printer button", image);
    expect(result).toMatchObject({ status: "found", provider: "jev", model: "jev-1.14.0", point: { x: 300, y: 180 }, box: { left: 200, right: 400, top: 120, bottom: 240 }, presence: 0.99, confidence: 0.95, usage: { inputTokens: 200, outputTokens: 25 } });
    const [url, options] = fetched.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(options.headers).toMatchObject({ Authorization: "Bearer test-jev-key", "TypeSafe-Danger-Zone-Images": "true" });
    const body = JSON.parse(options.body);
    expect(body.assets[body.state.screenshot]).toEqual({ type: "image", format: "png", data_base64: "AAAA" });
    expect(options.body.split(body.state.screenshot)).toHaveLength(3); // state + asset key, not repeated in questions
    expect(body.questions.location).toMatchObject({ type: "box" });
    expect(body.questions.location.criteria).toBeUndefined();
    expect(body.questions.visible.type).toBe("noul");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(create).not.toHaveBeenCalled();
  });

  it("handles JPEG and model overrides", async () => {
    vi.stubEnv("CALHACK_JEV_MODEL", "jev-preview");
    await locateWithProvider("jev", "button", { ...image, mediaType: "image/jpeg" });
    const body = JSON.parse(fetched.mock.calls[0][1].body);
    expect(body.model).toBe("jev-preview");
    expect(Object.values(body.assets)[0]).toMatchObject({ format: "jpg" });
  });

  it("ignores a fabricated box when the target is absent", async () => {
    const data = response();
    data.answers.visible.noul = 0.1;
    fetched.mockResolvedValueOnce(Response.json(data));
    const result = await locateWithProvider("jev", "missing", image);
    expect(result.status).toBe("not_found");
    expect(result.point).toBeUndefined();
    expect(result.box).toBeUndefined();
  });

  it("enforces confidence and configurable presence thresholds", async () => {
    const data = response();
    data.answers.location.confidence = 0.79;
    fetched.mockResolvedValueOnce(Response.json(data));
    expect(await locateWithProvider("jev", "button", image)).toMatchObject({ status: "rejected", reason: "insufficient_confidence" });
    vi.stubEnv("CALHACK_JEV_MIN_PRESENCE", "1");
    expect(await locateWithProvider("jev", "button", image)).toMatchObject({ status: "not_found", reason: "insufficient_presence" });
    vi.stubEnv("CALHACK_JEV_MIN_PRESENCE", "0.9");
    vi.stubEnv("CALHACK_JEV_MIN_CONFIDENCE", "1");
    expect(await locateWithProvider("jev", "button", image)).toMatchObject({ status: "rejected" });
  });

  it.each([
    { left: -0.1, right: 0.4, top: 0.2, bottom: 0.4 },
    { left: 0.5, right: 0.4, top: 0.2, bottom: 0.4 },
    { left: 0.2, right: 1.1, top: 0.2, bottom: 0.4 },
    { left: 0.2, right: 0.4, top: 0.4, bottom: 0.4 },
    { left: 0.2, right: 0.4, top: Infinity, bottom: 0.4 },
  ])("rejects malformed box %j", async (box) => {
    const data = response();
    data.answers.location.box = box;
    fetched.mockResolvedValueOnce(Response.json(data));
    expect(await locateWithProvider("jev", "button", image)).toMatchObject({ status: "error", reason: "invalid_response", point: undefined });
  });

  it.each([null, {}, { answers: { visible: { type: "choice", noul: 0.99 } } }, { answers: { visible: { type: "noul", noul: "0.99" } } }])("rejects malformed envelopes %j", async (data) => {
    fetched.mockResolvedValueOnce(Response.json(data));
    expect(await locateWithProvider("jev", "button", image)).toMatchObject({ status: "error", reason: "invalid_response" });
  });

  it.each([{ width: 200, height: 600 }, { width: 256, height: 256 }, { width: 1600, height: 900 }])("rejects unsupported image dimensions %j before upload", async (size) => {
    expect(await locateWithProvider("jev", "button", { ...image, ...size })).toMatchObject({ reason: "unsupported_image" });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("fails safely on invalid thresholds, and doesn't log API error bodies or thrown secrets", async () => {
    vi.stubEnv("CALHACK_JEV_MIN_CONFIDENCE", "oops");
    expect(await locateWithProvider("jev", "button", image)).toMatchObject({ reason: "invalid_threshold" });
    expect(fetched).not.toHaveBeenCalled();
    vi.stubEnv("CALHACK_JEV_MIN_CONFIDENCE", "");
    fetched.mockResolvedValueOnce(new Response("secret-image-data", { status: 401 }));
    expect(await locateWithProvider("jev", "button", image)).toMatchObject({ reason: "http_401" });
    fetched.mockRejectedValueOnce(new Error("secret-key-and-image"));
    const failed = await locateWithProvider("jev", "button", image);
    expect(failed.reason).toBe("request_failed");
    expect(JSON.stringify(failed)).not.toContain("secret");
  });
});

describe("Haiku and provider selection", () => {
  it("uses a dedicated structured-output Haiku request with usage and no retries", async () => {
    const result = await locateWithProvider("haiku", "button", image);
    expect(result).toMatchObject({ provider: "haiku", model: "claude-haiku-5-5", status: "found", point: { x: 300, y: 180 }, usage: { inputTokens: 100, outputTokens: 10 } });
    const [request, options] = create.mock.calls[0];
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.messages[0].content[0].source.data).toBe(image.data);
    expect(JSON.parse(request.messages[0].content[1].text)).toEqual({ target: "button", width: 1000, height: 600 });
    expect(options.maxRetries).toBe(0);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(fetched).not.toHaveBeenCalled();
  });

  it.each([{ visible: true, x: 1000, y: 1 }, { visible: true, x: -1, y: 1 }, { visible: true, x: null, y: 1 }, { visible: "true", x: 10, y: 1 }])("rejects bad Haiku coordinates %j", async (value) => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(value) }] });
    expect(await locateWithProvider("haiku", "button", image)).toMatchObject({ status: "error", reason: "invalid_response" });
  });

  it("doesn't use coordinates from Haiku when it says the target is absent", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ visible: false, x: 10, y: 20 }) }] });
    const result = await locateWithProvider("haiku", "missing", image);
    expect(result.status).toBe("not_found");
    expect(result.point).toBeUndefined();
  });

  it("selects Jev by default when keyed, and Haiku when not keyed", async () => {
    expect(await locatePointer("button", image)).toMatchObject({ selected: "jev" });
    expect(create).not.toHaveBeenCalled();
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await locatePointer("button", image)).toMatchObject({ selected: "haiku" });
    expect(fetched).toHaveBeenCalledOnce();
  });

  it.each(["auto", "jev"])("falls back on Jev error in %s mode", async (mode) => {
    vi.stubEnv("CALHACK_POINTER_PROVIDER", mode);
    fetched.mockResolvedValueOnce(new Response("busy", { status: 429 }));
    expect(await locatePointer("button", image)).toMatchObject({ selected: "haiku", fallbackReason: "http_429", attempts: [{ provider: "jev", status: "error" }, { provider: "haiku", status: "found" }] });
  });

  it("falls back for uncertain Jev output and unsupported images", async () => {
    const data = response();
    data.answers.location.confidence = 0.2;
    fetched.mockResolvedValueOnce(Response.json(data));
    expect(await locatePointer("button", image)).toMatchObject({ selected: "haiku", fallbackReason: "insufficient_confidence" });
    create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ visible: true, x: 30, y: 180 }) }] });
    expect(await locatePointer("button", { ...image, width: 200 })).toMatchObject({ selected: "haiku", fallbackReason: "unsupported_image" });
  });

  it("explicit Haiku bypasses Jev and both-failed lookups have no selected point", async () => {
    vi.stubEnv("CALHACK_POINTER_PROVIDER", "haiku");
    vi.stubEnv("CALHACK_HAIKU_POINTER_MODEL", "custom-haiku");
    expect(await locatePointer("button", image)).toMatchObject({ selected: "haiku" });
    expect(create.mock.calls[0][0].model).toBe("custom-haiku");
    expect(fetched).not.toHaveBeenCalled();
    vi.stubEnv("CALHACK_POINTER_PROVIDER", "jev");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await locatePointer("button", image);
    expect(result.attempts).toHaveLength(2);
    expect(result.point).toBeUndefined();
    expect(result.selected).toBeUndefined();
  });

  it("falls back after a timed-out Jev request", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(AbortSignal.abort(new DOMException("timeout", "TimeoutError")));
    fetched.mockImplementationOnce(async (_url, options) => { options.signal.throwIfAborted(); });
    expect(await locatePointer("button", image)).toMatchObject({ selected: "haiku", fallbackReason: "timeout" });
  });

  it("Stop before or during a request never starts fallback", async () => {
    await expect(locatePointer("button", image, AbortSignal.abort())).rejects.toThrow();
    expect(fetched).not.toHaveBeenCalled();
    const controller = new AbortController();
    fetched.mockImplementationOnce(async (_url, options) => { controller.abort(); options.signal.throwIfAborted(); });
    await expect(locatePointer("button", image, controller.signal)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("doesn't consume an answer that arrives after Stop", async () => {
    const controller = new AbortController();
    fetched.mockImplementationOnce(async () => { controller.abort(); return Response.json(response()); });
    await expect(locatePointer("button", image, controller.signal)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("shared click and highlight coordinates", () => {
  it("scales screenshot pixels once and rejects right/bottom edges and bad scales", () => {
    expect(screenPoint({ x: 300, y: 180 }, image)).toEqual({ x: 600, y: 360 });
    expect(screenPoint({ x: 1000, y: 20 }, image)).toBeUndefined();
    expect(screenPoint({ x: 30, y: 600 }, image)).toBeUndefined();
    expect(screenPoint({ x: NaN, y: 20 }, image)).toBeUndefined();
    expect(screenPoint({ x: 30, y: 20 }, { ...image, toScreen: 0 })).toBeUndefined();
  });
});

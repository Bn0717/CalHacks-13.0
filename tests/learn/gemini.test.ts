import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_MODEL, GeminiError, MISSING_KEY_MESSAGE, hasGeminiKey, readVideo } from "../../src/learn/gemini.js";

const recorded = readFileSync(new URL("./fixtures/gemini-video.response.json", import.meta.url), "utf8");
const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

type Call = { url: string; init: RequestInit };

// A fake fetch that records each request and answers with the given status and body.
function fakeFetch(body: string, status = 200): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

describe("readVideo", () => {
  it("gives the friendly error when GEMINI_API_KEY is missing, without calling the network", async () => {
    const { fetch, calls } = fakeFetch(recorded);
    await expect(readVideo(VIDEO, { fetch, env: {} })).rejects.toThrow(MISSING_KEY_MESSAGE);
    await expect(readVideo(VIDEO, { fetch, env: {} })).rejects.toThrow(/video lessons need GEMINI_API_KEY/i);
    expect(calls).toHaveLength(0);
    expect(hasGeminiKey({})).toBe(false);
    expect(hasGeminiKey({ GEMINI_API_KEY: "k" })).toBe(true);
  });

  it("sends the YouTube link as video input with the key in a header, and reads the recorded answer", async () => {
    const { fetch, calls } = fakeFetch(recorded);
    const notes = await readVideo(VIDEO, { fetch, env: { GEMINI_API_KEY: "test-key" } });

    expect(notes.title).toBe("Build Your First Web Page in 10 Minutes");
    expect(notes.chapters).toHaveLength(2);
    expect(notes.segments[2]!.code).toContain("<h1>Hello, I'm Alex</h1>");

    const call = calls[0]!;
    expect(call.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(call.url).not.toContain("test-key");
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(String(call.init.body));
    expect(body.contents[0].parts[0]).toEqual({ file_data: { file_uri: VIDEO } });
    expect(body.contents[0].parts[1].text).toMatch(/exact code/i);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.properties.segments).toBeDefined();
  });

  it("uses CALHACK_GEMINI_MODEL when set", async () => {
    const { fetch, calls } = fakeFetch(recorded);
    await readVideo(VIDEO, { fetch, env: { GEMINI_API_KEY: "k", CALHACK_GEMINI_MODEL: "gemini-test" } });
    expect(calls[0]!.url).toContain("/models/gemini-test:generateContent");
  });

  it("turns HTTP errors into plain words", async () => {
    const env = { GEMINI_API_KEY: "k" };
    await expect(readVideo(VIDEO, { fetch: fakeFetch("{}", 403).fetch, env })).rejects.toThrow(/key is wrong/);
    await expect(readVideo(VIDEO, { fetch: fakeFetch("{}", 429).fetch, env })).rejects.toThrow(/busy/);
    await expect(readVideo(VIDEO, { fetch: fakeFetch("{}", 400).fetch, env })).rejects.toThrow(/public YouTube video/);
  });

  it("says so when the network is down", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(readVideo(VIDEO, { fetch: down, env: { GEMINI_API_KEY: "k" } })).rejects.toThrow(/Couldn't reach Gemini/);
  });

  it("rejects answers that don't match the notes shape", async () => {
    const env = { GEMINI_API_KEY: "k" };
    const wrongShape = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "x" }) }] } }] });
    await expect(readVideo(VIDEO, { fetch: fakeFetch(wrongShape).fetch, env })).rejects.toBeInstanceOf(GeminiError);
    const notJson = JSON.stringify({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] });
    await expect(readVideo(VIDEO, { fetch: fakeFetch(notJson).fetch, env })).rejects.toThrow(/valid JSON/);
    const blocked = JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } });
    await expect(readVideo(VIDEO, { fetch: fakeFetch(blocked).fetch, env })).rejects.toThrow(/SAFETY/);
    const empty = JSON.stringify({ candidates: [] });
    await expect(readVideo(VIDEO, { fetch: fakeFetch(empty).fetch, env })).rejects.toThrow(/no notes/);
  });
});

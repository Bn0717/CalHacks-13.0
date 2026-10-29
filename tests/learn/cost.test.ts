import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { askJson } from "../../src/ai/json.js";
import { CostLog, costOf, dollars, meteredAskJson, meteredLearnModel, priceFor } from "../../src/learn/cost.js";

const fixedNow = () => new Date("2026-10-29T12:00:00.000Z");

// A fake askJson: answers {ok:true} and reports the given token counts, like the real one does through onResponse.
function fakeAsk(model: string, input: number, output: number, seen: unknown[] = []): typeof askJson {
  return (async (o: Parameters<typeof askJson>[0]) => {
    seen.push(o);
    o.onResponse?.({ model, usage: { input_tokens: input, output_tokens: output } });
    return { ok: true };
  }) as typeof askJson;
}

describe("prices", () => {
  it("prices Opus at $4/$20 and Haiku at $0.10/$0.50 per million tokens", () => {
    expect(costOf("claude-opus-5-5", 1_000_000, 0)).toBeCloseTo(4);
    expect(costOf("claude-opus-5-5", 0, 1_000_000)).toBeCloseTo(20);
    expect(costOf("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(costOf("claude-opus-5-5", 10_000, 2_000)).toBeCloseTo(0.08);
  });

  it("prices an unknown model like Opus, so it's never under-counted", () => {
    expect(priceFor("some-new-model")).toEqual(priceFor("claude-opus-5-5"));
  });

  it("shows small amounts with more digits", () => {
    expect(dollars(0.0005)).toBe("$0.0005");
    expect(dollars(0.42)).toBe("$0.42");
  });
});

describe("CostLog", () => {
  it("records each call through the wrapper and keeps the caller's own onResponse working", async () => {
    const log = new CostLog(fixedNow);
    let callerSaw = 0;
    const ask = meteredAskJson(log, "check", fakeAsk("claude-haiku-5-5", 2000, 100));
    await ask({ model: "claude-haiku-5-5", system: "s", content: "c", schema: {}, onResponse: () => callerSaw++ });
    expect(callerSaw).toBe(1);
    expect(log.entries).toEqual([
      { at: "2026-10-29T12:00:00.000Z", job: "check", model: "claude-haiku-5-5", inputTokens: 2000, outputTokens: 100, usd: costOf("claude-haiku-5-5", 2000, 100) },
    ]);
  });

  it("records the builder's model calls under their job, with the learn model", async () => {
    const log = new CostLog(fixedNow);
    const seen: { model: string; content: unknown; maxTokens?: number }[] = [];
    const ask = meteredLearnModel(log, fakeAsk("claude-opus-5-5", 5000, 3000, seen), () => "claude-opus-5-5");
    await ask({ job: "steps", system: "sys", prompt: "the prompt", schema: {}, maxTokens: 900 });
    expect(seen[0]).toMatchObject({ model: "claude-opus-5-5", content: "the prompt", maxTokens: 900 });
    expect(log.entries.map((e) => e.job)).toEqual(["steps"]);
    expect(log.total()).toMatchObject({ calls: 1, inputTokens: 5000, outputTokens: 3000 });
    expect(log.total().usd).toBeCloseTo(0.08);
  });

  it("saves to cost.json after what's already there, with a total, and never anything but tokens and prices", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stride-cost-"));
    const file = join(dir, "cost.json");
    const earlier = { at: "2026-10-28T10:00:00.000Z", job: "project", model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 1000, usd: 0.024 };
    await writeFile(file, JSON.stringify({ entries: [earlier], total: {} }));

    const log = new CostLog(fixedNow);
    log.record("questions", { model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 50 } }); // before attach
    await log.attach(file);
    log.record("check", { model: "claude-haiku-5-5", usage: { input_tokens: 400, output_tokens: 20 } });
    await log.flush();

    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.entries.map((e: { job: string }) => e.job)).toEqual(["project", "questions", "check"]);
    expect(saved.total.calls).toBe(3);
    expect(Object.keys(saved.entries[2]).sort()).toEqual(["at", "inputTokens", "job", "model", "outputTokens", "usd"]);
    expect(log.total().calls).toBe(2);
    expect(log.allTime().calls).toBe(3);
  });

  it("starts fresh when cost.json is broken", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stride-cost-"));
    const file = join(dir, "cost.json");
    await writeFile(file, "{ not json");
    const log = new CostLog(fixedNow);
    await log.attach(file);
    expect(log.allTime().calls).toBe(0);
    expect(JSON.parse(await readFile(file, "utf8")).entries).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { countOptional, fitSchema, MAX_OPTIONAL } from "../src/ai/schema-limit.js";
import { strictJsonSchema } from "../src/learn/build-from-idea.js";
import { CheckSchema, lessonJsonSchema, parseLesson } from "../src/learn/lesson.js";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../src/ai/client.js", () => ({ getClient: () => ({ messages: { create: mocks.create } }) }));
const { askJson } = await import("../src/ai/json.js");

const fixture = parseLesson(readFileSync("tests/learn/fixtures/about-me.lesson.json", "utf8"));
const FLAT_FIELDS = ["file", "say", "selector", "count", "text", "name", "value", "property", "question"];

// What the model sends for a check in the flat shape: every field, "" or -1 where the kind doesn't use it.
function asFlat(check: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { type: check.type };
  for (const k of FLAT_FIELDS) out[k] = check[k] ?? (k === "count" ? -1 : "");
  return out;
}

describe("fitting big answer shapes to the API's limits", () => {
  it("leaves small shapes exactly as they are", () => {
    const schema = strictJsonSchema(z.object({ a: z.string(), b: z.number().optional() }));
    const fitted = fitSchema(schema);
    expect(fitted.changed).toBe(false);
    expect(fitted.schema).toBe(schema);
    expect(fitted.restore({ a: "" })).toEqual({ a: "" });
  });

  it("turns a whole lesson into a shape with one kind of check and at most 24 optional fields", () => {
    const schema = lessonJsonSchema();
    expect(countOptional(schema)).toBeGreaterThan(MAX_OPTIONAL);
    const fitted = fitSchema(schema);
    expect(fitted.changed).toBe(true);
    expect(countOptional(fitted.schema)).toBeLessThanOrEqual(MAX_OPTIONAL);
    const text = JSON.stringify(fitted.schema);
    expect(text).not.toContain("anyOf");
    expect(text).not.toContain('"format"');
    const check = (fitted.schema as any).properties.steps.items.properties.checks.items;
    expect(check.properties.type.enum).toEqual(["parses", "selectorExists", "textIncludes", "attribute", "cssProperty", "fileExists", "ai"]);
    expect(check.required).toEqual(Object.keys(check.properties));
    expect(check.properties.question.description).toContain("Only for: ai.");
  });

  it("turns a flat answer back into the original lesson, check for check", () => {
    const fitted = fitSchema(lessonJsonSchema());
    const flat = { ...fixture, steps: fixture.steps.map((s) => ({ ...s, checks: s.checks.map((c) => asFlat(c)) })) };
    expect(parseLesson(fitted.restore(JSON.parse(JSON.stringify(flat))))).toEqual(fixture);
  });

  it("keeps a check's real values and drops only the unused ones", () => {
    const fitted = fitSchema(strictJsonSchema(z.object({ checks: z.array(CheckSchema) })));
    const back = fitted.restore({
      checks: [
        { type: "selectorExists", file: "", say: "", selector: "ul li", count: 3, text: "", name: "", value: "", property: "", question: "" },
        { type: "selectorExists", file: "index.html", say: "I can't see it.", selector: "h1", count: -1, text: "x", name: "", value: "", property: "", question: "" },
      ],
    });
    expect(back).toEqual({
      checks: [
        { type: "selectorExists", selector: "ul li", count: 3 },
        { type: "selectorExists", file: "index.html", say: "I can't see it.", selector: "h1" },
      ],
    });
    expect(z.object({ checks: z.array(CheckSchema) }).parse(back)).toEqual(back);
  });

  it("askJson sends the fitted shape and gives back the original one", async () => {
    const schema = strictJsonSchema(z.object({ checks: z.array(CheckSchema) }));
    mocks.create.mockResolvedValueOnce({
      model: "m",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: JSON.stringify({ checks: [asFlat({ type: "fileExists", file: "style.css" })] }) }],
    });
    const answer = await askJson({ model: "m", system: "s", content: "c", schema });
    expect(answer).toEqual({ checks: [{ type: "fileExists", file: "style.css" }] });
    const sent = mocks.create.mock.calls[0]![0].output_config.format.schema;
    expect(JSON.stringify(sent)).not.toContain("anyOf");
  });
});

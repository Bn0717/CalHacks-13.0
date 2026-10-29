// The lesson preview's partial, stuck and hint states are made from the real checker, runner and step card, so the
// screenshots show what students really read. This fails when the saved data is out of date.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPreviewData, OUT, previewDataSource } from "../../scripts/lesson-preview-data.js";

describe("lesson preview data", () => {
  it("is up to date (run npx tsx scripts/lesson-preview-data.ts if not)", async () => {
    const data = await buildPreviewData();
    expect(readFileSync(OUT, "utf8")).toBe(previewDataSource(data));
  });

  it("shows the real messages: wrong code is never 'on the right track', and hint 1 sits with what's wrong", async () => {
    const data = await buildPreviewData();
    expect(data.partial!.view).toMatchObject({ status: "partial", partial: "typing" });
    expect(data.partial!.view.note).toMatch(/^Still typing\? The <ul> you started still needs its closing <\/ul>/);
    expect(data.closer!.view).toMatchObject({ status: "partial", partial: "closer", parts: { done: 1, total: 2 } });
    expect(data.stuck!.view).toMatchObject({ status: "stuck", hints: [], parts: { done: 1, total: 2 } });
    expect(data.stuck!.view.note).toContain("One list item (<li>) is missing its closing </li>");
    expect(data["hint-1"]!.view.hints).toHaveLength(1);
    expect(data["hint-3"]!.view).toMatchObject({ hints: { length: 3 }, canShowMe: true });
    expect(data["want-hint"]!.view).toMatchObject({ status: "stuck", hintOffered: true });
    expect(data["stuck-wrong"]!.view).toMatchObject({ status: "stuck", note: 'I can\'t see a description line (<meta name="description">) yet.' });
    expect(data["stuck-wrong"]!.view.hints[0]).toMatch(/<meta>/);
    for (const d of Object.values(data)) expect(JSON.stringify(d.view)).not.toMatch(/right track/i);
  });
});

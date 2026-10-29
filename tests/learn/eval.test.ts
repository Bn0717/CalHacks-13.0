// The quality test's pure parts: the spending cap, the recorded video notes and the report.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scopeCheck } from "../../src/learn/build-from-idea.js";
import { CostLog } from "../../src/learn/cost.js";
import {
  assertBudget,
  BudgetError,
  capped,
  EVAL_CASES,
  averageScore,
  beforeRunFrom,
  findingsFor,
  PROMPT_CHANGES,
  reportMarkdown,
  summarizeNotes,
  type EvalReport,
} from "../../src/learn/eval.js";
import { readVideo } from "../../src/learn/gemini.js";
import { gradeTooBig } from "../../src/learn/grade.js";

const usage = (input: number, output: number) => ({ model: "claude-opus-5-5", usage: { input_tokens: input, output_tokens: output } });

describe("spending cap", () => {
  it("stops calls once spend passes the cap, before and after each call", async () => {
    const log = new CostLog();
    let calls = 0;
    const call = capped(log, async () => {
      calls++;
      log.record("steps", usage(0, 100_000)); // $2 a call at Opus prices
      return "ok";
    }, 3);
    await expect(call()).resolves.toBe("ok"); // $2
    await expect(call()).rejects.toBeInstanceOf(BudgetError); // ran, then $4 is past the cap
    await expect(call()).rejects.toThrow(/past the \$3\.00 cap/);
    expect(calls).toBe(2);
    expect(() => assertBudget(new CostLog(), 3)).not.toThrow();
  });
});

describe("recorded video notes", () => {
  const videos = EVAL_CASES.filter((c) => c.kind === "video");

  it.each(videos.map((v) => [v.videoId]))("%s reads through the real Gemini client and has code and timestamps", async (id) => {
    const rec = JSON.parse(readFileSync(new URL(`./fixtures/video-notes/${id}.json`, import.meta.url), "utf8"));
    expect(rec.mediaResolution).toBe("low");
    expect(rec.usage.inputTokens).toBeGreaterThan(50_000);
    expect(JSON.stringify(rec)).not.toMatch(/AIza|sk-ant/); // no key ever saved
    const notes = await readVideo(rec.url, { env: { GEMINI_API_KEY: "k" }, fetch: (async () => new Response(JSON.stringify(rec.response))) as typeof fetch });
    const s = summarizeNotes(notes);
    expect(s.codeSegments).toBeGreaterThan(0);
    expect(s.endSeconds).toBeGreaterThan(10 * 60);
    for (const seg of notes.segments) expect(seg.end).toBeGreaterThan(seg.start);
    // Gemini double-escaped the code of the first video; the client turns it back into real lines.
    for (const seg of notes.segments) expect(seg.code).not.toMatch(/\\n/);
    expect(s.codeLines!).toBeGreaterThan(s.codeSegments!);
  });
});

describe("report", () => {
  const base: EvalReport = {
    ranAt: "2026-10-29T12:00:00.000Z",
    claude: { usable: false, note: "no Claude key is set" },
    geminiPrice: "price note",
    cases: [
      { name: "make me Instagram", kind: "idea", status: "graded", source: "built", grade: gradeTooBig("make me Instagram", scopeCheck("make me Instagram")!), usd: 0 },
      { name: "a page about me", kind: "idea", status: "blocked", note: "needs a working Claude key" },
    ],
    videoNotes: [{ videoId: "abc", url: "https://www.youtube.com/watch?v=abc", status: "reused", title: "T", chapters: 2, segments: 5, codeSegments: 4, codeLines: 6, endSeconds: 900, inputTokens: 1000, outputTokens: 200, usd: 0.2 }],
    spend: { thisRun: 0.2, allRuns: 0.2, cap: 8 },
    findings: [],
    messageExamples: [{ before: 'I can\'t find "h1" yet.', after: "I can't see a big heading (<h1>) yet." }],
    promptChanges: PROMPT_CHANGES,
  };

  it("says what's blocked without a Claude key and never shows made-up scores", () => {
    const md = reportMarkdown(base);
    expect(md).toContain("## Blocked: no working Claude key");
    expect(md).toContain("npm run learn:eval");
    expect(md).toContain("Before/after: this is the first run");
    expect(md).not.toMatch(/wording \d/);
    expect(md).toContain("| a page about me | — | blocked: needs a working Claude key |");
    expect(md).toContain("$0.20");
  });

  it("shows Opus scores only when a review really ran", () => {
    const judged: EvalReport = {
      ...base,
      claude: { usable: true, note: "a key is set" },
      cases: [{ ...base.cases[0]!, name: "x", judgement: { scores: { wording: 4, stepSize: 5, order: 3, hints: 4, fidelity: 2 }, worst: [{ stepId: "s1", problem: "too long" }], summary: "OK." } }],
    };
    const md = reportMarkdown(judged);
    expect(md).toContain("wording 4 · step size 5 · order 3 · hints 4 · fidelity 2");
    expect(md).not.toContain("## Blocked");
  });

  it("works out findings from real results only", () => {
    const f = findingsFor(base);
    expect(f[0]).toMatch(/no real Claude call ran/);
    expect(f.join(" ")).toMatch(/projection, not measured/);
    expect(f.join(" ")).toMatch(/abc: Gemini copied only 6 code lines/);
    const built = findingsFor({ ...base, cases: [{ name: "x", kind: "idea", status: "graded", source: "built", usd: 0.62, grade: { name: "x", kind: "lesson", criteria: [], passed: 0, total: 0 } }] });
    expect(built[0]).toMatch(/most expensive \$0\.62 \(x\) — FAILS for x \$0\.62/);
  });

  it("compares with an earlier run: grades, Opus scores, their average and build cost", () => {
    const lessonGrade = (passed: number) => ({ name: "x", kind: "lesson" as const, criteria: [], passed, total: 8 });
    const j = (n: number) => ({ scores: { wording: n, stepSize: n, order: n, hints: n, fidelity: n }, worst: [], summary: "s" });
    const earlier: EvalReport = { ...base, ranAt: "2026-10-29T08:00:00.000Z", cases: [{ name: "x", kind: "idea", status: "graded", source: "built", grade: lessonGrade(5), judgement: j(3), usd: 0.4 }] };
    const now: EvalReport = {
      ...base,
      claude: { usable: true, note: "working" },
      cases: [{ name: "x", kind: "idea", status: "graded", source: "built", grade: lessonGrade(7), judgement: j(4), usd: 0.35 }],
      before: beforeRunFrom(earlier),
    };
    const md = reportMarkdown(now);
    expect(md).toContain("Before = the run of 2026-10-29T08:00:00.000Z");
    expect(md).toContain("| x | 5/8 → 7/8 | 3 · 3 · 3 · 3 · 3 | 4 · 4 · 4 · 4 · 4 | 3.0 → 4.0 | $0.40 → $0.35 |");
    expect(averageScore(undefined)).toBeUndefined();
  });

  it("reports the real cost of hint-time Haiku checks against the $0.01 goal", () => {
    const hintChecks = [
      { lesson: "x", stepId: "s1", answer: "no: I can't see your list yet.", inputTokens: 1500, outputTokens: 60, usd: 0.00018 },
      { lesson: "y", stepId: "s2", answer: "no: missing", inputTokens: 2000, outputTokens: 50, usd: 0.000225 },
    ];
    const f = findingsFor({ ...base, hintChecks });
    expect(f.join(" ")).toMatch(/2 real Haiku check call\(s\), average \$0\.0002, most expensive \$0\.0002 — passes/);
    expect(reportMarkdown({ ...base, hintChecks })).toContain("| x | s1 | no: I can't see your list yet. | 1500 / 60 | $0.0002 |");
  });
});

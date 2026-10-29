// Keeps track of what each model call costs, so a lesson's price is never a guess.
// It wraps the model call (askJson, or any call shaped like it): every answer's token counts are written down with an
// estimated price, and can be saved to a cost.json file. Only the model name, the job and token counts are kept: never
// a prompt, an answer or a key.
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { askJson } from "../ai/json.js";
import { learnModel, type AskModel } from "./build-from-idea.js";

// US dollars per million tokens.
export const PRICES = {
  opus: { input: 4, output: 20 }, // claude-opus-5-5
  haiku: { input: 0.1, output: 0.5 }, // claude-haiku-5-5
} as const;

export type Price = { input: number; output: number };

// The price for a model. Anything that isn't Haiku is priced like Opus, so an unknown model is never under-counted.
export function priceFor(model: string): Price {
  return /haiku/i.test(model) ? PRICES.haiku : PRICES.opus;
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export type CostEntry = {
  at: string;
  job: string; // what the call was for, e.g. "project", "steps", "hint-check"
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
};

export type CostTotal = { calls: number; inputTokens: number; outputTokens: number; usd: number };

export type CostFile = { entries: CostEntry[]; total: CostTotal };

// The part of a model answer that says what it cost.
export type Usage = { model: string; usage: { input_tokens: number; output_tokens: number } };

export function totalOf(entries: CostEntry[]): CostTotal {
  return entries.reduce<CostTotal>(
    (t, e) => ({ calls: t.calls + 1, inputTokens: t.inputTokens + e.inputTokens, outputTokens: t.outputTokens + e.outputTokens, usd: t.usd + e.usd }),
    { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
  );
}

export class CostLog {
  readonly entries: CostEntry[] = []; // this run's calls
  private earlier: CostEntry[] = []; // calls already in the file from earlier runs
  private file: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(job: string, response: Usage): CostEntry {
    const inputTokens = Math.max(0, response.usage?.input_tokens ?? 0);
    const outputTokens = Math.max(0, response.usage?.output_tokens ?? 0);
    const entry: CostEntry = {
      at: this.now().toISOString(),
      job,
      model: response.model,
      inputTokens,
      outputTokens,
      usd: costOf(response.model, inputTokens, outputTokens),
    };
    this.entries.push(entry);
    if (this.file) void this.write();
    return entry;
  }

  // This run only.
  total(): CostTotal {
    return totalOf(this.entries);
  }

  // This run plus everything already saved in the file.
  allTime(): CostTotal {
    return totalOf([...this.earlier, ...this.entries]);
  }

  // Start saving to this file. Calls already recorded are saved too, after what the file already holds.
  async attach(file: string): Promise<void> {
    this.file = file;
    this.earlier = await readCostFile(file);
    await this.write();
  }

  // Waits until everything recorded so far is on disk.
  async flush(): Promise<void> {
    await this.queue;
  }

  private write(): Promise<void> {
    const file = this.file!;
    const work = this.queue.then(async () => {
      const entries = [...this.earlier, ...this.entries];
      const body: CostFile = { entries, total: totalOf(entries) };
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
      await rename(temp, file);
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}

// What's already in a cost.json (nothing if it's missing or broken).
export async function readCostFile(file: string): Promise<CostEntry[]> {
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as Partial<CostFile>;
    return Array.isArray(data.entries) ? data.entries.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function isEntry(e: unknown): e is CostEntry {
  const x = e as CostEntry;
  return !!x && typeof x.model === "string" && typeof x.usd === "number" && typeof x.inputTokens === "number" && typeof x.outputTokens === "number";
}

// ---------- Wrappers: the same model call, with its cost written down ----------

type AskJson = typeof askJson;

// askJson (or a fake shaped like it) that records every answer's cost under `job`.
export function meteredAskJson(log: CostLog, job: string, ask: AskJson): AskJson {
  return (o) =>
    ask({
      ...o,
      onResponse: (response) => {
        log.record(job, response);
        o.onResponse?.(response);
      },
    });
}

// The lesson builders' model call (see build-from-idea.ts), with costs recorded per build job.
export function meteredLearnModel(log: CostLog, ask: AskJson, model: () => string = learnModel): AskModel {
  return (o) =>
    meteredAskJson(log, o.job, ask)({ model: model(), system: o.system, content: o.prompt, schema: o.schema, maxTokens: o.maxTokens });
}

// "$0.0123"
export function dollars(usd: number): string {
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
}

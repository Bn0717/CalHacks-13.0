// Level 3 of the checker: ask a fast model a yes/no question, only for 'ai' checks or when levels 1-2 can't decide.
// The checker only talks to the Judge type, so tests pass a fake and never call the API.
import { z } from "zod";
import { askJson } from "../../ai/json.js";

export const CHECK_MODEL = () => process.env.CALHACK_CHECK_MODEL || "claude-haiku-5-5";

export type JudgeRequest = {
  stepTitle: string;
  instruction: string;
  question: string; // the yes/no question to answer
  file: string; // which file the question is about
  code: string; // the student's code (all checked files, labelled)
  reference: string; // what the finished step adds (step.expected)
};

export const VerdictSchema = z.object({
  answer: z.enum(["yes", "no"]),
  reason: z.string().min(1).max(300).describe("One short, friendly sentence for a beginner."),
});

export type Verdict = z.infer<typeof VerdictSchema>;
export type Judge = (request: JudgeRequest) => Promise<Verdict>;

const SYSTEM = `You check a beginner's code for one step of a coding lesson.
Answer the yes/no question about the student's code. The reference shows one correct way to do the step, but the
student's code doesn't need to match it exactly: different names, text, spacing or order are fine if it does the same job.
Give one short, friendly reason a 14-year-old who has never coded understands: say what is missing in plain words
(e.g. "I can't see your big heading yet"), never code words like DOM, selector, element or parse. Never include the full answer code.`;

const VERDICT_JSON_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string", enum: ["yes", "no"] }, reason: { type: "string" } },
  required: ["answer", "reason"],
  additionalProperties: false,
};

// The real judge: Claude Haiku with structured output, checked with Zod.
export function haikuJudge(ask: typeof askJson = askJson): Judge {
  return async (r) => {
    const raw = await ask({
      model: CHECK_MODEL(),
      system: SYSTEM,
      maxTokens: 400,
      schema: VERDICT_JSON_SCHEMA,
      content: [
        `Step: ${r.stepTitle}\nInstruction: ${r.instruction}\n`,
        `Question about ${r.file}: ${r.question}\n`,
        `Student's code:\n${r.code.slice(0, 12_000)}\n`,
        `Reference for this step:\n${r.reference.slice(0, 4_000) || "(none)"}`,
      ].join("\n"),
    });
    return VerdictSchema.parse(raw);
  };
}

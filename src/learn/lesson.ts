// The one lesson format every Stride Learn lesson uses, whether it starts from a video, an idea or an idea + picture.
// Only shapes and small helpers live here: nothing in this file calls a model.
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z } from "zod";

export const LESSON_VERSION = 1;

// Time estimate constants, kept in one place so they're easy to tune after testing with students.
export const ESTIMATE = {
  minutesPerLine: 0.6, // a beginner typing and reading one line of code
  minutesPerConcept: 2, // reading a concept card the first time it comes up
  minutesPerStrideOrWatchStep: 0.5, // watching Stride do a step, or watching a video part
} as const;

// ---------- Checks: how Stride knows a step is done. Always about behaviour, never exact text. ----------

const checkFile = z.string().optional().describe("Which project file to check, e.g. 'index.html'. Leave out to use the step's file.");

export const CheckSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("parses"), file: checkFile }).describe("The file parses as HTML, CSS or JS (picked from its extension)."),
  z
    .object({
      type: z.literal("selectorExists"),
      file: checkFile,
      selector: z.string().min(1).describe("A CSS selector, e.g. 'header h1'"),
      count: z.number().int().min(0).optional().describe("Exact number of matches. Leave out for 'at least one'."),
    })
    .describe("An element matching the selector exists."),
  z
    .object({
      type: z.literal("textIncludes"),
      file: checkFile,
      selector: z.string().min(1),
      text: z.string().min(1).describe("Text the element must contain (case doesn't matter)."),
    })
    .describe("The element's text includes this text, ignoring case."),
  z
    .object({
      type: z.literal("attribute"),
      file: checkFile,
      selector: z.string().min(1),
      name: z.string().min(1).describe("Attribute name, e.g. 'alt'"),
      value: z.string().optional().describe("Exact value. Leave out for 'has the attribute'."),
    })
    .describe("The element has this attribute (and value, if given)."),
  z
    .object({
      type: z.literal("cssProperty"),
      file: checkFile,
      selector: z.string().min(1),
      property: z.string().min(1).describe("CSS property, e.g. 'background-color'"),
      value: z.string().optional().describe("Expected computed value, e.g. 'rgb(255, 0, 0)'. Leave out for 'is set'."),
    })
    .describe("The element's computed style has this property (checked in a rendered page)."),
  z.object({ type: z.literal("fileExists"), file: z.string().min(1) }).describe("The file exists in the project."),
  z
    .object({ type: z.literal("ai"), file: checkFile, question: z.string().min(1).describe("A yes/no question about the student's code.") })
    .describe("Last resort, answered by a fast model. Use only when no other check can decide."),
]);

export type Check = z.infer<typeof CheckSchema>;
export type CheckType = Check["type"];

// ---------- Steps ----------

export const ConceptSchema = z.object({
  title: z.string().min(1),
  explain: z.string().min(1).describe("A short plain-English explanation for a beginner."),
  links: z.array(z.object({ title: z.string().min(1), url: z.url() })).describe("Good reading, e.g. an MDN page."),
  imageQuery: z.string().optional().describe("A search for a simple diagram."),
  videoQuery: z.string().optional().describe("A search for a short explainer video."),
});

export type Concept = z.infer<typeof ConceptSchema>;

export const QuizSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
    answer: z.number().int().min(0).describe("Index of the right option, starting at 0."),
    explain: z.string().min(1).describe("One line on why that answer is right."),
  })
  .refine((q) => q.answer < q.options.length, { message: "The quiz answer must point at one of its options.", path: ["answer"] });

export type Quiz = z.infer<typeof QuizSchema>;

export const AnchorSchema = z
  .object({
    afterLine: z.number().int().min(0).optional().describe("Add the code after this line number (0 = top of the file)."),
    after: z.string().min(1).optional().describe("Add the code after this text or element, e.g. '</h1>'."),
    inside: z.string().min(1).optional().describe("Add the code inside this element, e.g. 'body'."),
  })
  .refine((a) => a.afterLine !== undefined || a.after !== undefined || a.inside !== undefined, {
    message: "An anchor needs afterLine, after or inside.",
  });

export type Anchor = z.infer<typeof AnchorSchema>;

export const StrideActionSchema = z.object({
  tool: z.string().min(1).describe("A tool name from Stride's safe tools, e.g. 'open_app'."),
  input: z
    .string()
    .refine(isJsonObject, { message: "The tool input must be a JSON object, e.g. {\"app_name\":\"Visual Studio Code\"}." })
    .describe('The tool input as a JSON object, e.g. {"app_name":"Visual Studio Code"}.'),
});

export type StrideAction = z.infer<typeof StrideActionSchema>;

export const StepSchema = z
  .object({
    id: z.string().min(1),
    chapter: z.string().min(1).describe("The id of the chapter this step belongs to."),
    title: z.string().min(1),
    instruction: z.string().min(1).describe("What to do, in plain English."),
    why: z.string().min(1).describe("One line on why this step matters."),
    who: z.enum(["learner", "stride", "watch"]).describe("learner = the student types it, stride = Stride does it, watch = just watch."),
    file: z.string().optional().describe("The project file this step changes."),
    anchor: AnchorSchema.optional(),
    expected: z.string().describe("The code this step adds, copied from the finished project. Empty for steps that add no code."),
    checks: z.array(CheckSchema),
    hints: z
      .tuple([z.string().min(1), z.string().min(1), z.string().min(1)])
      .describe("Exactly 3 hints, gentlest first: a nudge, then pointing at the spot, then part of the code."),
    concept: ConceptSchema.optional(),
    video: z
      .object({ start: z.number().min(0), end: z.number().min(0) })
      .refine((v) => v.end >= v.start, { message: "The video part must end after it starts.", path: ["end"] })
      .optional()
      .describe("For video lessons: the part of the video (in seconds) that shows this step."),
    strideAction: StrideActionSchema.optional().describe("For who=stride: the safe tool Stride runs."),
    quiz: QuizSchema.optional(),
  })
  .superRefine((s, ctx) => {
    if (s.who === "learner" && s.checks.length === 0) {
      ctx.addIssue({ code: "custom", message: "A 'learner' step needs at least one check.", path: ["checks"] });
    }
    if (s.who === "stride" && !s.strideAction) {
      ctx.addIssue({ code: "custom", message: "A 'stride' step needs a strideAction.", path: ["strideAction"] });
    }
  });

export type Step = z.infer<typeof StepSchema>;

// ---------- Lessons ----------

export const EstimateSchema = z.object({
  minutes: z.number().int().min(0),
  linesToType: z.number().int().min(0),
  steps: z.number().int().min(0),
});

export type Estimate = z.infer<typeof EstimateSchema>;

export const PictureNoteSchema = z.object({
  summary: z.string(),
  sections: z.array(z.object({ name: z.string(), description: z.string() })),
});

export const LessonSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("idea"),
    request: z.string().min(1).describe("What the student asked for, in their words."),
    answers: z.array(z.object({ question: z.string(), answer: z.string() })).describe("Their answers to the starting questions."),
    picture: PictureNoteSchema.optional().describe("What Stride read from their reference picture."),
  }),
  z.object({
    kind: z.literal("video"),
    url: z.url(),
    videoId: z.string().min(1),
    title: z.string().min(1),
  }),
]);

export type LessonSource = z.infer<typeof LessonSourceSchema>;

export const ProjectFileSchema = z.object({ path: z.string().min(1), content: z.string() });
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const LessonSchema = z
  .object({
    id: z.string().min(1),
    source: LessonSourceSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    outcome: z.string().min(1).describe("What the student will have made at the end."),
    learns: z.array(z.string().min(1)).describe("What they'll learn, in a few words each."),
    estimate: EstimateSchema,
    simpler: z
      .object({
        title: z.string().min(1),
        estimate: EstimateSchema,
        why: z.string().min(1),
        stepIds: z.array(z.string().min(1)).optional().describe("The steps of the smaller version, in order."),
      })
      .optional()
      .describe("A smaller version to offer first when the lesson is long."),
    files: z.array(ProjectFileSchema).min(1).describe("The finished reference project."),
    chapters: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) })).min(1),
    steps: z.array(StepSchema).min(1),
    createdAt: z.iso.datetime(),
    version: z.literal(LESSON_VERSION),
  })
  .superRefine((lesson, ctx) => {
    const chapterIds = new Set(lesson.chapters.map((c) => c.id));
    const filePaths = new Set(lesson.files.map((f) => f.path));
    const stepIds = new Set<string>();
    lesson.steps.forEach((step, i) => {
      if (stepIds.has(step.id)) ctx.addIssue({ code: "custom", message: `Step id "${step.id}" is used twice.`, path: ["steps", i, "id"] });
      stepIds.add(step.id);
      if (!chapterIds.has(step.chapter)) {
        ctx.addIssue({ code: "custom", message: `Chapter "${step.chapter}" doesn't exist.`, path: ["steps", i, "chapter"] });
      }
      if (step.file !== undefined && !filePaths.has(step.file)) {
        ctx.addIssue({ code: "custom", message: `File "${step.file}" isn't in the finished project.`, path: ["steps", i, "file"] });
      }
    });
  });

export type Lesson = z.infer<typeof LessonSchema>;

// ---------- Progress: where a student is, so a lesson resumes at the same step ----------

export const StepProgressSchema = z.object({
  status: z.enum(["todo", "done", "hinted", "shown", "skipped"]),
  hintsUsed: z.number().int().min(0).max(3),
  startedAt: z.iso.datetime().optional(),
  doneAt: z.iso.datetime().optional(),
});

export type StepProgress = z.infer<typeof StepProgressSchema>;

export const ProgressSchema = z.object({
  lessonId: z.string().min(1),
  stepIndex: z.number().int().min(0),
  steps: z.record(z.string(), StepProgressSchema).describe("Progress per step, keyed by step id."),
  pace: z.enum(["learn", "fast"]),
  updatedAt: z.iso.datetime(),
});

export type Progress = z.infer<typeof ProgressSchema>;

// ---------- Helpers ----------

// Lines of code a step adds (blank lines don't count).
export function linesIn(code: string): number {
  return code.split("\n").filter((line) => line.trim() !== "").length;
}

// How long the lesson takes a beginner: typing, plus a little for each new concept and each step they only watch.
export function estimateMinutes(steps: Step[]): number {
  let minutes = 0;
  const concepts = new Set<string>();
  for (const step of steps) {
    if (step.who === "learner") minutes += linesIn(step.expected) * ESTIMATE.minutesPerLine;
    else minutes += ESTIMATE.minutesPerStrideOrWatchStep;
    if (step.concept) concepts.add(step.concept.title.trim().toLowerCase());
  }
  minutes += concepts.size * ESTIMATE.minutesPerConcept;
  return Math.ceil(minutes);
}

// The full estimate shown to the student: minutes, lines they'll type and number of steps.
export function estimateFor(steps: Step[]): Estimate {
  const linesToType = steps.filter((s) => s.who === "learner").reduce((sum, s) => sum + linesIn(s.expected), 0);
  return { minutes: estimateMinutes(steps), linesToType, steps: steps.length };
}

// The smaller version of a lesson (its `simpler` offer) as a lesson of its own, or null when it can't be made from these
// steps (no offer, or the offer doesn't say which steps it keeps).
export function smallerLesson(lesson: Lesson): Lesson | null {
  const ids = lesson.simpler?.stepIds;
  if (!lesson.simpler || !ids || ids.length === 0) return null;
  const keep = new Set(ids);
  const steps = lesson.steps.filter((s) => keep.has(s.id));
  if (steps.length === 0 || steps.length >= lesson.steps.length) return null;
  const chapters = lesson.chapters.filter((c) => steps.some((s) => s.chapter === c.id));
  const { simpler, ...rest } = lesson;
  return { ...rest, id: `${lesson.id}-core`, title: simpler.title, steps, chapters, estimate: estimateFor(steps) };
}

// The input a 'stride' step passes to its tool.
export function strideActionInput(action: StrideAction): Record<string, unknown> {
  return JSON.parse(action.input) as Record<string, unknown>;
}

export class LessonError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = "LessonError";
  }
}

// Validates a lesson (a JSON string or an already parsed object). Throws a LessonError listing what's wrong in plain words.
export function parseLesson(json: unknown): Lesson {
  let data = json;
  if (typeof json === "string") {
    try {
      data = JSON.parse(json);
    } catch {
      throw new LessonError("This lesson isn't valid JSON.");
    }
  }
  const result = LessonSchema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${pathText(issue.path)}: ${issue.message}`);
  const shown = problems.slice(0, 5).join("; ");
  const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : "";
  throw new LessonError(`This lesson has problems: ${shown}${more}`, problems);
}

// The JSON schema of a Lesson, in the strict form `askJson` structured output accepts.
export function lessonJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(LessonSchema, {
    // Structured output can't describe a fixed-length list (the 3 hints), so send it as a list of strings.
    override: ({ jsonSchema }) => {
      const items = jsonSchema.prefixItems;
      if (!Array.isArray(items) || items.length === 0) return;
      jsonSchema.items = items[0];
      delete jsonSchema.prefixItems;
    },
  });
  delete schema.$schema;
  return transformJSONSchema(schema as Record<string, unknown>) as Record<string, unknown>;
}

// "steps.2.hints" -> "steps[2].hints", easier to read in an error.
function pathText(path: PropertyKey[]): string {
  if (path.length === 0) return "lesson";
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : `${i === 0 ? "" : "."}${String(p)}`)).join("");
}

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

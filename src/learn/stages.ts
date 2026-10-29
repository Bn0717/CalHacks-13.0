// The real phases of building a lesson, in order, with what Stride says during each, so progress shown to the student
// is honest: a builder reports a stage only when it actually starts it.

export type BuildStage = "scope" | "video" | "project" | "browser" | "steps" | "checks" | "estimate";

export const STAGE_LABELS: Record<BuildStage, string> = {
  scope: "Checking how big your idea is",
  video: "Watching the video",
  project: "Writing the finished website",
  browser: "Testing it in a hidden browser",
  steps: "Cutting it into small steps",
  checks: "Making sure every step can be checked",
  estimate: "Working out how long it takes",
};

// The stages each builder goes through, in the order they happen.
export const BUILD_STAGES = {
  idea: ["scope", "project", "browser", "steps", "checks", "estimate"],
  video: ["video", "steps", "checks", "estimate"],
} as const satisfies Record<string, readonly BuildStage[]>;

// How long a new lesson takes to build, said the same way everywhere.
export const BUILD_TIME_TEXT = "usually a minute or two";

// Called by a builder as each stage starts.
export type OnStage = (stage: BuildStage) => void;

// Is the student simply not finished yet? Yes when the lines they've added since the step opened are the first lines
// of the step's code, in order, each one right (their own words inside tags don't matter). Then a look that finds
// "something missing" is just the part they haven't typed yet, never "wrong" (A6 in docs/learn/GOAL.md).
// Pure: compares text only.

// One line of code with spacing, case and the student's own words between tags left out:
// "  <h1>Hi, I'm Bryan</h1>" and "<h1>Hi, I'm Sam</h1>" are the same line.
export function lineShape(line: string): string {
  return line
    .replace(/>[^<]*</g, "><")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function shapes(code: string): string[] {
  return code.split("\n").map(lineShape).filter((l) => l !== "");
}

// The lines in `now` that aren't in `start`: what's left after taking off the lines both share at the top and bottom.
export function addedLines(start: string, now: string): string[] {
  const a = shapes(start);
  const b = shapes(now);
  let top = 0;
  while (top < a.length && top < b.length && a[top] === b[top]) top++;
  let bottom = 0;
  while (bottom < a.length - top && bottom < b.length - top && a[a.length - 1 - bottom] === b[b.length - 1 - bottom]) bottom++;
  return b.slice(top, b.length - bottom);
}

// How many of the first lines of `expected` the student has typed right, when that's all they've added and the rest
// just isn't typed yet. 0 when they've added nothing, all of it, or any line that doesn't match.
export function onTrack(start: string, now: string, expected: string): number {
  const added = addedLines(start, now);
  const want = shapes(expected);
  if (added.length === 0 || added.length >= want.length) return 0;
  return added.every((line, i) => line === want[i]) ? added.length : 0;
}


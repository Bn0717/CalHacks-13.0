import { describe, expect, it } from "vitest";
import { FrameReader } from "../src/mac/capture.js";

const frame = (bytes: number[]) => {
  const b = Buffer.alloc(4 + bytes.length);
  b.writeUInt32BE(bytes.length, 0);
  Buffer.from(bytes).copy(b, 4);
  return b;
};

describe("reading the capture helper's answers", () => {
  it("reads whole answers, even when they arrive in pieces", () => {
    const r = new FrameReader();
    const both = Buffer.concat([frame([1, 2, 3]), frame([9])]);
    expect(r.push(both.subarray(0, 5))).toEqual([]);
    const out = r.push(both.subarray(5));
    expect(out.map((b) => [...b])).toEqual([[1, 2, 3], [9]]);
  });

  it("reads a failed answer as empty", () => {
    const r = new FrameReader();
    expect(r.push(frame([])).map((b) => b.length)).toEqual([0]);
  });
});

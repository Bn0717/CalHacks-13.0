import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PictureNoteSchema } from "../../src/learn/lesson.js";
import {
  applyCorrection,
  describeForStudent,
  MAX_SIDE,
  PictureError,
  prepareImage,
  readPicture,
  type AskJson,
  type PictureReading,
} from "../../src/learn/picture.js";

const reading: PictureReading = {
  sections: [
    { name: "a top menu", description: "Links to Home, About and Contact." },
    { name: "a big photo with a title", description: "A wide beach photo with large white text." },
    { name: "3 cards", description: "Three boxes side by side, each with an icon and a line of text." },
    { name: "a footer", description: "Small grey text with the copyright." },
  ],
  style: { colors: ["#1a73e8", "#ffffff"], mood: "bright and friendly" },
  summary: "A simple landing page for a surf school.",
};

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
}

// A fake model call that records what it was sent and answers with `answer`.
function fakeAsk(answer: unknown) {
  const calls: Parameters<AskJson>[0][] = [];
  const ask: AskJson = async (o) => {
    calls.push(o);
    return answer;
  };
  return { ask, calls };
}

describe("prepareImage", () => {
  it("shrinks a large picture so its longest side is 1568 px", async () => {
    const big = await png(3000, 1500);
    const out = await prepareImage(big);
    expect(out.resized).toBe(true);
    expect(out.mediaType).toBe("image/png");
    expect(out.width).toBe(MAX_SIDE);
    expect(out.height).toBe(784);
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([MAX_SIDE, 784]);
  });

  it("leaves a small picture exactly as it is", async () => {
    const small = await png(400, 300);
    const out = await prepareImage(small);
    expect(out.resized).toBe(false);
    expect(out.data.equals(small)).toBe(true);
    expect(out.mediaType).toBe("image/png");
  });

  it("keeps a large JPEG as JPEG", async () => {
    const big = await sharp({ create: { width: 2000, height: 2500, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    const out = await prepareImage(big);
    expect(out.mediaType).toBe("image/jpeg");
    expect(out.height).toBe(MAX_SIDE);
  });

  it("reads a picture from a file path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stride-picture-"));
    const path = join(dir, "ref.png");
    const small = await png(100, 80);
    await writeFile(path, small);
    const out = await prepareImage(path);
    expect(out.data.equals(small)).toBe(true);
  });

  it("refuses something that isn't a picture", async () => {
    await expect(prepareImage(Buffer.from("not a picture"))).rejects.toBeInstanceOf(PictureError);
  });
});

describe("readPicture", () => {
  it("sends the picture as an image block and returns the checked reading", async () => {
    const { ask, calls } = fakeAsk(reading);
    const out = await readPicture(await png(3000, 2000), { ask, model: "test-model" });
    expect(out).toEqual(reading);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe("test-model");
    const content = call.content as Array<{ type: string; source?: { type: string; media_type: string; data: string } }>;
    const image = content.find((b) => b.type === "image")!;
    expect(image.source?.type).toBe("base64");
    expect(image.source?.media_type).toBe("image/png");
    const sent = await sharp(Buffer.from(image.source!.data, "base64")).metadata();
    expect(Math.max(sent.width!, sent.height!)).toBe(MAX_SIDE);
    expect(call.schema).toMatchObject({ type: "object" });
  });

  it("uses claude-opus-5-5 unless CALHACK_LEARN_MODEL is set", async () => {
    const { ask, calls } = fakeAsk(reading);
    const before = process.env.CALHACK_LEARN_MODEL;
    try {
      delete process.env.CALHACK_LEARN_MODEL;
      await readPicture(await png(50, 50), { ask });
      process.env.CALHACK_LEARN_MODEL = "other-model";
      await readPicture(await png(50, 50), { ask });
    } finally {
      if (before === undefined) delete process.env.CALHACK_LEARN_MODEL;
      else process.env.CALHACK_LEARN_MODEL = before;
    }
    expect(calls.map((c) => c.model)).toEqual(["claude-opus-5-5", "other-model"]);
  });

  it("rejects an answer that doesn't fit the shape", async () => {
    const { ask } = fakeAsk({ sections: [{ name: "a menu" }], summary: "x" });
    await expect(readPicture(await png(50, 50), { ask })).rejects.toBeInstanceOf(PictureError);
  });

  it("fits the lesson's picture note", () => {
    expect(PictureNoteSchema.safeParse(reading).success).toBe(true);
  });
});

describe("applyCorrection", () => {
  it("sends the current reading and the student's words, and returns the update", async () => {
    const fixed: PictureReading = {
      ...reading,
      sections: reading.sections.map((s) => (s.name === "3 cards" ? { name: "4 cards", description: "Four boxes in a row." } : s)),
    };
    const { ask, calls } = fakeAsk(fixed);
    const out = await applyCorrection(reading, "there are 4 cards, not 3", { ask });
    expect(out).toEqual(fixed);
    const text = JSON.stringify(calls[0]!.content);
    expect(text).toContain("there are 4 cards, not 3");
    expect(text).toContain("a big photo with a title");
  });

  it("skips the model when the student said nothing", async () => {
    const { ask, calls } = fakeAsk(reading);
    expect(await applyCorrection(reading, "   ", { ask })).toBe(reading);
    expect(calls).toHaveLength(0);
  });

  it("rejects a bad corrected answer", async () => {
    const { ask } = fakeAsk({ nope: true });
    await expect(applyCorrection(reading, "no footer", { ask })).rejects.toBeInstanceOf(PictureError);
  });
});

describe("describeForStudent", () => {
  it("lists the sections in one plain sentence", () => {
    expect(describeForStudent(reading)).toBe("a top menu, a big photo with a title, 3 cards, a footer");
  });

  it("tidies names and keeps short words like FAQ", () => {
    const r = { ...reading, sections: [{ name: "Top menu.", description: "d" }, { name: "FAQ list", description: "d" }] };
    expect(describeForStudent(r)).toBe("top menu, FAQ list");
  });

  it("says so when there are no sections", () => {
    expect(describeForStudent({ ...reading, sections: [] })).toBe("I couldn't make out clear parts in your picture");
  });
});

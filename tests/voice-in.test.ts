import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanTranscript, isWav, modelCandidates, pickModel, transcribe, voiceModel, voiceProblem } from "../src/app/voice-in.js";

function wavHeader(dataBytes = 32): Buffer {
  const b = Buffer.alloc(44 + dataBytes);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.write("data", 36, "ascii");
  return b;
}

describe("isWav", () => {
  it("accepts a RIFF/WAVE file", () => expect(isWav(wavHeader())).toBe(true));
  it("rejects too-short data", () => expect(isWav(Buffer.from("RIFF0000WAVE"))).toBe(false));
  it("rejects other formats", () => {
    const b = wavHeader();
    b.write("OggS", 0, "ascii");
    expect(isWav(b)).toBe(false);
  });
  it("rejects files over 10 MB", () => expect(isWav(wavHeader(10 * 1024 * 1024))).toBe(false));
  it("transcribe refuses non-WAV input", async () => {
    await expect(transcribe(Buffer.alloc(100))).rejects.toThrow(/didn't come through/);
  });
});

describe("cleanTranscript", () => {
  it.each([
    [" My printer won't print. ", "My printer won't print."],
    ["[BLANK_AUDIO]", ""],
    ["(music) hello   there\n world [Music]", "hello there world"],
    ["\n [00:00.000 --> 00:02.000] hi", "hi"],
    ["*coughs* my wifi is down", "my wifi is down"],
  ])("%j → %j", (raw, clean) => expect(cleanTranscript(raw)).toBe(clean));
});

describe("model choice", () => {
  const home = "/Users/test";
  const base = "/Users/test/.cache/calhack/ggml-base.en.bin";
  const small = "/Users/test/.cache/calhack/ggml-small.en.bin";
  const large = "/Users/test/.cache/hyperframes/whisper/models/ggml-large-v3.bin";

  it("lists env first, then base, small, large", () => {
    expect(modelCandidates({ CALHACK_WHISPER_MODEL: "/x/my.bin" }, home)).toEqual(["/x/my.bin", base, small, large]);
    expect(modelCandidates({}, home)).toEqual([base, small, large]);
  });

  it("picks the first one that exists", () => {
    const has = (set: string[]) => (p: string) => set.includes(p);
    const list = modelCandidates({ CALHACK_WHISPER_MODEL: "/x/ggml-tiny.en.bin" }, home);
    expect(pickModel(list, has(["/x/ggml-tiny.en.bin", base]))).toEqual({ path: "/x/ggml-tiny.en.bin", name: "tiny.en" });
    expect(pickModel(list, has([small, large]))?.name).toBe("small.en");
    expect(pickModel(list, has([large]))).toEqual({ path: large, name: "large-v3" });
    expect(pickModel(list, has([]))).toBeNull();
  });
});

const canRun = voiceProblem() === null && existsSync("/usr/bin/say");

describe.skipIf(!canRun)("end to end with whisper-cli", () => {
  it("hears 'my printer won't print'", { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "calhack-voice-test-"));
    try {
      const file = join(dir, "say.wav");
      execFileSync("/usr/bin/say", ["-o", file, "--data-format=LEI16@16000", "my printer won't print"]);
      const result = await transcribe(readFileSync(file));
      console.log(`whisper (${result.model}) took ${result.ms} ms: ${JSON.stringify(result.text)}`);
      expect(result.text.toLowerCase()).toContain("printer");
      expect(result.model).toBe(voiceModel()?.name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

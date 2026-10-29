import { describe, expect, it } from "vitest";
import { KEY_ALIAS, useKeyAlias } from "../src/ai/client.js";

describe("Claude key under another name", () => {
  it("uses STRIDE_ANTHROPIC_API_KEY when ANTHROPIC_API_KEY is empty", () => {
    const env: NodeJS.ProcessEnv = { [KEY_ALIAS]: "sk-test" };
    useKeyAlias(env);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test");
  });
  it("never replaces a key that is already set", () => {
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "sk-main", [KEY_ALIAS]: "sk-other" };
    useKeyAlias(env);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-main");
  });
  it("does nothing when neither is set", () => {
    const env: NodeJS.ProcessEnv = {};
    useKeyAlias(env);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

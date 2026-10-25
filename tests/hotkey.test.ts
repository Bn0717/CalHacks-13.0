import { describe, expect, it } from "vitest";
import { helperKeys, modifiersOnly } from "../src/mac/hotkey.js";

describe("modifier-only shortcut", () => {
  it("knows a shortcut with no key", () => {
    expect(modifiersOnly("Command+Alt")).toBe(true);
    expect(modifiersOnly("Option+Cmd")).toBe(true);
    expect(modifiersOnly("Control+Alt+Command+D")).toBe(false);
    expect(modifiersOnly("")).toBe(false);
  });
  it("passes the keys to the listener by one name each", () => {
    expect(helperKeys("Command+Alt")).toBe("command,option");
    expect(helperKeys("Cmd+Option+Ctrl")).toBe("command,option,control");
  });
});

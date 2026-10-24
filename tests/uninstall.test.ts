import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAppBundles, uninstallApp, uninstallRequest, type UninstallDeps } from "../src/core/uninstall.js";

describe("local uninstall", () => {
  it.each(["uninstall Zoom", "please remove Zoom", "can you uninstall Zoom?", "help me to uninstall Zoom", "I want to uninstall Zoom", "delete Zoom from my Mac"])("recognizes %s", (text) => {
    expect(uninstallRequest(text)).toBe("Zoom");
  });
  it.each(["don't uninstall Zoom", "remove my files", "delete /Applications/Zoom.app", "remove Zoom and Chrome", "install Zoom"])("does not turn %s into removal", (text) => {
    expect(uninstallRequest(text)).toBeNull();
  });
  it("matches exact app names and aliases, excluding symlinks and similarly named apps", () => {
    const dir = mkdtempSync(join(tmpdir(), "calhack-app-test-"));
    try {
      mkdirSync(join(dir, "zoom.us.app"));
      mkdirSync(join(dir, "Zoom Helper.app"));
      symlinkSync(join(dir, "zoom.us.app"), join(dir, "Chrome.app"));
      expect(findAppBundles("Zoom", [dir])).toEqual([join(dir, "zoom.us.app")]);
      expect(findAppBundles("Zoom Workplace", [dir])).toEqual([join(dir, "zoom.us.app")]);
      expect(findAppBundles("Zoo", [dir])).toEqual([]);
      expect(findAppBundles("Chrome", [dir])).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  const setup = () => {
    const calls: string[] = [];
    let present = true;
    const deps: UninstallDeps = {
      find: () => ["/Applications/zoom.us.app"], exists: () => present,
      quit: async () => { calls.push("quit"); },
      trash: async () => { calls.push("trash"); present = false; },
    };
    return { deps, calls };
  };
  it("quits, trashes, then verifies absence", async () => {
    const { deps, calls } = setup();
    expect((await uninstallApp("Zoom", deps)).ok).toBe(true);
    expect(calls).toEqual(["quit", "trash"]);
  });
  it("does nothing when absent or ambiguous", async () => {
    const { deps, calls } = setup();
    deps.find = () => [];
    expect((await uninstallApp("Zoom", deps)).message).toContain("Nothing was moved");
    deps.find = () => ["/Applications/zoom.us.app", "/Users/test/Applications/zoom.us.app"];
    expect((await uninstallApp("Zoom", deps)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it("does not trash an app that could not quit", async () => {
    const { deps, calls } = setup();
    deps.quit = async () => { throw Error("App is busy"); };
    expect((await uninstallApp("Zoom", deps)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it("reports failure if Trash fails or the app still exists", async () => {
    const { deps } = setup();
    deps.trash = async () => {};
    expect((await uninstallApp("Zoom", deps)).ok).toBe(false);
    deps.trash = async () => { throw Error("Permission denied"); };
    expect((await uninstallApp("Zoom", deps)).message).toContain("Permission denied");
  });
});

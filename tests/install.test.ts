import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findInstalledApp, installFromOfficial, signerMatches, stagePackage, type InstallDeps } from "../src/core/install.js";

const ok = (output = "") => ({ code: 0, output, timedOut: false });

function deps(signer: string | undefined, over: Partial<InstallDeps> = {}) {
  const ran: string[] = [];
  let installed = false;
  const d: InstallDeps = {
    stagePackage: (path) => ({ path, cleanup() {} }),
    download: async () => ({ path: "/tmp/Zoom.pkg", bytes: 1, sha256: "", signature: { signed: !!signer, signer, summary: signer ? `Signed by "${signer}"` : "Not signed." } }),
    admin: async (c) => (ran.push("admin: " + c), (installed = true), ok()),
    normal: async (c) => (ran.push(c), ok()),
    sandboxed: async (c) => (ran.push(c), ok()),
    apps: () => new Map(installed ? [["/Applications/zoom.us.app", 2]] : []),
    ...over,
  };
  return { d, ran };
}

describe("installing from the official site", () => {
  it("matches the signer to the company", () => {
    expect(signerMatches("Developer ID Installer: Zoom Video Communications, Inc. (BJ4HAAB9B3)", "Zoom")).toBe(true);
    expect(signerMatches("Developer ID Installer: Totally Legit Apps LLC", "Zoom")).toBe(false);
    expect(signerMatches(undefined, "Zoom")).toBe(false);
  });

  it("finds the app that just appeared", () => {
    const before = new Map([["/Applications/Safari.app", 1]]);
    const after = new Map([["/Applications/Safari.app", 1], ["/Applications/zoom.us.app", 5]]);
    expect(findInstalledApp(before, after, "Zoom")).toBe("/Applications/zoom.us.app");
  });

  it("installs a signed pkg with the password box and checks it's there", async () => {
    const { d, ran } = deps("Developer ID Installer: Zoom Video Communications, Inc.");
    const r = await installFromOfficial({ url: "https://zoom.us/client/latest/Zoom.pkg", publisher: "Zoom", appName: "Zoom" }, undefined, d);
    expect(r.ok).toBe(true);
    expect(ran[0]).toBe("admin: /usr/sbin/installer -pkg '/tmp/Zoom.pkg' -target /");
    expect(r.appPath).toBe("/Applications/zoom.us.app");
    expect(r.evidence.some((e) => e.kind === "after" && e.code === 0)).toBe(true);
  });

  it("refuses unsigned files and files signed by someone else", async () => {
    const unsigned = deps(undefined);
    expect((await installFromOfficial({ url: "https://zoom.us/x/Zoom.pkg", publisher: "Zoom", appName: "Zoom" }, undefined, unsigned.d)).ok).toBe(false);
    expect(unsigned.ran).toEqual([]);
    const other = deps("Developer ID Installer: Sketchy Mirror Ltd");
    const r = await installFromOfficial({ url: "https://zoom.us/x/Zoom.pkg", publisher: "Zoom", appName: "Zoom" }, undefined, other.d);
    expect(r.message).toMatch(/not Zoom/);
    expect(other.ran).toEqual([]);
  });
});


describe("package staging", () => {
  it("copies the package bytes out of Downloads and removes the temporary copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "calhack-stage-test-"));
    try {
      const original = join(dir, "Zoom's installer 2.pkg");
      writeFileSync(original, "package bytes");
      const staged = stagePackage(original);
      try {
        expect(staged.path).not.toBe(original);
        expect(readFileSync(staged.path, "utf8")).toBe("package bytes");
      } finally { staged.cleanup(); }
      expect(existsSync(staged.path)).toBe(false);
      expect(existsSync(original)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each([0, 1, -128])("uses the staged path and cleans up after installer exit %s", async (code) => {
    let cleaned = false;
    let command = "";
    const { d } = deps("Developer ID Installer: Zoom", {
      stagePackage: () => ({ path: "/private/tmp/staged/installer.pkg", cleanup() { cleaned = true; } }),
      admin: async (c) => { command = c; return { code, output: code === -128 ? "User cancelled (-128)" : "", timedOut: false }; },
    });
    await installFromOfficial({ url: "https://zoom.us/Zoom.pkg", publisher: "Zoom", appName: "Zoom" }, undefined, d);
    expect(command).toBe("/usr/sbin/installer -pkg '/private/tmp/staged/installer.pkg' -target /");
    expect(cleaned).toBe(true);
  });
});

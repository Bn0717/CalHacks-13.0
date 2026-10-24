import { describe, expect, it } from "vitest";
import { findInstalledApp, installFromOfficial, signerMatches, type InstallDeps } from "../src/core/install.js";

const ok = (output = "") => ({ code: 0, output, timedOut: false });

function deps(signer: string | undefined, over: Partial<InstallDeps> = {}) {
  const ran: string[] = [];
  let installed = false;
  const d: InstallDeps = {
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
    expect(ran[0]).toBe("admin: installer -pkg '/tmp/Zoom.pkg' -target /");
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

import { describe, expect, it } from "vitest";
import { checkOfficial, officialDomainsFor } from "../src/core/official.js";

const page = (url: string, publisher = "Zoom", kind = "download", downloadUrl?: string) => checkOfficial({ url, publisher, kind, downloadUrl });

describe("official pages", () => {
  it.each([
    ["https://zoom.us/download", "Zoom"],
    ["https://zoom.com/download", "Zoom"],
    ["https://support.zoom.us/hc/en-us/articles/201362233", "Zoom"],
    ["https://us02web.zoom.us/download", "Zoom Video Communications, Inc."],
    ["https://support.hp.com/us-en/drivers", "HP"],
    ["https://support.hp.com/us-en/drivers", "HP Inc."],
    ["https://support.apple.com/en-us/102385", "Apple"],
    ["https://www.mozilla.org/firefox/new/", "Mozilla"],
    ["https://www.google.com/chrome/", "Google"],
    ["https://www.epson.com/support", "Epson"],
    ["https://www.logitech.com/en-us/support", "Logitech"],
    ["https://www.nvidia.com/drivers", "NVIDIA"],
  ])("%s (%s) is official", (url, publisher) => {
    expect(page(url, publisher).ok).toBe(true);
  });

  it("Apple's support site is fine for any maker's help article", () => {
    expect(page("https://support.apple.com/en-us/102385", "HP", "support-article").ok).toBe(true);
    expect(page("https://support.apple.com/en-us/102385", "HP", "download").ok).toBe(false);
  });

  it("gives the host and a plain reason", () => {
    const r = page("https://zoom.us/download");
    expect(r).toEqual({ ok: true, reason: "This is on Zoom's own website.", host: "zoom.us" });
  });
});

describe("look-alike and unsafe links", () => {
  it.each([
    "https://zoom.us.example.com/download",
    "https://zoom-us.com/download",
    "https://zoomus.com/download",
    "https://myzoom.us.co/download",
    "https://zoom.us@evil.com/download",
    "https://evil.com/zoom.us/download",
    "http://zoom.us/download",
    "ftp://zoom.us/download",
    "https://xn--zom-0na.us/download",
    "https://zοom.us/download", // Greek omicron, turned into punycode
    "https://zoom.us:8443/download",
    "https://bit.ly/zoom",
    "https://1.2.3.4/zoom",
    "not a link",
  ])("%s is refused", (url) => {
    expect(page(url).ok).toBe(false);
  });

  it("explains a link on someone else's site", () => {
    expect(page("https://zoom-us.com/download").reason).toBe("This link isn't on Zoom's own website.");
    expect(page("http://zoom.us/download").reason).toMatch(/https/);
    expect(page("https://zoom.us@evil.com/").host).toBe("evil.com");
  });

  it.each([
    ["https://github.com/zoom/zoom/releases", "Zoom"],
    ["https://objects.githubusercontent.com/zoom.pkg", "Zoom"],
    ["https://drive.google.com/file/d/abc", "Google"],
    ["https://docs.google.com/document/d/abc", "Google"],
    ["https://www.dropbox.com/s/abc/Zoom.pkg", "Zoom"],
    ["https://www.mediafire.com/file/zoom.pkg", "Zoom"],
    ["https://zoom.softonic.com/mac", "Zoom"],
  ])("user-upload site %s is refused", (url, publisher) => {
    expect(page(url, publisher).ok).toBe(false);
  });

  it.each([
    "https://discussions.apple.com/thread/123",
    "https://community.zoom.com/t5/abc",
    "https://h30434.www3.hp.com/t5/printers",
    "https://answers.microsoft.com/en-us/abc",
  ])("forum %s is refused", (url) => {
    const publisher = /apple/.test(url) ? "Apple" : /zoom/.test(url) ? "Zoom" : /hp/.test(url) ? "HP" : "Microsoft";
    expect(checkOfficial({ url, publisher, kind: "support-article" }).ok).toBe(false);
  });

  it("refuses a publisher that doesn't match the site", () => {
    expect(page("https://zoom.us/download", "HP").ok).toBe(false);
    expect(page("https://hp.com/drivers", "Zoom").ok).toBe(false);
    expect(page("https://support.apple.com/en-us/1", "Zoom", "download").ok).toBe(false);
  });

  it("refuses an unknown publisher", () => {
    const r = page("https://example-app.com/download", "Example App");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/don't know/);
  });
});

describe("direct installer links", () => {
  it.each([
    "https://zoom.us/client/latest/Zoom.pkg",
    "https://cdn.zoom.us/prod/6.2.0/Zoom.pkg?x=1",
    "https://zoom.us/client/latest/zoomusInstallerFull.pkg#top",
  ])("%s is fine", (dl) => {
    expect(page("https://zoom.us/download", "Zoom", "download", dl).ok).toBe(true);
  });

  it("allows Google's .dmg", () => {
    expect(page("https://www.google.com/chrome/", "Google", "download", "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg").ok).toBe(true);
  });

  it.each([
    ["http://zoom.us/client/latest/Zoom.pkg", /https/],
    ["https://zoom-cdn.com/Zoom.pkg", /isn't on Zoom's own website/],
    ["https://dl.google.com/Zoom.pkg", /isn't on Zoom's own website/],
    ["https://zoom.us/client/latest/Zoom.zip", /\.pkg or \.dmg/],
    ["https://zoom.us/client/latest/Zoom.exe", /\.pkg or \.dmg/],
    ["https://zoom.us/download?file=Zoom.pkg", /\.pkg or \.dmg/],
    ["https://github.com/zoom/x/Zoom.pkg", /anyone can upload/],
    ["https://zoom.us@evil.com/Zoom.pkg", /@/],
  ])("%s is refused", (dl, reason) => {
    const r = page("https://zoom.us/download", "Zoom", "download", dl);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(reason);
    expect(r.host).toBe("zoom.us");
  });
});

describe("officialDomainsFor", () => {
  it("knows common names", () => {
    expect(officialDomainsFor("Zoom Video Communications")).toContain("zoom.us");
    expect(officialDomainsFor("Hewlett-Packard")).toContain("hp.com");
    expect(officialDomainsFor("Mozilla Firefox")).toContain("mozilla.org");
    expect(officialDomainsFor("")).toEqual([]);
    expect(officialDomainsFor("GitHub")).toEqual([]);
  });
});

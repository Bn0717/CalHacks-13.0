// Checks that a page Droid found is really on the publisher's own website.
// Droid's answer is untrusted: our code decides if a link is official, not the AI.
import { VENDOR_DOMAINS, hostMatches, isSuspiciousHost } from "./trusted.js";

/** Known publishers and their own websites. Subdomains count (support.zoom.us is Zoom). */
export const OFFICIAL_PUBLISHERS: { name: string; names: string[]; domains: string[] }[] = [
  { name: "Apple", names: ["apple"], domains: ["apple.com", "cdn-apple.com"] },
  { name: "Zoom", names: ["zoom", "zoom us"], domains: ["zoom.us", "zoom.com"] },
  { name: "HP", names: ["hp", "hewlett packard"], domains: ["hp.com"] },
  { name: "Canon", names: ["canon"], domains: ["canon.com", "canon.co.uk", "canon-europe.com"] },
  { name: "Epson", names: ["epson", "seiko epson"], domains: ["epson.com", "epson.co.uk", "epson.eu"] },
  { name: "Brother", names: ["brother"], domains: ["brother.com", "brother-usa.com", "brother.co.uk"] },
  { name: "Microsoft", names: ["microsoft"], domains: ["microsoft.com", "office.com", "microsoft365.com"] },
  { name: "Google", names: ["google"], domains: ["google.com"] },
  { name: "Mozilla", names: ["mozilla", "firefox"], domains: ["mozilla.org", "mozilla.net", "firefox.com"] },
  { name: "Logitech", names: ["logitech", "logi"], domains: ["logitech.com", "logi.com"] },
  { name: "Adobe", names: ["adobe"], domains: ["adobe.com"] },
  { name: "Cisco Webex", names: ["webex", "cisco", "cisco webex"], domains: ["webex.com", "cisco.com"] },
  { name: "Slack", names: ["slack"], domains: ["slack.com"] },
  { name: "Spotify", names: ["spotify"], domains: ["spotify.com"] },
  { name: "Signal", names: ["signal"], domains: ["signal.org"] },
  { name: "WhatsApp", names: ["whatsapp"], domains: ["whatsapp.com"] },
  { name: "Samsung", names: ["samsung"], domains: ["samsung.com"] },
  { name: "Xerox", names: ["xerox"], domains: ["xerox.com"] },
  { name: "Lexmark", names: ["lexmark"], domains: ["lexmark.com"] },
  { name: "VideoLAN", names: ["videolan", "vlc"], domains: ["videolan.org"] },
  { name: "Python", names: ["python", "python software foundation"], domains: ["python.org"] },
  { name: "Node.js", names: ["node js", "nodejs", "openjs foundation"], domains: ["nodejs.org"] },
  { name: "Docker", names: ["docker"], domains: ["docker.com"] },
  { name: "Homebrew", names: ["homebrew"], domains: ["brew.sh"] },
  { name: "Rectangle", names: ["rectangle"], domains: ["rectangleapp.com"] },
];

/** Places where anyone can upload files or pages. Never official, even on a big company's domain. */
export const USER_CONTENT_HOSTS: string[] = [
  "github.com",
  "githubusercontent.com",
  "github.io",
  "gitlab.com",
  "bitbucket.org",
  "sourceforge.net",
  "dropbox.com",
  "dropboxusercontent.com",
  "drive.google.com",
  "docs.google.com",
  "sites.google.com",
  "storage.googleapis.com",
  "googleusercontent.com",
  "onedrive.live.com",
  "1drv.ms",
  "sharepoint.com",
  "box.com",
  "wetransfer.com",
  "mediafire.com",
  "mega.nz",
  "amazonaws.com",
  "blogspot.com",
  "wordpress.com",
  "medium.com",
  "reddit.com",
  "youtube.com",
  "softonic.com",
  "uptodown.com",
  "filehippo.com",
  "cnet.com",
  "macupdate.com",
];

/** Forums and community answers: written by other users, so not official instructions. */
const FORUM_HOSTS = ["discussions.apple.com", "answers.microsoft.com", "support.google.com/community", "h30434.www3.hp.com"];
const FORUM_LABELS = new Set(["community", "communities", "forum", "forums", "discussions", "answers"]);

/** Lowercase words only, e.g. "Zoom Video Communications, Inc." → "zoom video communications inc". */
function normalizeName(publisher: string): string {
  return publisher.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The official domains for a publisher name, or [] when we don't know them. */
export function officialDomainsFor(publisher: string): string[] {
  const n = normalizeName(publisher);
  if (!n) return [];
  const entry = OFFICIAL_PUBLISHERS.find((p) => p.names.some((name) => n === name || n.startsWith(name + " ")));
  if (entry) return entry.domains;
  // Not in our list: allow a vendor domain whose name is the publisher's, e.g. "NVIDIA" → nvidia.com.
  const squashed = n.replace(/ /g, "");
  return VENDOR_DOMAINS.filter((d) => !USER_CONTENT_HOSTS.some((u) => hostMatches(d, u))).filter((d) => {
    const label = d.split(".")[0];
    return label.length >= 3 && (squashed === label || squashed.startsWith(label));
  });
}

/** The publisher's display name, e.g. "Zoom" for "Zoom Video Communications". */
function displayName(publisher: string): string {
  const n = normalizeName(publisher);
  return OFFICIAL_PUBLISHERS.find((p) => p.names.some((name) => n === name || n.startsWith(name + " ")))?.name ?? (publisher.trim() || "the maker");
}

function isForum(host: string, path: string): boolean {
  if (FORUM_HOSTS.some((f) => (f.includes("/") ? (host + path).startsWith(f) : hostMatches(host, f)))) return true;
  return host.split(".").some((label) => FORUM_LABELS.has(label));
}

type Parsed = { ok: true; url: URL } | { ok: false; reason: string; host: string };

/** Reads a link and rejects the tricks look-alike links use. */
function parseLink(raw: string, what: string): Parsed {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: `The ${what} isn't a real web address.`, host: "" };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") return { ok: false, reason: `The ${what} isn't a secure (https) link.`, host };
  if (url.username || url.password) return { ok: false, reason: `The ${what} hides its real address (it has an @ in it).`, host };
  if (url.port) return { ok: false, reason: `The ${what} uses an unusual port, which official sites don't.`, host };
  if (host.split(".").some((label) => label.startsWith("xn--"))) return { ok: false, reason: `The ${what} uses look-alike letters in its name.`, host };
  if (isSuspiciousHost(host)) return { ok: false, reason: `The ${what} goes to a site often used to hide malware.`, host };
  if (USER_CONTENT_HOSTS.some((d) => hostMatches(host, d))) return { ok: false, reason: `The ${what} is on a site where anyone can upload files, not the maker's own website.`, host };
  return { ok: true, url };
}

/** True when the link's path ends in .pkg or .dmg (query strings are fine). */
export function isInstallerPath(url: URL): boolean {
  return /\.(pkg|dmg)$/i.test(decodeURIComponent(url.pathname));
}

export function checkOfficial(src: { url: string; downloadUrl?: string; publisher: string; kind: string }): { ok: boolean; reason: string; host: string } {
  const name = displayName(src.publisher);
  const domains = officialDomainsFor(src.publisher);
  const page = parseLink(src.url, "link");
  if (!page.ok) return page;
  const host = page.url.hostname.toLowerCase();

  if (isForum(host, page.url.pathname)) return { ok: false, reason: "This page is a forum where other people post answers, not official instructions.", host };

  // Apple's own support site explains other makers' devices on a Mac too, so it's fine for any help article.
  const appleSupport = src.kind === "support-article" && hostMatches(host, "support.apple.com");
  if (!appleSupport) {
    if (!domains.length) return { ok: false, reason: `We don't know ${name}'s official website, so we can't confirm this page is theirs.`, host };
    if (!domains.some((d) => hostMatches(host, d))) return { ok: false, reason: `This link isn't on ${name}'s own website.`, host };
  }

  if (src.downloadUrl) {
    const dl = parseLink(src.downloadUrl, "download link");
    if (!dl.ok) return { ...dl, host };
    const dlHost = dl.url.hostname.toLowerCase();
    if (!domains.some((d) => hostMatches(dlHost, d))) return { ok: false, reason: `The download link isn't on ${name}'s own website.`, host };
    if (!isInstallerPath(dl.url)) return { ok: false, reason: "The download link isn't a Mac installer (.pkg or .dmg).", host };
  }

  return {
    ok: true,
    reason: appleSupport ? "This is on Apple's own support website." : `This is on ${name}'s own website.`,
    host,
  };
}

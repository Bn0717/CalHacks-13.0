// Lists of web addresses we trust or distrust. Kept separate so the team can edit them easily.

/**
 * Official "download and run" installers. These still run code from the internet,
 * so they are never "safe", but they are allowed with the user's yes instead of blocked.
 */
export const TRUSTED_INSTALLER_PREFIXES: string[] = [
  "https://raw.githubusercontent.com/Homebrew/install/",
  "https://sh.rustup.rs",
  "https://bun.sh/install",
  "https://deno.land/install.sh",
  "https://astral.sh/uv/",
  "https://raw.githubusercontent.com/nvm-sh/nvm/",
  "https://install.python-poetry.org",
  "https://get.pnpm.io/install.sh",
  "https://claude.ai/install.sh",
];

/** Websites of companies that publish drivers and apps. Downloads from these are allowed with a yes. */
export const VENDOR_DOMAINS: string[] = [
  "apple.com",
  "microsoft.com",
  "hp.com",
  "canon.com",
  "epson.com",
  "brother.com",
  "logitech.com",
  "nvidia.com",
  "intel.com",
  "amd.com",
  "google.com",
  "mozilla.org",
  "python.org",
  "nodejs.org",
  "zoom.us",
  "docker.com",
  "brew.sh",
  "videolan.org",
  "rectangleapp.com",
  "github.com",
  "githubusercontent.com",
  // Added for official-source lookups (src/core/official.ts): Zoom's newer support/download domain.
  "zoom.com",
];

/** Link shorteners, anonymous file shares and tunnels: common places to hide malware. */
export const SUSPICIOUS_HOSTS: string[] = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "cutt.ly",
  "mediafire.com",
  "mega.nz",
  "transfer.sh",
  "pastebin.com",
  "paste.ee",
  "cdn.discordapp.com",
  "file.io",
  "gofile.io",
  "anonfiles.com",
  "ngrok.io",
  "ngrok-free.app",
  "trycloudflare.com",
];

/** True when host is the domain itself or one of its subdomains. */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith("." + d);
}

export function isTrustedInstaller(url: string): boolean {
  return TRUSTED_INSTALLER_PREFIXES.some((p) => url.startsWith(p));
}

export function isVendorHost(host: string): boolean {
  return VENDOR_DOMAINS.some((d) => hostMatches(host, d));
}

export function isSuspiciousHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // raw IP address
  if (host.endsWith(".zip") || host.endsWith(".mov")) return true; // look-alike file-name domains
  return SUSPICIOUS_HOSTS.some((d) => hostMatches(host, d));
}

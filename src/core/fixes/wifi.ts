// "Wi-Fi says connected but nothing loads": is Wi-Fi on, did it get an address, do websites load, can the Mac look names up.
// The first check finds the Wi-Fi device name (e.g. "en0"); the later checks' commands are built from it.
import type { CheckDef, Facts, FixDef, FixGuide } from "./types.js";

/** Wi-Fi device names we accept from command output. */
export const WIFI_DEVICE = /^en\d{1,3}$/;

export function safeDevice(name: string): string {
  if (!WIFI_DEVICE.test(name)) throw new Error(`Not a Wi-Fi device name we trust: ${name}`);
  return name;
}

/** A fixed Apple page that just says "Success". Only the status number is kept. */
export const INTERNET_CHECK = "curl -sS -o /dev/null -w '%{http_code}' --max-time 5 https://www.apple.com/library/test/success.html";
/** Looks up apple.com by name (DNS). */
export const NAME_CHECK = "dscacheutil -q host -a name apple.com";

/** `networksetup -listallhardwareports` → the Wi-Fi device, e.g. "en0". "" when there's none. */
export function parseWifiDevice(output: string): string {
  const m = /Hardware Port:\s*(?:Wi-Fi|AirPort)\s*\n\s*Device:\s*(\S+)/i.exec(output);
  return m && WIFI_DEVICE.test(m[1]) ? m[1] : "";
}

/** `networksetup -getairportpower en0` → true (On), false (Off), null (odd output). */
export function parsePower(output: string): boolean | null {
  const m = /Wi-Fi Power \([^)]*\):\s*(On|Off)/i.exec(output);
  return m ? m[1].toLowerCase() === "on" : null;
}

/** `ipconfig getifaddr en0` → the address, or "". */
export function parseAddress(output: string): string {
  const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*$/m.exec(output);
  return m ? m[1] : "";
}

const str = (f: Facts, k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
const connected = (f: Facts) => !!str(f, "ipAddress") && f.selfAssigned !== true;

const checks: CheckDef[] = [
  {
    id: "wifi-device",
    label: "This Mac has Wi-Fi",
    command: "networksetup -listallhardwareports",
    interpret(r) {
      if (r.code !== 0) return { status: "unknown", detail: "Couldn't check this." };
      const wifiDevice = parseWifiDevice(r.output);
      if (!wifiDevice) return { status: "problem", detail: "No Wi-Fi found on this Mac", facts: { wifiDevice } };
      return { status: "ok", detail: "Wi-Fi found", facts: { wifiDevice } };
    },
  },
  {
    id: "wifi-power",
    label: "Wi-Fi is turned on",
    command: (f) => (str(f, "wifiDevice") ? `networksetup -getairportpower ${safeDevice(str(f, "wifiDevice"))}` : null),
    skipped: "No Wi-Fi to check",
    interpret(r) {
      const on = parsePower(r.output);
      if (on === null) return { status: "unknown", detail: "Couldn't check this." };
      return on ? { status: "ok", detail: "Wi-Fi is on", facts: { wifiOn: true } } : { status: "problem", detail: "Wi-Fi is turned off", facts: { wifiOn: false } };
    },
  },
  {
    id: "wifi-address",
    label: "Connected to a Wi-Fi network",
    command: (f) => (str(f, "wifiDevice") && f.wifiOn !== false ? `ipconfig getifaddr ${safeDevice(str(f, "wifiDevice"))}` : null),
    skipped: "Wi-Fi is off",
    interpret(r) {
      const ipAddress = r.code === 0 ? parseAddress(r.output) : "";
      // 169.254.x.x means the router never answered.
      const selfAssigned = ipAddress.startsWith("169.254.");
      if (!ipAddress) return { status: "problem", detail: "Not joined to a Wi-Fi network", facts: { ipAddress, selfAssigned } };
      if (selfAssigned) return { status: "problem", detail: "The router didn't give your Mac an address", facts: { ipAddress, selfAssigned } };
      return { status: "ok", detail: "Connected", facts: { ipAddress, selfAssigned } };
    },
  },
  {
    id: "wifi-internet",
    label: "Websites load",
    command: (f) => (connected(f) ? INTERNET_CHECK : null),
    skipped: "Not connected yet",
    needsNetwork: true,
    interpret(r) {
      const code = Number(/(\d{3})\s*$/.exec(r.output.trim())?.[1] ?? 0);
      if (code === 200) return { status: "ok", detail: "Websites load", facts: { internet: true, internetCode: code } };
      if (code >= 300 && code < 400) return { status: "problem", detail: "The Wi-Fi may want you to sign in first", facts: { internet: false, internetCode: code } };
      return { status: "problem", detail: "Websites don't load", facts: { internet: false, internetCode: code } };
    },
  },
  {
    // DNS: turning "apple.com" into an address.
    id: "wifi-names",
    label: "Your Mac can look up websites",
    command: (f) => (connected(f) ? NAME_CHECK : null),
    skipped: "Not connected yet",
    needsNetwork: true,
    interpret(r) {
      const ok = /^(ip_address|ipv6_address):\s*\S+/m.test(r.output);
      return ok ? { status: "ok", detail: "Looking up websites works", facts: { namesWork: true } } : { status: "problem", detail: "Can't look up websites", facts: { namesWork: false } };
    },
  },
];

const fixes: FixDef[] = [
  {
    id: "wifi-on",
    label: "Turn Wi-Fi on",
    applies: (f) => f.wifiOn === false && !!str(f, "wifiDevice"),
    command: (f) => `networksetup -setairportpower ${safeDevice(str(f, "wifiDevice"))} on`,
    waitAfterMs: 10_000,
  },
  {
    // Flush the DNS cache. Plain words: the Mac's list of where websites live.
    id: "reset-names",
    label: "Reset your Mac's internet address book (asks for your Mac password)",
    applies: (f) => f.namesWork === false,
    command: () => "sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder",
    admin: true,
    waitAfterMs: 2_000,
  },
  {
    id: "wifi-restart",
    label: "Turn Wi-Fi off and on again",
    applies: (f) => f.wifiOn === true && !!str(f, "wifiDevice") && (!str(f, "ipAddress") || f.selfAssigned === true || f.internet === false || f.namesWork === false),
    command: (f) => {
      const dev = safeDevice(str(f, "wifiDevice"));
      return `networksetup -setairportpower ${dev} off && sleep 3 && networksetup -setairportpower ${dev} on`;
    },
    waitAfterMs: 10_000,
  },
];

function problemSentence(f: Facts): string | null {
  if (f.wifiDevice === "") return "I couldn't find Wi-Fi on this Mac.";
  if (f.wifiOn === false) return "Your Wi-Fi is turned off.";
  if (f.ipAddress === "") return "Your Mac isn't connected to a Wi-Fi network.";
  if (f.selfAssigned === true) return "Your Mac is on Wi-Fi, but the router didn't let it in.";
  if (f.namesWork === false) return "Your Wi-Fi is connected, but your Mac can't look up websites.";
  if (f.internet === false) {
    const code = typeof f.internetCode === "number" ? f.internetCode : 0;
    return code >= 300 && code < 400 ? "Your Wi-Fi is connected, but it wants you to sign in on a web page first." : "Your Wi-Fi is connected, but the internet isn't getting through.";
  }
  return null;
}

function status(f: Facts): { label: string; value: string }[] {
  const yesNo = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : "Not checked");
  return [
    { label: "Wi-Fi", value: f.wifiDevice === "" ? "Not found" : f.wifiOn === true ? "On" : f.wifiOn === false ? "Off" : "Not checked" },
    { label: "Connected to a network", value: f.ipAddress === undefined ? "Not checked" : f.selfAssigned === true ? "No address from the router" : f.ipAddress ? "Yes" : "No" },
    { label: "Websites load", value: yesNo(f.internet) },
    { label: "Looking up websites", value: yesNo(f.namesWork) },
  ];
}

export const wifiGuide: FixGuide = {
  id: "wifi",
  title: "Internet isn't working",
  goal: "Get you back on the internet",
  describe: "Wi-Fi or internet problems: Wi-Fi is off, not connected, says connected but websites won't load, or pages can't be found.",
  examples: [
    "Wi-Fi says connected but nothing loads",
    "my internet isn't working",
    "websites won't load",
    "I can't get online",
    "Wi-Fi is not working",
    "Safari can't find the server",
  ],
  checks,
  fixes,
  problemSentence,
  status,
};

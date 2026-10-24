// "I can't hear anything": is the sound muted or turned right down, and where is sound going.
import type { CheckDef, Facts, FixDef, FixGuide } from "./types.js";

/** Below this the Mac is basically silent. */
export const LOW_VOLUME = 10;
/** What we set it to when it's too low. */
export const FIX_VOLUME = 50;

export const SOUND_SETTINGS = "x-apple.systempreferences:com.apple.Sound-Settings.extension";

/** Places sound can go where people often can't hear it: a screen without speakers, a virtual device, AirPlay. */
const ODD_TRANSPORTS = new Set(["virtual", "hdmi", "displayport", "airplay"]);

/** `get volume settings` → volume (-1 when the device has no volume, e.g. some screens) and muted. */
export function parseVolume(output: string): { volume: number; muted: boolean } | null {
  const v = /output volume:\s*(\d+|missing value)/.exec(output);
  const m = /output muted:\s*(true|false|missing value)/.exec(output);
  if (!v || !m) return null;
  return { volume: v[1] === "missing value" ? -1 : Math.min(100, Number(v[1])), muted: m[1] === "true" };
}

/** From `system_profiler SPAudioDataType`: the device marked "Default Output Device: Yes". */
export function parseOutputDevice(output: string): { name: string; transport: string } | null {
  let device = "";
  let deviceIndent = -1;
  const props = new Map<string, Map<string, string>>();
  for (const line of output.split("\n")) {
    const m = /^(\s*)([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2].trim();
    const value = m[3].trim();
    if (!value) {
      // A heading. Devices sit under "Devices:"; their properties are indented more.
      if (key === "Audio" || key === "Devices") continue;
      if (deviceIndent === -1 || indent <= deviceIndent) {
        device = key;
        deviceIndent = indent;
        props.set(device, new Map());
      }
      continue;
    }
    if (device && indent > deviceIndent) props.get(device)!.set(key, value);
  }
  for (const [name, p] of props) {
    if (p.get("Default Output Device") === "Yes") return { name: name.slice(0, 80), transport: p.get("Transport") ?? "Unknown" };
  }
  return null;
}

const bool = (f: Facts, k: string) => f[k] === true;
const str = (f: Facts, k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");

function isLow(f: Facts): boolean {
  return typeof f.volume === "number" && f.volume >= 0 && f.volume < LOW_VOLUME;
}

const checks: CheckDef[] = [
  {
    id: "sound-volume",
    label: "Sound is on and loud enough",
    command: "osascript -e 'get volume settings'",
    interpret(r) {
      const v = r.code === 0 ? parseVolume(r.output) : null;
      if (!v) return { status: "unknown", detail: "Couldn't check the volume." };
      const facts = { volume: v.volume, muted: v.muted };
      if (v.muted) return { status: "problem", detail: "Sound is muted", facts };
      if (v.volume >= 0 && v.volume < LOW_VOLUME) return { status: "problem", detail: `Volume is very low (${v.volume}%)`, facts };
      return { status: "ok", detail: v.volume >= 0 ? `Volume is ${v.volume}%` : "Sound is on", facts };
    },
  },
  {
    id: "sound-output",
    label: "Sound goes to your speakers",
    command: "system_profiler SPAudioDataType",
    interpret(r) {
      if (r.code !== 0) return { status: "unknown", detail: "Couldn't check where sound goes." };
      const d = parseOutputDevice(r.output);
      if (!d) return { status: "problem", detail: "No speaker is picked", facts: { outputDevice: "", outputTransport: "", outputOdd: true, outputBluetooth: false } };
      const t = d.transport.toLowerCase();
      const odd = ODD_TRANSPORTS.has(t);
      const bluetooth = t === "bluetooth";
      const facts = { outputDevice: d.name, outputTransport: d.transport, outputOdd: odd, outputBluetooth: bluetooth };
      if (odd) return { status: "problem", detail: `Sound goes to ${d.name}`, facts };
      // Bluetooth headphones may be in a drawer; we can't tell, so we just mention it.
      if (bluetooth) return { status: "unknown", detail: `Sound goes to ${d.name}`, facts };
      return { status: "ok", detail: `Sound goes to ${d.name}`, facts };
    },
  },
];

const fixes: FixDef[] = [
  {
    id: "unmute",
    label: "Turn the sound back on (un-mute)",
    applies: (f) => bool(f, "muted"),
    command: () => "osascript -e 'set volume without output muted'",
  },
  {
    id: "volume-up",
    label: `Turn the volume up to ${FIX_VOLUME}%`,
    applies: isLow,
    command: () => `osascript -e 'set volume output volume ${FIX_VOLUME}'`,
  },
  {
    // No shell command picks the output device, but CalHack's own audio helper does (the "sound-output" recipe).
    // The manual instructions are only the fallback if that fails.
    id: "pick-output",
    label: "Pick where sound plays",
    applies: (f) => bool(f, "outputOdd") || (bool(f, "outputBluetooth") && !bool(f, "muted") && !isLow(f)),
    recipe: "sound-output",
    manual: {
      clickTarget: "Output",
      settingsUrl: SOUND_SETTINGS,
      explain: "In Sound settings, under Output, pick your Mac's speakers or the headphones you're wearing.",
    },
  },
];

function deviceClause(f: Facts): string {
  const name = str(f, "outputDevice");
  const t = str(f, "outputTransport").toLowerCase();
  if (!name) return "no speaker is picked for sound";
  if (t === "virtual") return `sound is going to “${name}”, which isn't a real speaker`;
  if (t === "airplay") return `sound is going to “${name}” over AirPlay`;
  if (t === "bluetooth") return `sound is going to “${name}”, so you'll only hear it there`;
  return `sound is going to “${name}”, which may not have speakers`;
}

function problemSentence(f: Facts): string | null {
  const muted = bool(f, "muted");
  const low = isLow(f);
  const odd = bool(f, "outputOdd");
  // Bluetooth is only worth a mention when nothing else explains the silence.
  const bt = bool(f, "outputBluetooth") && !muted && !low;
  let first = "";
  if (muted && low) first = "Your Mac's sound is muted and the volume is almost all the way down";
  else if (muted) first = "Your Mac's sound is turned off (muted)";
  else if (low) first = "Your Mac's volume is almost all the way down";
  if (!first && !odd && !bt) return null;
  if (!first) {
    const c = deviceClause(f);
    return c[0].toUpperCase() + c.slice(1) + ".";
  }
  return odd ? `${first}, and ${deviceClause(f)}.` : `${first}.`;
}

function status(f: Facts): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (typeof f.muted === "boolean") rows.push({ label: "Sound", value: f.muted ? "Muted" : "On" });
  if (typeof f.volume === "number") rows.push({ label: "Volume", value: f.volume >= 0 ? `${f.volume}%` : "Set on the speaker itself" });
  if (typeof f.outputDevice === "string") rows.push({ label: "Sound goes to", value: f.outputDevice || "Nothing picked" });
  return rows.length ? rows : [{ label: "Sound", value: "Couldn't check" }];
}

export const soundGuide: FixGuide = {
  id: "sound",
  title: "No sound",
  goal: "Get your sound working again",
  describe: "The Mac makes no sound or is too quiet: muted, volume all the way down, or sound going to the wrong speaker, screen or headphones.",
  examples: [
    "I can't hear anything",
    "no sound",
    "my Mac has no sound",
    "the volume is too low",
    "sound isn't working",
    "I can't hear the video",
    "people on Zoom can't be heard",
  ],
  checks,
  fixes,
  problemSentence,
  status,
};

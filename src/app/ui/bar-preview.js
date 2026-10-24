// Preview only: a fake app (window.calhack) and a fake mic, so bar.js can be tried in a normal browser.
(() => {
  "use strict";

  const listeners = {};
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };

  function emit(channel, data) {
    for (const cb of listeners[channel] || []) cb(data);
  }
  function log(text) {
    const box = document.getElementById("log");
    if (!box) return;
    box.textContent = (text + "\n" + box.textContent).slice(0, 4000);
  }

  // ---------- Sample data ----------

  const zoomSteps = [
    { id: "s1", text: "Check whether Zoom is already on your Mac", status: "todo" },
    { id: "s2", text: "Download Zoom from zoom.us, Zoom's own website", status: "todo" },
    { id: "s3", text: "Install Zoom into your Applications folder", status: "todo" },
    { id: "s4", text: "Open Zoom so you can sign in", status: "todo" },
  ];
  const withStatus = (steps, upTo, running) =>
    steps.map((s, i) => ({ ...s, status: i < upTo ? "done" : i === upTo && running ? "running" : "todo" }));

  const zoomDetail = [
    { text: "Plan checked by CalHack's safety rules" },
    { stepId: "s1", text: "✅ Allowed: ls /Applications | grep -i zoom", mono: true },
    { stepId: "s1", text: "Zoom is not installed yet." },
    { stepId: "s2", text: "Run by Droid (Factory)" },
    { stepId: "s2", text: "✅ Allowed: brew install --cask zoom", mono: true },
    { stepId: "s2", text: "==> Downloading https://cdn.zoom.us/prod/6.2.5/arm64/zoomusInstallerFull.pkg", mono: true },
  ];

  const S = {
    hidden: { phase: "hidden" },
    looking: { phase: "looking", message: "Let me take a look…" },
    ask: {
      phase: "ask",
      question: "Hi! What's going on?",
      suggestions: ["My printer won't print", "Install Zoom", "My Wi-Fi is slow"],
      listening: false,
      transcribing: false,
    },
    "ask (listening)": {
      phase: "ask",
      question: "Hi! What's going on?",
      suggestions: [],
      listening: true,
      transcribing: false,
    },
    "ask (transcribing)": {
      phase: "ask",
      question: "Hi! What's going on?",
      suggestions: [],
      listening: false,
      transcribing: true,
    },
    "ask (heard)": {
      phase: "ask",
      question: "Did I get that right?",
      suggestions: ["Yes", "No, let me say it again"],
      listening: false,
      transcribing: false,
      heard: "My printer says it's paused and nothing comes out",
    },
    checking: {
      phase: "checking",
      title: "Let me check your printer",
      checks: [
        { label: "Printer is connected", status: "ok" },
        { label: "Printer is turned on and ready", status: "problem", detail: "It's paused" },
        { label: "Print jobs waiting", status: "running" },
        { label: "Paper and ink", status: "pending" },
      ],
    },
    "plan (install)": {
      phase: "plan",
      goal: "Install Zoom",
      steps: zoomSteps,
      notes: [
        { tone: "info", text: "The page says to download a file and double-click it. I'll use Homebrew instead, which does the same thing safely." },
        { tone: "blocked", text: "I'll skip the step that turns off your Mac's security check. It isn't needed." },
      ],
      okLabel: "Yes, install",
      cancelLabel: "Not now",
      source: "From support.zoom.com",
    },
    "plan (fix)": {
      phase: "plan",
      goal: "Get your printer printing again",
      problem: "Your printer is paused and has 3 stuck print jobs.",
      steps: [
        { id: "p1", text: "Clear the 3 stuck print jobs", status: "todo" },
        { id: "p2", text: "Turn the printer back on (un-pause it)", status: "todo" },
        { id: "p3", text: "Print a test page to be sure", status: "todo" },
      ],
      notes: [{ tone: "warn", text: "You'll need to check that the printer has paper." }],
      okLabel: "OK, fix it",
      cancelLabel: "Not now",
    },
    working: {
      phase: "working",
      goal: "Install Zoom",
      current: 2,
      total: 4,
      line: "Downloading Zoom from zoom.us",
      steps: withStatus(zoomSteps, 1, true),
      detail: zoomDetail,
    },
    "needs-you (approve)": {
      phase: "needs-you",
      goal: "Install Zoom",
      stepId: "s3",
      kind: "approve",
      question: "Is it OK if I install Zoom into Applications?",
      why: ["It changes what's installed on your Mac.", "It needs your Mac password."],
      command: "brew install --cask zoom",
      showMe: false,
    },
    "needs-you (manual)": {
      phase: "needs-you",
      goal: "Install Zoom",
      stepId: "s4",
      kind: "manual",
      question: "Please click \"Allow\" in the box that just popped up.",
      why: ["Only you can say yes to this. I'm not allowed to click it for you."],
      showMe: true,
    },
    "done (fixed)": {
      phase: "done",
      receipt: {
        verdict: "done",
        headline: "Fixed. Your printer is Ready.",
        beforeAfter: [
          { label: "Printer", before: "Paused", after: "Ready" },
          { label: "Stuck jobs", before: "3 waiting", after: "None" },
        ],
        proofs: [
          { claim: "The printer is ready to print", checks: ["lpstat -p HP_LaserJet → idle, enabled", "lpstat -o → (empty)"] },
          { claim: "A test page was sent", checks: ["lp -d HP_LaserJet test.txt → request id HP_LaserJet-41"] },
        ],
        problems: [],
        reviewedBy: "claude",
      },
      steps: [],
      detail: [{ text: "✅ Allowed: cancel -a HP_LaserJet", mono: true }, { text: "✅ Allowed: cupsenable HP_LaserJet", mono: true }],
      canRetry: false,
      canSendSummary: true,
    },
    "done (not done)": {
      phase: "done",
      receipt: {
        verdict: "not-done",
        headline: "Zoom didn't finish installing.",
        beforeAfter: [{ label: "Zoom", before: "Not installed", after: "Not installed" }],
        proofs: [{ claim: "The download finished", checks: ["ls ~/Library/Caches/Homebrew → zoom.pkg"] }],
        problems: ["The installer needed your Mac password, and it wasn't entered.", "Zoom isn't in your Applications folder."],
        reviewedBy: "rules",
      },
      steps: [],
      detail: zoomDetail,
      canRetry: true,
      canSendSummary: true,
    },
    "done (can't verify)": {
      phase: "done",
      receipt: {
        verdict: "couldnt-verify",
        headline: "I did the steps, but couldn't check the result.",
        beforeAfter: [],
        proofs: [],
        problems: ["I can't see your Wi-Fi speed from here."],
        reviewedBy: "rules",
      },
      steps: [],
      detail: [],
      canRetry: true,
      canSendSummary: false,
    },
    error: { phase: "error", message: "I lost the connection to the internet. Please check your Wi-Fi and try again." },
    "agent-working": { phase: "working", goal: "My sound is coming out of my AirPods", current: 2, total: 2, openEnded: true, line: "Switching the sound to MacBook Air Speakers…", steps: [{ id: "1", text: "Checking your sound", status: "done" }, { id: "2", text: "Switching the sound to MacBook Air Speakers", status: "running" }], detail: [] },
    confirm: { phase: "confirm", title: "Move 146 files (8.8 MB) from your Downloads folder to the Trash?", message: "They go to the Trash, not deleted. You can drag them back out if you change your mind.", details: ["Holiday.mov (4.1 MB)", "receipt.pdf (300 KB)", "notes.txt (2 KB)"], yes: "Yes, move them", no: "No, keep them", tone: "danger" },
    "confirm-typed": { phase: "confirm", title: "Last check: type Downloads to confirm", message: "Type the word Downloads below to move 146 files (8.8 MB) from your Downloads folder to the Trash.", yes: "Move to Trash", no: "Cancel", typeToConfirm: "Downloads", tone: "danger" },
    "ask-note": { phase: "ask", question: "Deleting all your files can't be undone. What would you like to do?", note: "Permanently deleted files can't be brought back, including photos and documents. The safer thing I can do: find big old files and move the ones you pick to the Trash.", suggestions: ["Do the safer thing", "I still want to do it myself", "Never mind"], listening: false, transcribing: false },
    explain: { phase: "explain", title: "How to do it yourself: Empty the Trash", paragraphs: ["CalHack never does this itself, because it can't be undone. Here's how, step by step, if you're sure:"], steps: ["Click the Trash icon at the right end of the Dock.", "Look through what's inside. Drag back anything you want to keep.", "Click Empty in the top-right corner, then Empty Trash."] },
    "done-agent": { phase: "done", receipt: { verdict: "done", headline: "Done. Sound is now coming out of the Mac's speakers.", lines: ["The sound was going to your AirPods.", "I switched it to the MacBook Air Speakers.", "Your AirPods are still connected, so you can switch back any time."], beforeAfter: [{ label: "Sound goes to", before: "Dad's AirPods", after: "MacBook Air Speakers" }], proofs: [{ claim: "MacBook Air Speakers are in use", checks: ["list sound outputs"] }], problems: [], reviewedBy: "agent" }, steps: [], detail: [], canRetry: false, canSendSummary: false },
  };

  // ---------- Little animated runs ----------

  function playChecking() {
    clearTimers();
    const labels = ["Printer is connected", "Printer is turned on and ready", "Print jobs waiting", "Paper and ink"];
    const results = [["ok"], ["problem", "It's paused"], ["problem", "3 print jobs are stuck"], ["unknown", "I can't see the paper tray"]];
    const checks = labels.map((label) => ({ label, status: "pending" }));
    const push = () => emit("bar", { phase: "checking", title: "Let me check your printer", checks: checks.map((c) => ({ ...c })) });
    push();
    emit("say", { text: "Let me check a few things on your printer.", mode: "now" });
    labels.forEach((_, i) => {
      later(600 + i * 1400, () => { checks[i].status = "running"; push(); });
      later(1300 + i * 1400, () => { checks[i].status = results[i][0]; checks[i].detail = results[i][1]; push(); });
    });
    later(1300 + labels.length * 1400, () => { emit("bar", S["plan (fix)"]); emit("say", { text: "Your printer is paused and has 3 stuck jobs. I can fix that.", mode: "queue" }); });
  }

  function playWorking() {
    clearTimers();
    const lines = ["Checking whether Zoom is already here", "Downloading Zoom from zoom.us", "Installing Zoom into Applications", "Opening Zoom"];
    lines.forEach((line, i) => {
      later(i * 1800, () => {
        emit("bar", { phase: "working", goal: "Install Zoom", current: i + 1, total: 4, line, steps: withStatus(zoomSteps, i, true), detail: zoomDetail.slice(0, 2 + i * 2) });
        emit("say", { text: line + ".", mode: "queue" });
      });
    });
    later(lines.length * 1800, () => {
      emit("bar", {
        phase: "done",
        receipt: {
          verdict: "done",
          headline: "Zoom is installed and open.",
          beforeAfter: [{ label: "Zoom", before: "Not installed", after: "Installed, version 6.2.5" }],
          proofs: [{ claim: "Zoom is in your Applications folder", checks: ["test -d /Applications/zoom.us.app → yes"] }],
          problems: [],
          reviewedBy: "claude",
        },
        steps: withStatus(zoomSteps, 4, false),
        detail: zoomDetail,
        canRetry: false,
        canSendSummary: true,
      });
      emit("say", { text: "All done. Zoom is installed and open.", mode: "now" });
    });
  }

  // ---------- Fake app: how the real app might react ----------

  function fakeApp(channel, data) {
    if (channel === "bar-cancel") { clearTimers(); emit("bar", S.hidden); }
    else if (channel === "bar-ok") playWorking();
    else if (channel === "bar-stop") { clearTimers(); emit("bar", S["done (not done)"]); }
    else if (channel === "bar-answer") {
      clearTimers();
      emit("bar", { phase: "looking", message: "Got it: \"" + data.text + "\". One moment…" });
      later(1200, playChecking);
    } else if (channel === "bar-mic-start") emit("bar", { ...S.ask, suggestions: [], listening: true });
    else if (channel === "bar-mic-cancel") emit("bar", S.ask);
    else if (channel === "bar-mic-audio") {
      emit("bar", { ...S.ask, suggestions: [], transcribing: true });
      later(1200, () => emit("bar", { ...S["ask (heard)"] }));
    }
  }

  window.calhack = {
    send(channel, data) {
      const shown = data && data.wav ? { wav: "ArrayBuffer(" + data.wav.byteLength + " bytes)" } : data;
      log("→ " + channel + (shown !== undefined ? " " + JSON.stringify(shown) : ""));
      if (channel === "bar-rect") placeBuddy(data);
      setTimeout(() => fakeApp(channel, data), 0);
    },
    on(channel, cb) {
      (listeners[channel] = listeners[channel] || []).push(cb);
    },
  };

  // A fake mic: loudness wiggles while "recording".
  let levelFn = null;
  let levelTimer = 0;
  window.CalhackMic = {
    start() {
      return new Promise((resolve) => setTimeout(() => {
        levelTimer = setInterval(() => levelFn && levelFn(Math.random() * 0.9), 90);
        resolve();
      }, 60));
    },
    stop() {
      clearInterval(levelTimer);
      return Promise.resolve(new ArrayBuffer(32044));
    },
    cancel() { clearInterval(levelTimer); },
    onLevel(fn) { levelFn = fn; },
  };

  // Shows where the buddy would sit, from the rect the bar sends.
  function placeBuddy(r) {
    const buddy = document.getElementById("buddy");
    const stage = document.getElementById("stage");
    if (!buddy || !stage) return;
    // In the real window the page is the window; here the rect is already page-relative.
    buddy.hidden = false;
    buddy.style.left = r.x + 54 + "px";
    buddy.style.top = r.y + 8 + "px";
  }

  // ?cycle: show every state and press every button, to catch script errors.
  function selfTest() {
    let errors = 0;
    window.addEventListener("error", (e) => { errors++; console.error("SELFTEST error: " + e.message); });
    for (const name of Object.keys(S)) {
      emit("bar", JSON.parse(JSON.stringify(S[name])));
      for (const b of document.querySelectorAll("#card button")) {
        if (b.offsetParent === null) continue;
        emit("bar", JSON.parse(JSON.stringify(S[name])));
        const again = [...document.querySelectorAll("#card button")].find((x) => x.textContent === b.textContent && x.className === b.className);
        if (again) again.click();
      }
    }
    emit("say", { text: "One", mode: "queue" });
    emit("say", { text: "Two", mode: "now" });
    document.getElementById("mute").click();
    document.getElementById("mute").click();
    // Hold-to-talk: hold, then a quick tap (latch) and tap again, then Space.
    const sent = [];
    const realSend = window.calhack.send;
    window.calhack.send = (c, d) => { if (c.startsWith("bar-mic")) sent.push(c); realSend(c, d); };
    setTimeout(micTest, 1000); // after the fake app settles
    function micTest() {
    clearTimers();
    emit("bar", JSON.parse(JSON.stringify(S.ask)));
    const micBtn = document.querySelector(".mic");
    const p = (type) => micBtn.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }));
    const key = (type) => document.dispatchEvent(new KeyboardEvent(type, { key: " ", bubbles: true }));
    p("pointerdown");
    setTimeout(() => p("pointerup"), 600);
    setTimeout(() => { p("pointerdown"); p("pointerup"); }, 1200);
    setTimeout(() => { p("pointerdown"); p("pointerup"); }, 1800);
    setTimeout(() => { p("pointerdown"); p("pointerleave"); }, 2400);
    setTimeout(() => { emit("bar", JSON.parse(JSON.stringify(S.ask))); key("keydown"); }, 3000);
    setTimeout(() => key("keyup"), 3600);
    setTimeout(() => console.log("SELFTEST done, errors: " + errors + ", mic: " + sent.join(" ")), 4500);
    }
  }

  // ---------- Controls ----------

  document.addEventListener("DOMContentLoaded", () => {
    const states = document.getElementById("states");
    const extras = document.getElementById("extras");
    const btn = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    for (const name of Object.keys(S)) {
      states.append(btn(name, () => { clearTimers(); emit("bar", JSON.parse(JSON.stringify(S[name]))); }));
    }
    extras.append(
      btn("▶ play checking", playChecking),
      btn("▶ play working", () => { emit("bar", S["plan (install)"]); later(400, playWorking); }),
      btn("say (now)", () => emit("say", { text: "Okay! I'll fix your printer now. This takes about a minute.", mode: "now" })),
      btn("say 2 (queue)", () => {
        emit("say", { text: "First, I'll clear the stuck jobs.", mode: "queue" });
        emit("say", { text: "Then I'll turn the printer back on.", mode: "queue" });
      }),
      btn("hide buddy dot", () => { document.getElementById("buddy").hidden = true; }),
    );
    const tip = document.createElement("span");
    tip.textContent = "Dark mode follows your system setting.";
    tip.style.alignSelf = "center";
    extras.append(tip);

    // ?still freezes motion (for screenshots); ?tall shows a 620x560 window.
    if (/still/.test(location.search)) document.documentElement.classList.add("still");
    if (/tall/.test(location.search)) document.documentElement.classList.add("tall");
    // Open bar-preview.html#plan%20(fix) to start on a state.
    const start = decodeURIComponent(location.hash.slice(1));
    emit("bar", JSON.parse(JSON.stringify(S[start] || S.ask)));
    if (/details/.test(location.search)) document.getElementById("details-toggle").click();
    if (/cycle/.test(location.search)) selfTest();
    if (/say/.test(location.search)) emit("say", { text: "Okay! I'll fix your printer now. This takes about a minute.", mode: "now" });
  });
})();

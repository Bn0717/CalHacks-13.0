// The plan panel. All text is inserted as plain text (never HTML), because it comes from web pages.
const api = window.calhack;
const view = document.getElementById("view");

let state = { phase: "idle" };
const approvals = {}; // step id -> { detail, needsReview }
const manual = {}; // step id -> true
const progress = {}; // step id -> message
const needScreen = {}; // step id -> true when we can't see the screen

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Short words for how each step ended.
const STATUS = {
  "already-done": ["✅", "good", "Already done"],
  done: ["✅", "good", "Done"],
  "done-unverified": ["✅", "good", "Done"],
  failed: ["❌", "bad", "Didn't work"],
  blocked: ["⛔", "bad", "Blocked"],
  skipped: ["⏭️", "neutral", "Skipped"],
  declined: ["✋", "neutral", "You said no"],
  "not-for-this-computer": ["🚫", "neutral", "Not for this Mac"],
  "waiting-for-user": ["⏳", "neutral", "Waiting for you"],
};

/** One short line saying what will happen to this step. */
function plannedLine(step) {
  if (step.kind === "info") return ["ℹ️", "neutral", "Tip"];
  if (step.kind === "manual") return step.recipe ? ["🤖", "good", "I'll do this: " + step.recipe] : ["👆", "neutral", "You click this"];
  if (step.level === "blocked") return ["⛔", "bad", step.flags[0] || "Won't run"];
  if (step.notNeeded) return ["⏭️", "neutral", "Not needed"];
  if (step.flags.length) return ["⚠️", "warn", step.flags[0]];
  return ["▶️", "good", "Will run"];
}

function stepRow(step, index) {
  const ask = approvals[step.id];
  const waiting = manual[step.id];
  const [icon, tone, text] = step.status ? STATUS[step.status] || ["•", "neutral", step.status] : plannedLine(step);
  const command = step.useUpdated && step.outdated?.suggestion ? step.outdated.suggestion : step.command || step.url;

  const row = el("div", { class: "step" + (ask || waiting ? " active" : "") },
    el("div", { class: "step-head" },
      el("span", { class: "num" }, index + 1 + "."),
      el("span", { class: "title" }, step.title),
    ),
    el("div", { class: "line " + tone }, icon + " " + text),
  );

  if (progress[step.id] && !step.status) row.append(el("div", { class: "progress" }, progress[step.id]));

  if (ask) {
    row.append(
      el("div", { class: "ask-box" },
        el("b", {}, "⚠️ Flagged"),
        step.flags.map((f) => el("div", {}, "• " + f)),
        command ? el("pre", {}, command) : null,
        el("p", {}, "Run it anyway?"),
        el("div", { class: "row" },
          el("button", { class: "yes", onclick: () => respond(step.id, true) }, "Run it"),
          el("button", { onclick: () => respond(step.id, false) }, "Don't run"),
        ),
      ),
    );
  }
  if (waiting) {
    row.append(
      el("div", { class: "ask-box" },
        el("b", {}, "Your turn"),
        step.note ? el("p", { class: "muted" }, step.note) : null,
        step.clickTarget ? el("p", {}, "Click “" + step.clickTarget + "”.") : el("p", {}, step.explanation),
        needScreen[step.id]
          ? el("div", { class: "banner ask" },
              el("b", {}, "I can't see your screen yet"),
              el("div", {}, "1. Turn on Screen Recording for the app you started me from (Terminal or VS Code)."),
              el("div", {}, "2. Quit that app and open it again."),
              el("div", {}, "3. Run npm start again."),
              el("button", { onclick: () => api.send("open-privacy") }, "Open Screen Recording settings"),
            )
          : null,
        el("div", { class: "row" },
          step.clickTarget ? el("button", { onclick: () => api.send("show-me", { id: step.id }) }, "👉 Show me") : null,
          step.hasSettingsLink ? el("button", { onclick: () => api.send("open-settings", { id: step.id }) }, "Open Settings") : null,
          el("button", { class: "yes", onclick: () => manualDone(step.id, "done") }, "Done"),
          el("button", { onclick: () => manualDone(step.id, "skip") }, "Skip"),
        ),
      ),
    );
  }

  // Everything else stays folded away.
  const more = [];
  if (step.explanation) more.push(el("p", {}, step.explanation));
  if (command) more.push(el("pre", {}, command));
  if (step.outdated?.suggestion) {
    more.push(
      el("p", { class: "muted" }, "🕰️ Old command. Using the new one."),
      el("label", { class: "switch" },
        el("input", { type: "checkbox", checked: step.useUpdated, disabled: state.running, onchange: (e) => api.send("toggle-updated", { id: step.id, value: e.target.checked }) }),
        "Use the new command",
      ),
    );
  }
  if (step.reasons.length && step.kind !== "manual" && step.kind !== "info") more.push(el("ul", { class: "reasons" }, step.reasons.map((r) => el("li", {}, r))));
  if (step.status && step.message) more.push(el("p", { class: "muted" }, step.message));
  if (step.output) more.push(el("pre", {}, step.output));
  if (more.length) row.append(el("details", { open: step.status === "failed" ? true : null }, el("summary", {}, "Details"), ...more));
  return row;
}

function respond(id, yes) {
  delete approvals[id];
  api.send("approve-response", { id, yes });
  render();
}

function manualDone(id, answer) {
  delete manual[id];
  api.send("manual-response", { id, answer });
  render();
}

function scamBanner(s) {
  const scam = s.pageWarnings.filter((w) => w.level === "blocked");
  if (!scam.length) return null;
  return el("div", { class: "banner blocked" }, el("b", {}, "⛔ This looks like a scam"), el("div", {}, "Nothing here will run. Don't paste anything from this page."));
}

const BAD = ["failed", "blocked", "declined"];
let stepsOpen = false; // Is "See steps" unfolded? Kept between redraws.

function stepsFold(steps, skipId) {
  const rows = steps.map((st, i) => (st.id === skipId ? null : stepRow(st, i))).filter(Boolean);
  if (!rows.length) return null;
  const fold = el("details", { class: "steps-fold", open: stepsOpen || null }, el("summary", {}, "See steps (" + steps.length + ")"), ...rows);
  fold.addEventListener("toggle", () => (stepsOpen = fold.open));
  return fold;
}

/** Before running: what it'll do, in one or two lines, then "Do it". */
function summaryLines(s) {
  const left = s.steps.filter((st) => !st.status && st.kind !== "info" && !st.notNeeded && !st.wrongPlatform);
  const risky = left.filter((st) => (st.kind === "command" || st.kind === "download") && (st.level === "blocked" || st.flags.length));
  const yours = left.filter((st) => st.kind === "manual" && !st.recipe);
  const done = s.steps.filter((st) => st.status === "already-done").length;
  const lines = [el("p", {}, "I'll do " + (left.length === 1 ? "it" : "all " + left.length + " steps") + " for you" + (done ? " (" + done + " already done)." : "."))];
  if (risky.length) lines.push(el("p", { class: "line warn" }, "⚠️ " + (risky.length === 1 ? "1 step looks risky" : risky.length + " steps look risky") + ". I'll ask you about " + (risky.length === 1 ? "it" : "them") + " first."));
  if (yours.length) lines.push(el("p", { class: "line neutral" }, "👆 " + (yours.length === 1 ? "1 step" : yours.length + " steps") + " you'll click yourself. I'll point to where."));
  return lines;
}

function renderPlan() {
  const s = state;
  const scam = scamBanner(s);
  const work = s.steps.filter((st) => st.kind !== "info");
  const started = s.running || s.proof || s.steps.some((st) => st.status && st.status !== "already-done");
  const allDone = work.length > 0 && work.every((st) => st.status);
  const parts = [];
  if (scam) parts.push(scam);
  parts.push(el("h1", {}, s.goal || "Follow these steps"), el("p", { class: "muted" }, "From " + s.sourceLabel));

  // 1. Before running.
  if (!started) {
    if (allDone) {
      parts.push(el("div", { class: "banner good" }, "✅ Already done on this Mac. Nothing to do."));
    } else if (!scam) {
      parts.push(...summaryLines(s));
      const notes = s.pageWarnings.filter((w) => w.level !== "blocked");
      if (notes.length) parts.push(el("div", { class: "banner ask" }, notes.map((w) => el("div", {}, "• " + w.reason))));
    }
    parts.push(stepsFold(s.steps));
    parts.push(
      el("div", { class: "row sticky" },
        allDone || scam ? null : el("button", { class: "primary big", onclick: () => api.send("run-all") }, "Do it"),
        el("button", { onclick: () => api.send("close-panel") }, allDone || scam ? "Close" : "Cancel"),
      ),
    );
    return parts;
  }

  // 2. Running: one line, unless a step needs the person.
  if (s.running) {
    const waiting = s.steps.find((st) => approvals[st.id] || manual[st.id]);
    const current = s.steps.find((st) => !st.status && st.kind !== "info");
    if (waiting) {
      parts.push(el("p", { class: "muted" }, approvals[waiting.id] ? "I need your OK for this one:" : "I need you for this one:"));
      parts.push(stepRow(waiting, s.steps.indexOf(waiting)));
    } else if (current) {
      const n = work.indexOf(current) + 1;
      parts.push(
        el("div", { class: "working" },
          el("div", { class: "spinner" }),
          el("div", {},
            el("div", {}, "Step " + n + " of " + work.length + ": " + current.title),
            el("div", { class: "muted" }, progress[current.id] || "Working…"),
          ),
        ),
      );
    }
    parts.push(stepsFold(s.steps, waiting?.id));
    parts.push(el("div", { class: "row sticky" }, el("button", { class: "danger", onclick: () => api.send("stop") }, "Stop")));
    return parts;
  }

  // 3. Finished: proof, or where it stopped.
  const bad = s.steps.find((st) => BAD.includes(st.status));
  if (s.proof) {
    parts.push(
      el("div", { class: "banner proof " + (s.proof.ok ? "good" : "ask") },
        el("b", {}, (s.proof.ok ? "✅ " : "⚠️ ") + s.proof.lines[0]),
        s.proof.lines.slice(1).map((l) => el("div", {}, l)),
      ),
    );
  } else if (bad) {
    parts.push(el("div", { class: "banner ask" }, el("b", {}, "Stopped at step " + (s.steps.indexOf(bad) + 1) + ": " + bad.title), bad.message ? el("div", {}, bad.message) : null));
    parts.push(stepRow(bad, s.steps.indexOf(bad)));
  } else {
    parts.push(el("div", { class: "banner ask" }, "Stopped. Nothing else was changed."));
  }
  parts.push(stepsFold(s.steps, bad && !s.proof ? bad.id : null));
  parts.push(
    el("div", { class: "row sticky" },
      s.proof?.ok ? null : el("button", { class: "primary", disabled: !!scam, onclick: () => api.send("run-all") }, "Try again"),
      el("button", { onclick: () => api.send("close-panel") }, "Close"),
    ),
  );
  return parts;
}

function render() {
  const s = state;
  let parts = [];
  if (s.phase === "idle") {
    parts = [
      el("div", { class: "center" },
        el("h2", {}, "Stuck on some steps?"),
        s.note ? el("p", {}, s.note) : null,
        el("p", {}, "Open the how-to and press ", ...[...(s.hotkey || "⌃⌥D")].flatMap((k, i) => (i ? [" ", el("kbd", {}, k)] : [el("kbd", {}, k)])), "."),
        el("p", { class: "muted" }, "I'll read it, check it's safe, do it for you, and show you it worked."),
        s.hasKey === false ? el("p", { class: "status bad" }, "No Claude API key yet: add it to the .env file.") : null,
        s.screenAllowed === false ? el("div", {}, el("p", { class: "muted" }, "Screen Recording is off, so I can only read web pages, documents and copied text."), el("button", { onclick: () => api.send("open-privacy") }, "Turn on Screen Recording")) : null,
      ),
    ];
  } else if (s.phase === "reading") {
    parts = [el("div", { class: "center" }, el("div", { class: "spinner" }), el("p", {}, s.message))];
  } else if (s.phase === "permission") {
    parts = [el("div", { class: "center" }, el("p", {}, s.message), el("button", { onclick: () => api.send("open-privacy") }, "Open Privacy settings"), el("p", { class: "muted" }, "After turning it on, quit and reopen CalHack."))];
  } else if (s.phase === "error") {
    parts = [el("div", { class: "center" }, el("p", { class: "status bad" }, "⚠️ " + s.message), el("p", { class: "muted" }, "Press " + (s.hotkey || "⌃⌥D") + " to try again."))];
  } else if (s.phase === "plan") {
    parts = renderPlan();
  }
  view.replaceChildren(...parts);
}

api.on("state", (s) => {
  if (s.phase !== "plan") {
    for (const k of Object.keys(approvals)) delete approvals[k];
    for (const k of Object.keys(manual)) delete manual[k];
  }
  if (s.phase === "plan") {
    for (const st of s.steps) if (st.status) delete progress[st.id];
  }
  state = s;
  render();
});
api.on("approve-request", ({ id, detail, needsReview }) => {
  approvals[id] = { detail, needsReview };
  render();
});
api.on("manual-request", ({ id }) => {
  manual[id] = true;
  render();
});
api.on("step-progress", ({ id, message, needsScreen }) => {
  progress[id] = message;
  if (needsScreen) needScreen[id] = true;
  else delete needScreen[id];
  render();
});
api.on("finished", () => render());

document.getElementById("close").addEventListener("click", () => api.send("close-panel"));
render();

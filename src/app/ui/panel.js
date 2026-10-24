// The plan panel. All text is inserted as plain text (never HTML), because it comes from web pages.
const api = window.calhack;
const view = document.getElementById("view");

let state = { phase: "idle" };
const approvals = {}; // step id -> { detail, needsReview }
const manual = {}; // step id -> true
const progress = {}; // step id -> message

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

const LEVEL_LABEL = { safe: "🟢 Safe", ask: "🟡 Asks first", blocked: "🔴 Blocked" };
const STATUS = {
  "already-done": ["✅", "good"],
  done: ["✅", "good"],
  "done-unverified": ["☑️", "good"],
  failed: ["❌", "bad"],
  blocked: ["⛔", "bad"],
  skipped: ["⏭️", "neutral"],
  declined: ["✋", "neutral"],
  "not-for-this-computer": ["🚫", "neutral"],
  "waiting-for-user": ["⏳", "neutral"],
};

function badge(step) {
  if (step.kind === "manual") return el("span", { class: "badge info" }, "👆 You click");
  if (step.kind === "info") return el("span", { class: "badge info" }, "ℹ️ Info");
  return el("span", { class: "badge " + step.level }, LEVEL_LABEL[step.level]);
}

function stepCard(step, index) {
  const ask = approvals[step.id];
  const waiting = manual[step.id];
  const card = el("div", { class: "step" + (ask || waiting ? " active" : "") },
    el("div", { class: "step-head" }, el("span", { class: "num" }, index + 1 + "."), el("span", { class: "title" }, step.title), badge(step)),
    el("p", {}, step.explanation),
  );

  if (step.command) card.append(el("pre", {}, step.command));
  if (step.url) card.append(el("pre", {}, "⬇️ " + step.url));
  if (step.kind === "manual" && step.clickTarget) card.append(el("p", { class: "muted" }, "Click: “" + step.clickTarget + "”"));

  if (step.outdated) {
    const box = el("div", { class: "outdated" }, "🕰️ " + step.outdated.reason);
    if (step.outdated.suggestion) {
      box.append(
        el("pre", {}, step.outdated.suggestion),
        el("label", { class: "switch" },
          el("input", { type: "checkbox", checked: step.useUpdated, disabled: state.running, onchange: (e) => api.send("toggle-updated", { id: step.id, value: e.target.checked }) }),
          "Use the updated command",
        ),
      );
    }
    card.append(box);
  }

  const reasons = step.reasons.filter((r) => !step.outdated || r !== step.outdated.reason);
  if (reasons.length && step.kind !== "manual" && step.kind !== "info") {
    card.append(el("ul", { class: "reasons" }, reasons.map((r) => el("li", {}, r))));
  }
  if (step.checkCommand) card.append(el("div", { class: "check" }, "We'll check it with: ", el("code", {}, step.checkCommand)));

  if (ask) {
    card.append(
      el("div", { class: "ask-box" },
        el("b", {}, step.kind === "download" ? "OK to go ahead?" : "Run this on your Mac?"),
        ask.needsReview ? el("p", { class: "muted" }, "We read this from a screenshot. Check it matches the instructions exactly.") : null,
        ask.detail && ask.detail !== step.command ? el("p", { class: "muted" }, ask.detail) : null,
        el("div", { class: "row" },
          el("button", { class: "yes", onclick: () => respond(step.id, true) }, "Yes, do it"),
          el("button", { onclick: () => respond(step.id, false) }, "No"),
        ),
      ),
    );
  }

  if (waiting) {
    card.append(
      el("div", { class: "ask-box" },
        el("b", {}, "Your turn"),
        el("p", { class: "muted" }, "Follow the arrow on your screen. I won't click anything for you."),
        el("div", { class: "row" },
          step.clickTarget ? el("button", { onclick: () => api.send("show-me", { id: step.id }) }, "👉 Show me") : null,
          step.hasSettingsLink ? el("button", { onclick: () => api.send("open-settings", { id: step.id }) }, "Open Settings") : null,
          el("button", { class: "yes", onclick: () => manualDone(step.id, "done") }, "I did it"),
          el("button", { onclick: () => manualDone(step.id, "skip") }, "Skip"),
        ),
      ),
    );
  }

  if (progress[step.id] && !step.status) card.append(el("div", { class: "progress" }, progress[step.id]));
  if (step.status) {
    const [icon, tone] = STATUS[step.status] || ["•", "neutral"];
    card.append(el("div", { class: "status " + tone }, icon + " " + step.message));
    if (step.output) card.append(el("details", {}, el("summary", {}, "Show output"), el("pre", {}, step.output)));
  }
  return card;
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

function renderPlan() {
  const s = state;
  const parts = [];
  parts.push(el("h2", {}, s.goal || "Here's the plan"));
  parts.push(el("p", { class: "muted" }, "From " + s.sourceLabel + (s.fromCache ? " · using a saved answer (offline)" : "")));

  const blockedWarnings = s.pageWarnings.filter((w) => w.level === "blocked");
  const otherWarnings = s.pageWarnings.filter((w) => w.level !== "blocked");
  if (blockedWarnings.length) {
    parts.push(el("div", { class: "banner blocked" }, el("b", {}, "⛔ This page looks like a scam. Nothing on it will run."), blockedWarnings.map((w) => el("div", {}, "• " + w.reason))));
  }
  if (!s.appliesToThisComputer) {
    parts.push(el("div", { class: "banner ask" }, el("b", {}, "These instructions may not be for this Mac."), "Check each step before saying yes."));
  }
  if (otherWarnings.length) {
    parts.push(el("div", { class: "banner ask" }, el("b", {}, "Things to know"), otherWarnings.map((w) => el("div", {}, "• " + w.reason))));
  }

  const counts = { safe: 0, ask: 0, blocked: 0 };
  for (const st of s.steps) if (st.kind === "command" || st.kind === "download") counts[st.level]++;
  parts.push(el("p", { class: "muted" }, `${s.steps.length} steps · ${counts.safe} safe · ${counts.ask} ask first · ${counts.blocked} blocked`));

  const allDone = s.steps.length > 0 && s.steps.every((st) => st.status);
  parts.push(
    el("div", { class: "row" },
      s.running
        ? el("button", { class: "danger", onclick: () => api.send("stop") }, "Stop after this step")
        : el("button", { class: "primary", disabled: blockedWarnings.length > 0 || s.steps.length === 0, onclick: () => api.send("run-all") }, allDone ? "Run again" : "Do this for me"),
    ),
  );
  parts.push(el("div", { class: "spacer" }));
  s.steps.forEach((st, i) => parts.push(stepCard(st, i)));

  if (!s.running && allDone) {
    const bad = s.steps.filter((st) => ["failed", "blocked", "declined"].includes(st.status));
    parts.push(el("div", { class: "banner " + (bad.length ? "ask" : "") }, bad.length ? "Stopped early. See the step marked above." : "🎉 All done, and every step we could check worked."));
  }
  return parts;
}

function render() {
  const s = state;
  let parts = [];
  if (s.phase === "idle") {
    parts = [
      el("div", { class: "center" },
        el("h2", {}, "Stuck on some instructions?"),
        el("p", {}, "Open the how-to (a web page, PDF or document) and press ", el("kbd", {}, "⌃"), " ", el("kbd", {}, "⌥"), " ", el("kbd", {}, "D"), "."),
        el("p", { class: "muted" }, "I'll read it, check every step is safe, and do it with you. I'll also warn you if you copy a dangerous command."),
        s.hasKey === false ? el("p", { class: "status bad" }, "No Claude API key yet: add it to the .env file.") : null,
        s.screenAllowed === false ? el("div", {}, el("p", { class: "muted" }, "Screen Recording is off, so I can only read web pages, documents and copied text."), el("button", { onclick: () => api.send("open-privacy") }, "Turn on Screen Recording")) : null,
      ),
    ];
  } else if (s.phase === "reading") {
    parts = [el("div", { class: "center" }, el("div", { class: "spinner" }), el("p", {}, s.message))];
  } else if (s.phase === "permission") {
    parts = [el("div", { class: "center" }, el("p", {}, s.message), el("button", { onclick: () => api.send("open-privacy") }, "Open Privacy settings"), el("p", { class: "muted" }, "After turning it on, quit and reopen CalHack."))];
  } else if (s.phase === "error") {
    parts = [el("div", { class: "center" }, el("p", { class: "status bad" }, "⚠️ " + s.message), el("p", { class: "muted" }, "Press ⌃⌥D to try again."))];
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
api.on("step-progress", ({ id, message }) => {
  progress[id] = message;
  render();
});
api.on("finished", () => render());

document.getElementById("close").addEventListener("click", () => api.send("close-panel"));
render();

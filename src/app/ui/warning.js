// The "Stop! Don't paste that." pop-up.
const api = window.calhack;
let confirmRestore = false;

api.on("warning", ({ reasons, command }) => {
  confirmRestore = false;
  document.getElementById("restore").textContent = "I trust it, copy it back";
  document.getElementById("reasons").replaceChildren(...reasons.map((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    return li;
  }));
  document.getElementById("command").textContent = command;
});

document.getElementById("ok").addEventListener("click", () => api.send("warning-close"));
document.getElementById("restore").addEventListener("click", (e) => {
  // Ask twice, so it's never one accidental click.
  if (!confirmRestore) {
    confirmRestore = true;
    e.target.textContent = "Are you sure? Click again";
    return;
  }
  api.send("warning-restore");
});

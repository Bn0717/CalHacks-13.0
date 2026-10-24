// The only bridge between our pages and the app. Pages can use just these channels.
const { contextBridge, ipcRenderer } = require("electron");

const TO_APP = new Set([
  "run-all", "toggle-recipe", "stop", "approve-response", "manual-response", "show-me", "open-settings",
  "toggle-updated", "close-panel", "open-privacy", "warning-close", "warning-restore",
  // Helper bar (see protocol.ts).
  "bar-ok", "bar-cancel", "bar-stop", "bar-retry", "bar-answer", "bar-approve", "bar-manual",
  "bar-send-summary", "bar-mic-start", "bar-mic-audio", "bar-mic-cancel", "bar-rect",
  "bar-confirm", "bar-explain-ok",
]);
const FROM_APP = new Set(["state", "approve-request", "manual-request", "step-progress", "finished", "warning", "bar", "say"]);

contextBridge.exposeInMainWorld("calhack", {
  synthesize(text) {
    return ipcRenderer.invoke("voice-synthesize", text);
  },
  send(channel, data) {
    if (TO_APP.has(channel)) ipcRenderer.send(channel, data);
  },
  on(channel, callback) {
    if (FROM_APP.has(channel)) ipcRenderer.on(channel, (_event, data) => callback(data));
  },
});

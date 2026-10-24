// The only bridge between our pages and the app. Pages can use just these channels.
const { contextBridge, ipcRenderer } = require("electron");

const TO_APP = new Set([
  "run-all", "stop", "approve-response", "manual-response", "show-me", "open-settings",
  "toggle-updated", "close-panel", "open-privacy", "warning-close", "warning-restore",
]);
const FROM_APP = new Set(["state", "approve-request", "manual-request", "step-progress", "finished", "point", "point-hide", "warning"]);

contextBridge.exposeInMainWorld("calhack", {
  send(channel, data) {
    if (TO_APP.has(channel)) ipcRenderer.send(channel, data);
  },
  on(channel, callback) {
    if (FROM_APP.has(channel)) ipcRenderer.on(channel, (_event, data) => callback(data));
  },
});

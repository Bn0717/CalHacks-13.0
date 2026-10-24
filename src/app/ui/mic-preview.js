// Wires the mic test page to window.CalhackMic.
const $ = (id) => document.getElementById(id);
const talk = $("talk");
const status = $("status");
let recording = false;
let lastUrl = null;

CalhackMic.onLevel((v) => {
  $("meter").value = v;
  $("lvl").textContent = v.toFixed(2);
});

async function begin(e) {
  e.preventDefault();
  if (recording) return;
  recording = true;
  status.textContent = "Starting mic…";
  try {
    await CalhackMic.start();
    status.textContent = recording ? "Listening… let go to stop." : "Stopped.";
    if (!recording) CalhackMic.cancel();
  } catch (err) {
    recording = false;
    status.textContent = err.message;
  }
}

async function end() {
  if (!recording) return;
  recording = false;
  try {
    const t = performance.now();
    const wav = await CalhackMic.stop();
    const secs = ((wav.byteLength - 44) / 32000).toFixed(1);
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    $("play").src = lastUrl;
    $("play").hidden = false;
    $("download").href = lastUrl;
    $("download").hidden = false;
    status.textContent = `Got ${secs} s of audio (${wav.byteLength} bytes, encoded in ${Math.round(performance.now() - t)} ms).`;
  } catch (err) {
    status.textContent = err.message;
  }
}

talk.addEventListener("pointerdown", begin);
talk.addEventListener("pointerup", end);
talk.addEventListener("pointerleave", end);
talk.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) begin(e); });
talk.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") end(); });
$("cancel").addEventListener("click", () => {
  recording = false;
  CalhackMic.cancel();
  status.textContent = "Cancelled.";
});

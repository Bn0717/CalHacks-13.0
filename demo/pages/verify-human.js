// Like the real scam: ticking the box copies the "verification code" to the clipboard.
document.getElementById("check").addEventListener("change", async () => {
  const code = document.getElementById("code").textContent;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // Some browsers need a click on the code instead.
  }
  document.getElementById("steps").hidden = false;
});
document.getElementById("code").addEventListener("click", (e) => navigator.clipboard.writeText(e.target.textContent));

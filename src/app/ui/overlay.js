// Draws a pulsing ring and an arrow at the spot the person should click.
const ring = document.getElementById("ring");
const arrow = document.getElementById("arrow");
const label = document.getElementById("label");

const parts = [ring, arrow, label];

window.calhack.on("point", ({ x, y, label: text }) => {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Start everything near the panel (top right), then glide to the target so the eye can follow.
  const shown = ring.style.display === "block";
  if (!shown) {
    for (const p of parts) p.style.transition = "none";
    ring.style.left = w - 240 + "px";
    ring.style.top = "120px";
    arrow.style.left = w - 390 + "px";
    arrow.style.top = "-30px";
    label.style.left = w - 420 + "px";
    label.style.top = "60px";
    for (const p of parts) p.style.display = "block";
    void ring.offsetWidth; // apply the start position before moving
    for (const p of parts) p.style.transition = "";
  }

  ring.style.left = x + "px";
  ring.style.top = y + "px";

  // Arrow comes from the top-left of the target, or flips when the target is near that edge.
  const flipX = x < 140;
  const flipY = y < 140;
  arrow.style.transform = `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
  arrow.style.left = (flipX ? x + 30 : x - 150) + "px";
  arrow.style.top = (flipY ? y + 30 : y - 150) + "px";

  label.textContent = "Click “" + text + "”";
  label.style.display = "block";
  const lw = label.offsetWidth;
  label.style.left = Math.min(Math.max(8, (flipX ? x + 40 : x - 150) - lw / 2 + 60), w - lw - 8) + "px";
  label.style.top = Math.min(Math.max(8, flipY ? y + 160 : y - 190), h - 40) + "px";

  ring.style.display = "block";
  arrow.style.display = "block";
});

// Hidden between steps, so the next arrow glides in again.
window.calhack.on("point-hide", () => {
  for (const p of parts) p.style.display = "none";
});

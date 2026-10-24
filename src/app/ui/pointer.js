// Draws the ring and label where the app says. Text is inserted as text, never as HTML.
(() => {
  const spot = document.getElementById("spot");
  const label = document.getElementById("label");
  window.calhack.on("pointer", (p) => {
    if (!p || !p.show) {
      spot.classList.add("is-hidden");
      return;
    }
    spot.style.left = `${Math.round(p.x)}px`;
    spot.style.top = `${Math.round(p.y)}px`;
    label.textContent = String(p.label || "Click here");
    // Near the bottom, put the label above the ring so it stays on screen.
    spot.classList.toggle("above", p.y > window.innerHeight - 120);
    // Keep the label inside the screen at the left and right edges.
    const half = 170;
    label.style.marginLeft = p.x < half ? `${half - p.x}px` : p.x > window.innerWidth - half ? `${window.innerWidth - half - p.x}px` : "0";
    spot.classList.remove("is-hidden");
  });
})();

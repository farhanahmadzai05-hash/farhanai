// Intro screen. Shown every time the page opens; any key, click or tap enters the chat.
// That first press also counts as the click browsers need before music can play.
(() => {
  const splash = document.getElementById("splash");
  const svg = document.getElementById("splash-title");
  const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  document.getElementById("splash-hint").textContent = touch ? "Tap the screen to continue" : "Press any key to continue";

  // "FARHAN AI" drawn with thin lines; the A's are plain triangles. Letters are 80 units tall.
  const letters = [
    "M6 80V1.3H56M6 40H48", // F
    "M142 2.6L183 78.7H101Z", // A (the triangle we dive into)
    "M232 80V1.3H266a19 19 0 0 1 0 38H232M262 39.3L288 80", // R
    "M334 0V80M394 0V80M334 40H394", // H
    "M482 2.6L523 78.7H441Z", // A
    "M572 80V0L628 80V0", // N
    "M772 2.6L813 78.7H731Z", // A
    "M860 0V80", // I
  ];
  const DIVE_X = 142; // middle of the first triangle's inside
  const DIVE_Y = 54;
  const INNER_RADIUS = 18; // clear black space inside the triangle, in the same units

  const group = (cls, drawn) =>
    `<g class="${cls}">${letters
      .map((d, i) => `<path d="${d}"${drawn ? ` pathLength="1" style="animation-delay:${0.1 + i * 0.09}s"` : ""}/>`)
      .join("")}</g>`;
  svg.setAttribute("viewBox", "-8 -14 878 108");
  svg.innerHTML =
    `<defs><linearGradient id="splash-metal" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="80">` +
    `<stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#e3e8ff"/><stop offset="1" stop-color="#aeb9e6"/>` +
    `</linearGradient></defs>` +
    group("glow wide") +
    group("glow mid") +
    group("line", true);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let leaving = false;

  function show() {
    leaving = false;
    splash.getAnimations({ subtree: true }).forEach((a) => a.id === "leave" && a.cancel());
    splash.classList.remove("leaving");
    document.body.classList.remove("entering");
    splash.hidden = false;
    window.addEventListener("keydown", enter, true);
  }

  function finish() {
    splash.hidden = true;
    document.body.classList.add("entering");
    document.getElementById("input")?.focus();
  }

  async function enter(e) {
    if (e.type === "keydown") e.preventDefault(); // don't type the key into the chat box
    if (leaving) return;
    leaving = true;
    window.removeEventListener("keydown", enter, true);
    splash.classList.add("leaving");

    const play = (el, frames, opts) => {
      const a = el.animate(frames, { fill: "forwards", ...opts });
      a.id = "leave";
      return a.finished;
    };

    if (reduceMotion) {
      await play(splash, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
      return finish();
    }

    // Aim at the inside of the first triangle and work out how far to zoom so it covers the screen.
    const ctm = svg.getScreenCTM();
    const box = svg.getBoundingClientRect();
    const point = new DOMPoint(DIVE_X, DIVE_Y).matrixTransform(ctm);
    const unitsToPx = ctm.a;
    const halfDiagonal = Math.hypot(innerWidth, innerHeight) / 2;
    const zoom = (halfDiagonal / (INNER_RADIUS * unitsToPx)) * 1.15;
    svg.style.transformOrigin = `${point.x - box.left}px ${point.y - box.top}px`;

    // Scale grows exponentially so the dive feels like constant speed, not a sudden jump.
    const steps = 24;
    const frames = Array.from({ length: steps + 1 }, (_, i) => ({ transform: `scale(${Math.pow(zoom, i / steps)})` }));

    const fades = [".splash-grid", ".splash-tagline", ".splash-hint"].map((s) =>
      play(splash.querySelector(s), [{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: "ease-out" }),
    );
    await Promise.all([...fades, play(svg, frames, { duration: 1500, easing: "cubic-bezier(0.55, 0, 0.75, 1)" })]);
    await new Promise((r) => setTimeout(r, 250)); // a beat of pure black
    finish();
  }

  splash.addEventListener("pointerdown", enter);
  show();
  // Browsers can restore a page from memory when you come back to it; show the intro then too.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) show();
  });
})();

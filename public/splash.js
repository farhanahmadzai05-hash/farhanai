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
  const VIEW = [-8, -14, 878, 108];
  svg.setAttribute("viewBox", VIEW.join(" "));
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
    splash.querySelector(".dive")?.remove();
    svg.querySelector(".line").style.visibility = "";
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

    // The dive redraws the title at screen size every frame by shrinking the SVG's viewBox
    // around the first triangle. Scaling the element itself would make the browser paint a
    // picture hundreds of times bigger than the screen, which is what made phones stutter.
    const box = svg.getBoundingClientRect();
    const k = VIEW[2] / box.width; // SVG units per screen pixel
    const W = innerWidth * k;
    const H = innerHeight * k;
    const x0 = VIEW[0] - box.left * k;
    const y0 = VIEW[1] - box.top * k;
    const zoom = (Math.hypot(W, H) / 2 / INNER_RADIUS) * 1.1;

    const dive = svg.cloneNode(true);
    dive.removeAttribute("id");
    dive.classList.add("dive");
    // Leave the soft glow behind: huge see-through strokes are what's slow to draw.
    dive.querySelectorAll(".glow").forEach((g) => g.remove());
    dive.setAttribute("preserveAspectRatio", "none");
    const frameAt = (z) => {
      const w = W / z;
      const h = H / z;
      dive.setAttribute("viewBox", `${DIVE_X - (DIVE_X - x0) / z} ${DIVE_Y - (DIVE_Y - y0) / z} ${w} ${h}`);
    };
    frameAt(1);
    splash.appendChild(dive);
    svg.querySelector(".line").style.visibility = "hidden";

    const fades = ["#splash-title", ".splash-grid", ".splash-tagline", ".splash-hint"].map((s) =>
      play(splash.querySelector(s), [{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: "ease-out" }),
    );
    const DURATION = 1400;
    await new Promise((done) => {
      const start = performance.now();
      const step = (now) => {
        if (!leaving) return done();
        const t = Math.min(1, (now - start) / DURATION);
        const eased = t * t * (3 - 2 * t); // smooth start and finish
        frameAt(Math.pow(zoom, eased)); // exponential, so it feels like a steady dive
        if (t < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    await Promise.all(fades);
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

// Intro screen. Shown every time the page opens; any key, click or tap enters the chat.
// That first press also counts as the click browsers need before music can play.
(() => {
  const splash = document.getElementById("splash");
  const title = splash.querySelector(".splash-title");
  const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  document.getElementById("splash-hint").textContent = touch ? "Tap the screen to continue" : "Press any key to continue";

  let leaving = false;

  function show() {
    leaving = false;
    splash.classList.remove("leaving");
    title.style.transformOrigin = "";
    splash.hidden = false;
    window.addEventListener("keydown", enter, true);
  }

  function enter(e) {
    if (e.type === "keydown") e.preventDefault(); // don't type the key into the chat box
    if (leaving) return;
    leaving = true;
    window.removeEventListener("keydown", enter, true);

    // Zoom into the F's upright stroke.
    const f = splash.querySelector(".splash-f").getBoundingClientRect();
    const t = title.getBoundingClientRect();
    title.style.transformOrigin = `${f.left - t.left + f.width * 0.25}px ${f.top - t.top + f.height * 0.6}px`;
    splash.classList.add("leaving");
  }

  splash.addEventListener("animationend", (ev) => {
    if (ev.target !== splash || !leaving) return;
    splash.hidden = true;
    document.getElementById("input")?.focus();
  });
  splash.addEventListener("pointerdown", enter);

  show();
  // Browsers can restore a page from memory when you come back to it; show the intro then too.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) show();
  });
})();

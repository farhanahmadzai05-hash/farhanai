// Intro screen. Shown once per visit; any key, click or tap enters the chat.
// That first press also counts as the click browsers need before music can play.
(() => {
  const splash = document.getElementById("splash");
  const SEEN_KEY = "farhanai-intro-seen";
  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {}
  if (seen) {
    splash.remove();
    return;
  }

  const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  document.getElementById("splash-hint").textContent = touch ? "Tap the screen to continue" : "Press any key to continue";

  let leaving = false;
  function enter(e) {
    if (e.type === "keydown") e.preventDefault(); // don't type the key into the chat box
    if (leaving) return;
    leaving = true;
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    window.removeEventListener("keydown", enter, true);

    // Zoom into the centre of the F.
    const title = splash.querySelector(".splash-title");
    const f = splash.querySelector(".splash-f").getBoundingClientRect();
    const t = title.getBoundingClientRect();
    title.style.transformOrigin = `${f.left - t.left + f.width * 0.25}px ${f.top - t.top + f.height * 0.6}px`;
    splash.classList.add("leaving");
    splash.addEventListener("animationend", (ev) => {
      if (ev.target !== splash) return;
      splash.remove();
      document.getElementById("input")?.focus();
    });
  }
  window.addEventListener("keydown", enter, true);
  splash.addEventListener("pointerdown", enter);
})();

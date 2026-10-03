// Chat and Voice sit side by side. Swipe, scroll sideways or tap the switch at the top to move
// between them; each card tilts in 3D as it slides. Only transform and opacity change, so the
// graphics card does the work and it stays smooth on phones.
(() => {
  const scroller = document.getElementById("panels");
  const panels = [...scroller.querySelectorAll(".panel")];
  const cards = panels.map((p) => p.querySelector(".card"));
  const tabs = [...document.querySelectorAll(".mode")];
  const pill = document.getElementById("modes-pill");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let current = 0;
  let queued = false;

  function render() {
    queued = false;
    const width = scroller.clientWidth || 1;
    const progress = scroller.scrollLeft / width; // 0 = Chat, 1 = Voice
    pill.style.setProperty("--p", Math.min(1, Math.max(0, progress)));

    cards.forEach((card, i) => {
      const d = Math.max(-1, Math.min(1, i - progress)); // where this card is: -1 left, 0 centre, 1 right
      if (reduceMotion || Math.abs(d) < 0.001) {
        card.style.transform = "";
        card.style.opacity = "";
        return;
      }
      // Like turning a cube: the card swings on the edge nearest the middle.
      card.style.transformOrigin = d > 0 ? "0% 50%" : "100% 50%";
      card.style.transform = `rotateY(${d * -38}deg) translateZ(${-Math.abs(d) * 120}px) scale(${1 - Math.abs(d) * 0.08})`;
      card.style.opacity = String(1 - Math.abs(d) * 0.55);
    });

    const nearest = Math.round(progress);
    if (nearest !== current) {
      current = nearest;
      tabs.forEach((t, i) => t.setAttribute("aria-selected", String(i === current)));
      window.dispatchEvent(new CustomEvent("farhanai-panel", { detail: current === 1 ? "voice" : "chat" }));
    }
  }

  function goTo(index) {
    scroller.scrollTo({ left: index * scroller.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
  }

  scroller.addEventListener(
    "scroll",
    () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(render);
      }
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    scroller.scrollLeft = current * scroller.clientWidth; // stay on the same panel
    render();
  });
  tabs.forEach((tab) => tab.addEventListener("click", () => goTo(Number(tab.dataset.panel))));

  // Mouse wheel scrolling up and down doesn't move sideways on its own; let it switch panels
  // when it's not scrolling the chat messages.
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpads already scroll sideways
      if (e.target.closest("main, .voice-reply, textarea")) return;
      if (Math.abs(e.deltaY) < 20) return;
      e.preventDefault();
      goTo(e.deltaY > 0 ? 1 : 0);
    },
    { passive: false },
  );

  window.FarhanPanels = { goTo };
  render();
})();

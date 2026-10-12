// Applies the visitor's theme (dark, light or the system's) and accent colour before the page
// is drawn, so it never flashes the wrong colours. Loaded in <head>; everything else about
// appearance lives in ui.js. Choices are kept in this browser only.
(() => {
  const root = document.documentElement;
  const MODES = ["dark", "light", "system"];
  const ACCENTS = ["violet", "blue", "teal", "amber", "rose"];
  const read = (key, allowed, fallback) => {
    try {
      const value = localStorage.getItem(key);
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback; // storage blocked (private mode, strict settings)
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };
  const systemLight = window.matchMedia("(prefers-color-scheme: light)");

  let mode = read("farhanai-theme", MODES, "dark");
  let accent = read("farhanai-accent", ACCENTS, "violet");

  function apply() {
    const theme = mode === "system" ? (systemLight.matches ? "light" : "dark") : mode;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#f7f7f8" : "#0a0b0f";
  }
  systemLight.addEventListener?.("change", () => mode === "system" && apply());
  apply();
  if (read("farhanai-sidebar", ["collapsed", "open"], "open") === "collapsed") root.classList.add("side-collapsed");

  window.FarhanTheme = {
    MODES,
    ACCENTS,
    get: () => ({ mode, accent, theme: root.dataset.theme }),
    setMode(next) {
      if (!MODES.includes(next)) return;
      mode = next;
      write("farhanai-theme", next);
      apply();
      window.dispatchEvent(new CustomEvent("farhanai-theme", { detail: this.get() }));
    },
    setAccent(next) {
      if (!ACCENTS.includes(next)) return;
      accent = next;
      write("farhanai-accent", next);
      apply();
      window.dispatchEvent(new CustomEvent("farhanai-theme", { detail: this.get() }));
    },
  };
})();

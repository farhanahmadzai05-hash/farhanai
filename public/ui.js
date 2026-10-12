// Shared pieces of the interface: icons, toast messages, the confirm dialog, pop-up menus,
// copying to the clipboard, the Copy and Collapse buttons on code blocks, and the Appearance
// menu (theme and accent colour).
(() => {
  // Line icons on a 24px grid, drawn to match each other.
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2.5"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    pin: '<path d="M9 3.5h6l-1 6 3.5 3.5v1.5h-11V13L10 9.5z"/><path d="M12 14.5v6"/>',
    pencil: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chat: '<path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    sigma: '<path d="M17.5 5h-11l6 7-6 7h11"/>',
    code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
    pen: '<path d="M12 20h8.5"/><path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L7.5 18.5 3.5 19.5l1-4z"/>',
    book: '<path d="M4 5.5A2 2 0 0 1 6 3.5h13.5v15H6a2 2 0 0 0-2 2z"/><path d="M4 20.5a2 2 0 0 0 2 2h13.5v-4"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    scale: '<path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 6a3 3 0 0 0 5 0zM19 8l-2.5 6a3 3 0 0 0 5 0z"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4 6.5l1 1 2-2M4 12l1 1 2-2M4 17.5l1 1 2-2"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 15l3.5-4 3 2.5L19 8"/>',
    flask: '<path d="M9.5 3.5h5M10 3.5v5.5l-5 8.5A2 2 0 0 0 6.7 20.5h10.6a2 2 0 0 0 1.7-3L14 9V3.5"/><path d="M7.5 15h9"/>',
    briefcase: '<rect x="3.5" y="7" width="17" height="12.5" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17"/>',
    shuffle: '<path d="M16.5 4.5l3 3-3 3M3.5 7.5h4c4.5 0 4.5 9 9 9h3M16.5 13.5l3 3-3 3"/><path d="M3.5 16.5h4c1.4 0 2.3-.9 3-2M19.5 7.5h-3c-1.4 0-2.3.9-3 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    arrowUp: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    paperclip: '<path d="M20.5 11.5l-8.2 8.2a5.3 5.3 0 0 1-7.5-7.5l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.9-7.9"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-4.8-4.8L6.5 19.5"/>',
    file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5"/>',
    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7h2a4.5 4.5 0 0 0 4.5-4.5c0-3.7-4-6.6-9-6.6z"/><circle cx="7.5" cy="11.5" r="1.1"/><circle cx="10.5" cy="7.5" r="1.1"/><circle cx="15" cy="7.8" r="1.1"/>',
  };
  const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  // ---------- Toasts: short messages at the bottom that read out to screen readers ----------
  const toasts = document.getElementById("toasts");
  function toast(message, { kind = "info", timeout = 3200 } = {}) {
    if (!toasts) return;
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.innerHTML = icon(kind === "error" ? "x" : "check");
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    toasts.appendChild(el);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 220);
    }, timeout);
  }

  // ---------- Confirm dialog for things that can't be undone ----------
  function confirmDialog({ title, body = "", confirm = "Delete", danger = true }) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "confirm";
      dialog.setAttribute("aria-labelledby", "confirm-title");
      dialog.innerHTML =
        `<h2 id="confirm-title"></h2><p class="confirm-body"></p>` +
        `<div class="confirm-actions"><button type="button" class="btn" value="no">Cancel</button>` +
        `<button type="button" class="btn ${danger ? "danger" : "primary"}" value="yes"></button></div>`;
      dialog.querySelector("h2").textContent = title;
      dialog.querySelector(".confirm-body").textContent = body;
      dialog.querySelector('[value="yes"]').textContent = confirm;
      const returnTo = document.activeElement;
      let answer = false;
      dialog.addEventListener("click", (e) => {
        const button = e.target.closest("button");
        if (button) {
          answer = button.value === "yes";
          dialog.close();
        } else if (e.target === dialog) dialog.close();
      });
      dialog.addEventListener("close", () => {
        dialog.remove();
        returnTo?.focus?.();
        resolve(answer);
      });
      document.body.appendChild(dialog);
      dialog.showModal();
      dialog.querySelector('[value="no"]').focus(); // the safe choice is the default
    });
  }

  // ---------- Pop-up menus: arrow keys move, Escape or a click outside closes ----------
  let openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    const { el, returnTo } = openMenu;
    openMenu = null;
    el.remove();
    returnTo?.setAttribute?.("aria-expanded", "false");
    returnTo?.focus?.();
  }
  // items: [{ label, icon, action, danger }]. anchor: the button that opened it, or a {x, y} point.
  function showMenu(items, anchor, { label = "Menu" } = {}) {
    closeMenu();
    const el = document.createElement("div");
    el.className = "menu";
    el.setAttribute("role", "menu");
    el.setAttribute("aria-label", label);
    for (const item of items) {
      const b = document.createElement("button");
      b.type = "button";
      // A choice that can be the current one is a radio item, so screen readers say "checked".
      b.setAttribute("role", "checked" in item ? "menuitemradio" : "menuitem");
      if ("checked" in item) b.setAttribute("aria-checked", String(!!item.checked));
      b.className = item.danger ? "danger" : "";
      b.innerHTML = icon(item.icon);
      b.append(item.label);
      b.addEventListener("click", () => {
        closeMenu();
        item.action();
      });
      el.appendChild(b);
    }
    document.body.appendChild(el);
    const box = el.getBoundingClientRect();
    let x, y;
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      x = r.right - box.width;
      y = r.bottom + 6;
      if (x < 8) x = r.left;
      anchor.setAttribute("aria-expanded", "true");
    } else ({ x, y } = anchor);
    x = Math.max(8, Math.min(x, innerWidth - box.width - 8));
    if (y + box.height > innerHeight - 8) y = Math.max(8, y - box.height - (anchor instanceof Element ? anchor.offsetHeight + 12 : 0));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    openMenu = { el, returnTo: anchor instanceof Element ? anchor : document.activeElement };
    el.querySelector("button")?.focus();
    el.addEventListener("keydown", (e) => {
      const buttons = [...el.querySelectorAll("button")];
      const i = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length].focus();
      else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length].focus();
      else if (e.key === "Home") buttons[0].focus();
      else if (e.key === "End") buttons.at(-1).focus();
      else if (e.key === "Tab") closeMenu();
      else return;
      e.preventDefault();
    });
  }
  document.addEventListener("pointerdown", (e) => openMenu && !openMenu.el.contains(e.target) && closeMenu(), true);
  document.addEventListener("keydown", (e) => e.key === "Escape" && openMenu && (e.preventDefault(), closeMenu()));
  window.addEventListener("resize", closeMenu);

  // ---------- Clipboard ----------
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers, or a page that isn't allowed to use the clipboard API.
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {}
      area.remove();
      return ok;
    }
  }

  // ---------- Code block buttons (the blocks are drawn by code.js) ----------
  document.addEventListener("click", async (e) => {
    const copy = e.target.closest(".code-copy");
    if (copy) {
      const code = copy.closest(".code-block")?.querySelector("pre code");
      if (!code) return;
      const ok = await copyText(code.textContent);
      copy.textContent = ok ? "Copied" : "Couldn't copy";
      copy.classList.toggle("done", ok);
      setTimeout(() => {
        copy.textContent = "Copy";
        copy.classList.remove("done");
      }, 1600);
      if (!ok) toast("Your browser blocked copying. Select the code and copy it instead.", { kind: "error" });
      return;
    }
    const fold = e.target.closest(".code-fold");
    if (fold) {
      const block = fold.closest(".code-block");
      const collapsed = block.classList.toggle("collapsed");
      fold.textContent = collapsed ? `Show all ${block.dataset.lines} lines` : "Collapse";
      fold.setAttribute("aria-expanded", String(!collapsed));
    }
  });

  // ---------- Appearance menu: theme and accent colour ----------
  const appearanceBtn = document.getElementById("appearance");
  const ACCENT_NAMES = { violet: "Violet", blue: "Blue", teal: "Teal", amber: "Amber", rose: "Rose" };
  const MODE_INFO = { dark: ["Dark", "moon"], light: ["Light", "sun"], system: ["System", "monitor"] };
  let panel = null;
  function closeAppearance() {
    if (!panel) return;
    panel.remove();
    panel = null;
    appearanceBtn.setAttribute("aria-expanded", "false");
  }
  function openAppearance() {
    const { mode, accent } = window.FarhanTheme.get();
    panel = document.createElement("div");
    panel.className = "popover appearance";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Appearance");
    panel.innerHTML =
      `<fieldset><legend>Theme</legend><div class="segmented">${window.FarhanTheme.MODES.map(
        (m) =>
          `<label><input type="radio" name="theme-mode" value="${m}"${m === mode ? " checked" : ""}>${icon(MODE_INFO[m][1])}<span>${MODE_INFO[m][0]}</span></label>`,
      ).join("")}</div></fieldset>` +
      `<fieldset><legend>Accent colour</legend><div class="swatches">${window.FarhanTheme.ACCENTS.map(
        (a) =>
          `<label class="swatch" data-swatch="${a}" title="${ACCENT_NAMES[a]}"><input type="radio" name="theme-accent" value="${a}"${a === accent ? " checked" : ""} aria-label="${ACCENT_NAMES[a]}"><span></span></label>`,
      ).join("")}</div></fieldset>` +
      `<p class="popover-note">Saved in this browser.</p>`;
    panel.addEventListener("change", (e) => {
      if (e.target.name === "theme-mode") window.FarhanTheme.setMode(e.target.value);
      if (e.target.name === "theme-accent") window.FarhanTheme.setAccent(e.target.value);
    });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeAppearance();
        appearanceBtn.focus();
      }
    });
    document.body.appendChild(panel);
    const r = appearanceBtn.getBoundingClientRect();
    const w = panel.offsetWidth;
    panel.style.top = `${r.bottom + 8}px`;
    panel.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    appearanceBtn.setAttribute("aria-expanded", "true");
    panel.querySelector("input:checked")?.focus();
  }
  appearanceBtn?.addEventListener("click", () => (panel ? closeAppearance() : openAppearance()));
  document.addEventListener("pointerdown", (e) => panel && !panel.contains(e.target) && !appearanceBtn.contains(e.target) && closeAppearance(), true);
  window.addEventListener("resize", closeAppearance);

  window.FarhanUI = { icon, toast, confirmDialog, showMenu, closeMenu, copyText };
})();

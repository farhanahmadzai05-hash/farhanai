// Settings: appearance, how the assistant answers (styles and your own presets), chats and
// privacy, and keyboard shortcuts. Everything is kept in this browser. The assistant choices are
// sent with each message and the server checks them (see preferenceRules in server.js); they
// change style, length, tone and language only, never the safety rules.
(() => {
  const { icon, toast, confirmDialog, showMenu } = window.FarhanUI;
  const PROFILE_KEY = "farhanai-assistant";
  const PRESETS_KEY = "farhanai-presets";
  const SAVE_KEY = "farhanai-save-chats";

  const STYLES = {
    balanced: ["Balanced", "Clear, direct answers for most questions."],
    concise: ["Concise", "The answer first, in as few words as possible."],
    academic: ["Academic", "Precise definitions and rigorous reasoning."],
    creative: ["Creative", "Fresh angles, vivid examples, several ideas."],
    technical: ["Technical", "Formulas, code, edge cases and detail."],
    socratic: ["Socratic tutor", "Guides you with questions and hints."],
    research: ["Research", "Separates facts from inference and cites sources."],
  };
  const CHOICES = {
    length: { short: "Short", normal: "Normal", detailed: "Detailed" },
    tone: { friendly: "Friendly", neutral: "Neutral", formal: "Formal" },
    focus: { intuition: "Intuition first", balanced: "Balanced", technical: "Technical detail" },
  };
  const DEFAULT = { name: "", style: "balanced", length: "normal", tone: "friendly", focus: "balanced", language: "", examples: false, custom: "", preset: "" };
  const LIMITS = { name: 30, language: 40, custom: 500 };

  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      toast("This browser didn't let Farhan AI save that setting.", { kind: "error" });
      return false;
    }
  };
  // Keeps only known fields with allowed values (the same checks the server makes).
  function clean(p) {
    const out = { ...DEFAULT };
    if (!p || typeof p !== "object") return out;
    if (Object.hasOwn(STYLES, p.style)) out.style = p.style;
    for (const key of Object.keys(CHOICES)) if (Object.hasOwn(CHOICES[key], p[key])) out[key] = p[key];
    for (const key of Object.keys(LIMITS)) if (typeof p[key] === "string") out[key] = p[key].slice(0, LIMITS[key]);
    out.examples = p.examples === true;
    if (typeof p.preset === "string") out.preset = p.preset.slice(0, 40);
    return out;
  }

  let profile = clean(read(PROFILE_KEY, null));
  let presets = (Array.isArray(read(PRESETS_KEY, [])) ? read(PRESETS_KEY, []) : [])
    .filter((p) => p && typeof p.id === "string" && typeof p.label === "string")
    .slice(0, 20)
    .map((p) => ({ id: p.id.slice(0, 40), label: p.label.slice(0, 40), ...clean(p), preset: "" }));

  const changed = () => {
    write(PROFILE_KEY, profile);
    updateChip();
    window.dispatchEvent(new Event("farhanai-settings"));
  };
  const styleLabel = () => presets.find((p) => p.id === profile.preset)?.label || STYLES[profile.style][0];

  // ---------- The style button in the message box ----------
  const chip = document.getElementById("style-chip");
  function updateChip() {
    if (!chip) return;
    chip.querySelector("span").textContent = styleLabel();
    chip.title = `Answer style: ${styleLabel()}. Click to change.`;
    chip.setAttribute("aria-label", `Answer style: ${styleLabel()}`);
  }
  function useStyle(style) {
    profile = { ...profile, style, preset: "" };
    changed();
    toast(`Answer style: ${STYLES[style][0]}`);
  }
  function usePreset(preset) {
    profile = { ...clean(preset), preset: preset.id };
    changed();
    toast(`Using your preset “${preset.label}”`);
  }
  chip?.addEventListener("click", () =>
    showMenu(
      [
        ...Object.entries(STYLES).map(([key, [label]]) => ({
          label: `${label}${!profile.preset && profile.style === key ? " ✓" : ""}`,
          icon: "sparkle",
          action: () => useStyle(key),
        })),
        ...presets.map((p) => ({ label: `${p.label}${profile.preset === p.id ? " ✓" : ""}`, icon: "pin", action: () => usePreset(p) })),
        { label: "Customise…", icon: "gear", action: () => open("assistant") },
      ],
      chip,
      { label: "Answer style" },
    ),
  );

  // ---------- The Settings dialog ----------
  const SECTIONS = [
    ["appearance", "Appearance", "palette"],
    ["assistant", "Assistant", "sparkle"],
    ["chats", "Chats & privacy", "chat"],
    ["shortcuts", "Shortcuts", "keyboard"],
  ];
  let dialog = null;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const radios = (name, options, current) =>
    `<div class="segmented wide" role="radiogroup">${Object.entries(options)
      .map(([v, label]) => `<label><input type="radio" name="${name}" value="${v}"${v === current ? " checked" : ""}><span>${esc(label)}</span></label>`)
      .join("")}</div>`;
  const field = (label, control, hint = "") => `<div class="field"><div class="field-label">${label}</div>${control}${hint ? `<p class="field-hint">${hint}</p>` : ""}</div>`;

  function appearanceHtml() {
    const { mode, accent } = window.FarhanTheme.get();
    const look = window.FarhanTheme.look();
    return (
      field("Theme", radios("theme-mode", { dark: "Dark", light: "Light", system: "System" }, mode)) +
      field(
        "Accent colour",
        `<div class="swatches">${window.FarhanTheme.ACCENTS.map(
          (a) => `<label class="swatch" data-swatch="${a}" title="${a}"><input type="radio" name="theme-accent" value="${a}"${a === accent ? " checked" : ""} aria-label="${a}"><span></span></label>`,
        ).join("")}</div>`,
      ) +
      field("Text size", radios("look-text", { small: "Small", default: "Default", large: "Large" }, look.text)) +
      field("Message width", radios("look-width", { narrow: "Narrow", default: "Default", wide: "Wide" }, look.width)) +
      field("Spacing", radios("look-density", { comfortable: "Comfortable", compact: "Compact" }, look.density)) +
      field("Motion", radios("look-motion", { system: "Follow device", reduce: "Reduce" }, look.motion), "Reduce turns off sliding, fading and spinning effects.") +
      field("Background light", radios("look-ambient", { on: "On", off: "Off" }, look.ambient))
    );
  }
  function assistantHtml() {
    return (
      field(
        "Style",
        `<div class="style-grid">${Object.entries(STYLES)
          .map(
            ([key, [label, about]]) =>
              `<label class="style-card"><input type="radio" name="style" value="${key}"${profile.style === key ? " checked" : ""}><span class="style-name">${label}</span><span class="style-about">${about}</span></label>`,
          )
          .join("")}</div>`,
      ) +
      field("Answer length", radios("length", CHOICES.length, profile.length)) +
      field("Tone", radios("tone", CHOICES.tone, profile.tone)) +
      field("Explanations", radios("focus", CHOICES.focus, profile.focus)) +
      `<label class="check"><input type="checkbox" name="examples"${profile.examples ? " checked" : ""}> Usually include an example</label>` +
      field("Language", `<input class="text" name="language" maxlength="${LIMITS.language}" placeholder="e.g. English, Urdu, French" value="${esc(profile.language)}">`, "Leave empty to answer in the language you write in.") +
      field("Call the assistant", `<input class="text" name="name" maxlength="${LIMITS.name}" placeholder="Farhan AI" value="${esc(profile.name)}">`) +
      field(
        "Anything else about how you like answers",
        `<textarea class="text" name="custom" maxlength="${LIMITS.custom}" rows="3" placeholder="e.g. I'm studying A Level maths, so use UK exam terms.">${esc(profile.custom)}</textarea>`,
        `Up to ${LIMITS.custom} characters. This shapes style only: it can't switch off Farhan AI's safety rules.`,
      ) +
      `<div class="field"><div class="field-label">Your presets</div><div class="preset-list">${
        presets.length
          ? presets.map((p) => `<div class="preset" data-id="${esc(p.id)}"><span>${esc(p.label)}</span><button type="button" class="link-btn danger" data-delete="${esc(p.id)}">Delete</button></div>`).join("")
          : `<p class="field-hint">Save the choices above as a preset to switch to them quickly from the message box.</p>`
      }</div><div class="preset-save"><input class="text" name="preset-name" maxlength="40" placeholder="Preset name, e.g. Exam revision"><button type="button" class="btn" data-action="save-preset">Save preset</button></div></div>` +
      `<button type="button" class="link-btn" data-action="reset-assistant">Reset to the defaults</button>`
    );
  }
  function chatsHtml() {
    const saving = read(SAVE_KEY, true) !== false;
    const count = window.FarhanChats?.list().length || 0;
    return (
      `<label class="check"><input type="checkbox" name="save-chats"${saving ? " checked" : ""}> Save my chats in this browser</label>` +
      `<p class="field-hint">Chats are kept only on this device, in this browser. They aren't sent to a server for storage and don't sync to your other devices. Turn this off on a shared computer.</p>` +
      field("Saved chats", `<p class="field-hint">${count} saved chat${count === 1 ? "" : "s"}.</p><div class="row-buttons"><button type="button" class="btn" data-action="export-chats"${count ? "" : " disabled"}>${icon("download")}Export all as Markdown</button><button type="button" class="btn danger-outline" data-action="delete-chats"${count ? "" : " disabled"}>${icon("trash")}Delete all chats</button></div>`) +
      field("What's sent to the AI", `<p class="field-hint">Your messages in the open chat (the latest 12), your time zone, and your Assistant settings. Online, Farhan AI uses Groq to write answers and may search the web for current facts.</p>`)
    );
  }
  function shortcutsHtml() {
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
    const rows = window.FarhanShortcuts?.list(mod) || [];
    return `<table class="shortcuts"><tbody>${rows.map(([keys, what]) => `<tr><td>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(" ")}</td><td>${esc(what)}</td></tr>`).join("")}</tbody></table>`;
  }
  const RENDER = { appearance: appearanceHtml, assistant: assistantHtml, chats: chatsHtml, shortcuts: shortcutsHtml };

  function show(section) {
    dialog.querySelectorAll(".settings-nav button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.section === section)));
    const panel = dialog.querySelector(".settings-panel");
    panel.dataset.section = section;
    panel.innerHTML = `<h3>${SECTIONS.find((s) => s[0] === section)[1]}</h3>${RENDER[section]()}`;
    panel.scrollTop = 0;
  }

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "settings";
    dialog.setAttribute("aria-labelledby", "settings-title");
    dialog.innerHTML =
      `<div class="settings-head"><h2 id="settings-title">Settings</h2><button type="button" class="icon-btn settings-close" aria-label="Close settings">${icon("x")}</button></div>` +
      `<div class="settings-body"><nav class="settings-nav" role="tablist" aria-label="Settings sections">${SECTIONS.map(
        ([key, label, ic]) => `<button type="button" role="tab" data-section="${key}">${icon(ic)}<span>${label}</span></button>`,
      ).join("")}</nav><div class="settings-panel" role="tabpanel"></div></div>`;
    dialog.querySelector(".settings-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
    dialog.querySelector(".settings-nav").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-section]");
      if (b) show(b.dataset.section);
    });
    dialog.querySelector(".settings-nav").addEventListener("keydown", (e) => {
      const tabs = [...dialog.querySelectorAll(".settings-nav button")];
      const i = tabs.indexOf(document.activeElement);
      if (i < 0 || !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) return;
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next.focus();
      show(next.dataset.section);
    });
    const panel = dialog.querySelector(".settings-panel");
    panel.addEventListener("change", (e) => {
      const { name, value, checked } = e.target;
      if (name === "theme-mode") window.FarhanTheme.setMode(value);
      else if (name === "theme-accent") window.FarhanTheme.setAccent(value);
      else if (name?.startsWith("look-")) window.FarhanTheme.setLook(name.slice(5), value);
      else if (name === "save-chats") write(SAVE_KEY, checked);
      else if (["style", "length", "tone", "focus"].includes(name)) {
        profile = clean({ ...profile, [name]: value, preset: "" });
        changed();
      } else if (name === "examples") {
        profile = { ...profile, examples: checked, preset: "" };
        changed();
      } else return;
      dialog.querySelector(".settings-saved").classList.add("show");
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => dialog.querySelector(".settings-saved")?.classList.remove("show"), 1500);
    });
    panel.addEventListener("input", (e) => {
      const { name, value } = e.target;
      if (!Object.hasOwn(LIMITS, name)) return;
      profile = clean({ ...profile, [name]: value, preset: "" });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(changed, 300);
    });
    panel.addEventListener("click", async (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      const del = e.target.closest("[data-delete]")?.dataset.delete;
      if (del) {
        presets = presets.filter((p) => p.id !== del);
        write(PRESETS_KEY, presets);
        if (profile.preset === del) profile.preset = "";
        changed();
        show("assistant");
        toast("Preset deleted");
      } else if (action === "save-preset") {
        const nameEl = panel.querySelector('[name="preset-name"]');
        const label = nameEl.value.replace(/\s+/g, " ").trim().slice(0, 40);
        if (!label) {
          nameEl.focus();
          return toast("Give the preset a name first.", { kind: "error" });
        }
        if (presets.length >= 20) return toast("You can keep up to 20 presets. Delete one first.", { kind: "error" });
        const preset = { ...profile, id: `p${Date.now().toString(36)}`, label, preset: "" };
        presets.push(preset);
        write(PRESETS_KEY, presets);
        profile.preset = preset.id;
        changed();
        show("assistant");
        toast(`Saved preset “${label}”`);
      } else if (action === "reset-assistant") {
        profile = { ...DEFAULT };
        changed();
        show("assistant");
        toast("Assistant settings reset");
      } else if (action === "export-chats") {
        window.exportAllChats?.();
      } else if (action === "delete-chats") {
        const ok = await confirmDialog({ title: "Delete all chats?", body: "Every saved chat will be removed from this browser. This can't be undone.", confirm: "Delete all" });
        if (!ok) return;
        window.FarhanChats.removeAll();
        window.startNewChat?.();
        show("chats");
        toast("All chats deleted");
      }
    });
    dialog.addEventListener("close", () => {
      clearTimeout(typingTimer);
      changed();
      returnTo?.focus?.();
    });
    dialog.querySelector(".settings-close").insertAdjacentHTML("beforebegin", `<span class="settings-saved" aria-live="polite">Saved</span>`);
    document.body.appendChild(dialog);
  }
  let savedTimer, typingTimer, returnTo;

  function open(section = "appearance") {
    if (!dialog) build();
    returnTo = document.activeElement;
    show(section);
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(`.settings-nav [data-section="${section}"]`).focus();
  }

  document.getElementById("settings-open")?.addEventListener("click", () => open());

  window.FarhanSettings = {
    STYLES,
    open,
    useStyle,
    presets: () => presets.map((p) => ({ ...p })),
    usePreset: (id) => presets.find((p) => p.id === id) && usePreset(presets.find((p) => p.id === id)),
    profile: () => ({ ...profile }),
    // What's sent with each message. Only fields that differ from the defaults are included.
    preferences() {
      const out = {};
      for (const [key, value] of Object.entries(profile)) if (key !== "preset" && value !== DEFAULT[key] && value !== "") out[key] = value;
      return Object.keys(out).length ? out : undefined;
    },
    savingChats: () => read(SAVE_KEY, true) !== false,
  };
  updateChip();
})();

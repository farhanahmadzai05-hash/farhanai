// The command palette (Ctrl+K or ⌘K) and keyboard shortcuts. Every command runs a real action;
// commands that can't work right now (Voice in a browser without speech recognition) are left
// out. Typing also searches saved chats.
(() => {
  const { icon } = window.FarhanUI;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = (e) => (mac ? e.metaKey : e.ctrlKey);
  const voiceWorks = !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !!window.speechSynthesis;

  function commands() {
    const theme = window.FarhanTheme.get();
    const list = [
      { label: "New chat", icon: "plus", keys: "Shift O", run: () => window.startNewChat() },
      { label: "Search chats", icon: "search", run: focusSearch },
      { label: "Open settings", icon: "gear", keys: ",", run: () => window.FarhanSettings.open() },
      { label: "Keyboard shortcuts", icon: "keyboard", run: () => window.FarhanSettings.open("shortcuts") },
      { label: "Show or hide chats", icon: "sidebar", keys: "Shift S", run: () => window.FarhanSidebar.toggle() },
      { label: "Copy the latest reply", icon: "copy", keys: "Shift ;", run: copyLatest, when: () => !!latestReply() },
      { label: "Export this chat as Markdown", icon: "download", run: () => window.exportCurrentChat(), when: () => turns.length > 0 },
      ...["dark", "light", "system"].filter((m) => m !== theme.mode).map((m) => ({ label: `Theme: ${m[0].toUpperCase()}${m.slice(1)}`, icon: m === "dark" ? "moon" : m === "light" ? "sun" : "monitor", run: () => window.FarhanTheme.setMode(m) })),
      ...Object.entries(window.FarhanSettings.STYLES).map(([key, [label]]) => ({ label: `Answer style: ${label}`, icon: "sparkle", run: () => window.FarhanSettings.useStyle(key) })),
      ...(window.FarhanComposer
        ? Object.entries(window.FarhanComposer.MODES)
            .filter(([key]) => key !== window.FarhanComposer.mode())
            .map(([key, [label, iconName]]) => ({ label: `Mode: ${label}`, icon: iconName, run: () => window.FarhanComposer.setMode(key) }))
        : []),
      { label: window.FarhanComposer?.models().pictures ? "Attach a file or picture" : "Attach a text file", icon: "paperclip", run: () => document.getElementById("attach").click() },
      ...window.FarhanSettings.presets().map((p) => ({ label: `Use preset: ${p.label}`, icon: "pin", run: () => window.FarhanSettings.usePreset(p.id) })),
    ];
    if (voiceWorks) list.push({ label: "Voice mode", icon: "mic", run: () => window.FarhanPanels?.goTo(1) });
    return list.filter((c) => !c.when || c.when());
  }

  function focusSearch() {
    if (window.matchMedia("(max-width: 860px)").matches) window.FarhanSidebar.setDrawer(true);
    else if (document.documentElement.classList.contains("side-collapsed")) window.FarhanSidebar.toggle();
    document.getElementById("chat-search")?.focus();
  }
  const latestReply = () => [...document.querySelectorAll("#messages > .row.assistant .msg-actions")].at(-1);
  function copyLatest() {
    latestReply()?.querySelector(".act")?.click(); // the Copy button
  }

  // ---------- The palette ----------
  let dialog = null;
  let items = [];
  let active = 0;
  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "palette";
    dialog.setAttribute("aria-label", "Command palette");
    dialog.innerHTML =
      `<div class="palette-search">${icon("search")}<input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Type a command or search your chats" spellcheck="false" autocomplete="off"><kbd>Esc</kbd></div>` +
      `<ul id="palette-list" class="palette-list" role="listbox"></ul>`;
    const field = dialog.querySelector("input");
    field.addEventListener("input", render);
    field.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1);
        highlight();
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(items[active]);
      }
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) return dialog.close();
      const li = e.target.closest("li[data-i]");
      if (li) choose(items[Number(li.dataset.i)]);
    });
    dialog.addEventListener("close", () => returnTo?.focus?.());
    document.body.appendChild(dialog);
  }
  let returnTo = null;

  function render() {
    const q = dialog.querySelector("input").value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const matches = (text) => words.every((w) => text.toLowerCase().includes(w));
    items = commands()
      .filter((c) => matches(c.label))
      .map((c) => ({ ...c, kind: "Command" }));
    if (words.length && window.FarhanChats) {
      for (const chat of (window.FarhanChats.search(q) || []).slice(0, 8)) {
        items.push({ label: chat.title, detail: chat.snippet, icon: "chat", kind: "Chat", run: () => window.openChat(chat.id) });
      }
    } else if (window.FarhanChats) {
      for (const chat of window.FarhanChats.list().sort((a, b) => b.updated - a.updated).slice(0, 5)) {
        items.push({ label: chat.title, icon: "chat", kind: "Recent chat", run: () => window.openChat(chat.id) });
      }
    }
    active = 0;
    const list = dialog.querySelector(".palette-list");
    list.replaceChildren();
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "palette-empty";
      li.textContent = "Nothing matches. Try another word.";
      list.appendChild(li);
    }
    items.forEach((item, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = `palette-${i}`;
      li.dataset.i = i;
      li.innerHTML = icon(item.icon);
      const text = document.createElement("span");
      text.className = "palette-label";
      text.textContent = item.label;
      if (item.detail) {
        const d = document.createElement("span");
        d.className = "palette-detail";
        d.textContent = item.detail;
        text.appendChild(d);
      }
      const kind = document.createElement("span");
      kind.className = "palette-kind";
      kind.textContent = item.keys ? `${mac ? "⌘" : "Ctrl"} ${item.keys}` : item.kind;
      li.append(text, kind);
      li.addEventListener("pointermove", () => {
        if (active !== i) {
          active = i;
          highlight();
        }
      });
      list.appendChild(li);
    });
    highlight();
  }
  function highlight() {
    dialog.querySelectorAll(".palette-list li[role=option]").forEach((li, i) => {
      li.setAttribute("aria-selected", String(i === active));
      if (i === active) li.scrollIntoView({ block: "nearest" });
    });
    dialog.querySelector("input").setAttribute("aria-activedescendant", items.length ? `palette-${active}` : "");
  }
  function choose(item) {
    if (!item) return;
    dialog.close();
    item.run();
  }
  function open() {
    if (!dialog) build();
    if (dialog.open) return dialog.close();
    returnTo = document.activeElement;
    dialog.querySelector("input").value = "";
    render();
    dialog.showModal();
    dialog.querySelector("input").focus();
  }

  // ---------- Shortcuts ----------
  // Chosen not to clash with the browser's own (no Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Shift+C…).
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const k = e.key.toLowerCase();
    if (mod(e) && !e.shiftKey && !e.altKey && k === "k") {
      e.preventDefault();
      open();
    } else if (mod(e) && e.shiftKey && k === "o") {
      e.preventDefault();
      window.startNewChat();
    } else if (mod(e) && e.shiftKey && k === "s") {
      e.preventDefault();
      window.FarhanSidebar.toggle();
    } else if (mod(e) && !e.shiftKey && e.key === ",") {
      e.preventDefault();
      window.FarhanSettings.open();
    } else if (mod(e) && e.shiftKey && (e.key === ";" || e.key === ":")) {
      e.preventDefault();
      copyLatest();
    } else if (e.key === "Escape" && busy && !document.querySelector("dialog[open], .menu")) {
      stopReply();
    } else if (!typing(e.target) && !mod(e) && !e.altKey && !document.querySelector("dialog[open]")) {
      if (e.key === "/") {
        e.preventDefault();
        input.focus();
      } else if (e.key === "?") {
        e.preventDefault();
        window.FarhanSettings.open("shortcuts");
      }
    }
  });

  document.getElementById("palette-open")?.addEventListener("click", open);

  window.FarhanShortcuts = {
    list: (m) => [
      [[m, "K"], "Open the command palette"],
      [[m, "Shift", "O"], "New chat"],
      [[m, "Shift", "S"], "Show or hide chats"],
      [[m, ","], "Open settings"],
      [[m, "Shift", ";"], "Copy the latest reply"],
      [["/"], "Type a message"],
      [["Enter"], "Send"],
      [["Shift", "Enter"], "New line"],
      [["Esc"], "Stop the reply being written"],
      [["?"], "Show these shortcuts"],
    ],
  };
  window.FarhanPalette = { open };
})();

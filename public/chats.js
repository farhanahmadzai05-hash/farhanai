// Saved chats, kept in this browser's local storage (nothing is sent anywhere or synced between
// devices), and the sidebar that lists them: search, rename, pin, delete, grouped by date.
//
// Storage: "farhanai-chats" holds the list (id, title, times, pinned) and each chat's messages
// are under "farhanai-chat:<id>", so saving one chat never rewrites the others. A chat's turns
// are { user, reply, sources, note }, the same shape app.js shows on screen.
(() => {
  const INDEX_KEY = "farhanai-chats";
  const CHAT_KEY = (id) => `farhanai-chat:${id}`;
  const TITLE_MAX = 80;
  const { icon, toast, confirmDialog, showMenu } = window.FarhanUI;

  let storageWorks = true;
  try {
    localStorage.setItem("farhanai-probe", "1");
    localStorage.removeItem("farhanai-probe");
  } catch {
    storageWorks = false;
  }

  const str = (v, max = 100_000) => (typeof v === "string" ? v.slice(0, max) : "");
  // Anything read back from storage is checked, in case it was damaged or edited by hand.
  function cleanMeta(m) {
    if (!m || typeof m !== "object" || typeof m.id !== "string" || !/^[\w-]{1,40}$/.test(m.id)) return null;
    const created = Number(m.created) || Date.now();
    return { id: m.id, title: str(m.title, TITLE_MAX) || "New chat", created, updated: Number(m.updated) || created, pinned: m.pinned === true };
  }
  function cleanTurn(t) {
    if (!t || typeof t !== "object" || typeof t.user !== "string") return null;
    return {
      user: str(t.user),
      reply: str(t.reply),
      sources: Array.isArray(t.sources) ? t.sources.filter((s) => s && typeof s === "object").slice(0, 5) : [],
      note: str(t.note, 300),
    };
  }

  function readIndex() {
    if (!storageWorks) return [];
    try {
      const list = JSON.parse(localStorage.getItem(INDEX_KEY) || "[]");
      return Array.isArray(list) ? list.map(cleanMeta).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  function writeIndex(list) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  }
  function readTurns(id) {
    try {
      const data = JSON.parse(localStorage.getItem(CHAT_KEY(id)) || "null");
      return Array.isArray(data?.turns) ? data.turns.map(cleanTurn).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  const changed = () => window.dispatchEvent(new Event("farhanai-chats-changed"));
  const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const titleFrom = (text) => {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line || "New chat";
  };

  let warnedFull = false;
  const store = {
    available: storageWorks,
    list: readIndex,
    get(id) {
      const meta = readIndex().find((m) => m.id === id);
      return meta ? { ...meta, turns: readTurns(id) } : null;
    },
    // Saves a chat's turns and returns its id (a new id the first time). Returns null when it
    // couldn't be saved, for example because the browser's storage is full.
    save(id, turns) {
      if (!storageWorks || window.FarhanSettings?.savingChats() === false) return null;
      const list = readIndex();
      let meta = id && list.find((m) => m.id === id);
      const now = Date.now();
      if (!meta) {
        meta = { id: newId(), title: titleFrom(turns[0]?.user || ""), created: now, updated: now, pinned: false };
        list.push(meta);
      }
      meta.updated = now;
      try {
        localStorage.setItem(CHAT_KEY(meta.id), JSON.stringify({ turns: turns.map(cleanTurn).filter(Boolean) }));
        writeIndex(list);
      } catch {
        if (!warnedFull) toast("This browser's storage is full, so this chat isn't being saved. Delete some old chats to make room.", { kind: "error", timeout: 7000 });
        warnedFull = true;
        return null;
      }
      changed();
      return meta.id;
    },
    rename(id, title) {
      const clean = String(title).replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
      if (!clean) return false;
      const list = readIndex();
      const meta = list.find((m) => m.id === id);
      if (!meta) return false;
      meta.title = clean;
      writeIndex(list);
      changed();
      return true;
    },
    pin(id, pinned) {
      const list = readIndex();
      const meta = list.find((m) => m.id === id);
      if (!meta) return;
      meta.pinned = pinned;
      writeIndex(list);
      changed();
    },
    remove(id) {
      writeIndex(readIndex().filter((m) => m.id !== id));
      localStorage.removeItem(CHAT_KEY(id));
      changed();
    },
    removeAll() {
      for (const m of readIndex()) localStorage.removeItem(CHAT_KEY(m.id));
      localStorage.removeItem(INDEX_KEY);
      changed();
    },
    // Chats whose title or messages contain every word of the query, with a short snippet.
    search(query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return null;
      const results = [];
      for (const meta of readIndex()) {
        const turns = readTurns(meta.id);
        const text = [meta.title, ...turns.flatMap((t) => [t.user, t.reply])].join("\n");
        const lower = text.toLowerCase();
        if (!terms.every((t) => lower.includes(t))) continue;
        let snippet = "";
        if (!terms.every((t) => meta.title.toLowerCase().includes(t))) {
          const at = lower.indexOf(terms[0]);
          const start = Math.max(0, at - 30);
          snippet = `${start ? "…" : ""}${text.slice(start, at + 60).replace(/\s+/g, " ").trim()}…`;
        }
        results.push({ ...meta, snippet });
      }
      return results;
    },
  };
  window.FarhanChats = store;

  // ---------- The sidebar ----------
  const root = document.documentElement;
  const listEl = document.getElementById("chat-list");
  const searchEl = document.getElementById("chat-search");
  const toggleBtn = document.getElementById("side-toggle");
  const closeBtn = document.getElementById("side-close");
  const scrim = document.getElementById("scrim");
  const clearBtn = document.getElementById("clear-chats");
  const narrow = window.matchMedia("(max-width: 860px)");
  let activeId = null;
  let query = "";

  // Date groups, newest first.
  function groupOf(time) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const t = day.getTime();
    if (time >= t) return "Today";
    if (time >= t - 864e5) return "Yesterday";
    if (time >= t - 7 * 864e5) return "Previous 7 days";
    if (time >= t - 30 * 864e5) return "Previous 30 days";
    return new Date(time).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function render() {
    const results = query ? store.search(query) : null;
    const chats = (results || store.list()).sort((a, b) => b.updated - a.updated);
    listEl.replaceChildren();
    if (!store.available) {
      listEl.innerHTML = `<p class="side-empty">This browser isn't letting Farhan AI save anything, so chats can't be kept after you leave.</p>`;
      return;
    }
    if (!chats.length) {
      const p = document.createElement("p");
      p.className = "side-empty";
      p.textContent = query ? `No chats match “${query}”.` : "No saved chats yet. Your conversations will appear here.";
      listEl.appendChild(p);
      clearBtn.hidden = !query && !store.list().length;
      return;
    }
    clearBtn.hidden = false;
    const groups = new Map();
    for (const chat of chats) {
      const name = !query && chat.pinned ? "Pinned" : query ? "Results" : groupOf(chat.updated);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(chat);
    }
    const order = [...groups.keys()].sort((a, b) => (a === "Pinned" ? -1 : b === "Pinned" ? 1 : 0));
    for (const name of order) {
      const section = document.createElement("section");
      section.className = "chat-group";
      const h = document.createElement("h3");
      h.textContent = name;
      const ul = document.createElement("ul");
      for (const chat of groups.get(name)) ul.appendChild(item(chat));
      section.append(h, ul);
      listEl.appendChild(section);
    }
  }

  function item(chat) {
    const li = document.createElement("li");
    li.className = "chat-item";
    li.dataset.id = chat.id;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "chat-open";
    if (chat.id === activeId) open.setAttribute("aria-current", "page");
    const title = document.createElement("span");
    title.className = "chat-title";
    title.textContent = chat.title;
    open.appendChild(title);
    if (chat.pinned) open.insertAdjacentHTML("afterbegin", icon("pin", "pinned-mark"));
    if (chat.snippet) {
      const s = document.createElement("span");
      s.className = "chat-snippet";
      s.textContent = chat.snippet;
      open.appendChild(s);
    }
    open.addEventListener("click", () => {
      window.openChat?.(chat.id);
      if (narrow.matches) setDrawer(false);
    });
    open.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      menuFor(chat, { x: e.clientX, y: e.clientY });
    });
    const more = document.createElement("button");
    more.type = "button";
    more.className = "chat-more";
    more.setAttribute("aria-label", `Options for “${chat.title}”`);
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.innerHTML = icon("more");
    more.addEventListener("click", () => menuFor(chat, more));
    li.append(open, more);
    return li;
  }

  function menuFor(chat, anchor) {
    showMenu(
      [
        { label: "Rename", icon: "pencil", action: () => rename(chat) },
        { label: chat.pinned ? "Unpin" : "Pin to top", icon: "pin", action: () => store.pin(chat.id, !chat.pinned) },
        { label: "Export as Markdown", icon: "download", action: () => window.download?.(`${window.fileName(chat.title)}.md`, window.chatMarkdown(store.get(chat.id).turns, chat.title)) },
        { label: "Delete", icon: "trash", danger: true, action: () => remove(chat) },
      ],
      anchor,
      { label: `Options for ${chat.title}` },
    );
  }

  function rename(chat) {
    const li = listEl.querySelector(`[data-id="${chat.id}"]`);
    if (!li) return;
    const field = document.createElement("input");
    field.className = "chat-rename";
    field.value = chat.title;
    field.maxLength = TITLE_MAX;
    field.setAttribute("aria-label", "Chat name");
    li.replaceChildren(field);
    field.focus();
    field.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save && field.value.trim() && field.value.trim() !== chat.title) {
        store.rename(chat.id, field.value);
        toast("Chat renamed");
      } else render();
      listEl.querySelector(`[data-id="${chat.id}"] .chat-open`)?.focus();
    };
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      }
    });
    field.addEventListener("blur", () => finish(true));
  }

  async function remove(chat) {
    const ok = await confirmDialog({ title: "Delete this chat?", body: `“${chat.title}” will be removed from this browser. This can't be undone.` });
    if (!ok) return;
    store.remove(chat.id);
    if (chat.id === activeId) window.startNewChat?.();
    toast("Chat deleted");
  }

  clearBtn?.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Delete all chats?", body: "Every saved chat will be removed from this browser. This can't be undone.", confirm: "Delete all" });
    if (!ok) return;
    store.removeAll();
    window.startNewChat?.();
    toast("All chats deleted");
  });

  let searchTimer;
  searchEl?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = searchEl.value.trim();
      render();
    }, 120);
  });
  searchEl?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && searchEl.value) {
      e.stopPropagation();
      searchEl.value = "";
      query = "";
      render();
    }
  });

  // Desktop: the sidebar collapses to give the chat more room (remembered). Phones: it slides
  // in over the chat as a drawer.
  function setDrawer(open) {
    root.classList.toggle("drawer-open", open);
    scrim.hidden = !open;
    toggleBtn.setAttribute("aria-expanded", String(open));
    if (open) searchEl?.focus({ preventScroll: true });
    else if (document.activeElement?.closest?.("#sidebar")) toggleBtn.focus();
  }
  function toggleSidebar() {
    if (narrow.matches) return setDrawer(!root.classList.contains("drawer-open"));
    const collapsed = root.classList.toggle("side-collapsed");
    toggleBtn.setAttribute("aria-expanded", String(!collapsed));
    try {
      localStorage.setItem("farhanai-sidebar", collapsed ? "collapsed" : "open");
    } catch {}
  }
  toggleBtn?.addEventListener("click", toggleSidebar);
  closeBtn?.addEventListener("click", () => (narrow.matches ? setDrawer(false) : toggleSidebar()));
  scrim?.addEventListener("click", () => setDrawer(false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && root.classList.contains("drawer-open") && !document.querySelector("dialog[open], .menu") && setDrawer(false));
  narrow.addEventListener?.("change", () => setDrawer(false));
  toggleBtn?.setAttribute("aria-expanded", String(narrow.matches ? false : !root.classList.contains("side-collapsed")));

  window.addEventListener("farhanai-chats-changed", render);
  window.addEventListener("farhanai-active-chat", (e) => {
    activeId = e.detail;
    listEl.querySelectorAll(".chat-open").forEach((b) => {
      if (b.closest(".chat-item").dataset.id === activeId) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  });
  // Another tab changed the saved chats.
  window.addEventListener("storage", (e) => e.key === INDEX_KEY && render());
  window.FarhanSidebar = { setDrawer, toggle: toggleSidebar };
  render();
})();

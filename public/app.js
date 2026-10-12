// Chat page: keeps the conversation, sends it to /api/chat, and renders the streamed reply.
const messagesEl = document.getElementById("messages");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const newChatBtn = document.getElementById("new-chat");
const bannerEl = document.getElementById("banner");
const counterEl = document.getElementById("counter");

// Give up on a reply that hasn't started after this long.
const FIRST_WORDS_TIMEOUT_MS = 3 * 60 * 1000;

// The conversation so far, sent to the server with every message. A message only joins it once
// it has an answer (or part of one), so trying a failed message again never sends it twice.
let history = [];
let busy = false;
let onlineSite = false; // true on the public website, false on your PC
let current = null; // the reply being written: { controller, stopped }
let lastTurn = null; // the newest message and its reply, which can be tried again
let chatNumber = 0; // goes up with every New chat, so a stopped reply can't add to the next chat
// What's on screen, saved in this browser by chats.js: { user, reply, sources, note } for each
// message that got an answer (or part of one). chatId is null until the first answer is saved.
let turns = [];
let chatId = null;
const MAX_CHARS = 20_000; // the longest message the server accepts

fetch("/api/config")
  .then((r) => r.json())
  .then((c) => {
    document.title = c.appName;
    // "Farhan AI" is shown as a wordmark with "AI" set apart.
    const name = document.getElementById("app-name");
    const [, first, ai] = /^(.*?)\s*(AI)?$/.exec(c.appName);
    name.textContent = first || c.appName;
    if (ai) name.insertAdjacentHTML("beforeend", "<span>AI</span>");
    document.getElementById("welcome").innerHTML = renderMarkdown(c.welcome);
    if (c.creatorMessage) {
      document.getElementById("creator-message").innerHTML = renderMarkdown(c.creatorMessage);
      document.getElementById("creator-note").hidden = false;
    }
    document.getElementById("model").textContent = c.online ? "online" : `${c.model} · on your PC`;
    onlineSite = c.online;
    input.placeholder = `Ask ${c.appName} anything…`;
  })
  .catch(() => {});

// Check that Ollama and the model are ready, and say what to fix if not.
async function checkStatus() {
  try {
    const status = await (await fetch("/api/status")).json();
    bannerEl.textContent = status.ok ? "" : status.error;
    bannerEl.hidden = status.ok;
    document.body.classList.toggle("offline", !status.ok);
  } catch {
    document.body.classList.add("offline");
    bannerEl.textContent = "Can't reach the chatbot server. Double-click start-chatbot.bat and keep its black window open.";
    bannerEl.hidden = false;
  }
}
checkStatus();

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Turns the AI's Markdown into nicely formatted HTML, like ChatGPT: headings, numbered
// lists, tables, code blocks and maths. Maths written in LaTeX (\( \), \[ \], $ and $$)
// is drawn with KaTeX. Everything is cleaned with DOMPurify so a reply can't run code.
const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g;

function renderMath(tex, display) {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
  } catch {
    return escapeHtml(tex);
  }
}

// Code blocks get a language label, colours and a Copy button (code.js).
let plainCode = false; // true while drawing the unfinished end of a streaming reply
if (window.marked && window.renderCodeBlock) marked.use({ renderer: { code: ({ text, lang }) => renderCodeBlock(text, lang, { plain: plainCode }) } });

function renderMarkdown(text) {
  if (!window.marked || !window.DOMPurify) return renderBasic(text);
  // Set code aside so a $ or \( inside code isn't mistaken for maths.
  const code = [];
  let source = text.replace(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g, (m) => `\u0001C${code.push(m) - 1}\u0001`);
  // Set maths aside so Markdown doesn't mangle it (an _ or * in maths would turn into italics).
  const maths = [];
  source = source.replace(MATH_PATTERN, (m, dd, sq, rd, d) => {
    const display = dd !== undefined || sq !== undefined;
    const tex = dd ?? sq ?? rd ?? d;
    if (!window.katex) return m;
    maths.push(renderMath(tex, display));
    const token = `MATHTOKEN${maths.length - 1}X`;
    return display ? `\n\n${token}\n\n` : token;
  });
  source = source.replace(/\u0001C(\d+)\u0001/g, (m, i) => code[i]);
  let html = DOMPurify.sanitize(marked.parse(source, { gfm: true, breaks: true }), { ADD_ATTR: ["target"] });
  html = html.replace(/<p>\s*MATHTOKEN(\d+)X\s*<\/p>/g, (m, i) => maths[i]).replace(/MATHTOKEN(\d+)X/g, (m, i) => maths[i]);
  return html.replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=');
}

// Simple fallback used if the Markdown library didn't load.
function renderBasic(text) {
  const parts = text.split(/```(\w*)\n?([\s\S]*?)(?:```|$)/g);
  let html = "";
  for (let i = 0; i < parts.length; i += 3) {
    html += parts[i]
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .map((p) => {
        const inline = (t) =>
          escapeHtml(t)
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
        const lines = p.trim().split("\n");
        // A block where every line is "- item", "* item" or "1. item" becomes a list.
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
        }
        return `<p>${inline(p).replace(/\n/g, "<br>")}</p>`;
      })
      .join("");
    if (i + 2 < parts.length) html += `<pre><code>${escapeHtml(parts[i + 2])}</code></pre>`;
  }
  return html;
}

// The home screen (greeting and suggestions) shows only while the chat is empty.
function updateHome() {
  document.body.classList.toggle("chatting", !!messagesEl.querySelector(":scope > .row"));
}

// Adds a chat bubble and returns it. Assistant bubbles get the Farhan AI mark beside them.
function addMessage(role, text = "") {
  const row = document.createElement("div");
  row.className = `row ${role}`;
  if (role === "assistant") {
    row.insertAdjacentHTML("afterbegin", '<svg class="avatar" aria-hidden="true"><use href="#mark"/></svg>');
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "user") bubble.textContent = text;
  else bubble.innerHTML = renderMarkdown(text);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  updateHome();
  following = true;
  scrollToEnd();
  return bubble;
}

// Keeps the newest words in view while a reply streams, unless the visitor scrolls up to read
// something; scrolling back down to the end starts following again. This goes by what the
// visitor does (wheel, touch, keys, scrollbar) rather than by position alone, because a fast
// reply would otherwise pull the page back down in the middle of their scroll.
let following = true;
let leftAt = 0; // when the visitor last started scrolling away from the end
const leave = () => {
  following = false;
  leftAt = Date.now();
};
const atEnd = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
messagesEl.addEventListener("wheel", (e) => e.deltaY < 0 && leave(), { passive: true });
messagesEl.addEventListener("touchmove", leave, { passive: true });
messagesEl.addEventListener("pointerdown", (e) => e.target === messagesEl && leave()); // the scrollbar
window.addEventListener("keydown", (e) => {
  if (e.target !== input && ["PageUp", "ArrowUp", "Home"].includes(e.key)) leave();
});
// Back at the end: follow again. Scroll events that were already on their way when the visitor
// started scrolling away (from the page's own scrolling) are ignored.
messagesEl.addEventListener("scroll", () => atEnd() && Date.now() - leftAt > 300 && (following = true), { passive: true });

// Scrolls instantly: the page's smooth scrolling restarts on every frame and would never catch
// up with a fast reply.
function scrollToEnd() {
  messagesEl.style.scrollBehavior = "auto";
  messagesEl.scrollTop = messagesEl.scrollHeight;
  messagesEl.style.scrollBehavior = "";
}
function follow(update) {
  update();
  if (following) scrollToEnd();
}

// While a reply is being written, the send button becomes a stop button.
function setBusy(value) {
  busy = value;
  sendBtn.classList.toggle("stop", value);
  sendBtn.title = value ? "Stop" : "Send";
  sendBtn.setAttribute("aria-label", value ? "Stop the reply" : "Send");
  messagesEl.querySelectorAll(".retry").forEach((b) => (b.disabled = value));
  document.body.classList.toggle("busy", value);
}

function stopReply() {
  if (!current) return;
  current.stopped = true;
  current.controller.abort();
}

// Pictures and links from the AI's web searches, shown above its answer.
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function showSources(container, data) {
  container.hidden = false;
  const images = (data.images || []).filter((img) => safeUrl(img.url) && img.url.startsWith("https:"));
  let shots = container.querySelector(".shots");
  if (images.length && !shots) {
    shots = document.createElement("div");
    shots.className = "shots";
    container.prepend(shots);
  }
  for (const img of images) {
    if (shots.children.length >= 4) break;
    const link = document.createElement("a");
    link.href = img.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const pic = document.createElement("img");
    pic.src = img.url;
    pic.alt = img.caption || data.query;
    pic.loading = "lazy";
    pic.referrerPolicy = "no-referrer";
    pic.onerror = () => link.remove(); // some sites don't allow their pictures to be shown elsewhere
    link.appendChild(pic);
    shots.appendChild(link);
  }
  let list = container.querySelector(".source-list");
  if (!list) {
    const label = document.createElement("div");
    label.className = "sources-label";
    label.textContent = data.provider === "wikipedia" ? "Searched Wikipedia" : "Searched the web";
    list = document.createElement("div");
    list.className = "source-list";
    container.append(label, list);
  }
  for (const r of data.results || []) {
    const url = safeUrl(r.url);
    if (!url) continue;
    const card = document.createElement("a");
    card.className = "source";
    card.href = url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    const thumb = safeUrl(r.image || r.icon);
    if (thumb && thumb.startsWith("https:")) {
      const pic = document.createElement("img");
      pic.src = thumb;
      pic.alt = "";
      pic.loading = "lazy";
      pic.referrerPolicy = "no-referrer";
      pic.onerror = () => pic.remove();
      card.appendChild(pic);
    }
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = r.n;
    const title = document.createElement("span");
    title.className = "t";
    title.textContent = r.title;
    const site = document.createElement("span");
    site.className = "site";
    site.textContent = new URL(url).hostname.replace(/^www\./, "");
    card.append(n, title, site);
    list.appendChild(card);
  }
}

// Turns the AI's [1] style citations in `root` into links to those sources. Only plain text is
// changed: code, maths and links are left alone, so `items[1]` in code stays exactly as written.
function linkCitations(root, links) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("pre, code, a, .katex") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    const text = node.nodeValue.replace(/【[^】]*】/g, ""); // the model's own source markers
    const parts = [];
    let from = 0;
    for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
      if (!links[m[1]]) continue;
      const link = document.createElement("a");
      link.className = "cite";
      link.href = links[m[1]];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = m[1];
      parts.push(text.slice(from, m.index), link);
      from = m.index + m[0].length;
    }
    if (parts.length) node.replaceWith(...parts, text.slice(from));
    else if (text !== node.nodeValue) node.nodeValue = text;
  }
}

// Where the finished part of a streaming reply ends: the start of the newest line that follows a
// blank line, sits outside code blocks and maths, and doesn't start with a space (an indented line
// may still belong to the list or code above it). Everything before it is complete and won't
// change as more words arrive. `from` must itself be such a place (or 0).
function finishedUpTo(text, from) {
  let cut = from;
  let fence = ""; // the ``` or ~~~ that opened the code block we're in
  let displayMath = false; // inside $$ … $$
  let brackets = 0; // inside \[ … \] or \( … \)
  let afterBlank = false;
  let pos = from;
  for (let end; (end = text.indexOf("\n", pos)) !== -1; pos = end + 1) {
    const line = text.slice(pos, end);
    if (afterBlank && !fence && !displayMath && !brackets && /^\S/.test(line)) cut = pos;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) fence = marker;
    else if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) fence = "";
    else if (!fence) {
      const plain = line.replace(/`[^`]*`/g, "");
      for (const m of plain.matchAll(/\$\$|\\[[(]|\\[\])]/g)) {
        if (m[0] === "$$") displayMath = !displayMath;
        else if (m[0][1] === "[" || m[0][1] === "(") brackets++;
        else brackets = Math.max(0, brackets - 1);
      }
    }
    afterBlank = !line.trim();
  }
  return cut;
}

// Draws a reply into `el` while it streams. Finished blocks (paragraphs, lists, code…) are drawn
// once and kept; each update only redraws the unfinished last block. Redrawing the whole reply on
// every update made long answers freeze the page. finish() draws the reply once more in full, so
// the end result is exactly what drawing it all at once gives.
function streamRenderer(el, links) {
  let kept = 0; // characters already drawn as finished blocks
  let tail = []; // the nodes of the unfinished block
  const draw = (markdown, unfinished = false) => {
    const t = document.createElement("template");
    plainCode = unfinished;
    try {
      t.innerHTML = renderMarkdown(markdown);
    } finally {
      plainCode = false;
    }
    linkCitations(t.content, links);
    const nodes = [...t.content.childNodes];
    el.append(t.content);
    return nodes;
  };
  return {
    update(text) {
      for (const node of tail) node.remove();
      const cut = finishedUpTo(text, kept);
      if (cut > kept) {
        draw(text.slice(kept, cut));
        kept = cut;
      }
      tail = draw(text.slice(kept), true);
    },
    finish(text) {
      el.replaceChildren();
      draw(text);
      tail = [];
      kept = text.length;
    },
  };
}

// Why a reply failed, in words for the visitor.
function failureMessage(err) {
  if (err.name === "AbortError") {
    return onlineSite
      ? "the AI didn't answer in time. Please try again."
      : "the AI model didn't answer within 3 minutes. Check the black chatbot window for a message, and make sure the Ollama app is running.";
  }
  if (err instanceof TypeError) {
    return onlineSite
      ? "lost connection to the website. Check your internet and try again."
      : "can't reach the chatbot server. Double-click start-chatbot.bat and keep its black window open.";
  }
  return err.message;
}

// Sends a message and shows the reply as it streams in.
// hooks (used by voice mode): onText(chunk) for each piece of the reply, onStatus(message), onError(message).
// Returns the full reply, or null if it was stopped or something went wrong.
async function send(text, hooks = {}) {
  if (busy) return null;
  const userRow = addMessage("user", text).parentElement;
  return answer(text, userRow, hooks);
}

// Gets and shows the reply to `text`, whose bubble is already on the page.
async function answer(text, userRow, hooks = {}) {
  lastTurn?.replyRow.querySelector(".turn-actions")?.remove(); // only the newest message can be tried again
  const replyEl = addMessage("assistant");
  const turn = (lastTurn = { text, userRow, replyRow: replyEl.parentElement, saved: false, chat: chatNumber, sources: [] });
  replyEl.parentElement.classList.add("streaming");
  const sourcesEl = document.createElement("div");
  sourcesEl.className = "sources";
  sourcesEl.hidden = true;
  const answerEl = document.createElement("div");
  replyEl.append(sourcesEl, answerEl);
  const links = {};
  let statusText = "";
  const reply = (current = { controller: new AbortController(), stopped: false });
  setBusy(true);

  // While waiting for the first words, show how long it's been.
  const started = Date.now();
  const showWaiting = () => {
    const secs = Math.round((Date.now() - started) / 1000);
    let note = "";
    if (statusText) note = statusText;
    else if (secs >= 5) note = `Thinking… ${secs}s`;
    if (secs >= 15 && !statusText && !onlineSite) note += " · the first reply can take a minute or two while the model loads";
    answerEl.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>${note ? `<div class="wait-note">${note}</div>` : ""}`;
  };
  showWaiting();
  const waitingTimer = setInterval(showWaiting, 1000);
  const giveUp = setTimeout(() => reply.controller.abort(), FIRST_WORDS_TIMEOUT_MS);
  const stopWaiting = () => {
    clearInterval(waitingTimer);
    clearTimeout(giveUp);
  };

  // Keeps this message and its reply in the conversation (unless a new chat has started since).
  const save = (content) => {
    if (turn.chat !== chatNumber) return;
    history.push({ role: "user", content: text }, { role: "assistant", content });
    turn.saved = true;
    turn.record = { user: text, reply: content, sources: turn.sources, note: "" };
    turns.push(turn.record);
    persist();
  };

  let replyText = "";
  let finished = false;
  let ended = false;
  let renderQueued = false;
  const renderer = streamRenderer(answerEl, links);
  const renderAnswer = () => {
    renderQueued = false;
    if (replyText && !ended) follow(() => renderer.update(replyText));
  };
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [...history, { role: "user", content: text }],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      signal: reply.controller.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server error ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = /^event: (.*)$/m.exec(raw)?.[1];
        let data;
        try {
          data = JSON.parse(/^data: (.*)$/m.exec(raw)?.[1] || "{}");
        } catch {
          continue; // a garbled event: skip it rather than lose the whole reply
        }
        if (event === "text") {
          if (!replyText) {
            stopWaiting();
            answerEl.replaceChildren();
          }
          replyText += data.text;
          hooks.onText?.(data.text);
          if (!renderQueued) {
            renderQueued = true;
            requestAnimationFrame(renderAnswer); // redraw at most once per frame while it streams
          }
        } else if (event === "status") {
          statusText = data.text;
          hooks.onStatus?.(data.text);
          if (!replyText) showWaiting();
        } else if (event === "sources") {
          for (const r of data.results || []) if (safeUrl(r.url)) links[r.n] = safeUrl(r.url);
          turn.sources.push(data);
          follow(() => showSources(sourcesEl, data));
        } else if (event === "done") {
          ended = finished = true;
          follow(() => renderer.finish(replyText));
          if (!replyText) answerEl.textContent = "(The model sent back an empty reply. Try asking again.)";
          save(data.content);
          break;
        } else if (event === "error") {
          throw new Error(data.message);
        }
      }
    }
    if (!finished) throw new Error("The connection closed before the reply finished. Is the black chatbot window still open?");
    reader.cancel().catch(() => {});
  } catch (err) {
    ended = true;
    stopWaiting();
    const message = reply.stopped ? null : failureMessage(err);
    follow(() => {
      if (replyText) {
        // Keep the words that already arrived, and say the reply isn't complete.
        renderer.finish(replyText);
        save(replyText);
        const note = reply.stopped ? "Stopped" : `Interrupted: ${message}`;
        addNote(replyEl, note, !reply.stopped);
        if (turn.record) {
          turn.record.note = note;
          persist();
        }
      } else if (reply.stopped) {
        answerEl.replaceChildren();
        addNote(replyEl, "Stopped before it answered");
      } else {
        replyEl.classList.add("error");
        replyEl.textContent = `Error: ${message}`;
      }
      if (turn.chat === chatNumber) addRetry(turn);
    });
    if (!reply.stopped) {
      checkStatus();
      hooks.onError?.(message);
    }
  } finally {
    stopWaiting();
    turn.replyRow.classList.remove("streaming");
    if (current === reply) current = null;
    setBusy(false);
    if (!hooks.onText) input.focus();
  }
  return finished ? replyText : null;
}

// A short line under a reply that was stopped or cut off.
function addNote(bubble, text, problem = false) {
  const note = document.createElement("div");
  note.className = problem ? "turn-note problem" : "turn-note";
  note.textContent = text;
  bubble.appendChild(note);
}

// A "Try again" button under the newest reply when it didn't finish. It asks again in place:
// the message isn't added a second time, and the unfinished reply is replaced.
function addRetry(turn) {
  const actions = document.createElement("div");
  actions.className = "turn-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "retry";
  button.textContent = "Try again";
  button.addEventListener("click", () => {
    if (busy || turn !== lastTurn) return;
    if (turn.saved) {
      history.splice(-2, 2);
      turns.pop();
      persist();
    }
    turn.replyRow.remove();
    answer(turn.text, turn.userRow);
  });
  actions.appendChild(button);
  turn.replyRow.querySelector(".bubble").appendChild(actions);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return; // while a reply is being written, keep what's typed for later
  if (text.length > MAX_CHARS) {
    window.FarhanUI?.toast(`That message is too long. Please keep it under ${MAX_CHARS.toLocaleString("en-GB")} characters.`, { kind: "error" });
    return;
  }
  input.value = "";
  composerChanged();
  send(text);
});

// While a reply is being written, the send button stops it instead.
sendBtn.addEventListener("click", (e) => {
  if (!busy) return;
  e.preventDefault();
  stopReply();
});

// Enter sends and Shift+Enter starts a new line. On phones and tablets Enter starts a new line
// (their keyboards have no Shift), and the send button sends. Enter that finishes typing a
// word in an input method (Chinese, Japanese…) is left alone.
const touchKeyboard = window.matchMedia("(pointer: coarse)");
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !touchKeyboard.matches) {
    e.preventDefault();
    form.requestSubmit();
  }
});

// The box grows with what's typed (up to a limit), the length shows only when it's getting
// close to the limit, and an unsent message is kept if the page is closed or reloaded.
const DRAFT_KEY = "farhanai-draft";
let draftTimer;
function composerChanged() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, Math.round(innerHeight * 0.4))}px`;
  const n = input.value.length;
  counterEl.hidden = n < MAX_CHARS * 0.75;
  counterEl.textContent = `${n.toLocaleString("en-GB")} / ${MAX_CHARS.toLocaleString("en-GB")}`;
  counterEl.classList.toggle("over", n > MAX_CHARS);
  form.classList.toggle("has-text", !!input.value.trim());
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      if (input.value.trim()) localStorage.setItem(DRAFT_KEY, input.value);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, 300);
}
input.addEventListener("input", composerChanged);
try {
  const draft = localStorage.getItem(DRAFT_KEY);
  if (draft && !input.value) {
    input.value = draft;
    composerChanged();
  }
} catch {}

document.getElementById("talk")?.addEventListener("click", () => window.FarhanPanels?.goTo(1));

// Saves the current chat in this browser (see chats.js).
function persist() {
  if (!window.FarhanChats || (!turns.length && !chatId)) return;
  const id = window.FarhanChats.save(chatId, turns);
  if (id && id !== chatId) {
    chatId = id;
    window.dispatchEvent(new CustomEvent("farhanai-active-chat", { detail: chatId }));
  }
}

// Empties the chat on screen and starts afresh. A reply being written is stopped first.
function clearChat() {
  stopReply();
  chatNumber++;
  window.dispatchEvent(new Event("farhanai-new-chat"));
  history = [];
  turns = [];
  chatId = null;
  lastTurn = null;
  messagesEl.querySelectorAll(":scope > .row").forEach((m) => m.remove());
  updateHome();
  window.dispatchEvent(new CustomEvent("farhanai-active-chat", { detail: null }));
}

function startNewChat() {
  clearChat();
  window.FarhanPanels?.goTo(0);
  input.focus();
}
newChatBtn.addEventListener("click", startNewChat);
document.getElementById("side-new")?.addEventListener("click", () => {
  startNewChat();
  if (window.matchMedia("(max-width: 860px)").matches) window.FarhanSidebar?.setDrawer(false);
});

// Opens a saved chat: shows its messages and carries on the conversation from there.
function openChat(id) {
  const chat = window.FarhanChats?.get(id);
  if (!chat) return false;
  clearChat();
  chatId = id;
  for (const t of chat.turns) {
    addMessage("user", t.user);
    const bubble = addMessage("assistant");
    const links = {};
    if (t.sources.length) {
      const sourcesEl = document.createElement("div");
      sourcesEl.className = "sources";
      for (const data of t.sources) {
        for (const r of data.results || []) if (safeUrl(r.url)) links[r.n] = safeUrl(r.url);
        showSources(sourcesEl, data);
      }
      bubble.appendChild(sourcesEl);
    }
    const answerEl = document.createElement("div");
    bubble.appendChild(answerEl);
    streamRenderer(answerEl, links).finish(t.reply);
    if (t.note) addNote(bubble, t.note, t.note !== "Stopped");
    history.push({ role: "user", content: t.user }, { role: "assistant", content: t.reply });
    turns.push(t);
  }
  following = true;
  scrollToEnd();
  window.dispatchEvent(new CustomEvent("farhanai-active-chat", { detail: chatId }));
  window.FarhanPanels?.goTo(0);
  return true;
}

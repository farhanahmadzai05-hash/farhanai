// Chat page: keeps the conversation, sends it to /api/chat, and renders the streamed reply.
const messagesEl = document.getElementById("messages");
const chipsEl = document.getElementById("chips");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const newChatBtn = document.getElementById("new-chat");
const bannerEl = document.getElementById("banner");

// Give up on a reply that hasn't started after this long.
const FIRST_WORDS_TIMEOUT_MS = 3 * 60 * 1000;

// Full conversation, sent to the server with every message.
let history = [];
let busy = false;
let onlineSite = false; // true on the public website, false on your PC

fetch("/api/config")
  .then((r) => r.json())
  .then((c) => {
    document.title = c.appName;
    document.getElementById("app-name").textContent = c.appName;
    document.getElementById("welcome").innerHTML = renderMarkdown(c.welcome);
    if (c.creatorMessage) {
      document.getElementById("creator-message").innerHTML = renderMarkdown(c.creatorMessage);
      document.getElementById("creator-note").hidden = false;
    }
    document.getElementById("model").textContent = c.online ? "online" : `${c.model} · on your PC`;
    onlineSite = c.online;
    input.placeholder = `Message ${c.appName}…`;
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

// Minimal, safe Markdown: code blocks, inline code, bold, italics, paragraphs.
function renderMarkdown(text) {
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

// Adds a chat bubble and returns it. Assistant bubbles get the app's logo beside them.
function addMessage(role, text = "") {
  chipsEl.hidden = true;
  const row = document.createElement("div");
  row.className = `row ${role}`;
  if (role === "assistant") {
    const avatar = document.createElement("img");
    avatar.src = "/icon.svg";
    avatar.alt = "";
    avatar.className = "avatar";
    row.appendChild(avatar);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "user") bubble.textContent = text;
  else bubble.innerHTML = renderMarkdown(text);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
}

async function send(text) {
  history.push({ role: "user", content: text });
  addMessage("user", text);
  const replyEl = addMessage("assistant");
  setBusy(true);

  // While waiting for the first words, show how long it's been.
  const started = Date.now();
  const showWaiting = () => {
    const secs = Math.round((Date.now() - started) / 1000);
    let note = "";
    if (secs >= 5) note = `Thinking… ${secs}s`;
    if (secs >= 15) note += " · the first reply can take a minute or two while the model loads";
    replyEl.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>${note ? `<div class="wait-note">${note}</div>` : ""}`;
  };
  showWaiting();
  const waitingTimer = setInterval(showWaiting, 1000);
  const controller = new AbortController();
  const giveUp = setTimeout(() => controller.abort(), FIRST_WORDS_TIMEOUT_MS);
  const stopWaiting = () => {
    clearInterval(waitingTimer);
    clearTimeout(giveUp);
  };

  let replyText = "";
  let finished = false;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server error ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = /^event: (.*)$/m.exec(raw)?.[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(raw)?.[1] || "{}");
        if (event === "text") {
          stopWaiting();
          replyText += data.text;
          replyEl.innerHTML = renderMarkdown(replyText);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if (event === "done") {
          history.push({ role: "assistant", content: data.content });
          if (!replyText) replyEl.textContent = "(The model sent back an empty reply. Try asking again.)";
          finished = true;
        } else if (event === "error") {
          throw new Error(data.message);
        }
      }
    }
    if (!finished) throw new Error("The connection closed before the reply finished. Is the black chatbot window still open?");
  } catch (err) {
    history.pop(); // drop the unanswered user turn so the conversation stays valid
    replyEl.classList.add("error");
    replyEl.textContent =
      err.name === "AbortError"
        ? onlineSite
          ? "Error: the AI didn't answer in time. Please try again."
          : "Error: the AI model didn't answer within 3 minutes. Check the black chatbot window for a message, and make sure the Ollama app is running."
        : err instanceof TypeError
          ? onlineSite
            ? "Error: lost connection to the website. Check your internet and try again."
            : "Error: can't reach the chatbot server. Double-click start-chatbot.bat and keep its black window open."
          : `Error: ${err.message}`;
    checkStatus();
  } finally {
    stopWaiting();
      setBusy(false);
    input.focus();
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  input.style.height = "";
  send(text);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
});

newChatBtn.addEventListener("click", () => {
  if (busy) return;
  history = [];
  messagesEl.querySelectorAll(":scope > .row").forEach((m) => m.remove());
  chipsEl.hidden = false;
  input.focus();
});

// Suggestion buttons on the welcome screen send their text as a message.
document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    if (!busy) send(chip.textContent);
  }),
);

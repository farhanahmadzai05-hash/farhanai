// Small web chat server: serves the chat page and streams replies from an AI model.
// On your PC it uses Ollama (https://ollama.com). Online (when GROQ_API_KEY is set)
// it uses Groq's free API (https://console.groq.com) instead.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, spawn } from "node:child_process";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, "public");

// Your app's name, greeting and personality live in settings.json.
let settings = {};
try {
  settings = JSON.parse(await readFile(path.join(APP_DIR, "settings.json"), "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") {
    console.log(`Problem reading settings.json (${err.message}). Using the default settings.`);
    console.log("Tip: every value needs \"quotes\" around it, and every line except the last needs a comma at the end.\n");
  }
}

const APP_NAME = settings.appName || "Chatbot";
// The first message visitors see, and an optional note from the creator under it (Markdown).
const WELCOME = settings.welcome || settings.greeting || "Hi! Ask me anything to get started.";
const CREATOR_MESSAGE = settings.creatorMessage || "";
const PORT = Number(process.env.PORT) || Number(settings.port) || 3000;
// Online mode: a website host sets GROQ_API_KEY, and replies come from Groq.
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ONLINE = Boolean(GROQ_API_KEY);
const GROQ_URL = (process.env.GROQ_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const MODEL = ONLINE
  ? process.env.GROQ_MODEL || settings.onlineModel || "openai/gpt-oss-120b"
  : process.env.OLLAMA_MODEL || settings.model || "llama3.2";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  settings.personality ||
  "You are a friendly, helpful assistant. Answer clearly and concisely, and use Markdown when it helps.";

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/favicon.ico": ["favicon.ico", "image/x-icon"],
  "/music.js": ["music.js", "text/javascript; charset=utf-8"],
  "/splash.js": ["splash.js", "text/javascript; charset=utf-8"],
  // Optional: drop your own song into the public folder with one of these names.
  "/music.mp3": ["music.mp3", "audio/mpeg"],
  "/music.m4a": ["music.m4a", "audio/mp4"],
  "/music.ogg": ["music.ogg", "audio/ogg"],
};

function readBody(req, limit = 5_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Checks that Ollama is running and the model is downloaded.
// Returns { ok: true } or { ok: false, error: "what to do about it" }.
async function checkOllama() {
  let tags;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    tags = await res.json();
  } catch {
    return { ok: false, error: "Can't reach Ollama. Open the Ollama app from the Start menu (or install it from ollama.com), then reload this page." };
  }
  const names = (tags.models || []).map((m) => m.name);
  const wanted = MODEL.includes(":") ? MODEL : `${MODEL}:latest`;
  if (!names.includes(wanted)) {
    return { ok: false, error: `The AI model "${MODEL}" isn't downloaded yet. Press the Windows key, type cmd, press Enter, run: ollama pull ${MODEL}  then reload this page.` };
  }
  return { ok: true };
}

function checkModel() {
  return ONLINE ? { ok: true } : checkOllama();
}

// Yields the reply from Ollama piece by piece.
async function* streamOllama(messages, signal) {
  let upstream;
  try {
    upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, stream: true, messages }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new Error("Can't reach Ollama. Make sure the Ollama app is installed and running, then try again.");
  }
  if (!upstream.ok) {
    const detail = (await upstream.json().catch(() => ({}))).error || `status ${upstream.status}`;
    if (/not found/i.test(detail)) {
      throw new Error(`The model "${MODEL}" isn't downloaded yet. In a terminal, run: ollama pull ${MODEL}`);
    }
    throw new Error(`Ollama error: ${detail}`);
  }
  // Ollama streams one JSON object per line.
  for await (const line of lines(upstream.body)) {
    const part = JSON.parse(line);
    if (part.error) throw new Error(`Ollama error: ${part.error}`);
    if (part.message?.content) yield part.message.content;
  }
}

// Yields the reply from Groq's OpenAI-compatible API piece by piece.
// Groq models we'd like to use online, best first. If the chosen model isn't
// available to your Groq account, the site switches to one of these by itself.
const GROQ_PREFERRED = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
let groqModel = MODEL;

async function pickAvailableGroqModel() {
  const res = await fetch(`${GROQ_URL}/models`, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
  const ids = ((await res.json().catch(() => ({}))).data || []).map((m) => m.id);
  const chat = ids.filter((id) => !/whisper|tts|guard|playai|orpheus/i.test(id));
  return GROQ_PREFERRED.find((id) => chat.includes(id)) || chat[0];
}

async function callGroq(messages, signal) {
  try {
    return await fetch(`${GROQ_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: groqModel, stream: true, messages }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    console.log(`Can't reach Groq: ${err.message}`);
    throw new Error("Can't reach the AI service right now. Please try again in a moment.");
  }
}

// Yields the reply from Groq's OpenAI-compatible API piece by piece.
async function* streamGroq(messages, signal) {
  let upstream = await callGroq(messages, signal);
  let detail = "";
  if (upstream.status === 404 || upstream.status === 400) {
    detail = (await upstream.json().catch(() => ({}))).error?.message || "";
    // The model was retired or isn't on this account's plan: switch to one that is.
    if (/model/i.test(detail) && /(not exist|not have access|decommissioned|deprecated|not found)/i.test(detail)) {
      const replacement = await pickAvailableGroqModel().catch(() => null);
      if (replacement && replacement !== groqModel) {
        console.log(`Groq model "${groqModel}" isn't available (${detail}). Switching to "${replacement}".`);
        groqModel = replacement;
        upstream = await callGroq(messages, signal);
        detail = "";
      }
    }
  }
  if (!upstream.ok) {
    detail ||= (await upstream.json().catch(() => ({}))).error?.message || `status ${upstream.status}`;
    console.log(`Groq error (${upstream.status}): ${detail}`);
    if (upstream.status === 401) throw new Error("The website's Groq API key is wrong or missing. Check GROQ_API_KEY in the host's settings.");
    if (upstream.status === 429) throw new Error("Lots of people are chatting right now. Please wait a minute and try again.");
    throw new Error(`The AI service had a problem: ${detail}`);
  }
  // Server-sent events: lines like "data: {...}", ending with "data: [DONE]".
  for await (const line of lines(upstream.body)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    const text = JSON.parse(data).choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

// Splits a streamed response body into non-empty lines.
async function* lines(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

// Keeps one visitor from using up the free AI allowance: at most
// RATE_LIMIT messages per IP address every 10 minutes.
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 30;
const recent = new Map();
function allowed(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
  const now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (times.length >= RATE_LIMIT) return false;
  times.push(now);
  recent.set(ip, times);
  return true;
}

// Streams one assistant turn back as server-sent events:
//   text  -> {text}      a piece of the reply as it is written
//   done  -> {content}   the full reply text to keep in the history
//   error -> {message}
async function handleChat(req, res) {
  let messages;
  try {
    ({ messages } = JSON.parse(await readBody(req)));
    if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages must be a non-empty array");
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return;
  }

  if (!allowed(req)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "You're sending messages very quickly. Please wait a few minutes and try again." }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const started = Date.now();
  const last = messages[messages.length - 1];
  // On your PC the black window shows what you typed; online, visitors' messages stay private.
  if (!ONLINE) {
    console.log(`\nYou: ${String(last?.content ?? "").slice(0, 80)}`);
    console.log("Waiting for the AI model to answer...");
  }

  try {
    // Keep only recent, reasonably sized messages so long chats stay fast and cheap.
    const convo = messages.slice(-20).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? "").slice(0, 8000),
    }));
    const stream = (ONLINE ? streamGroq : streamOllama)(
      [{ role: "system", content: SYSTEM_PROMPT }, ...convo],
      abort.signal,
    );
    let full = "";
    for await (const text of stream) {
      if (!full && !ONLINE) console.log(`First words arrived after ${((Date.now() - started) / 1000).toFixed(1)}s.`);
      full += text;
      send("text", { text });
    }
    send("done", { content: full });
    if (!ONLINE) console.log(`Reply finished in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } catch (err) {
    if (abort.signal.aborted) {
      console.log("The browser stopped waiting for this reply.");
    } else {
      console.log(`Error: ${err.message}`);
      if (!res.writableEnded) send("error", { message: err.message });
    }
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/chat") return handleChat(req, res);
  if (req.method === "GET" && url.pathname === "/api/config") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ appName: APP_NAME, welcome: WELCOME, creatorMessage: CREATOR_MESSAGE, model: MODEL, online: ONLINE }));
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(await checkModel()));
  }
  const file = ["GET", "HEAD"].includes(req.method) && STATIC_FILES[url.pathname];
  let body;
  try {
    body = file && (await readFile(path.join(PUBLIC_DIR, file[0])));
  } catch {
    body = null; // e.g. no music file has been added
  }
  if (!body) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": file[1], "Content-Length": body.length, "Cache-Control": "no-cache" });
  res.end(req.method === "HEAD" ? undefined : body);
});

// Shares the app on the internet through a free Cloudflare quick tunnel
// (no account needed). The address changes every time it starts.
function goOnline() {
  console.log("\nGetting a public web address from Cloudflare...");
  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`]);
  let found = false;
  const watch = (data) => {
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(data.toString())?.[0];
    if (url && !found) {
      found = true;
      console.log("\n==============================================================");
      console.log(`  ${APP_NAME} is ONLINE at:  ${url}`);
      console.log("  Share this address with anyone. It works while this window");
      console.log("  stays open and your PC is on. It changes each time you start.");
      console.log("==============================================================\n");
    }
  };
  tunnel.stdout.on("data", watch);
  tunnel.stderr.on("data", watch);
  tunnel.on("error", (err) => {
    if (err.code === "ENOENT") {
      console.log("\nCan't go online yet: Cloudflare's free tool (cloudflared) isn't installed.");
      console.log("Close this window and double-click go-online.bat again; it will install it for you.");
    } else console.log(`Problem going online: ${err.message}`);
  });
  tunnel.on("exit", (code) => {
    if (code) console.log(`The public web address stopped (code ${code}). Your app still works at http://localhost:${PORT}`);
  });
  process.on("exit", () => tunnel.kill());
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} is already in use. The chatbot may already be running in another black window: close it and try again.`);
  } else console.log(`Error: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, async () => {
  console.log(`${APP_NAME} is running at http://localhost:${PORT} (model: ${MODEL})`);
  console.log("Open that address in your browser. Close this window to stop the chatbot.");
  // start-chatbot.bat sets OPEN_BROWSER so double-clicking it opens the chat page.
  if (process.env.OPEN_BROWSER && process.platform === "win32") exec(`start "" http://localhost:${PORT}`);

  // go-online.bat sets GO_ONLINE to share the app at a public web address.
  if (process.env.GO_ONLINE) goOnline();

  if (ONLINE) return console.log("Online mode: replies come from Groq.");

  console.log("\nChecking Ollama...");
  const status = await checkOllama();
  if (!status.ok) return console.log(`Problem: ${status.error}`);
  // Load the model into memory now so the first reply doesn't have to wait for it.
  console.log(`Ollama is running and "${MODEL}" is downloaded. Loading the model (this can take a minute the first time)...`);
  const started = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: "", keep_alive: "30m" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(body.error || `status ${res.status}`);
    console.log(`Model loaded in ${((Date.now() - started) / 1000).toFixed(1)}s. Ready to chat!`);
  } catch (err) {
    console.log(`Problem loading the model: ${err.message}`);
  }
});

// Small web chat server: serves the chat page and streams replies from an AI model.
// On your PC it uses Ollama (https://ollama.com). Online (when GROQ_API_KEY is set)
// it uses Groq's free API (https://console.groq.com) instead.
import http from "node:http";
import net from "node:net";
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

// ---------- Limits and timeouts ----------
// Each can be changed in the host's environment settings without touching the code.
const setting = (name, fallback) => {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(value) ? value : fallback;
};
// How many proxies in front of the app add the visitor's address to X-Forwarded-For.
// Render has one, and sets RENDER; on your PC there are none, so the header is ignored.
const TRUST_PROXY_HOPS = setting("TRUST_PROXY_HOPS", process.env.RENDER ? 1 : 0);
const RATE_LIMIT = setting("RATE_LIMIT", 30); // messages per visitor every 10 minutes
const MAX_ACTIVE_PER_VISITOR = setting("MAX_ACTIVE_PER_VISITOR", 1); // replies running at once
const DAILY_AI_CALLS = setting("DAILY_AI_CALLS", 1000); // AI requests for the whole site per day (0 = no limit)
const FIRST_BYTE_TIMEOUT_MS = setting("GROQ_FIRST_BYTE_TIMEOUT_MS", 20_000); // wait for the AI to start
const IDLE_TIMEOUT_MS = setting("GROQ_IDLE_TIMEOUT_MS", 30_000); // longest pause allowed mid-reply
const SEARCH_TIMEOUT_MS = setting("SEARCH_TIMEOUT_MS", 8000);
const HEARTBEAT_MS = setting("HEARTBEAT_MS", 15_000); // keeps proxies from closing a quiet stream

// An error whose message is safe and useful to show visitors. Anything else is logged on the
// server and replaced by a general message, so provider internals never reach the page.
class VisitorError extends Error {}
const GENERAL_ERROR = "Something went wrong on Farhan AI's side. Please try again in a moment.";
const RESTING = "Farhan AI is resting after a busy day. Please come back tomorrow.";
class TimedOut extends Error {}

// A signal that fires when `parent` does or after `ms`, whichever is first. restart() sets a
// new time limit from now; done() tidies up.
function deadline(parent, ms, what) {
  const controller = new AbortController();
  const stop = () => controller.abort(parent.reason);
  if (parent.aborted) stop();
  else parent.addEventListener("abort", stop, { once: true });
  let timer;
  const restart = (limit, label) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new TimedOut(`${label} took longer than ${limit}ms`)), limit);
  };
  restart(ms, what);
  return {
    signal: controller.signal,
    restart,
    done: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", stop);
    },
  };
}

// The site-wide daily allowance of AI requests, so no one can spend the free quota for everyone.
const budget = { day: "", used: 0 };
function budgetSpent() {
  const today = new Date().toISOString().slice(0, 10); // resets at midnight UTC
  if (budget.day !== today) Object.assign(budget, { day: today, used: 0 });
  return DAILY_AI_CALLS > 0 && budget.used >= DAILY_AI_CALLS;
}
function spendAiCall() {
  if (budgetSpent()) throw new VisitorError(RESTING);
  budget.used++;
}

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/favicon.ico": ["favicon.ico", "image/x-icon"],
  "/music.js": ["music.js", "text/javascript; charset=utf-8"],
  "/splash.js": ["splash.js", "text/javascript; charset=utf-8"],
  "/panels.js": ["panels.js", "text/javascript; charset=utf-8"],
  "/voice.js": ["voice.js", "text/javascript; charset=utf-8"],
  "/bugfixes.js": ["bugfixes.js", "text/javascript; charset=utf-8"],
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
    throw new VisitorError("Can't reach Ollama. Make sure the Ollama app is installed and running, then try again.");
  }
  if (!upstream.ok) {
    const detail = (await upstream.json().catch(() => ({}))).error || `status ${upstream.status}`;
    if (/not found/i.test(detail)) {
      throw new VisitorError(`The model "${MODEL}" isn't downloaded yet. In a terminal, run: ollama pull ${MODEL}`);
    }
    throw new VisitorError(`Ollama error: ${detail}`);
  }
  // Ollama streams one JSON object per line.
  for await (const line of lines(upstream.body)) {
    const part = parseLine(line);
    if (!part) continue;
    if (part.error) throw new VisitorError(`Ollama error: ${part.error}`);
    if (part.message?.content) yield part.message.content;
  }
}

// ---------- Groq ----------
// Groq models we'd like to use online, best first. If the chosen model isn't
// available to your Groq account, the site switches to one of these by itself.
const GROQ_PREFERRED = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
let groqModel = MODEL;

async function pickAvailableGroqModel() {
  const res = await fetch(`${GROQ_URL}/models`, {
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    signal: AbortSignal.timeout(5000),
  });
  const ids = ((await res.json().catch(() => ({}))).data || []).map((m) => m.id);
  const chat = ids.filter((id) => !/whisper|tts|guard|playai|orpheus/i.test(id));
  return GROQ_PREFERRED.find((id) => chat.includes(id)) || chat[0];
}

// Starts one request to Groq and resolves once Groq starts answering. Gives up after
// FIRST_BYTE_TIMEOUT_MS. Every request counts against the site's daily budget.
// Returns the call: call.res is Groq's response, call.restart() changes the time limit and
// call.done() tidies up.
async function callGroq(messages, signal, extra, model) {
  spendAiCall();
  const call = deadline(signal, FIRST_BYTE_TIMEOUT_MS, `Groq model "${model}" starting to answer`);
  try {
    const res = await fetch(`${GROQ_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model, stream: true, messages, ...extra }),
      signal: call.signal,
    });
    return Object.assign(call, { res });
  } catch (err) {
    call.done();
    if (signal.aborted) throw err;
    if (call.signal.reason instanceof TimedOut) throw call.signal.reason;
    throw new Error(`Can't reach Groq: ${err.message}`);
  }
}

// Groq's free plan limits how much each model can do per minute (and per day). When a model
// is busy, wait a moment if the wait is short; otherwise answer with the next free model, which
// has its own separate allowance. Busy models are skipped until their limit resets.
const busyUntil = new Map();
const rest = (model, seconds) => busyUntil.set(model, Date.now() + Math.min(seconds, 24 * 3600) * 1000);
const SHORT_WAIT = Number(process.env.GROQ_SHORT_WAIT ?? 6); // seconds worth waiting for
const sleep = (ms, signal) =>
  new Promise((done, fail) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), fail(signal.reason)), { once: true });
  });

// Seconds until Groq lets us try again, from its headers ("2", "7.5s", "1m30s", "250ms").
function retryAfter(headers) {
  const seconds = (v) => {
    if (!v) return NaN;
    if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
    let total = 0;
    for (const [, n, unit] of v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) total += Number(n) * { ms: 0.001, s: 1, m: 60, h: 3600 }[unit];
    return total || NaN;
  };
  const found = ["retry-after", "x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"].map((h) => seconds(headers.get(h))).filter((n) => n >= 0);
  return found.length ? found[0] : 60;
}

// Reads Groq's streamed answer: strings for text, then {toolCalls} at the end if the model
// asked to use a tool (such as web search). A pause longer than IDLE_TIMEOUT_MS ends it.
async function* readGroq(res, call) {
  const calls = [];
  const pause = "A pause in the AI's reply";
  call.restart(IDLE_TIMEOUT_MS, pause);
  // Server-sent events: lines like "data: {...}", ending with "data: [DONE]".
  for await (const line of lines(res.body)) {
    call.restart(IDLE_TIMEOUT_MS, pause);
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    const parsed = parseLine(data);
    if (!parsed) continue;
    if (parsed.error) {
      // Groq gave up part way (for example, it garbled a search request). Stop here; the chat
      // handler asks again for a plain answer if nothing was written.
      console.log(`Groq stopped mid-reply: ${parsed.error.message || JSON.stringify(parsed.error)}`);
      break;
    }
    const delta = parsed.choices?.[0]?.delta || {};
    if (delta.content) yield delta.content;
    for (const tc of delta.tool_calls || []) {
      const tool = (calls[tc.index ?? calls.length] ||= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (tc.id) tool.id = tc.id;
      if (tc.function?.name) tool.function.name += tc.function.name;
      if (tc.function?.arguments) tool.function.arguments += tc.function.arguments;
    }
  }
  if (calls.length) yield { toolCalls: calls.filter(Boolean) };
}

// Yields the reply from Groq piece by piece: strings for text, {status} for notes to show while
// waiting, and {toolCalls} if the model asked to search. A model that fails before it has sent
// anything is safe to replace with the next one; once words have reached the visitor, it isn't,
// because trying again would repeat them.
let toolsWork = true; // switched off if the model on this account can't use tools
async function* streamGroq(messages, signal, tools) {
  const extra = () => (tools && toolsWork ? { tools, tool_choice: "auto" } : {});
  const ready = (m) => !(busyUntil.get(m) > Date.now());
  // The main model first, then the backups, skipping any that are busy right now.
  const queue = [groqModel, ...GROQ_PREFERRED.filter((m) => m !== groqModel)];
  let candidates = queue.filter(ready);
  if (!candidates.length) candidates = [groqModel];
  let problem = "down"; // why the last model failed: "down", "busy" or "slow"
  let waited = false;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    let call;
    try {
      call = await callGroq(messages, signal, extra(), model);
      let upstream = call.res;
      if (upstream.status === 404 || upstream.status === 400) {
        const error = (await upstream.json().catch(() => ({}))).error || {};
        const detail = [error.message, error.code].filter(Boolean).join(" ");
        // The model was retired or isn't on this account's plan.
        if (/model/i.test(detail) && /(not exist|not have access|decommissioned|deprecated|not found)/i.test(detail)) {
          call.done();
          rest(model, 3600);
          if (model === groqModel) {
            const replacement = await pickAvailableGroqModel().catch(() => null);
            if (replacement && replacement !== groqModel) {
              console.log(`Groq model "${groqModel}" isn't available (${detail}). Switching to "${replacement}".`);
              groqModel = replacement;
              candidates = [...candidates.slice(0, i + 1), replacement, ...candidates.slice(i + 1).filter((m) => m !== replacement)];
            }
          }
          problem = "down";
          continue;
        }
        if (tools && toolsWork && /tool|function/i.test(detail)) {
          // The model fumbled the search request or can't search: answer without searching.
          console.log(`Answering without web search this time (${detail}).`);
          if (/not support/i.test(detail)) toolsWork = false;
          call.done();
          call = await callGroq(messages, signal, {}, model);
          upstream = call.res;
        } else {
          console.log(`Groq error (${upstream.status}): ${detail}`);
          throw new VisitorError("The AI service couldn't answer that message. Please try rephrasing it.");
        }
      }
      if (upstream.status === 429) {
        const wait = retryAfter(upstream.headers);
        const detail = (await upstream.json().catch(() => ({}))).error?.message || "rate limited";
        call.done();
        problem = "busy";
        if (!waited && wait <= SHORT_WAIT) {
          // Worth a short pause: try the same model again.
          waited = true;
          console.log(`Groq model "${model}" is busy; waiting ${wait.toFixed(1)}s.`);
          yield { status: "Lots of people are chatting, one moment…" };
          await sleep(Math.max(250, wait * 1000), signal);
          i--;
          continue;
        }
        rest(model, wait);
        console.log(`Groq model "${model}" is busy for ${Math.round(wait)}s (${detail}). Trying another model.`);
        continue;
      }
      if (!upstream.ok) {
        const detail = (await upstream.json().catch(() => ({}))).error?.message || `status ${upstream.status}`;
        console.log(`Groq error (${upstream.status}) from "${model}": ${detail}`);
        if (upstream.status === 401) throw new VisitorError("The website's Groq API key is wrong or missing. Check GROQ_API_KEY in the host's settings.");
        // 413: too big for this model's per-request allowance; another model may have room.
        if (upstream.status < 500 && upstream.status !== 413) throw new VisitorError("The AI service couldn't answer that message. Please try rephrasing it.");
        // A problem on Groq's side: let another model answer.
        call.done();
        rest(model, 30);
        problem = "down";
        continue;
      }
    } catch (err) {
      call?.done();
      if (signal.aborted || err instanceof VisitorError) throw err;
      console.log(`Groq model "${model}" failed before answering (${err.message}). Trying another model.`);
      rest(model, 60);
      problem = err instanceof TimedOut ? "slow" : "down";
      continue;
    }

    // Groq has started answering.
    let started = false;
    try {
      for await (const part of readGroq(call.res, call)) {
        started = true;
        yield part;
      }
      return;
    } catch (err) {
      if (signal.aborted) throw err;
      const why = call.signal.reason instanceof TimedOut ? call.signal.reason.message : err.message;
      console.log(`Groq model "${model}" stopped mid-reply (${why}).`);
      if (started) throw new VisitorError("The reply stopped part way. Please try again.");
      rest(model, 60);
      problem = call.signal.reason instanceof TimedOut ? "slow" : "down";
    } finally {
      call.done();
    }
  }
  if (problem === "busy") throw new VisitorError("Farhan AI is very busy right now. Please wait a minute and try again.");
  if (problem === "slow") throw new VisitorError("The AI didn't answer in time. Please try again in a moment.");
  throw new VisitorError("Can't reach the AI service right now. Please try again in a moment.");
}

// ---------- Web search ----------
// With a free Tavily key (TAVILY_API_KEY) searches cover the whole web, including today's
// news, and come with pictures. Without one, Farhan AI searches Wikipedia, which is free and
// needs no key but isn't up to the minute.
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_URL = process.env.TAVILY_URL || "https://api.tavily.com/search";
const WIKI_URL = process.env.WIKI_URL || "https://en.wikipedia.org/w/api.php";
const MAX_SEARCHES = 3; // per message, to stay inside the free allowance

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the internet for current or factual information: news, sports results and scores, who won something, prices, weather, recent events, people, or anything that may have changed after your training. Returns numbered results with snippets, links and pictures.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for, like a short Google search" } },
      required: ["query"],
    },
  },
};

const clip = (text, n) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function searchTavily(query, signal) {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 5, include_images: true, include_image_descriptions: true, search_depth: "basic" }),
    signal,
  });
  if (!res.ok) throw new Error(`Tavily search failed (status ${res.status})`);
  const data = await res.json();
  return {
    provider: "web",
    results: (data.results || []).map((r) => ({
      title: clip(r.title, 120),
      url: r.url,
      snippet: clip(r.content, 700),
      date: r.published_date || undefined,
      icon: r.favicon || undefined,
    })),
    images: (data.images || [])
      .map((img) => (typeof img === "string" ? { url: img } : { url: img.url, caption: clip(img.description, 160) }))
      .filter((img) => /^https:\/\//.test(img.url))
      .slice(0, 6),
  };
}

async function searchWikipedia(query, signal) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "4",
    prop: "pageimages|extracts|info",
    exintro: "1",
    explaintext: "1",
    exchars: "900",
    piprop: "thumbnail",
    pithumbsize: "480",
    inprop: "url",
  });
  const res = await fetch(`${WIKI_URL}?${params}`, {
    headers: { "User-Agent": "FarhanAI/1.0 (https://farhanai.onrender.com)" },
    signal,
  });
  if (!res.ok) throw new Error(`Wikipedia search failed (status ${res.status})`);
  const pages = Object.values((await res.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
  return {
    provider: "wikipedia",
    results: pages.map((p) => ({ title: p.title, url: p.fullurl, snippet: clip(p.extract, 900), image: p.thumbnail?.source })),
    images: pages.filter((p) => p.thumbnail?.source).map((p) => ({ url: p.thumbnail.source, caption: p.title })).slice(0, 4),
  };
}

// Each search service gets SEARCH_TIMEOUT_MS; one that takes longer counts as not working.
async function withTimeout(signal, what, run) {
  const limit = deadline(signal, SEARCH_TIMEOUT_MS, what);
  try {
    return await run(limit.signal);
  } catch (err) {
    if (signal.aborted) throw err;
    throw limit.signal.reason instanceof TimedOut ? limit.signal.reason : err;
  } finally {
    limit.done();
  }
}

async function webSearch(query, signal) {
  if (TAVILY_API_KEY) {
    try {
      return await withTimeout(signal, "Tavily search", (s) => searchTavily(query, s));
    } catch (err) {
      if (signal.aborted) throw err;
      console.log(`${err.message}. Searching Wikipedia instead.`);
    }
  }
  return withTimeout(signal, "Wikipedia search", (s) => searchWikipedia(query, s));
}

// The current date and time where the visitor is, so "today" and "now" mean something.
function timeNow(timeZone) {
  let zone = "UTC";
  try {
    if (timeZone) {
      new Intl.DateTimeFormat("en-GB", { timeZone });
      zone = timeZone;
    }
  } catch {}
  const now = new Date().toLocaleString("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `The current date and time for the user is ${now} (${zone} time).`;
}

// How answers should be laid out. The page renders Markdown and LaTeX maths.
const FORMAT_RULES =
  "Format answers like a polished chat assistant. Start with the direct answer, then explain. Use short paragraphs, **bold** for key terms, ## headings only for longer answers, numbered lists for steps (1., 2., 3.), bullet points for lists, Markdown tables for data or comparisons, and fenced code blocks with a language name for code. Write all maths in LaTeX: inline as \\( ... \\) and worked equations on their own line as $$ ... $$. For maths problems, show clear numbered steps and finish with the final answer in bold or in a $$ ... $$ block. Don't pad answers; match the length to the question.";

const SEARCH_RULES =
  "You can search the internet with the web_search tool. Use it whenever a question is about something current or checkable: news, sports results and scores, who won or is winning something, prices, weather, recent events, or anything that may have changed since your training. Also use it when the user asks you to look something up. Answer from the search results, cite them inline like [1] or [2] using the result numbers, and say plainly if the results don't answer the question. Never invent scores, dates, names or facts. The page automatically shows the user pictures and links from your searches, so don't paste image or link URLs yourself.";

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

// Reads one line of streamed JSON. A garbled line is skipped (and counted in the log) rather
// than ending the whole reply.
function parseLine(text) {
  try {
    return JSON.parse(text);
  } catch {
    console.log(`Skipped a garbled line from the AI service (${text.length} characters).`);
    return null;
  }
}

// ---------- Who is asking, and how much they may ask ----------
// How the visitor is identified, and what that assumes about the proxy in front of the app:
//
// - Each trusted proxy adds the address it received the request from to the END of
//   X-Forwarded-For, after anything the visitor's own browser or tools put there. With
//   TRUST_PROXY_HOPS trusted proxies, the entry that many places from the end is the visitor's
//   real address; everything before it could be made up, so it is ignored. Render is assumed
//   to be one such proxy (TRUST_PROXY_HOPS=1 when RENDER is set). That is an assumption about
//   Render, checked in production with the "Proxy check" log line below, not by the tests.
// - If X-Forwarded-For is missing, has fewer entries than TRUST_PROXY_HOPS, or the chosen entry
//   isn't a valid IP address, the request is counted under one shared "unidentified" allowance.
//   That can make the limit stricter for those visitors, but never lets anyone dodge it.
// - With no trusted proxy (on your PC), X-Forwarded-For is ignored and the connection's own
//   address is used.
//
// "Proxy check" lines are logged once per start-up for each case seen (and for each different
// number of addresses, up to 10 lines), so a test request with a made-up header shows up too.
// They hold only counts, yes/no answers and header names, never anyone's address.
const proxyNotes = new Set();
function proxyNote(kind, text) {
  if (proxyNotes.has(kind) || proxyNotes.size >= 10) return;
  proxyNotes.add(kind);
  console.log(`Proxy check: ${text}`);
}

function visitorAddress(req) {
  const direct = req.socket.remoteAddress || "unknown";
  if (TRUST_PROXY_HOPS <= 0) return direct;
  const header = req.headers["x-forwarded-for"];
  const listed = String(header ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const others = ["true-client-ip", "cf-connecting-ip", "x-real-ip"].filter((h) => req.headers[h]).join(", ") || "none";
  const shared = `unidentified via ${direct}`;
  if (!listed.length) {
    proxyNote("missing", `X-Forwarded-For is missing or empty, so these requests share one allowance. Other address headers: ${others}.`);
    return shared;
  }
  if (listed.length < TRUST_PROXY_HOPS) {
    proxyNote(
      "short",
      `X-Forwarded-For has ${listed.length} address(es) but TRUST_PROXY_HOPS is ${TRUST_PROXY_HOPS}, so these requests share one allowance.`,
    );
    return shared;
  }
  const chosen = listed.at(-TRUST_PROXY_HOPS);
  if (!net.isIP(chosen)) {
    proxyNote("malformed", `entry number ${TRUST_PROXY_HOPS} from the end of X-Forwarded-For isn't a valid IP address, so these requests share one allowance.`);
    return shared;
  }
  proxyNote(
    `ok-${listed.length}`,
    `X-Forwarded-For has ${listed.length} address(es); using number ${TRUST_PROXY_HOPS} from the end (TRUST_PROXY_HOPS), ` +
      `which is a valid IP address. Other address headers: ${others}.`,
  );
  return chosen;
}

// At most RATE_LIMIT messages per visitor every 10 minutes, and MAX_ACTIVE_PER_VISITOR replies
// running at once.
const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map(); // visitor -> times of their recent messages
const active = new Map(); // visitor -> replies running now
function underRateLimit(visitor) {
  const now = Date.now();
  const times = (recent.get(visitor) || []).filter((t) => now - t < WINDOW_MS);
  recent.set(visitor, times);
  return times.length < RATE_LIMIT;
}
// Forget visitors who have been quiet for a while, so the list doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [visitor, times] of recent) if (!times.some((t) => now - t < WINDOW_MS)) recent.delete(visitor);
}, WINDOW_MS).unref();

// Checks the request body and returns { messages, timeZone }, or throws a VisitorError.
// Only the new message has a length limit: earlier ones (including long answers) are cut down
// later anyway, and refusing them would break a long conversation for good.
const MAX_CHARS = 20_000;
function readChatRequest(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new VisitorError("That message couldn't be read. Please reload the page and try again.");
  }
  const { messages, timeZone } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new VisitorError("That conversation couldn't be read. Please start a new chat and try again.");
  }
  for (const m of messages) {
    if (!m || typeof m !== "object" || !["user", "assistant"].includes(m.role) || typeof m.content !== "string") {
      throw new VisitorError("That conversation couldn't be read. Please start a new chat and try again.");
    }
  }
  const last = messages.at(-1);
  if (last.role !== "user" || !last.content.trim()) throw new VisitorError("Please type a message first.");
  if (last.content.length > MAX_CHARS) {
    throw new VisitorError(`That message is too long. Please keep it under ${MAX_CHARS.toLocaleString("en-GB")} characters.`);
  }
  return { messages, timeZone: typeof timeZone === "string" ? timeZone.slice(0, 64) : undefined };
}

const replyJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

// Streams one assistant turn back as server-sent events:
//   text    -> {text}      a piece of the reply as it is written
//   status  -> {text}      a note to show while waiting
//   sources -> {...}       what a web search found
//   done    -> {content}   the full reply text to keep in the history
//   error   -> {message}
// Lines starting with ":" are keep-alive pings and carry nothing.
async function handleChat(req, res) {
  let messages, timeZone;
  try {
    ({ messages, timeZone } = readChatRequest(await readBody(req)));
  } catch (err) {
    return replyJson(res, 400, { error: err instanceof VisitorError ? err.message : "That message couldn't be read. Please try again." });
  }

  const visitor = visitorAddress(req);
  if (ONLINE && budgetSpent()) return replyJson(res, 503, { error: RESTING }, { "Retry-After": "3600" });
  if ((active.get(visitor) || 0) >= MAX_ACTIVE_PER_VISITOR) {
    return replyJson(res, 429, { error: "Farhan AI is still answering your last message. Please wait for it to finish." });
  }
  if (!underRateLimit(visitor)) {
    return replyJson(res, 429, { error: "You're sending messages very quickly. Please wait a few minutes and try again." });
  }
  recent.get(visitor).push(Date.now());

  // This visitor now has a reply running. Freed exactly once, when the reply ends or they leave.
  active.set(visitor, (active.get(visitor) || 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const left = (active.get(visitor) || 1) - 1;
    if (left > 0) active.set(visitor, left);
    else active.delete(visitor);
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders(); // the browser knows straight away that the message arrived
  const send = (event, data) => !res.writableEnded && !res.destroyed && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => !res.writableEnded && !res.destroyed && res.write(": ping\n\n"), HEARTBEAT_MS);

  const abort = new AbortController();
  res.on("close", () => {
    abort.abort();
    clearInterval(heartbeat);
    release();
  });
  const started = Date.now();
  const last = messages[messages.length - 1];
  // On your PC the black window shows what you typed; online, visitors' messages stay private.
  if (!ONLINE) {
    console.log(`\nYou: ${String(last?.content ?? "").slice(0, 80)}`);
    console.log("Waiting for the AI model to answer...");
  }

  try {
    // Keep only recent, reasonably sized messages so long chats stay fast and stay inside the
    // free plan's per-minute allowance.
    const convo = messages.slice(-12).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? "").slice(0, 4000),
    }));
    const system = [SYSTEM_PROMPT, FORMAT_RULES, timeNow(timeZone), ONLINE ? SEARCH_RULES : ""].filter(Boolean).join("\n\n");
    const history = [{ role: "system", content: system }, ...convo];
    let full = "";
    let searches = 0;
    let sourceNumber = 0;
    const found = []; // what the searches turned up, for the fallback below
    // Online, the model may ask to search the web; run the searches, show what was found,
    // then let it answer from the results.
    for (let round = 0; round < 4; round++) {
      const canSearch = ONLINE && searches < MAX_SEARCHES;
      const stream = ONLINE ? streamGroq(history, abort.signal, canSearch ? [WEB_SEARCH_TOOL] : null) : streamOllama(history, abort.signal);
      let toolCalls = null;
      let roundText = "";
      for await (const part of stream) {
        if (typeof part !== "string") {
          if (part.status) send("status", { text: part.status });
          if (part.toolCalls) toolCalls = part.toolCalls;
          continue;
        }
        if (!full && !ONLINE) console.log(`First words arrived after ${((Date.now() - started) / 1000).toFixed(1)}s.`);
        full += part;
        roundText += part;
        send("text", { text: part });
      }
      if (!toolCalls) break;

      history.push({ role: "assistant", content: roundText || null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        let query = "";
        try {
          query = String(JSON.parse(call.function.arguments || "{}").query || "").slice(0, 200);
        } catch {}
        let content;
        if (call.function.name !== "web_search" || !query) {
          content = "Error: unknown tool or missing query.";
        } else if (searches >= MAX_SEARCHES) {
          content = "Search limit reached for this message. Answer with what you have.";
        } else {
          searches++;
          send("status", { text: `Searching the web for “${query}”…` });
          try {
            const result = await webSearch(query, abort.signal);
            const results = result.results.map((r) => ({ ...r, n: ++sourceNumber }));
            send("sources", { query, provider: result.provider, results, images: result.images });
            content = results.length
              ? results.map((r) => `[${r.n}] ${r.title}${r.date ? ` (${r.date})` : ""}\n${r.url}\n${r.snippet}`).join("\n\n")
              : "No results found.";
            found.push(`Search: ${query}\n\n${content}`);
          } catch (err) {
            if (abort.signal.aborted) throw err;
            console.log(`Search error: ${err.message}`);
            content = "The search didn't work this time. Answer from what you know and say you couldn't check online.";
          }
        }
        history.push({ role: "tool", tool_call_id: call.id, content });
      }
      send("status", { text: "Reading the results…" });
    }
    // Sometimes the model reads the search results and then writes nothing (or keeps asking to
    // search). Ask once more, without the search tool, with the results laid out plainly.
    for (let attempt = 0; ONLINE && !full.trim() && attempt < 2; attempt++) {
      const nudge = found.length
        ? `Here is what the web search found:\n\n${found.join("\n\n---\n\n")}\n\nUsing these results, answer my last message now. Cite results like [1]. Don't search again.`
        : "Please answer my last message now.";
      const retry = [{ role: "system", content: system }, ...convo, { role: "user", content: nudge }];
      for await (const part of streamGroq(retry, abort.signal, null)) {
        if (typeof part !== "string") {
          if (part.status) send("status", { text: part.status });
          continue;
        }
        full += part;
        send("text", { text: part });
      }
    }
    send("done", { content: full });
    if (!ONLINE) console.log(`Reply finished in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } catch (err) {
    if (abort.signal.aborted) {
      console.log("The browser stopped waiting for this reply.");
    } else {
      console.log(`Error: ${err.message}`);
      send("error", { message: err instanceof VisitorError ? err.message : GENERAL_ERROR });
    }
  } finally {
    clearInterval(heartbeat);
    release();
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
  let file = ["GET", "HEAD"].includes(req.method) && STATIC_FILES[url.pathname];
  // Libraries in public/vendor (Markdown, maths and safety helpers) and their fonts.
  const vendor = ["GET", "HEAD"].includes(req.method) && /^\/vendor\/(fonts\/)?[\w.-]+\.(js|css|woff2)$/.exec(url.pathname);
  if (vendor && !url.pathname.includes("..")) {
    const types = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", woff2: "font/woff2" };
    file = [url.pathname.slice(1), types[vendor[2]]];
  }
  // Before and after pictures on the Bug fixes page (public/bugfixes).
  const shot = ["GET", "HEAD"].includes(req.method) && /^\/bugfixes\/[\w.-]+\.(webp|jpg|png)$/.exec(url.pathname);
  if (shot && !url.pathname.includes("..")) {
    file = [url.pathname.slice(1), { webp: "image/webp", jpg: "image/jpeg", png: "image/png" }[shot[1]]];
  }
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

// Shared helpers for the tests: start server.js on a free port, run fake AI and search
// services, and send chat messages.
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Starts server.js with the given environment. The server is stopped when the test ends.
// Returns { base, logs() } where logs() is everything the server printed so far.
export async function startApp(t, env = {}) {
  const port = await freePort();
  const app = spawn(process.execPath, [serverPath], {
    // Tests decide for themselves whether the app thinks it's on Render.
    env: { ...process.env, RENDER: "", TAVILY_API_KEY: "", PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout.on("data", (d) => (output += d));
  app.stderr.on("data", (d) => (output += d));
  t.after(() => app.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server didn't start:\n${output}`)), 10_000);
    const check = () => {
      if (output.includes("is running at")) {
        clearTimeout(timer);
        resolve();
      } else if (app.exitCode !== null) {
        clearTimeout(timer);
        reject(new Error(`server exited:\n${output}`));
      } else setTimeout(check, 20);
    };
    check();
  });
  return { base: `http://127.0.0.1:${port}`, logs: () => output };
}

// A fake Groq. handler(req, body, res) answers each /chat/completions request; every request is
// recorded in `requests`, and `closed` counts requests whose connection has been closed.
export async function startFakeGroq(t, handler) {
  const state = { requests: [], closed: 0, open: 0 };
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url === "/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    const body = raw ? JSON.parse(raw) : {};
    state.requests.push(body);
    state.open++;
    res.on("close", () => {
      state.open--;
      state.closed++;
    });
    await handler(req, body, res, state.requests.length);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  state.url = `http://127.0.0.1:${server.address().port}`;
  return state;
}

// Writes OpenAI-style streamed pieces of text, then [DONE].
export function streamText(res, pieces) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const text of pieces) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}

export function chat(base, { messages = [{ role: "user", content: "Hi" }], headers = {}, body, signal } = {}) {
  return fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ?? JSON.stringify({ messages }),
    signal,
  });
}

// Reads the whole event stream and returns [{event, data}].
export async function readEvents(res) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((block) => /^event: /m.test(block))
    .map((block) => ({ event: /^event: (.*)$/m.exec(block)[1], data: JSON.parse(/^data: (.*)$/m.exec(block)[1]) }));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves with how long `promise` took, or rejects if it takes longer than `ms`.
export async function within(ms, promise, what) {
  let timer;
  const started = Date.now();
  const limit = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms}ms`)), ms)));
  try {
    const value = await Promise.race([promise, limit]);
    return { value, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

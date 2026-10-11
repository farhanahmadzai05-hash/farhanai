// Starts server.js against a fake Groq so the chat page can be tested and measured in a real
// browser without an API key or any cost. Used by test/browser.test.js and scripts/bench-streaming.js.
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// A fake Groq. handler(body, res, n) answers the n-th chat request; every request body is kept
// in `requests`. Returns { url, requests, close() }.
export async function startFakeGroq(handler) {
  const fake = { requests: [] };
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    const body = raw ? JSON.parse(raw) : {};
    fake.requests.push(body);
    try {
      await handler(body, res, fake.requests.length);
    } catch {
      res.destroy();
    }
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.close = () =>
    new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(resolve);
    });
  return fake;
}

// Writes the start of an OpenAI-style event stream.
export function startStream(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
}

// Writes one piece of streamed text.
export function writeText(res, text) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
}

export function endStream(res) {
  res.end("data: [DONE]\n\n");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Starts server.js using the fake Groq at groqUrl. Returns { base, logs(), stop() }.
export async function startApp(groqUrl, env = {}) {
  const port = await freePort();
  const app = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      GROQ_API_KEY: "test-key",
      GROQ_URL: groqUrl,
      TAVILY_API_KEY: "",
      RENDER: "",
      RATE_LIMIT: "1000",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout.on("data", (d) => (output += d));
  app.stderr.on("data", (d) => (output += d));
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
  return {
    base: `http://127.0.0.1:${port}`,
    logs: () => output,
    stop: () =>
      new Promise((resolve) => {
        if (app.exitCode !== null) return resolve();
        app.once("exit", resolve);
        app.kill();
      }),
  };
}

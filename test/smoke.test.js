// End-to-end smoke test: runs server.js against a fake Ollama and checks a streamed reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));

function startFakeOllama(onRequest) {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "llama3.2:latest" }] }));
    }
    body = JSON.parse(body);
    if (req.url === "/api/generate") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ model: body.model, response: "", done: true }));
    }
    onRequest(req, body);
    if (body.model !== "llama3.2") {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: `model "${body.model}" not found, try pulling it first` }));
    }
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    for (const text of ["Hello", ", world!"]) {
      res.write(JSON.stringify({ model: body.model, message: { role: "assistant", content: text }, done: false }) + "\n");
    }
    res.end(JSON.stringify({ model: body.model, message: { role: "assistant", content: "" }, done: true }) + "\n");
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function startApp(t, env) {
  const port = 3900 + Math.floor(Math.random() * 90);
  const app = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => app.kill());
  await new Promise((resolve) => app.stdout.on("data", (d) => d.toString().includes("running") && resolve()));
  return `http://localhost:${port}`;
}

const chat = (base) =>
  fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  }).then((r) => r.text());

test("streams a reply from the local model to the browser", async (t) => {
  let seen;
  const ollama = await startFakeOllama((req, body) => req.url === "/api/chat" && (seen = body));
  t.after(() => ollama.close());
  const base = await startApp(t, { OLLAMA_URL: `http://127.0.0.1:${ollama.address().port}` });

  assert.equal((await fetch(`${base}/`)).status, 200);

  const text = await chat(base);
  assert.match(text, /event: text\ndata: {"text":"Hello"}/);
  const done = JSON.parse(/event: done\ndata: (.*)/.exec(text)[1]);
  assert.equal(done.content, "Hello, world!");

  assert.equal(seen.model, "llama3.2");
  assert.equal(seen.stream, true);
  assert.equal(seen.messages[0].role, "system");
  assert.deepEqual(seen.messages[1], { role: "user", content: "Hi" });
});

test("explains how to download a missing model", async (t) => {
  const ollama = await startFakeOllama(() => {});
  t.after(() => ollama.close());
  const base = await startApp(t, { OLLAMA_URL: `http://127.0.0.1:${ollama.address().port}`, OLLAMA_MODEL: "nope" });
  assert.match(await chat(base), /event: error\ndata: .*ollama pull nope/);
});

test("explains when Ollama isn't running", async (t) => {
  const base = await startApp(t, { OLLAMA_URL: "http://127.0.0.1:1" });
  assert.match(await chat(base), /event: error\ndata: .*Can't reach Ollama/);
});

test("status reports a missing model and a stopped Ollama", async (t) => {
  const ollama = await startFakeOllama(() => {});
  t.after(() => ollama.close());
  const ready = await startApp(t, { OLLAMA_URL: `http://127.0.0.1:${ollama.address().port}` });
  assert.deepEqual(await (await fetch(`${ready}/api/status`)).json(), { ok: true });

  const missing = await startApp(t, { OLLAMA_URL: `http://127.0.0.1:${ollama.address().port}`, OLLAMA_MODEL: "nope" });
  assert.match((await (await fetch(`${missing}/api/status`)).json()).error, /ollama pull nope/);

  const stopped = await startApp(t, { OLLAMA_URL: "http://127.0.0.1:1" });
  assert.match((await (await fetch(`${stopped}/api/status`)).json()).error, /Can't reach Ollama/);
});

test("online mode streams a reply from Groq", async (t) => {
  let seen;
  const groq = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen = { auth: req.headers.authorization, url: req.url, body: JSON.parse(body) };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const text of ["Hello", " from Groq"]) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => groq.listen(0, resolve));
  t.after(() => groq.close());
  const base = await startApp(t, { GROQ_API_KEY: "test-key", GROQ_URL: `http://127.0.0.1:${groq.address().port}` });

  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.online, true);
  assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { ok: true });

  const done = JSON.parse(/event: done\ndata: (.*)/.exec(await chat(base))[1]);
  assert.equal(done.content, "Hello from Groq");
  assert.equal(seen.url, "/chat/completions");
  assert.equal(seen.auth, "Bearer test-key");
  assert.equal(seen.body.model, "openai/gpt-oss-120b");
  assert.equal(seen.body.messages[0].role, "system");
});

test("online mode explains a bad API key", async (t) => {
  const groq = http.createServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid API Key" } }));
  });
  await new Promise((resolve) => groq.listen(0, resolve));
  t.after(() => groq.close());
  const base = await startApp(t, { GROQ_API_KEY: "bad", GROQ_URL: `http://127.0.0.1:${groq.address().port}` });
  assert.match(await chat(base), /event: error\ndata: .*API key is wrong/);
});

test("limits how fast one visitor can send messages", async (t) => {
  const base = await startApp(t, { OLLAMA_URL: "http://127.0.0.1:1", RATE_LIMIT: "2" });
  await chat(base);
  await chat(base);
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
  assert.equal(res.status, 429);
});

test("online mode switches to an available model when the chosen one is gone", async (t) => {
  const tried = [];
  const groq = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "whisper-large-v3" }, { id: "openai/gpt-oss-20b" }] }));
    }
    const { model } = JSON.parse(body);
    tried.push(model);
    if (model !== "openai/gpt-oss-20b") {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: `The model \`${model}\` does not exist or you do not have access to it.` } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hi!" } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => groq.listen(0, resolve));
  t.after(() => groq.close());
  const base = await startApp(t, { GROQ_API_KEY: "k", GROQ_MODEL: "llama-3.3-70b-versatile", GROQ_URL: `http://127.0.0.1:${groq.address().port}` });

  const done = JSON.parse(/event: done\ndata: (.*)/.exec(await chat(base))[1]);
  assert.equal(done.content, "Hi!");
  await chat(base);
  assert.deepEqual(tried, ["llama-3.3-70b-versatile", "openai/gpt-oss-20b", "openai/gpt-oss-20b"]);
});

// A fake Groq that asks to search on the first request and answers on the second.
function startSearchingGroq(requests) {
  const groq = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    body = JSON.parse(body);
    requests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (requests.length === 1) {
      const call = { index: 0, id: "call_1", type: "function", function: { name: "web_search", arguments: "" } };
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\n`);
      const more = { index: 0, function: { arguments: '{"query":"world cup winner"}' } };
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [more] } }] })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Argentina won [1]." } }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  return new Promise((resolve) => groq.listen(0, () => resolve(groq)));
}

test("online mode searches the web and shows sources and pictures", async (t) => {
  const requests = [];
  const groq = await startSearchingGroq(requests);
  t.after(() => groq.close());
  let wikiQuery;
  const wiki = http.createServer((req, res) => {
    wikiQuery = new URL(req.url, "http://x").searchParams.get("gsrsearch");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        query: {
          pages: {
            7: { index: 1, title: "2022 FIFA World Cup final", fullurl: "https://en.wikipedia.org/wiki/2022_FIFA_World_Cup_final", extract: "Argentina beat France on penalties.", thumbnail: { source: "https://upload.wikimedia.org/final.jpg" } },
          },
        },
      }),
    );
  });
  await new Promise((resolve) => wiki.listen(0, resolve));
  t.after(() => wiki.close());
  const base = await startApp(t, {
    GROQ_API_KEY: "k",
    GROQ_URL: `http://127.0.0.1:${groq.address().port}`,
    WIKI_URL: `http://127.0.0.1:${wiki.address().port}/w/api.php`,
    TAVILY_API_KEY: "",
  });

  const text = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Who won the World Cup?" }], timeZone: "Europe/London" }),
  }).then((r) => r.text());

  assert.equal(wikiQuery, "world cup winner");
  const sources = JSON.parse(/event: sources\ndata: (.*)/.exec(text)[1]);
  assert.equal(sources.provider, "wikipedia");
  assert.equal(sources.results[0].n, 1);
  assert.equal(sources.images[0].url, "https://upload.wikimedia.org/final.jpg");
  assert.match(text, /event: status\ndata: .*Searching the web/);
  assert.equal(JSON.parse(/event: done\ndata: (.*)/.exec(text)[1]).content, "Argentina won [1].");

  // First request offers the search tool and tells the model today's date in the visitor's time zone.
  assert.equal(requests[0].tools[0].function.name, "web_search");
  assert.match(requests[0].messages[0].content, /current date and time .* \(Europe\/London time\)/);
  // Second request carries the search results back to the model.
  const tool = requests[1].messages.find((m) => m.role === "tool");
  assert.equal(tool.tool_call_id, "call_1");
  assert.match(tool.content, /\[1\] 2022 FIFA World Cup final/);
});

test("uses Tavily for live web search when a key is set", async (t) => {
  const requests = [];
  const groq = await startSearchingGroq(requests);
  t.after(() => groq.close());
  let tavilyAuth;
  const tavily = http.createServer(async (req, res) => {
    for await (const _ of req);
    tavilyAuth = req.headers.authorization;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        results: [{ title: "Final score", url: "https://example.com/score", content: "Argentina 3-3 France (4-2 pens)", published_date: "2022-12-18" }],
        images: [{ url: "https://example.com/trophy.jpg", description: "Messi lifts the trophy" }, "http://insecure.example/x.jpg"],
      }),
    );
  });
  await new Promise((resolve) => tavily.listen(0, resolve));
  t.after(() => tavily.close());
  const base = await startApp(t, {
    GROQ_API_KEY: "k",
    GROQ_URL: `http://127.0.0.1:${groq.address().port}`,
    TAVILY_API_KEY: "tvly-test",
    TAVILY_URL: `http://127.0.0.1:${tavily.address().port}/search`,
  });
  const text = await chat(base);
  assert.equal(tavilyAuth, "Bearer tvly-test");
  const sources = JSON.parse(/event: sources\ndata: (.*)/.exec(text)[1]);
  assert.equal(sources.provider, "web");
  assert.deepEqual(sources.images, [{ url: "https://example.com/trophy.jpg", caption: "Messi lifts the trophy" }]);
  assert.match(requests[1].messages.find((m) => m.role === "tool").content, /Argentina 3-3 France/);
});

test("when Groq says it's busy, a short wait is retried and a long one switches model", async (t) => {
  const tried = [];
  let calls = 0;
  const groq = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { model } = JSON.parse(body);
    tried.push(model);
    calls++;
    if (calls === 1) {
      res.writeHead(429, { "Content-Type": "application/json", "retry-after": "0.2" });
      return res.end(JSON.stringify({ error: { message: "Rate limit reached" } }));
    }
    if (model === "openai/gpt-oss-120b") {
      res.writeHead(429, { "Content-Type": "application/json", "retry-after": "40" });
      return res.end(JSON.stringify({ error: { message: "Rate limit reached for tokens per minute" } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `Hi from ${model}` } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => groq.listen(0, resolve));
  t.after(() => groq.close());
  const base = await startApp(t, { GROQ_API_KEY: "k", GROQ_MODEL: "openai/gpt-oss-120b", GROQ_URL: `http://127.0.0.1:${groq.address().port}` });

  const text = await chat(base);
  assert.match(text, /event: status/);
  assert.doesNotMatch(text, /event: error/);
  assert.equal(JSON.parse(/event: done\ndata: (.*)/.exec(text)[1]).content, "Hi from openai/gpt-oss-20b");
  // The busy model is skipped until its limit resets.
  await chat(base);
  assert.deepEqual(tried, ["openai/gpt-oss-120b", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "openai/gpt-oss-20b"]);
});

test("if the model writes nothing after searching, it is asked again with the results", async (t) => {
  const requests = [];
  const groq = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (requests.length === 1) {
      const call = { index: 0, id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"world cup final"}' } };
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\n`);
    } else if (requests.length === 2) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "" } }] })}\n\n`); // empty answer
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Spain won 1-0 [1]." } }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => groq.listen(0, resolve));
  t.after(() => groq.close());
  const wiki = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ query: { pages: { 1: { index: 1, title: "2026 FIFA World Cup final", fullurl: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_final", extract: "Spain beat Argentina 1-0." } } } }));
  });
  await new Promise((resolve) => wiki.listen(0, resolve));
  t.after(() => wiki.close());
  const base = await startApp(t, {
    GROQ_API_KEY: "k",
    GROQ_URL: `http://127.0.0.1:${groq.address().port}`,
    WIKI_URL: `http://127.0.0.1:${wiki.address().port}/w/api.php`,
    TAVILY_API_KEY: "",
  });

  const text = await chat(base);
  assert.equal(JSON.parse(/event: done\ndata: (.*)/.exec(text)[1]).content, "Spain won 1-0 [1].");
  assert.equal(requests.length, 3);
  const retry = requests[2];
  assert.equal(retry.tools, undefined);
  assert.match(retry.messages.at(-1).content, /Spain beat Argentina 1-0/);
});

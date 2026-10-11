// Regression tests for the reliability and abuse fixes (review PR 1): who counts as the same
// visitor, limits that can't be dodged, timeouts on outside services, safe retries, clean-up
// when a visitor leaves, and plain errors for bad input or bad provider data.
import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, startFakeGroq, streamText, chat, readEvents, sleep, within } from "./helpers.js";

// Every test here gets a time limit, so an unfixed hang fails instead of stalling the run.
const test = (name, fn) => nodeTest(name, { timeout: 15_000 }, fn);

const groqEnv = (groq, extra = {}) => ({ GROQ_API_KEY: "k", GROQ_URL: groq.url, ...extra });
const answer = (events) => events.find((e) => e.event === "done")?.data.content;
const errorOf = (events) => events.find((e) => e.event === "error")?.data.message;

// ---------- Who is the visitor? ----------

test("on Render, a made-up X-Forwarded-For can't dodge the rate limit", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => streamText(res, ["ok"]));
  const { base } = await startApp(t, groqEnv(groq, { RENDER: "true", RATE_LIMIT: "2" }));
  // Render's proxy adds the real address at the end; anything before it came from the visitor.
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const res = await chat(base, { headers: { "X-Forwarded-For": `10.0.0.${i}, 198.51.100.7` } });
    statuses.push(res.status);
    await res.text();
  }
  assert.deepEqual(statuses, [200, 200, 429, 429]);
});

test("on Render, two real visitors get separate allowances", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => streamText(res, ["ok"]));
  const { base } = await startApp(t, groqEnv(groq, { RENDER: "true", RATE_LIMIT: "1" }));
  const a = await chat(base, { headers: { "X-Forwarded-For": "198.51.100.1" } });
  const b = await chat(base, { headers: { "X-Forwarded-For": "198.51.100.2" } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  await Promise.all([a.text(), b.text()]);
  const again = await chat(base, { headers: { "X-Forwarded-For": "198.51.100.1" } });
  assert.equal(again.status, 429);
  await again.text();
});

test("away from a proxy, X-Forwarded-For is ignored completely", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => streamText(res, ["ok"]));
  const { base } = await startApp(t, groqEnv(groq, { RATE_LIMIT: "2" }));
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    const res = await chat(base, { headers: { "X-Forwarded-For": `203.0.113.${i}` } });
    statuses.push(res.status);
    await res.text();
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});

test("one visitor can only have one reply running at a time", async (t) => {
  const groq = await startFakeGroq(t, async (req, body, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "slow" } }] })}\n\n`);
    await sleep(600);
    res.end("data: [DONE]\n\n");
  });
  const { base } = await startApp(t, groqEnv(groq));
  const first = await chat(base);
  const second = await chat(base);
  assert.equal(second.status, 429);
  assert.match((await second.json()).error, /still answering/i);
  assert.equal(answer(await readEvents(first)), "slow");
  // Once the first reply has finished, the visitor can send again.
  const third = await chat(base);
  assert.equal(third.status, 200);
  await third.text();
});

// ---------- The site-wide daily budget ----------

test("the daily budget counts AI calls and stops before using more quota", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => streamText(res, ["ok"]));
  const { base } = await startApp(t, groqEnv(groq, { DAILY_AI_CALLS: "2" }));
  for (let i = 0; i < 2; i++) {
    const res = await chat(base);
    assert.equal(answer(await readEvents(res)), "ok");
  }
  const res = await chat(base);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /come back tomorrow/i);
  assert.equal(groq.requests.length, 2, "no AI call is made once the budget is spent");
});

// ---------- Timeouts and safe retries ----------

test("a model that never answers is abandoned and the next model answers", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => {
    if (body.model === "openai/gpt-oss-120b") return; // hangs: never sends anything
    streamText(res, [`Hi from ${body.model}`]);
  });
  const { base } = await startApp(t, groqEnv(groq, { GROQ_FIRST_BYTE_TIMEOUT_MS: "300" }));
  const { value: events } = await within(5000, chat(base).then(readEvents), "the fallback answer");
  assert.equal(answer(events), "Hi from openai/gpt-oss-20b");
  assert.equal(groq.open, 0, "the abandoned request is closed");
});

test("when every model hangs, the visitor gets a clear error quickly", async (t) => {
  const groq = await startFakeGroq(t, () => {}); // never answers
  const { base } = await startApp(t, groqEnv(groq, { GROQ_FIRST_BYTE_TIMEOUT_MS: "200" }));
  const { value: events } = await within(5000, chat(base).then(readEvents), "the error");
  assert.match(errorOf(events), /didn't answer in time/i);
  assert.equal(answer(events), undefined);
});

test("headers reach the browser at once, even while the AI is slow", async (t) => {
  const groq = await startFakeGroq(t, () => {}); // never answers
  const { base } = await startApp(t, groqEnv(groq, { GROQ_FIRST_BYTE_TIMEOUT_MS: "3000" }));
  const controller = new AbortController();
  const { value: res } = await within(1000, chat(base, { signal: controller.signal }), "response headers");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  controller.abort();
});

test("a slow wait sends keep-alive pings so proxies don't drop the stream", async (t) => {
  const groq = await startFakeGroq(t, async (req, body, res) => {
    await sleep(700);
    streamText(res, ["late"]);
  });
  const { base } = await startApp(t, groqEnv(groq, { HEARTBEAT_MS: "150" }));
  const text = await (await chat(base)).text();
  assert.match(text, /^: ping$/m);
  assert.match(text, /event: done/);
});

test("a reply that stalls after its first words ends instead of hanging", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Half an ans" } }] })}\n\n`);
    // ...and then nothing, forever.
  });
  const { base } = await startApp(t, groqEnv(groq, { GROQ_IDLE_TIMEOUT_MS: "300" }));
  const { value: events } = await within(5000, chat(base).then(readEvents), "the stalled reply to end");
  assert.equal(events.filter((e) => e.event === "text").map((e) => e.data.text).join(""), "Half an ans");
  assert.match(errorOf(events), /stopped part way/i);
  assert.equal(groq.requests.length, 1, "no retry after words were already shown, so nothing is duplicated");
  assert.equal(groq.open, 0, "the stalled request is closed");
});

test("a provider error before any words is retried on the next model", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => {
    if (body.model === "openai/gpt-oss-120b") {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "over capacity" } }));
    }
    streamText(res, ["Backup here"]);
  });
  const { base } = await startApp(t, groqEnv(groq));
  const events = await readEvents(await chat(base));
  assert.equal(answer(events), "Backup here");
  assert.equal(errorOf(events), undefined);
});

test("a provider that fails after starting is not retried, so no words repeat", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Once " } }] })}\n\n`);
    setTimeout(() => res.destroy(), 100); // connection dropped mid-reply
  });
  const { base } = await startApp(t, groqEnv(groq));
  const events = await readEvents(await chat(base));
  assert.equal(events.filter((e) => e.event === "text").map((e) => e.data.text).join(""), "Once ");
  assert.match(errorOf(events), /stopped part way/i);
  assert.equal(groq.requests.length, 1);
});

test("a web search that hangs is given up on and the answer carries on", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res, n) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (n === 1) {
      const call = { index: 0, id: "c1", type: "function", function: { name: "web_search", arguments: '{"query":"news"}' } };
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "From memory." } }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  const wiki = http.createServer(() => {}); // never answers
  await new Promise((r) => wiki.listen(0, "127.0.0.1", r));
  t.after(() => {
    wiki.closeAllConnections();
    wiki.close();
  });
  const { base } = await startApp(t, groqEnv(groq, { WIKI_URL: `http://127.0.0.1:${wiki.address().port}/w`, SEARCH_TIMEOUT_MS: "300" }));
  const { value: events } = await within(5000, chat(base).then(readEvents), "the answer");
  assert.equal(answer(events), "From memory.");
  assert.match(groq.requests[1].messages.find((m) => m.role === "tool").content, /didn't work/);
});

// ---------- Clean-up when the visitor leaves ----------

test("when the visitor leaves, the AI request is closed and their slot is freed", async (t) => {
  const groq = await startFakeGroq(t, () => {}); // never answers
  const { base, logs } = await startApp(t, groqEnv(groq, { GROQ_FIRST_BYTE_TIMEOUT_MS: "20000" }));
  const controller = new AbortController();
  const res = await chat(base, { signal: controller.signal });
  assert.equal(res.status, 200);
  await sleep(200);
  assert.equal(groq.open, 1);
  controller.abort();
  await within(2000, (async () => { while (groq.open) await sleep(20); })(), "the AI request to close");
  // The same visitor can send again straight away: their one-at-a-time slot was released.
  const next = await chat(base, { signal: AbortSignal.timeout(500) }).catch((e) => e);
  assert.equal(next.status, 200);
  assert.match(logs(), /stopped waiting/);
});

// ---------- Bad input and bad provider data ----------

test("badly formed requests get a plain 400 and never reach the AI", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => streamText(res, ["ok"]));
  const { base } = await startApp(t, groqEnv(groq));
  const bad = [
    { body: "not json" },
    { messages: [] },
    { messages: [null] },
    { messages: [{ role: "user", content: 42 }] },
    { messages: [{ role: "wizard", content: "hi" }] },
    { messages: [{ role: "user", content: "x".repeat(20_001) }] },
    { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }, // must end with the visitor
    { messages: [{ role: "user", content: "   " }] },
  ];
  for (const b of bad) {
    const res = await chat(base, b.body ? { body: b.body } : { messages: b.messages });
    assert.equal(res.status, 400, JSON.stringify(b).slice(0, 80));
    const { error } = await res.json();
    assert.doesNotMatch(error, /Cannot read|undefined|JSON at position/);
  }
  assert.equal(groq.requests.length, 0);
});

test("long conversations and long earlier answers are still accepted", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => streamText(res, ["ok"]));
  const { base } = await startApp(t, groqEnv(groq));
  const messages = [];
  for (let i = 0; i < 150; i++) messages.push({ role: "user", content: `question ${i}` }, { role: "assistant", content: "y".repeat(30_000) });
  messages.push({ role: "user", content: "one more" });
  const events = await readEvents(await chat(base, { messages }));
  assert.equal(answer(events), "ok");
  // Only the recent part of the conversation is sent on, each message cut down to size.
  assert.equal(groq.requests[0].messages.length, 13);
  assert.ok(groq.requests[0].messages.every((m) => m.content.length <= 4000 || m.role === "system"));
});

test("bad requests don't use up the visitor's allowance", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => streamText(res, ["ok"]));
  const { base } = await startApp(t, groqEnv(groq, { RATE_LIMIT: "1" }));
  for (let i = 0; i < 3; i++) await (await chat(base, { messages: [null] })).text();
  const res = await chat(base);
  assert.equal(res.status, 200);
  await res.text();
});

test("a garbled line from the AI is skipped and the rest of the reply arrives", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`);
    res.write("data: {not json\n\n");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: " there" } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  const { base } = await startApp(t, groqEnv(groq));
  const events = await readEvents(await chat(base));
  assert.equal(answer(events), "Hello there");
  assert.equal(errorOf(events), undefined);
});

test("provider error details stay in the server log, not on the page", async (t) => {
  const groq = await startFakeGroq(t, (req, body, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "internal: shard 7 stack trace" } }));
  });
  const { base, logs } = await startApp(t, groqEnv(groq));
  const message = errorOf(await readEvents(await chat(base)));
  assert.ok(message, "an error is shown");
  assert.doesNotMatch(message, /shard 7/);
  assert.match(logs(), /shard 7/);
});

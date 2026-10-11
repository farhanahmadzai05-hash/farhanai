// Browser tests for the chat page: they open the real page in headless Chrome against server.js
// and a fake Groq, so they check what a visitor actually sees. They are skipped (with the reason)
// when no Chrome, Chromium or Edge is installed; set CHROME_PATH to point at one.
import { test as base, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { browserUnavailable, launchBrowser } from "../scripts/browser.js";
import { startFakeGroq, startApp, startStream, writeText, endStream, sleep } from "../scripts/fake-ai.js";

const skip = browserUnavailable();
const test = (name, fn) => base(name, { skip: skip || false, timeout: 20_000 }, fn);

let browser, page, fake, app;
let handler; // how the fake Groq answers in the current test
let released; // lets a test finish a reply the fake is holding open

before(async () => {
  if (skip) return;
  fake = await startFakeGroq((body, res, n) => handler(body, res, n));
  app = await startApp(fake.url);
  browser = await launchBrowser();
  page = browser.page;
});

after(async () => {
  released?.();
  await browser?.close();
  await app?.stop();
  await fake?.close();
});

beforeEach(async () => {
  if (skip) return;
  released?.();
  fake.requests.length = 0;
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "Hello!");
    endStream(res);
  };
  await page.goto(app.base);
  await page.waitFor("typeof send === 'function' && document.getElementById('input')");
  await page.evaluate(`document.getElementById("splash")?.remove()`); // as if the visitor has gone past the intro
});

// Holds a reply open until the test calls released() (or the visitor stops it).
const holdOpen = (res) =>
  new Promise((resolve) => {
    released = resolve;
    res.on("close", resolve);
  });

// Types a message into the box and presses the send button, like a visitor.
const type = (text) =>
  page.evaluate(`(() => {
    const input = document.getElementById("input");
    input.value = ${JSON.stringify(text)};
    document.getElementById("send").click();
  })()`);

// The text of the newest reply bubble, as an expression to run in the page.
const LAST_REPLY = `([...messages.querySelectorAll(":scope > .row.assistant .bubble")].at(-1)?.innerText || "")`;
const lastReply = () => page.evaluate(LAST_REPLY);
const rows = (role) => page.evaluate(`messages.querySelectorAll(":scope > .row.${role}").length`);
const state = () => page.evaluate(`({ busy, history: JSON.parse(JSON.stringify(history)) })`);

test("the send button stops a reply, and the words so far are kept", async () => {
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "Hello there, ");
    await holdOpen(res);
  };
  await type("Hi");
  await page.waitFor(`${LAST_REPLY}.includes("Hello there")`, { what: "the first words" });
  assert.equal(await page.evaluate(`document.getElementById("send").getAttribute("aria-label")`), "Stop the reply");

  await page.evaluate(`document.getElementById("send").click()`);
  await page.waitFor("!busy", { what: "the reply to stop" });

  const reply = await lastReply();
  assert.match(reply, /Hello there/);
  assert.match(reply, /Stopped/);
  assert.deepEqual((await state()).history, [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello there, " },
  ]);
  assert.equal(await page.evaluate(`document.getElementById("send").getAttribute("aria-label")`), "Send");
  assert.ok(await page.evaluate(`!!messages.querySelector(":scope > .row.assistant:last-child .retry")`), "a Try again button is offered");
});

test("a reply that breaks part way keeps its words and says it was interrupted", async () => {
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "Part one of the answer.");
    await sleep(150);
    res.destroy();
  };
  await type("Tell me something");
  await page.waitFor(`!busy && !messages.querySelector(":scope > .row.assistant .typing")`, { what: "the reply to end" });
  const reply = await lastReply();
  assert.match(reply, /Part one of the answer\./, "the words that arrived are still shown");
  assert.match(reply, /Interrupted/);
  assert.deepEqual((await state()).history, [
    { role: "user", content: "Tell me something" },
    { role: "assistant", content: "Part one of the answer." },
  ]);
});

test("trying a failed message again doesn't send or show it twice", async () => {
  let failing = true; // every model fails until the visitor tries again
  handler = async (body, res) => {
    if (failing) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "upstream broke" } }));
    }
    startStream(res);
    writeText(res, "Second time lucky.");
    endStream(res);
  };
  await type("Hi");
  await page.waitFor(`!busy && messages.querySelector(":scope > .row.assistant .retry")`, { what: "the Try again button" });
  assert.deepEqual((await state()).history, [], "a message that got no answer isn't kept in the conversation");

  failing = false;
  await page.evaluate(`messages.querySelector(":scope > .row.assistant .retry").click()`);
  await page.waitFor(`!busy && ${LAST_REPLY}.includes("Second time lucky")`, {
    what: "the retried reply",
  });

  assert.equal(await rows("user"), 1, "the message is shown once");
  assert.equal(await rows("assistant"), 1, "the failed reply is replaced, not added to");
  assert.deepEqual((await state()).history, [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Second time lucky." },
  ]);
  const sent = fake.requests.at(-1).messages.filter((m) => m.role === "user");
  assert.deepEqual(
    sent.map((m) => m.content),
    ["Hi"],
    "the AI gets the message once",
  );
});

test("pressing send twice quickly only sends once", async () => {
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "One answer.");
    await sleep(200);
    endStream(res);
  };
  await page.evaluate(`(() => {
    const input = document.getElementById("input");
    input.value = "Once";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.value = "Once";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  })()`);
  await page.waitFor(`!busy && ${LAST_REPLY}.includes("One answer")`);
  assert.equal(fake.requests.length, 1);
  assert.equal(await rows("user"), 1);
  assert.equal(await page.evaluate(`document.getElementById("input").value`), "Once", "text typed while busy isn't thrown away");
});

test("New chat while a reply is being written stops it and starts clean", async () => {
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "Still going…");
    await holdOpen(res);
  };
  await type("Hi");
  await page.waitFor(`${LAST_REPLY}.includes("Still going")`);
  await page.evaluate(`document.getElementById("new-chat").click()`);
  await page.waitFor("!busy", { what: "the reply to stop" });
  await sleep(100);
  assert.equal(await rows("user"), 0);
  assert.equal(await rows("assistant"), 0);
  assert.deepEqual((await state()).history, [], "the stopped reply doesn't leak into the new chat");
});

test("scrolling up to read isn't undone while a reply streams", async () => {
  const pauses = new Set([25, 40]);
  handler = async (body, res) => {
    startStream(res);
    for (let i = 1; i <= 60; i++) {
      writeText(res, `Paragraph ${i} of a long answer that keeps going.\n\n`);
      await sleep(15);
      if (pauses.has(i)) await new Promise((r) => (released = r));
    }
    endStream(res);
  };
  const distanceFromEnd = () => page.evaluate(`messages.scrollHeight - messages.scrollTop - messages.clientHeight`);
  await type("Write a lot");
  await page.waitFor(`${LAST_REPLY}.includes("Paragraph 25")`);
  await sleep(100);
  assert.ok((await distanceFromEnd()) < 80, "it follows the reply while the visitor is at the bottom");

  // Something above grows without the visitor scrolling (a late font or welcome message).
  await page.evaluate(`document.getElementById("intro").insertAdjacentHTML("beforeend", '<div style="height:400px"></div>')`);
  released();
  await page.waitFor(`${LAST_REPLY}.includes("Paragraph 40")`);
  await sleep(100);
  assert.ok((await distanceFromEnd()) < 80, "it keeps following when the page above changes size");

  // The visitor scrolls up with the mouse wheel, as the reply carries on.
  const { x, y } = await page.evaluate(`(() => { const r = messages.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  released();
  await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: -100000 });
  await page.waitFor(`!busy`, { timeout: 8000 });
  await sleep(800); // let any smooth scrolling finish
  // The wheel scrolled to the top; the reply must not have pulled the page back down to the end.
  const { top, height } = await page.evaluate(`({ top: messages.scrollTop, height: messages.scrollHeight })`);
  assert.ok(top < height / 5, `the page stays where the visitor scrolled to (at ${Math.round(top)} of ${height})`);
});

test("citation numbers become links only in plain text, never inside code, maths or links", async () => {
  const result = await page.evaluate(`(() => {
    const el = document.createElement("div");
    el.innerHTML = renderMarkdown([
      "Rain is wet [1]. Unknown source [9].",
      "In code: \`items[1]\`.",
      "\`\`\`",
      "first = items[1]",
      "\`\`\`",
      "A link: [the docs](https://example.com/page_[1]).",
      "Maths: $x[1] + 1$.",
      "Native marker 【3†source】 is removed.",
    ].join("\\n\\n"));
    const docsBefore = el.querySelector("a").getAttribute("href");
    linkCitations(el, { 1: "https://source.example/rain" });
    return {
      docsBefore,
      cites: [...el.querySelectorAll("a.cite")].map((a) => [a.textContent, a.getAttribute("href")]),
      inlineCode: el.querySelector("p code").textContent,
      block: el.querySelector("pre").textContent.trim(),
      docs: el.querySelector("a:not(.cite)").getAttribute("href"),
      maths: el.querySelector(".katex")?.querySelector("a") === null,
      text: el.textContent,
    };
  })()`);
  assert.deepEqual(result.cites, [["1", "https://source.example/rain"]]);
  assert.equal(result.inlineCode, "items[1]");
  assert.equal(result.block, "first = items[1]");
  assert.match(result.docsBefore, /^https:\/\/example\.com\/page_/);
  assert.equal(result.docs, result.docsBefore, "an address containing [1] isn't changed");
  assert.ok(result.maths, "no link inside the maths");
  assert.match(result.text, /Unknown source \[9\]/, "a number with no source is left as it is");
  assert.doesNotMatch(result.text, /【/);
});

test("a long reply streams without losing or reordering anything, and ends exactly as a full redraw", async () => {
  const result = await page.evaluate(`(() => {
    const parts = [];
    for (let i = 1; i <= 25; i++) {
      parts.push("## Section " + i, "Some text with a citation [1] and **bold** words, item " + i + ".");
      parts.push("1. first\\n2. second\\n\\n3. third after a gap");
      parts.push("\`\`\`js\\nconst a = [" + i + "];\\n\\nconst b = a[0]; // blank line above is inside the code\\n\`\`\`");
      parts.push("$$\\na_" + i + " = 1\\n\\n+ 2\\n$$");
      parts.push("| a | b |\\n|---|---|\\n| " + i + " | x |");
      parts.push("- loose\\n\\n    indented continuation " + i);
    }
    const text = parts.join("\\n\\n");
    const links = { 1: "https://source.example/" };
    const squash = (s) => s.replace(/\\s+/g, "");
    const realRender = window.renderMarkdown;
    const fullOf = (t) => {
      const el = document.createElement("div");
      el.innerHTML = realRender(t);
      linkCitations(el, links);
      return el;
    };

    let rendered = 0; // characters the stream renderer asked to be drawn
    window.renderMarkdown = (t) => ((rendered += t.length), realRender(t));
    const el = document.createElement("div");
    const r = streamRenderer(el, links);
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const mismatches = [];
    let at = 0;
    while (at < text.length) {
      at = Math.min(text.length, at + 1 + Math.floor(random() * 40));
      r.update(text.slice(0, at));
      if (squash(el.textContent) !== squash(fullOf(text.slice(0, at)).textContent) && mismatches.length < 3) mismatches.push(at);
    }
    const streamedChars = rendered;
    window.renderMarkdown = realRender;
    r.finish(text);
    return {
      length: text.length,
      streamedChars,
      updates: Math.round(text.length / 20),
      mismatches,
      sameAtEnd: el.innerHTML === fullOf(text).innerHTML,
    };
  })()`);
  assert.deepEqual(result.mismatches, [], "at every step the page shows exactly the text received so far");
  assert.ok(result.sameAtEnd, "the finished reply is identical to drawing it all at once");
  // Redrawing everything each time would draw about length × updates / 2 characters.
  assert.ok(
    result.streamedChars < result.length * 6,
    `drew ${result.streamedChars} characters for a ${result.length}-character reply; redrawing everything would be about ${Math.round((result.length * result.updates) / 2)}`,
  );
});

test("the page has no script errors", async () => {
  await type("Hi");
  await page.waitFor(`!busy && ${LAST_REPLY}.includes("Hello!")`);
  assert.deepEqual(page.errors, []);
});

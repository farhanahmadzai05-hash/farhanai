// Browser tests for Stage C: the model picker (only models the server really has), modes, and
// attaching text files and pictures, plus the server's checks on all of them. Like the other
// browser tests they use headless Chrome, server.js and a fake Groq, and are skipped (with the
// reason) when no browser is installed.
import { test as base, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { browserUnavailable, launchBrowser } from "../scripts/browser.js";
import { startFakeGroq, startApp, startStream, writeText, endStream, sleep } from "../scripts/fake-ai.js";

const skip = browserUnavailable();
const test = (name, fn) => base(name, { skip: skip || false, timeout: 20_000 }, fn);

let browser, page, fake, app;
let handler;

before(async () => {
  if (skip) return;
  fake = await startFakeGroq((body, res, n) => handler(body, res, n));
  // The models this Groq account lists; Llama 4 Maverick and others it doesn't list must never show.
  fake.models = ["openai/gpt-oss-120b", "llama-3.1-8b-instant", "qwen/qwen3.8-27b", "whisper-large-v3"];
  app = await startApp(fake.url, { GROQ_MODEL: "openai/gpt-oss-120b" });
  browser = await launchBrowser();
  page = browser.page;
  // Record what the page copies instead of touching the real clipboard.
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }); const realBlob = URL.createObjectURL; URL.createObjectURL = (b) => { window.__download = b; return realBlob(b); }; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloadName = this.download; };`,
  });
});

after(async () => {
  await browser?.close();
  await app?.stop();
  await fake?.close();
});

// The fake AI answers every message with "Answer to: <message>".
const echo = async (body, res) => {
  startStream(res);
  writeText(res, `Answer to: ${body.messages.at(-1).content}`);
  endStream(res);
};

async function load({ keepStorage = false } = {}) {
  if (!keepStorage) {
    await page.goto(`${app.base}/api/config`);
    await page.evaluate(`localStorage.clear()`);
  }
  await page.goto(app.base);
  await page.waitFor(`typeof send === 'function' && window.FarhanChats && document.querySelector(".suggestion")`);
  // Go past the intro screen the way a visitor does (with reduced motion on, it just fades).
  await page.evaluate(`document.getElementById("splash").dispatchEvent(new Event("pointerdown"))`);
  await page.waitFor(`document.getElementById("splash").hidden`);
}
const REDUCED_MOTION = { name: "prefers-reduced-motion", value: "reduce" };

beforeEach(async () => {
  if (skip) return;
  fake.requests.length = 0;
  handler = echo;
  await page.send("Emulation.clearDeviceMetricsOverride");
  await page.send("Emulation.setEmulatedMedia", { features: [REDUCED_MOTION] });
  await load();
});

const js = (expression) => page.evaluate(expression);
const type = (text) => js(`(() => { input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event("input")); document.getElementById("send").click(); })()`);
const ask = async (text) => {
  await type(text);
  await page.waitFor(`!busy && [...messages.querySelectorAll(".row.assistant .bubble")].at(-1)?.innerText.includes(${JSON.stringify(text)})`, { what: `the answer to "${text}"` });
};
const chatTitles = () => js(`[...document.querySelectorAll("#chat-list .chat-title")].map((e) => e.textContent)`);
// A real mouse click in the middle of an element.
async function click(selector) {
  const { x, y } = await page.waitFor(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, { what: selector });
  for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
async function key(keyName, modifiers = 0) {
  const codes = { Enter: 13, Escape: 27, k: 75, o: 79 };
  const text = keyName === "Enter" ? "\r" : undefined;
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code: keyName.length === 1 ? `Key${keyName.toUpperCase()}` : keyName, windowsVirtualKeyCode: codes[keyName], modifiers, text });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName], modifiers });
}
// The system prompt the fake AI received last.
const lastSystem = () => fake.requests.at(-1).messages.find((m) => m.role === "system").content;
const lastSent = () => fake.requests.at(-1).messages.filter((m) => m.role !== "system").map((m) => m.content);
const menuItem = (label) => js(`(() => { const b = [...document.querySelectorAll('.menu button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)})); b.id = "menu-pick"; return true; })()`);


const lastUser = () => fake.requests.at(-1).messages.at(-1).content;
const post = (base, body) =>
  fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], ...body }) });
// Picks a file for the hidden file input the way the browser's file dialog does.
async function chooseFiles(paths) {
  const { root } = await page.send("DOM.getDocument", {});
  const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#attach-input" });
  await page.send("DOM.setFileInputFiles", { nodeId, files: paths });
}
const dir = mkdtempSync(path.join(tmpdir(), "farhanai-files-"));
after(() => rmSync(dir, { recursive: true, force: true }));
// A small PNG drawn in the page, as a File.
const PICTURE = `(async () => { const c = document.createElement("canvas"); c.width = 40; c.height = 30; const x = c.getContext("2d"); x.fillStyle = "red"; x.fillRect(0, 0, 40, 30); const blob = await new Promise((r) => c.toBlob(r, "image/png")); return new File([blob], "red.png", { type: "image/png" }); })()`;

// ---------- Models ----------

test("the model picker lists only the models the server can use, and the pick is asked first", async () => {
  await page.waitFor(`!document.getElementById("model-chip").hidden`);
  await click("#model-chip");
  const items = await js(`[...document.querySelectorAll('.menu button')].map((b) => b.textContent.trim())`);
  assert.deepEqual(
    items.map((t) => t.split(" · ")[0].replace(" ✓", "")),
    ["Auto (GPT-OSS 120B)", "GPT-OSS 120B", "Qwen 3.8 27B", "Llama 3.1 8B"],
    "speech models and models the account doesn't list are left out",
  );
  assert.equal(await js(`document.querySelector('.menu button[aria-checked="true"]').textContent.trim()`), "Auto (GPT-OSS 120B)", "the current choice is marked for screen readers");
  await menuItem("Llama 3.1 8B");
  await click("#menu-pick");
  assert.match(await js(`document.getElementById("model-chip").textContent`), /Llama 3.1 8B/);
  await ask("hello");
  assert.equal(fake.requests.at(-1).model, "llama-3.1-8b-instant");
  assert.equal(await js(`document.querySelector(".row.assistant .answered-by").textContent`), "Llama 3.1 8B", "the reply says which model answered");
  // Remembered after a reload, and Auto goes back to the usual model.
  await load({ keepStorage: true });
  await page.waitFor(`/Llama/.test(document.getElementById("model-chip").textContent)`);
  await click("#model-chip");
  await menuItem("Auto");
  await click("#menu-pick");
  await ask("again");
  assert.equal(fake.requests.at(-1).model, "openai/gpt-oss-120b");
});

test("the server ignores a model it doesn't have", async () => {
  handler = echo;
  const res = await post(app.base, { model: "meta-llama/llama-4-maverick-17b-128e-instruct" });
  await res.text();
  assert.equal(fake.requests.at(-1).model, "openai/gpt-oss-120b");
});

// ---------- Modes ----------

test("modes change how the AI is asked to answer, and are remembered", async () => {
  await click("#mode-chip");
  await menuItem("Coding");
  await click("#menu-pick");
  await ask("sort a list");
  assert.match(lastSystem(), /Coding mode: act as a careful senior programmer/);
  await load({ keepStorage: true });
  assert.match(await js(`document.getElementById("mode-chip").textContent`), /Coding/);
  await click("#mode-chip");
  await menuItem("Maths");
  await click("#menu-pick");
  await ask("solve x^2 = 4");
  assert.match(lastSystem(), /Maths mode/);
  assert.doesNotMatch(lastSystem(), /Coding mode/);
  // A made-up mode sent straight to the server adds nothing.
  await (await post(app.base, { mode: "jailbreak" })).text();
  assert.doesNotMatch(lastSystem(), /(Study|Coding|Maths) mode:/);
});

// ---------- Text files ----------

test("a text file can be attached, is read by the AI, kept for follow-ups and shown in saved chats", async () => {
  const file = path.join(dir, "notes.md");
  writeFileSync(file, "# Shopping\n- apples\n- secret ingredient: saffron\n");
  await chooseFiles([file]);
  await page.waitFor(`document.querySelector("#attachments .attachment")`);
  assert.match(await js(`document.getElementById("attachments").textContent`), /notes\.md/);
  // With nothing typed, the file can still be sent.
  await js(`document.getElementById("send").click()`);
  await page.waitFor(`!busy && messages.querySelector(".row.assistant .msg-actions")`);
  const sent = lastUser();
  assert.match(sent, /^Please read the attached file\./);
  assert.match(sent, /\[Attached file: notes\.md\]\n````\n# Shopping/);
  assert.match(sent, /saffron/);
  assert.equal(await js(`document.getElementById("attachments").hidden`), true, "the tray is emptied after sending");
  assert.match(await js(`messages.querySelector(".row.user .sent-attachments").textContent`), /notes\.md/);
  await ask("what was the secret ingredient?");
  assert.match(fake.requests.at(-1).messages.find((m) => m.role === "user").content, /saffron/, "a follow-up still has the file");
  // Reopened from the sidebar, the chip is still there and the file is still in the conversation.
  await load({ keepStorage: true });
  await click("#chat-list .chat-title");
  await page.waitFor(`messages.querySelector(".row.user .sent-attachments")`);
  await ask("and the first item?");
  assert.match(fake.requests.at(-1).messages.find((m) => m.role === "user").content, /saffron/);
});

test("files that aren't text, or are too long, are refused with a message", async () => {
  const binary = path.join(dir, "report.bin");
  writeFileSync(binary, Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 1, 2, 3]));
  const pdf = path.join(dir, "report.pdf");
  writeFileSync(pdf, "%PDF-1.7 fake");
  const long = path.join(dir, "long.txt");
  writeFileSync(long, "x".repeat(12_001));
  for (const [file, message] of [
    [binary, /isn't a text file/],
    [pdf, /isn't a text file/],
    [long, /too much text/],
  ]) {
    await chooseFiles([file]);
    await page.waitFor(`[...document.querySelectorAll(".toast")].some((t) => ${message}.test(t.textContent))`, { what: String(message) });
    assert.equal(await js(`document.querySelectorAll("#attachments .attachment").length`), 0);
  }
  // The server checks too.
  const res = await post(app.base, { attachments: { files: [{ name: "a.txt", text: "y".repeat(12_001) }] } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /too long/);
});

// ---------- Pictures ----------

test("a picture is shrunk, sent only to a model that can read pictures, and shown in the message", async () => {
  handler = echo;
  await js(`(async () => window.FarhanComposer.add([await ${PICTURE}]))()`);
  await page.waitFor(`document.querySelector("#attachments .attachment.picture img")`);
  await js(`input.value = "what colour is this?"; document.getElementById("send").click()`);
  await page.waitFor(`!busy && messages.querySelector(".row.assistant .msg-actions")`);
  const request = fake.requests.at(-1);
  assert.equal(request.model, "qwen/qwen3.8-27b", "even with Auto, a picture goes to the model that can see");
  const content = request.messages.at(-1).content;
  assert.equal(content[0].type, "text");
  assert.equal(content[0].text, "what colour is this?");
  assert.equal(content[1].type, "image_url");
  assert.match(content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.ok(await js(`messages.querySelector(".row.user .sent-attachments img")`), "the picture shows in the message");
  // The next message doesn't send the picture again.
  await ask("thanks");
  assert.equal(typeof fake.requests.at(-1).messages.at(-1).content, "string");
  assert.ok(fake.requests.at(-1).messages.every((m) => typeof m.content === "string" || m.content === null));
});

test("the server refuses bad pictures, too many pictures, and pictures when no model can read them", async () => {
  const tiny = "data:image/png;base64,iVBORw0KGgo=";
  for (const pictures of [["data:text/html;base64,PHNjcmlwdD4="], ["https://example.com/a.png"], [tiny, tiny, tiny, tiny]]) {
    const res = await post(app.base, { attachments: { pictures } });
    assert.equal(res.status, 400, JSON.stringify(pictures).slice(0, 60));
  }
  // A Groq account with no picture model: the picture button only offers text files, and the
  // server says so plainly.
  const plain = await startFakeGroq(echo);
  plain.models = ["openai/gpt-oss-120b"];
  const other = await startApp(plain.url, { GROQ_MODEL: "openai/gpt-oss-120b" });
  try {
    const res = await post(other.base, { attachments: { pictures: [tiny] } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /can see pictures/);
    assert.equal(plain.requests.length, 0, "nothing was sent to the AI");
    const list = await (await fetch(`${other.base}/api/models`)).json();
    assert.equal(list.pictures, false);
    assert.deepEqual(list.models.map((m) => m.id), ["openai/gpt-oss-120b"]);
  } finally {
    await other.stop();
    await plain.close();
  }
});

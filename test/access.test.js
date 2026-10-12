// Browser tests for Stage D: what screen readers hear, names and sizes of controls, menus that
// say which choice is current, Read aloud and the voice settings, and long replies that are only
// partly drawn. The browser's speech is replaced by a recorder, so nothing is played. Like the
// other browser tests they're skipped (with the reason) when no browser is installed.
import { test as base, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { browserUnavailable, launchBrowser } from "../scripts/browser.js";
import { startFakeGroq, startApp, startStream, writeText, endStream, sleep } from "../scripts/fake-ai.js";

// A stand-in for the browser's speech: it records what would be said, with which voice and speed.
// Each utterance "finishes" after window.__speakMs (never, if it's Infinity).
const SPEECH = `window.__spoken = []; window.__cancelled = 0; window.__speakMs = 5;
window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
  getVoices: () => [{ name: "Test Voice A", lang: "en-GB" }, { name: "Test Voice B", lang: "fr-FR" }],
  speak(u) { window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate }); if (window.__speakMs !== Infinity) setTimeout(() => { u.onstart && u.onstart(); u.onend && u.onend(); }, window.__speakMs); },
  cancel() { window.__cancelled++; },
  addEventListener() {},
} });
`;

const skip = browserUnavailable();
const test = (name, fn) => base(name, { skip: skip || false, timeout: 20_000 }, fn);

let browser, page, fake, app;
let handler;

before(async () => {
  if (skip) return;
  fake = await startFakeGroq((body, res, n) => handler(body, res, n));
  app = await startApp(fake.url);
  browser = await launchBrowser();
  page = browser.page;
  // Record what the page copies instead of touching the real clipboard.
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: SPEECH + `Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }); const realBlob = URL.createObjectURL; URL.createObjectURL = (b) => { window.__download = b; return realBlob(b); }; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloadName = this.download; };`,
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


// ---------- What screen readers hear ----------

test("a reply is announced once, when it's finished, not piece by piece", async () => {
  let release;
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "The answer is **42**. ");
    await new Promise((r) => (release = r));
    writeText(res, "That's all.");
    endStream(res);
  };
  assert.equal(await js(`messages.getAttribute("aria-live")`), null, "the conversation itself isn't a live region");
  await type("question");
  await page.waitFor(`messages.innerText.includes("The answer is")`);
  assert.equal(await js(`messages.getAttribute("aria-busy")`), "true");
  assert.equal(await js(`document.getElementById("announcer").textContent`), "", "nothing is read out while it streams");
  release();
  await page.waitFor(`!busy && document.getElementById("announcer").textContent`);
  assert.equal(await js(`document.getElementById("announcer").textContent`), "Farhan AI: The answer is 42. That's all.");
  assert.equal(await js(`messages.getAttribute("aria-busy")`), "false");
  assert.equal(await js(`document.getElementById("announcer").getAttribute("aria-live")`), "polite");
});

test("errors are announced too", async () => {
  handler = async (body, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "bad" } }));
  };
  await type("question");
  await page.waitFor(`!busy && /^Error: /.test(document.getElementById("announcer").textContent)`);
});

// ---------- Controls ----------

async function auditControls() {
  return js(`(() => {
    const problems = [];
    const ids = {};
    for (const el of document.querySelectorAll("[id]")) ids[el.id] = (ids[el.id] || 0) + 1;
    for (const [id, n] of Object.entries(ids)) if (n > 1) problems.push("duplicate id " + id);
    for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), textarea, select")) {
      if (el.offsetParent === null || el.closest("[hidden], [inert]")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const label = el.getAttribute("aria-label") || el.textContent.trim() || el.title || el.placeholder || (el.labels && el.labels[0] && el.labels[0].textContent.trim());
      if (!label) problems.push("no name: " + el.outerHTML.slice(0, 80));
      if (r.width < 24 || r.height < 24) problems.push("too small (" + Math.round(r.width) + "x" + Math.round(r.height) + "): " + el.outerHTML.slice(0, 80));
    }
    return problems;
  })()`);
}

test("every visible control has a name and is at least 24 by 24 pixels, on a computer and a phone", async () => {
  await ask("hello");
  assert.deepEqual(await auditControls(), []);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  await load({ keepStorage: true });
  await ask("hello again");
  assert.deepEqual(await auditControls(), []);
});

test("menus say which choice is the current one", async () => {
  await click("#style-chip");
  const items = await js(`[...document.querySelectorAll(".menu button")].map((b) => [b.textContent.trim(), b.getAttribute("role"), b.getAttribute("aria-checked")])`);
  assert.deepEqual(items[0], ["Balanced", "menuitemradio", "true"]);
  assert.deepEqual(items[1], ["Concise", "menuitemradio", "false"]);
  assert.deepEqual(items.at(-1), ["Customise…", "menuitem", null], "an action isn't a choice");
});

// ---------- Read aloud and voice settings ----------

test("Read aloud reads the reply in the chosen voice and speed, and can be stopped", async () => {
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "First sentence. Then **x^2** is $x^2$. And `code`.");
    endStream(res);
  };
  await type("read this");
  await page.waitFor(`!busy && messages.querySelector('.act[aria-label="Read aloud"]')`);
  await click('.act[aria-label="Read aloud"]');
  await page.waitFor(`document.querySelector('.msg-actions .act[aria-pressed="false"]')`, { what: "reading to finish" });
  const spoken = await js(`window.__spoken`);
  assert.equal(spoken.map((s) => s.text).join(" "), await js(`window.__speakable("First sentence. Then **x^2** is $x^2$. And \`code\`.")`));
  assert.match(spoken.map((s) => s.text).join(" "), /x squared/);

  // Pick a voice and a speed in Settings; Read aloud uses them, and they're remembered.
  await js(`window.FarhanSettings.open("voice")`);
  await page.waitFor(`document.querySelector('dialog.settings select[name="voice-name"]')`);
  assert.deepEqual(await js(`[...document.querySelectorAll('select[name="voice-name"] option')].map((o) => o.value)`), ["", "Test Voice A", "Test Voice B"]);
  await js(`(() => { const s = document.querySelector('select[name="voice-name"]'); s.value = "Test Voice B"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await click('dialog.settings input[name="voice-rate"][value="1.2"]');
  await js(`document.querySelector("dialog.settings").close()`);
  await load({ keepStorage: true });
  await click("#chat-list .chat-title");
  await page.waitFor(`messages.querySelector('.act[aria-label="Read aloud"]')`);
  await js(`window.__spoken = []; window.__speakMs = Infinity`);
  await click('.act[aria-label="Read aloud"]');
  await page.waitFor(`window.__spoken.length > 0`);
  const first = await js(`window.__spoken[0]`);
  assert.equal(first.voice, "Test Voice B");
  assert.ok(Math.abs(first.rate - 1.03 * 1.2) < 1e-9, `rate ${first.rate}`);
  // Still reading (it never finishes here): the same button stops it.
  assert.equal(await js(`document.querySelector(".msg-actions .act[aria-pressed]").getAttribute("aria-label")`), "Stop reading");
  const cancelled = await js(`window.__cancelled`);
  await click('.act[aria-label="Stop reading"]');
  assert.equal(await js(`window.__cancelled`), cancelled + 1);
  assert.equal(await js(`document.querySelector(".msg-actions .act[aria-pressed]").getAttribute("aria-pressed")`), "false");
});

// ---------- Long replies ----------

test("a long reply that's partly off screen is still copied in full", async () => {
  const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph number ${i + 1} with some words.`);
  handler = async (body, res) => {
    startStream(res);
    writeText(res, paragraphs.join("\n\n"));
    endStream(res);
  };
  await type("long");
  await page.waitFor(`!busy && messages.querySelector(".row.assistant .msg-actions")`);
  await js(`messages.scrollTop = 0`);
  await sleep(100);
  assert.equal(await js(`getComputedStyle(messages.querySelector(".row.assistant .bubble > div > p")).contentVisibility`), "auto");
  await click('.row.assistant .act[aria-label="Copy"]');
  await page.waitFor(`window.__copied`);
  const copied = await js(`window.__copied`);
  assert.ok(copied.includes("Paragraph number 1 with") && copied.includes("Paragraph number 80 with"), "the whole reply is copied");
  assert.equal(copied.split("\n").filter(Boolean).length, 80, "paragraphs stay separate lines");
});

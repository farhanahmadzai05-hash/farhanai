// Browser tests for the new interface: themes, the home screen, the composer, code blocks and
// saved chats. Like browser.test.js they open the real page in headless Chrome against server.js
// and a fake Groq, and are skipped (with the reason) when no browser is installed.
import { test as base, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { browserUnavailable, launchBrowser } from "../scripts/browser.js";
import { startFakeGroq, startApp, startStream, writeText, endStream, sleep } from "../scripts/fake-ai.js";

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
    source: `Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });`,
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
  const codes = { Enter: 13, Escape: 27 };
  const text = keyName === "Enter" ? "\r" : undefined;
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName], modifiers, text });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName], modifiers });
}

// ---------- Themes ----------

test("dark is the default theme, and a chosen theme and accent are used from the first paint after reloading", async () => {
  assert.equal(await js(`document.documentElement.dataset.theme`), "dark");
  await click("#appearance");
  await click('input[name="theme-mode"][value="light"]');
  assert.equal(await js(`document.documentElement.dataset.theme`), "light", "the change shows straight away");
  await click('input[name="theme-accent"][value="teal"]');
  const accent = await js(`getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()`);
  assert.equal(accent, "#0d9488", "light theme's teal accent");

  // theme.js runs in <head>, so the theme is already set before the stylesheet and the body.
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `document.addEventListener("readystatechange", () => { if (!window.__firstTheme) window.__firstTheme = document.documentElement.dataset.theme + "/" + document.documentElement.dataset.accent; }, { once: true });`,
  });
  await load({ keepStorage: true });
  assert.equal(await js(`window.__firstTheme`), "light/teal");
  const bg = await js(`getComputedStyle(document.body).backgroundColor`);
  assert.equal(bg, "rgb(247, 247, 248)");
});

test("System follows the device's light or dark setting", async () => {
  await js(`FarhanTheme.setMode("system")`);
  await page.send("Emulation.setEmulatedMedia", { features: [REDUCED_MOTION, { name: "prefers-color-scheme", value: "light" }] });
  await page.waitFor(`document.documentElement.dataset.theme === "light"`);
  await page.send("Emulation.setEmulatedMedia", { features: [REDUCED_MOTION, { name: "prefers-color-scheme", value: "dark" }] });
  await page.waitFor(`document.documentElement.dataset.theme === "dark"`);
});

test("text and buttons stay readable in both themes", async () => {
  // Contrast between text and its background must meet WCAG AA (4.5:1) for body text.
  const contrast = () =>
    js(`(() => {
      const rgb = (c) => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
      const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bg = getComputedStyle(document.body).backgroundColor;
      const pick = (sel) => getComputedStyle(document.querySelector(sel)).color;
      return { text: ratio(pick(".home-sub"), bg), muted: ratio(pick(".suggest-head"), bg), title: ratio(pick(".home-title"), bg) };
    })()`);
  for (const mode of ["dark", "light"]) {
    await js(`FarhanTheme.setMode("${mode}")`);
    await sleep(100); // reduced motion makes the colour change instant, but give it a frame
    const c = await contrast();
    assert.ok(c.text >= 4.5 && c.muted >= 4.5 && c.title >= 7, `${mode}: ${JSON.stringify(c)}`);
  }
});

// ---------- Home screen and composer ----------

// Marks a shown suggestion card of the wanted kind ("send" or "fill") and returns its prompt.
async function findCard(kind) {
  for (let tries = 0; tries < 30; tries++) {
    const prompt = await js(`(() => {
      const byTitle = new Map(FarhanHome.SUGGESTIONS.map((s) => [s.title, s]));
      const card = [...document.querySelectorAll(".suggestion")].find((c) => byTitle.get(c.querySelector(".s-title").textContent)["${kind}"]);
      document.getElementById("picked")?.removeAttribute("id");
      if (!card) return null;
      card.id = "picked";
      return byTitle.get(card.querySelector(".s-title").textContent)["${kind}"];
    })()`);
    if (prompt) return prompt;
    await js(`document.getElementById("shuffle").click()`);
  }
  throw new Error(`no ${kind} card was shown`);
}

test("a suggestion card sends its prompt, and a fill-in card only fills the message box", async () => {
  assert.equal(await js(`document.querySelectorAll(".suggestion").length`), 4, "four suggestions are shown");
  const prompt = await findCard("send");
  await click("#picked");
  await page.waitFor(`!busy && messages.querySelector(".row.assistant")`);
  assert.equal(fake.requests.at(-1).messages.at(-1).content, prompt, "the card's whole prompt is sent");
  assert.ok(await js(`document.body.classList.contains("chatting")`), "the home screen gives way to the chat");

  await click("#new-chat");
  const sentSoFar = fake.requests.length;
  const starter = await findCard("fill");
  await click("#picked");
  assert.equal(await js(`input.value`), starter);
  assert.equal(await js(`document.activeElement === input`), true, "the cursor is in the box");
  await sleep(200);
  assert.equal(fake.requests.length, sentSoFar, "nothing is sent until the visitor finishes it");
});

test("quick actions start a message in the box", async () => {
  await click(".quick-actions .quick:nth-child(2)"); // Explain
  assert.equal(await js(`input.value`), "Explain ");
  assert.equal(await js(`document.activeElement.id`), "input");
  assert.equal(fake.requests.length, 0);
});

test("Enter sends, Shift+Enter adds a new line", async () => {
  await click("#input");
  await js(`input.value = "line one"`);
  await key("Enter", 8); // Shift
  assert.equal(fake.requests.length, 0, "Shift+Enter doesn't send");
  assert.equal(await js(`input.value`), "line one\n");
  await js(`input.value = "line one\\nline two"`);
  await key("Enter");
  await page.waitFor(`!busy && messages.querySelector(".row.assistant")`);
  assert.equal(fake.requests.at(-1).messages.at(-1).content, "line one\nline two");
  assert.equal(await js(`input.value`), "", "the box is emptied");
});

test("an unsent message is kept after a reload, and cleared once it's sent", async () => {
  await js(`input.value = "half-written thought"; input.dispatchEvent(new Event("input"))`);
  await sleep(400);
  await load({ keepStorage: true });
  assert.equal(await js(`input.value`), "half-written thought");
  await ask("half-written thought");
  await sleep(400);
  await load({ keepStorage: true });
  assert.equal(await js(`input.value`), "");
});

test("a message that's too long is caught before sending, and what was typed is kept", async () => {
  await js(`input.value = "x".repeat(20001); input.dispatchEvent(new Event("input"))`);
  assert.equal(await js(`document.getElementById("counter").hidden`), false, "the length shows near the limit");
  assert.match(await js(`document.getElementById("counter").textContent`), /20,001 \/ 20,000/);
  await js(`document.getElementById("send").click()`);
  await sleep(200);
  assert.equal(fake.requests.length, 0);
  assert.equal(await js(`input.value.length`), 20001);
  assert.match(await js(`document.getElementById("toasts").textContent`), /too long/);
});

// ---------- Code blocks and safe rendering ----------

test("code blocks show the language, colours, line numbers and copy the exact code", async () => {
  const code = 'def greet(name):\n    # say hello\n    return f"Hello {name}"\n\n\nprint(greet("Farhan"))\nx = 42';
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "Here you go:\n\n```python\n" + code + "\n```\n");
    endStream(res);
  };
  await type("code please");
  await page.waitFor(`!busy && document.querySelector(".row.assistant .code-block")`);
  const info = await js(`(() => {
    const b = document.querySelector(".row.assistant .code-block");
    return {
      label: b.querySelector(".code-lang").textContent,
      numbered: b.classList.contains("numbered"),
      keyword: b.querySelector(".tok-kw")?.textContent,
      comment: b.querySelector(".tok-com")?.textContent,
      string: b.querySelector(".tok-str")?.textContent,
      text: b.querySelector("pre code").textContent,
    };
  })()`);
  assert.equal(info.label, "Python");
  assert.ok(info.numbered, "seven lines get line numbers");
  assert.equal(info.keyword, "def");
  assert.equal(info.comment, "# say hello");
  assert.equal(info.string, 'f"Hello {name}"'.slice(1)); // the f prefix is an ordinary letter
  assert.equal(info.text, code, "the code on the page is exactly the code sent, with no line numbers mixed in");
  await click(".row.assistant .code-copy");
  await page.waitFor(`window.__copied !== undefined`);
  assert.equal(await js(`window.__copied`), code);
  assert.equal(await js(`document.querySelector(".row.assistant .code-copy").textContent`), "Copied");
});

test("long code blocks can be collapsed and expanded", async () => {
  const lines = Array.from({ length: 45 }, (_, i) => `console.log(${i});`).join("\n");
  const html = await js(`renderMarkdown(${JSON.stringify("```js\n" + lines + "\n```")})`);
  await js(`(() => { const d = document.createElement("div"); d.id = "fold-test"; d.className = "bubble"; d.innerHTML = ${JSON.stringify(html)}; messages.appendChild(d); })()`);
  await click("#fold-test .code-fold");
  assert.ok(await js(`document.querySelector("#fold-test .code-block").classList.contains("collapsed")`));
  assert.equal(await js(`document.querySelector("#fold-test .code-fold").textContent`), "Show all 45 lines");
  await click("#fold-test .code-fold");
  assert.equal(await js(`document.querySelector("#fold-test .code-block").classList.contains("collapsed")`), false);
});

test("nothing in a reply or a code block can run script", async () => {
  const attack = [
    "```js\" onmouseover=\"window.__pwned=1",
    "</code></pre><img src=x onerror=\"window.__pwned=2\">",
    "```",
    "",
    "<img src=x onerror=\"window.__pwned=3\"> <a href=\"javascript:window.__pwned=4\">link</a>",
    "",
    "```html",
    "<script>window.__pwned=5</script><svg onload=\"window.__pwned=6\">",
    "```",
  ].join("\n");
  handler = async (body, res) => {
    startStream(res);
    writeText(res, attack);
    endStream(res);
  };
  await type("attack");
  await page.waitFor(`!busy && messages.querySelector(".row.assistant")`);
  await sleep(300);
  const result = await js(`(() => {
    const bubble = [...messages.querySelectorAll(".row.assistant .bubble")].at(-1);
    for (const el of bubble.querySelectorAll("*")) el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return {
      pwned: window.__pwned,
      scripts: bubble.querySelectorAll("script, svg[onload], img[onerror], [onmouseover]").length,
      jsLinks: [...bubble.querySelectorAll("a")].filter((a) => /^javascript:/i.test(a.getAttribute("href") || "")).length,
      codeText: [...bubble.querySelectorAll("pre code")].map((c) => c.textContent).join("|"),
    };
  })()`);
  assert.equal(result.pwned, undefined);
  assert.equal(result.scripts, 0);
  assert.equal(result.jsLinks, 0);
  assert.match(result.codeText, /<script>window.__pwned=5<\/script>/, "code is shown as text");
});

// ---------- Saved chats ----------

test("chats are saved in this browser, listed in the sidebar, and carry on after a reload", async () => {
  assert.match(await js(`document.getElementById("chat-list").textContent`), /No saved chats yet/);
  await ask("What is a prime number?");
  await ask("Give an example");
  assert.deepEqual(await chatTitles(), ["What is a prime number?"]);
  assert.equal(await js(`document.querySelector("#chat-list .chat-open[aria-current=page]") !== null`), true, "the open chat is highlighted");

  await load({ keepStorage: true });
  assert.deepEqual(await chatTitles(), ["What is a prime number?"]);
  assert.equal(await js(`messages.querySelectorAll(".row").length`), 0, "a reload starts on a fresh chat");
  await click("#chat-list .chat-open");
  const shown = await js(`[...messages.querySelectorAll(".row .bubble")].map((b) => b.innerText.trim())`);
  assert.deepEqual(shown, ["What is a prime number?", "Answer to: What is a prime number?", "Give an example", "Answer to: Give an example"]);

  // Carrying on sends the earlier messages too, so the AI has the context.
  await ask("And another");
  const sent = fake.requests.at(-1).messages.filter((m) => m.role !== "system").map((m) => m.content);
  assert.deepEqual(sent.slice(-5), ["What is a prime number?", "Answer to: What is a prime number?", "Give an example", "Answer to: Give an example", "And another"]);
  assert.deepEqual(await chatTitles(), ["What is a prime number?"], "still one chat, not a copy");
});

test("New chat starts a separate saved chat", async () => {
  await ask("First topic");
  await click("#side-new");
  assert.equal(await js(`messages.querySelectorAll(".row").length`), 0);
  await ask("Second topic");
  assert.deepEqual(await chatTitles(), ["Second topic", "First topic"]);
});

test("chats can be renamed and pinned from their menu", async () => {
  await ask("Old name");
  await click("#side-new");
  await ask("Other chat");
  await click('#chat-list .chat-item:last-child .chat-more');
  await click('.menu [role="menuitem"]:nth-child(1)'); // Rename
  await js(`document.querySelector(".chat-rename").value = "My maths notes"`);
  await key("Enter");
  await page.waitFor(`[...document.querySelectorAll("#chat-list .chat-title")].some((e) => e.textContent === "My maths notes")`);

  await click('#chat-list .chat-item:last-child .chat-more');
  await click('.menu [role="menuitem"]:nth-child(2)'); // Pin
  const groups = await js(`[...document.querySelectorAll("#chat-list .chat-group")].map((g) => [g.querySelector("h3").textContent, [...g.querySelectorAll(".chat-title")].map((t) => t.textContent)])`);
  assert.deepEqual(groups[0], ["Pinned", ["My maths notes"]]);
  await load({ keepStorage: true });
  assert.deepEqual(await chatTitles(), ["My maths notes", "Other chat"], "renaming and pinning are remembered");
});

test("deleting a chat asks first, and Cancel keeps it", async () => {
  await ask("Keep or delete");
  await click("#chat-list .chat-more");
  await click('.menu [role="menuitem"].danger'); // Delete
  await page.waitFor(`document.querySelector("dialog.confirm[open]")`);
  assert.match(await js(`document.querySelector("dialog.confirm").textContent`), /Keep or delete/);
  assert.equal(await js(`document.activeElement.textContent`), "Cancel", "the safe choice has the focus");
  await click('dialog.confirm [value="no"]');
  await page.waitFor(`!document.querySelector("dialog.confirm")`, { what: "the dialog to close" });
  assert.deepEqual(await chatTitles(), ["Keep or delete"]);

  await click("#chat-list .chat-more");
  await click('.menu [role="menuitem"].danger');
  await click('dialog.confirm [value="yes"]');
  await page.waitFor(`!document.querySelector("#chat-list .chat-title")`);
  assert.equal(await js(`messages.querySelectorAll(".row").length`), 0, "deleting the open chat starts a new one");
  assert.equal(await js(`Object.keys(localStorage).filter((k) => k.startsWith("farhanai-chat:")).length`), 0, "its messages are removed too");
});

test("search finds chats by their title or by words inside them", async () => {
  await ask("Photosynthesis basics");
  await click("#side-new");
  await ask("Train timetable");
  await js(`(() => { const s = document.getElementById("chat-search"); s.value = "answer photosynthesis"; s.dispatchEvent(new Event("input")); })()`);
  await page.waitFor(`document.querySelectorAll("#chat-list .chat-title").length === 1`);
  assert.deepEqual(await chatTitles(), ["Photosynthesis basics"]);
  assert.match(await js(`document.querySelector("#chat-list .chat-snippet")?.textContent || ""`), /Answer to: Photosynthesis/i, "a match inside the chat shows where");
  await js(`(() => { const s = document.getElementById("chat-search"); s.value = "zebra"; s.dispatchEvent(new Event("input")); })()`);
  await page.waitFor(`/No chats match/.test(document.getElementById("chat-list").textContent)`);
});

test("a stopped reply is saved with its note, and a damaged or hostile saved chat can't break the page", async () => {
  let release;
  handler = async (body, res) => {
    startStream(res);
    writeText(res, "Partial words");
    await new Promise((r) => {
      release = r;
      res.on("close", r);
    });
  };
  await type("Stop me");
  await page.waitFor(`[...messages.querySelectorAll(".row.assistant .bubble")].at(-1)?.innerText.includes("Partial words")`);
  await js(`document.getElementById("send").click()`);
  await page.waitFor(`!busy`);
  release?.();
  await load({ keepStorage: true });
  await click("#chat-list .chat-open");
  assert.match(await js(`messages.querySelector(".turn-note")?.textContent || ""`), /Stopped/);

  // Saved data edited by hand, or damaged: bad entries are skipped and HTML stays harmless.
  await js(`(() => {
    localStorage.setItem("farhanai-chats", JSON.stringify([{ id: "evil", title: "<img src=x onerror=window.__pwned=1>", created: 1, updated: Date.now() }, { id: "../../x" }, null, 5]));
    localStorage.setItem("farhanai-chat:evil", JSON.stringify({ turns: [{ user: "<b>hi</b>", reply: "<img src=x onerror=window.__pwned=2> ok", sources: [{ results: [{ n: 1, url: "javascript:window.__pwned=3", title: "bad" }] }] }, "junk", { reply: "no user" }] }));
  })()`);
  await load({ keepStorage: true });
  assert.deepEqual(await chatTitles(), ["<img src=x onerror=window.__pwned=1>"], "shown as text, and the broken entries are skipped");
  await click("#chat-list .chat-open");
  await sleep(200);
  assert.equal(await js(`window.__pwned`), undefined);
  assert.equal(await js(`messages.querySelector(".row.user .bubble").textContent`), "<b>hi</b>");
  assert.equal(await js(`messages.querySelectorAll('a[href^="javascript"]').length`), 0);
  assert.deepEqual(page.errors, []);
});

test("if the browser's storage is full, the chat carries on and says it isn't being saved", async () => {
  await js(`(() => { const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k.startsWith("farhanai-chat")) throw new DOMException("full", "QuotaExceededError"); return real.call(this, k, v); }; })()`);
  await ask("Hello there");
  assert.match(await js(`document.getElementById("toasts").textContent`), /storage is full/);
  await ask("Still working?");
  assert.equal(await js(`messages.querySelectorAll(".row.assistant").length`), 2);
});

// ---------- Phones ----------

test("on a phone the chats open in a drawer, and nothing is wider than the screen", async () => {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await load();
  await ask("Phone chat");
  assert.equal(await js(`document.documentElement.scrollWidth <= innerWidth && innerWidth === 390`), true, "no sideways scrolling");
  assert.equal(await js(`getComputedStyle(document.getElementById("sidebar")).visibility`), "hidden");
  await click("#side-toggle");
  await page.waitFor(`getComputedStyle(document.getElementById("sidebar")).visibility === "visible"`);
  assert.equal(await js(`document.getElementById("side-toggle").getAttribute("aria-expanded")`), "true");
  await key("Escape");
  await page.waitFor(`getComputedStyle(document.getElementById("sidebar")).visibility === "hidden"`);
  // Tapping a chat opens it and closes the drawer.
  await click("#side-toggle");
  await page.waitFor(`getComputedStyle(document.getElementById("sidebar")).visibility === "visible"`);
  await sleep(300);
  await click("#chat-list .chat-open");
  await page.waitFor(`getComputedStyle(document.getElementById("sidebar")).visibility === "hidden"`);
  // Buttons are big enough to tap (at least 32px).
  const small = await js(`[...document.querySelectorAll("header button, #composer button")].filter((b) => b.offsetParent && (b.offsetWidth < 32 || b.offsetHeight < 32)).map((b) => (b.id || b.className) + " " + b.offsetWidth + "x" + b.offsetHeight)`);
  assert.deepEqual(small, []);
});

test("on a desktop the sidebar can be hidden, and that's remembered", async () => {
  assert.equal(await js(`getComputedStyle(document.getElementById("sidebar")).visibility`), "visible");
  await click("#side-close");
  await page.waitFor(`getComputedStyle(document.getElementById("sidebar")).visibility === "hidden"`);
  await load({ keepStorage: true });
  assert.equal(await js(`document.documentElement.classList.contains("side-collapsed")`), true);
  await click("#side-toggle");
  await page.waitFor(`getComputedStyle(document.getElementById("sidebar")).visibility === "visible"`);
});

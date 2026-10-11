// Background music must be the visitor's choice: nothing plays or downloads until they turn it
// on, and the music file stays small enough for phones.
import { test as base, before, after } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { browserUnavailable, launchBrowser } from "../scripts/browser.js";
import { startFakeGroq, startApp } from "../scripts/fake-ai.js";

const MAX_MUSIC_BYTES = 2 * 1024 * 1024;

base("the music file is small enough to load quickly on a phone", () => {
  for (const name of ["music.mp3", "music.m4a", "music.ogg"]) {
    let size;
    try {
      size = statSync(fileURLToPath(new URL(`../public/${name}`, import.meta.url))).size;
    } catch {
      continue; // that file hasn't been added
    }
    assert.ok(size <= MAX_MUSIC_BYTES, `public/${name} is ${(size / 1048576).toFixed(1)} MB; keep it under 2 MB`);
  }
});

const skip = browserUnavailable();
const test = (name, fn) => base(name, { skip: skip || false, timeout: 20_000 }, fn);
let browser, page, fake, app;

before(async () => {
  if (skip) return;
  fake = await startFakeGroq((body, res) => res.end());
  app = await startApp(fake.url);
  browser = await launchBrowser();
  page = browser.page;
  // Count audio players the page creates, and note when one actually starts playing.
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      window.__audioCreated = 0;
      window.__playing = false;
      const RealAudio = window.Audio;
      window.Audio = function (...args) {
        window.__audioCreated++;
        return new RealAudio(...args);
      };
      const realPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const started = realPlay.call(this);
        started.then(() => (window.__playing = true), () => {});
        return started;
      };
    })()`,
  });
});

after(async () => {
  await browser?.close();
  await app?.stop();
  await fake?.close();
});

// Opens the page fresh, with whatever music choice was remembered from an earlier visit.
async function open(remembered) {
  await page.goto(`${app.base}/api/config`);
  await page.evaluate(remembered ? `localStorage.setItem("farhanai-music", ${JSON.stringify(remembered)})` : `localStorage.clear()`);
  await page.goto(app.base);
  await page.waitFor(`document.getElementById("music")`);
  await page.evaluate(`document.getElementById("splash")?.remove()`);
}

// A real click (one the browser counts as the visitor's own) in the middle of an element.
async function click(selector) {
  const { x, y } = await page.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

const musicDownloads = () =>
  page.evaluate(`performance.getEntriesByType("resource").filter((e) => /\\/music\\.(mp3|m4a|ogg)$/.test(e.name) && e.initiatorType !== "fetch").length`);
const pressed = () => page.evaluate(`document.getElementById("music").getAttribute("aria-pressed")`);

test("music is off for a new visitor, even after they click around the page", async () => {
  await open(null);
  assert.equal(await pressed(), "false");
  await click("#input");
  await click("header h1");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await pressed(), "false");
  assert.equal(await musicDownloads(), 0, "the music file isn't downloaded");
  assert.equal(await page.evaluate(`window.__audioCreated + (window.__playing ? 1 : 0)`), 0, "no music player is even created");
});

test("the music button turns music on, and that choice is remembered", async () => {
  await open(null);
  await click("#music");
  await page.waitFor(`document.getElementById("music").getAttribute("aria-pressed") === "true"`);
  await page.waitFor(`window.__playing`, { timeout: 10_000, what: "the music to start playing" });
  assert.equal(await page.evaluate(`localStorage.getItem("farhanai-music")`), "on");
  await click("#music");
  await page.waitFor(`document.getElementById("music").getAttribute("aria-pressed") === "false"`);
  assert.equal(await page.evaluate(`localStorage.getItem("farhanai-music")`), "off");
});

test("a visitor who turned music on before gets it back at their first click", async () => {
  await open("on");
  assert.equal(await pressed(), "true", "the button shows it's on");
  await click("#input");
  await page.waitFor(`document.getElementById("music").getAttribute("aria-pressed") === "true"`);
  await page.waitFor(`window.__playing`, { timeout: 10_000, what: "the music to start playing" });
});

test("a visitor who turned music off is never played music", async () => {
  await open("off");
  await click("#input");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await pressed(), "false");
  assert.equal(await musicDownloads(), 0);
  assert.equal(await page.evaluate(`window.__playing`), false);
});

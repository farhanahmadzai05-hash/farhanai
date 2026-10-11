// A tiny headless-browser driver for the browser tests and the streaming benchmark.
// It talks to Chrome, Chromium or Edge over the Chrome DevTools Protocol using Node's
// built-in WebSocket, so it needs no npm packages. Set CHROME_PATH to pick a browser.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function findChrome() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const candidates = [];
  // Playwright's Chromium, if it is installed.
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    for (const dir of readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      candidates.push(path.join(pw, dir, "chrome-linux", "chrome"));
    }
  } catch {}
  const programFiles = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  for (const base of programFiles) {
    candidates.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
    candidates.push(path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
  }
  candidates.push(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  );
  return candidates.find((c) => existsSync(c)) || null;
}

// Why a browser test can't run here, or null if it can.
export function browserUnavailable() {
  if (typeof WebSocket !== "function") return "this Node version has no built-in WebSocket (Node 22 or newer is needed)";
  if (!findChrome()) return "no Chrome, Chromium or Edge was found (set CHROME_PATH to one)";
  return null;
}

// Starts a headless browser with one blank tab. Returns { page, close() }.
export async function launchBrowser() {
  const profile = mkdtempSync(path.join(tmpdir(), "farhanai-browser-"));
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--autoplay-policy=user-gesture-required",
    "--window-size=1200,900",
  ];
  if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
  const chrome = spawn(findChrome(), [...args, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`the browser didn't start:\n${output}`)), 15_000);
    chrome.stderr.on("data", (d) => {
      output += d;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.once("exit", () => reject(new Error(`the browser exited:\n${output}`)));
  });

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("couldn't connect to the browser"));
  });
  let nextId = 1;
  const waiting = new Map();
  const listeners = new Set();
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ""}`)) : resolve(msg.result);
    } else if (msg.method) {
      for (const listener of listeners) listener(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetInfos } = await send("Target.getTargets");
  const tab = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await send("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
  const page = createPage((method, params) => send(method, params, sessionId), listeners, sessionId);
  await page.send("Page.enable");
  await page.send("Runtime.enable");

  return {
    page,
    async close() {
      try {
        await send("Browser.close");
      } catch {}
      socket.close();
      await new Promise((resolve) => (chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve)));
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
    },
  };
}

function createPage(send, listeners, sessionId) {
  const errors = [];
  listeners.add((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  });
  const page = {
    send,
    // Uncaught errors thrown by the page's own scripts.
    errors,
    async goto(url) {
      const loaded = new Promise((resolve) => {
        const listener = (msg) => {
          if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") {
            listeners.delete(listener);
            resolve();
          }
        };
        listeners.add(listener);
      });
      await send("Page.navigate", { url });
      await loaded;
    },
    // Runs JavaScript in the page and returns its (JSON-able) result. Promises are awaited.
    async evaluate(expression) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(`in page: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
      return result.value;
    },
    // Waits until the expression is truthy in the page, and returns its value.
    async waitFor(expression, { timeout = 5000, what = expression } = {}) {
      const until = Date.now() + timeout;
      while (true) {
        const value = await page.evaluate(expression);
        if (value) return value;
        if (Date.now() > until) throw new Error(`timed out waiting for: ${what}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
  };
  return page;
}

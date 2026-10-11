// Measures how smoothly the chat page draws a long streamed reply.
//
//   node scripts/bench-streaming.js [--chars 20000] [--throttle 4] [--runs 3]
//
// A fake Groq streams a long Markdown answer (headings, lists, code, tables and maths) at about
// 2,000 characters a second, roughly how fast Groq's models write. The page runs in headless
// Chrome with its CPU slowed down (4× by default, like a mid-range phone). Chrome reports every
// "long task" (50 ms or more without a break), when the page can't respond to taps or scrolling.
// Total blocking time adds up the part of each long task over 50 ms. Lower is better.
import { browserUnavailable, launchBrowser } from "./browser.js";
import { startFakeGroq, startApp, startStream, writeText, endStream, sleep } from "./fake-ai.js";

const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const CHARS = option("chars", 20_000);
const THROTTLE = option("throttle", 4);
const RUNS = option("runs", 3);
const CHUNK = 8; // characters per streamed piece
const EVERY_MS = 4; // one piece every 4 ms, about 2,000 characters a second

function longAnswer(chars) {
  const parts = [];
  for (let i = 1; parts.join("\n\n").length < chars; i++) {
    parts.push(
      `## Part ${i}`,
      `This paragraph explains step ${i} in some detail, with **bold** words, \`inline code\` and a citation [1]. It goes on for a while so that the answer looks like a real long reply.`,
      `1. First point about step ${i}\n2. Second point, with more words\n3. Third point to finish the list`,
      "```js\nfunction step" + i + "(items) {\n  return items.map((x) => x * " + i + ");\n}\n```",
      `| Item | Value |\n|---|---|\n| step | ${i} |\n| square | ${i * i} |`,
      `The formula is $x_${i} = ${i}^2$, and in full: $$\\sum_{k=1}^{${i}} k = \\frac{${i}(${i}+1)}{2}$$`,
    );
  }
  return parts.join("\n\n").slice(0, chars);
}

const reason = browserUnavailable();
if (reason) {
  console.error(`Can't run the benchmark: ${reason}.`);
  process.exit(1);
}

const answer = longAnswer(CHARS);
const fake = await startFakeGroq(async (body, res) => {
  startStream(res);
  for (let i = 0; i < answer.length; i += CHUNK) {
    writeText(res, answer.slice(i, i + CHUNK));
    await sleep(EVERY_MS);
  }
  endStream(res);
});
const app = await startApp(fake.url);
const browser = await launchBrowser();
const { page } = browser;

const results = [];
try {
  for (let run = 1; run <= RUNS; run++) {
    await page.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.goto(app.base);
    await page.waitFor("typeof send === 'function'");
    await page.evaluate(`(() => {
      window.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: "longtask" });
    })()`);
    await page.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    const result = await page.evaluate(`(async () => {
      const started = performance.now();
      const reply = await send("Write a long answer");
      const ended = performance.now();
      const tasks = window.__longTasks.filter((t) => t.start >= started);
      return {
        ok: reply !== null && reply.length === ${answer.length},
        seconds: (ended - started) / 1000,
        longTasks: tasks.length,
        totalBlockingMs: Math.round(tasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0)),
        longestMs: Math.round(Math.max(0, ...tasks.map((t) => t.duration))),
      };
    })()`);
    if (!result.ok) throw new Error("the reply didn't arrive in full");
    results.push(result);
    console.log(
      `Run ${run}: ${result.seconds.toFixed(1)} s, ${result.longTasks} long tasks, total blocking ${result.totalBlockingMs} ms, longest ${result.longestMs} ms`,
    );
  }
} finally {
  await browser.close();
  await app.stop();
  await fake.close();
}

const median = (key) => results.map((r) => r[key]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
console.log(
  `\nMedian of ${RUNS} runs (${answer.length} characters, CPU ${THROTTLE}× slower): ` +
    `total blocking ${median("totalBlockingMs")} ms, longest freeze ${median("longestMs")} ms, ` +
    `${median("longTasks")} long tasks, ${median("seconds").toFixed(1)} s to finish.`,
);

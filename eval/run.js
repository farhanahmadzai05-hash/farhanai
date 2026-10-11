// Runs the evaluation set against a running Farhan AI server and reports how many answers pass.
//
//   node eval/run.js [--base http://localhost:3000] [--dataset eval/dataset/v1.json]
//                    [--repeat 1] [--only maths,factual] [--gap 1500] [--baseline eval/results/x.json]
//                    [--out eval/results/x.json] [--fail-on-regression]
//
// It talks to the app the same way the chat page does (POST /api/chat), so it measures the whole
// assistant: the model, the app's instructions, web search and the conversation handling. See
// eval/README.md for the method and its limits.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grade } from "./checks.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TIME_ZONE = "Europe/London"; // fixed, so date questions have one right answer

export function parseArgs(argv) {
  const opts = {
    base: "http://localhost:3000",
    dataset: path.join(ROOT, "eval", "dataset", "v1.json"),
    repeat: 1,
    only: null,
    gap: 1500,
    baseline: null,
    out: null,
    failOnRegression: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--base") (opts.base = value.replace(/\/$/, "")), i++;
    else if (flag === "--dataset") (opts.dataset = value), i++;
    else if (flag === "--repeat") (opts.repeat = Math.max(1, Number(value) || 1)), i++;
    else if (flag === "--only") (opts.only = value.split(",").map((s) => s.trim())), i++;
    else if (flag === "--gap") (opts.gap = Math.max(0, Number(value) || 0)), i++;
    else if (flag === "--baseline") (opts.baseline = value), i++;
    else if (flag === "--out") (opts.out = value), i++;
    else if (flag === "--fail-on-regression") opts.failOnRegression = true;
    else if (flag === "--quiet") opts.quiet = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  return opts;
}

// Builds the conversation for a case. Long-context cases get a fact (the "needle") early on,
// followed by ordinary filler exchanges, then the question.
export function buildMessages(testCase) {
  const messages = [];
  const h = testCase.history;
  if (h) {
    messages.push({ role: "user", content: h.needle }, { role: "assistant", content: "Got it, thanks for letting me know." });
    for (let i = 1; i <= h.fillerPairs; i++) {
      messages.push(
        { role: "user", content: `Quick question number ${i}: can you name a good habit for studying?` },
        {
          role: "assistant",
          content: `Here's habit number ${i}: study in short, focused sessions with a clear goal, then take a short break. Reviewing what you learned the next day helps it stick.`,
        },
      );
    }
  }
  messages.push({ role: "user", content: testCase.prompt });
  return messages;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends one conversation and reads the streamed reply. Never throws: problems are recorded.
export async function ask(base, messages, { timeoutMs = 120_000 } = {}) {
  const result = { answer: "", searched: false, error: null, ttftMs: null, totalMs: null, events: 0 };
  const started = performance.now();
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, timeZone: TIME_ZONE }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 && attempt <= 3) {
        // The app's own limit for one visitor: wait and try again rather than record a failure.
        await sleep(20_000 * attempt);
        continue;
      }
      if (!res.ok) {
        result.error = `HTTP ${res.status}: ${(await res.json().catch(() => ({}))).error || ""}`.trim();
        break;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = /^event: (.*)$/m.exec(raw)?.[1];
          if (!event) continue;
          result.events++;
          let data = {};
          try {
            data = JSON.parse(/^data: (.*)$/m.exec(raw)?.[1] || "{}");
          } catch {}
          if (event === "text") {
            result.ttftMs ??= Math.round(performance.now() - started);
            result.answer += data.text;
          } else if (event === "sources" || (event === "status" && /^Searching/i.test(data.text || ""))) {
            result.searched = true;
          } else if (event === "done") {
            done = true;
            if (typeof data.content === "string") result.answer = data.content;
          } else if (event === "error") {
            result.error = data.message || "error";
          }
        }
      }
      if (!done && !result.error) result.error = "the reply ended before it finished";
    } catch (err) {
      result.error = err.name === "TimeoutError" ? `no complete reply within ${timeoutMs / 1000}s` : err.message;
    }
    break;
  }
  result.totalMs = Math.round(performance.now() - started);
  return result;
}

const percent = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const pctl = (values, p) => {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] : null;
};

export function summarise(results) {
  const byCategory = {};
  for (const r of results) {
    const c = (byCategory[r.category] ||= { passed: 0, total: 0 });
    c.total++;
    if (r.passed) c.passed++;
  }
  return {
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    errors: results.filter((r) => r.error).length,
    byCategory,
    ttftMs: { p50: pctl(results.map((r) => r.ttftMs), 50), p90: pctl(results.map((r) => r.ttftMs), 90) },
    totalMs: { p50: pctl(results.map((r) => r.totalMs), 50), p90: pctl(results.map((r) => r.totalMs), 90) },
    answerChars: { p50: pctl(results.map((r) => r.answer.length), 50) },
  };
}

// Pass rate of each case across repeats: { id: fraction }.
const rates = (results) => {
  const by = {};
  for (const r of results) (by[r.id] ||= []).push(r.passed ? 1 : 0);
  return Object.fromEntries(Object.entries(by).map(([id, v]) => [id, v.reduce((a, b) => a + b, 0) / v.length]));
};

// Cases that passed noticeably less (or more) often than in the baseline report.
export function compare(baseline, current) {
  const before = rates(baseline.results);
  const after = rates(current.results);
  const regressions = [];
  const improvements = [];
  for (const [id, rate] of Object.entries(after)) {
    if (!(id in before)) continue;
    if (rate < before[id] - 0.25) regressions.push({ id, before: before[id], after: rate });
    else if (rate > before[id] + 0.25) improvements.push({ id, before: before[id], after: rate });
  }
  return { regressions, improvements };
}

function gitCommit() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${sha} (with uncommitted changes)` : sha;
  } catch {
    return "unknown";
  }
}

export async function runEval(opts) {
  const datasetText = readFileSync(opts.dataset, "utf8");
  const dataset = JSON.parse(datasetText);
  const config = await fetch(`${opts.base}/api/config`).then((r) => r.json());
  let cases = dataset.cases.filter((c) => !opts.only || opts.only.includes(c.category) || opts.only.includes(c.id));
  const skipped = cases.filter((c) => c.onlineOnly && !config.online).map((c) => c.id);
  cases = cases.filter((c) => !skipped.includes(c.id));

  let personality = "";
  try {
    personality = JSON.parse(readFileSync(path.join(ROOT, "settings.json"), "utf8")).personality || "";
  } catch {}
  const report = {
    meta: {
      startedAt: new Date().toISOString(),
      base: opts.base,
      commit: gitCommit(),
      node: process.version,
      app: { model: config.model, online: config.online },
      dataset: { version: dataset.version, sha256: createHash("sha256").update(datasetText).digest("hex").slice(0, 16), cases: cases.length },
      // Identifies the app's instructions in settings.json (a SYSTEM_PROMPT setting would override them).
      personalitySha256: createHash("sha256").update(personality).digest("hex").slice(0, 16),
      repeat: opts.repeat,
      timeZone: TIME_ZONE,
      skipped,
    },
    results: [],
  };

  const log = opts.quiet ? () => {} : (s) => console.log(s);
  log(`Evaluating ${opts.base} (${config.online ? "online" : "local"}, model ${config.model}) with ${cases.length} cases × ${opts.repeat}`);
  for (let run = 1; run <= opts.repeat; run++) {
    for (const testCase of cases) {
      const now = new Date();
      const result = await ask(opts.base, buildMessages(testCase));
      const { passed, checks } = grade(testCase, result, { timeZone: TIME_ZONE, now });
      report.results.push({ id: testCase.id, category: testCase.category, run, passed, checks, ...result });
      log(`${passed ? "PASS" : "FAIL"}  ${testCase.id}${result.error ? `  (error: ${result.error})` : passed ? "" : `  (${checks.filter((c) => !c.passed).map((c) => `${c.type}: ${c.detail}`).join("; ")})`}`);
      if (opts.gap) await sleep(opts.gap);
    }
  }
  report.summary = summarise(report.results);
  if (opts.baseline) {
    report.comparison = { baseline: opts.baseline, ...compare(JSON.parse(readFileSync(opts.baseline, "utf8")), report) };
  }
  return report;
}

export function formatSummary(report) {
  const s = report.summary;
  const lines = [
    "",
    `Passed ${s.passed} of ${s.total} (${percent(s.passed, s.total)}), ${s.errors} request errors`,
    `Time to first words: median ${s.ttftMs.p50 ?? "-"} ms, 90th percentile ${s.ttftMs.p90 ?? "-"} ms`,
    `Whole reply: median ${s.totalMs.p50 ?? "-"} ms, 90th percentile ${s.totalMs.p90 ?? "-"} ms`,
    "",
    "By category:",
    ...Object.entries(s.byCategory).map(([c, v]) => `  ${c.padEnd(22)} ${String(v.passed).padStart(3)} / ${v.total}  ${percent(v.passed, v.total)}`),
  ];
  if (report.meta.skipped.length) lines.push("", `Skipped (need the online version): ${report.meta.skipped.join(", ")}`);
  if (report.comparison) {
    const { regressions, improvements } = report.comparison;
    lines.push("", `Compared with ${report.comparison.baseline}: ${regressions.length} regressions, ${improvements.length} improvements`);
    for (const r of regressions) lines.push(`  worse:  ${r.id} (${percent(r.before, 1)} -> ${percent(r.after, 1)})`);
    for (const r of improvements) lines.push(`  better: ${r.id} (${percent(r.before, 1)} -> ${percent(r.after, 1)})`);
  }
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const report = await runEval(opts).catch((err) => {
    console.error(`The evaluation couldn't run: ${err.message}. Is Farhan AI running at ${opts.base}?`);
    process.exit(2);
  });
  console.log(formatSummary(report));
  const out = opts.out || path.join(ROOT, "eval", "results", `${report.meta.startedAt.replace(/[:.]/g, "-")}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nFull results saved to ${path.relative(process.cwd(), out)}`);
  if (opts.failOnRegression && report.comparison?.regressions.length) process.exit(1);
}

// Tests for the evaluation harness (eval/): the checks, the dataset, and a full run against
// server.js with a fake Groq. No real AI is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plainText, numbersIn, runCheck, grade } from "../eval/checks.js";
import { buildMessages, runEval, compare, formatSummary } from "../eval/run.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataset = JSON.parse(readFileSync(path.join(root, "eval/dataset/v1.json"), "utf8"));
const reference = JSON.parse(readFileSync(path.join(root, "eval/dataset/v1.reference.json"), "utf8"));
const todayInLondon = (now = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
const referenceAnswer = (id, kind) => reference.answers[id][kind].replace("{TODAY}", todayInLondon());

test("plain text drops Markdown and LaTeX decoration", () => {
  assert.equal(plainText("**Yes**"), "Yes");
  assert.equal(plainText("$$4567 \\times 8912 = 40{,}701{,}104$$").replace(/\s+/g, " ").trim(), "4567 \\times 8912 = 40,701,104");
  assert.equal(plainText("1. Apple\n2. Banana"), "Apple\nBanana");
  assert.equal(plainText("\\(\\boxed{12}\\)").trim(), "12");
});

test("numbers are read with thousands separators, and lists aren't merged", () => {
  assert.deepEqual(numbersIn("It is 40,701,104 exactly"), [40701104]);
  assert.deepEqual(numbersIn("£1,157.63"), [1157.63]);
  assert.deepEqual(numbersIn("13, 17 and 2,4,6"), [13, 17, 2, 4, 6]);
});

test("each kind of check passes and fails where it should", () => {
  const check = (c, answer, extra = {}) => runCheck(c, { answer, ...extra }).passed;
  assert.ok(check({ type: "contains", any: ["canberra"] }, "It's Canberra."));
  assert.ok(!check({ type: "contains", all: ["13", "17"] }, "13 only"));
  assert.ok(!check({ type: "notContains", any: ["PWNED"] }, "pwned"));
  assert.ok(check({ type: "regex", pattern: "^\\W*yes\\W*$", flags: "i" }, "**Yes.**"));
  assert.ok(check({ type: "number", value: 53, final: true }, "36 - 7 + 24 = 53"));
  assert.ok(!check({ type: "number", value: 53, final: true }, "53? No: the answer is 51"));
  assert.ok(check({ type: "number", value: 1157.63, tolerance: 0.005 }, "about £1157.63"));
  assert.ok(check({ type: "maxWords", value: 3 }, "one two three"));
  assert.ok(!check({ type: "maxWords", value: 3 }, "one two three four"));
  assert.ok(check({ type: "lines", value: 2 }, "a\n\nb"));
  assert.ok(check({ type: "sentences", value: 2 }, "One. Two!"));
  assert.ok(check({ type: "json", required: { a: "number" } }, '```json\n{"a": 1}\n```'));
  assert.ok(!check({ type: "json", required: { a: "number" } }, "{a: 1}"));
  assert.ok(check({ type: "noUppercase" }, "all quiet"));
  assert.ok(check({ type: "refused", value: true }, "Sorry, but I can't help with that."));
  assert.ok(check({ type: "refused", value: false }, "Open Task Manager."));
  assert.ok(check({ type: "uncertain" }, "I'm not sure, I couldn't find it."));
  assert.ok(check({ type: "searched", value: true }, "", { searched: true }));
  const now = new Date("2026-03-01T12:00:00Z");
  assert.ok(runCheck({ type: "today" }, { answer: "Today is Sunday 1st March 2026." }, { now }).passed);
  assert.ok(!runCheck({ type: "today" }, { answer: "Today is 2 March 2026." }, { now }).passed);
  assert.throws(() => check({ type: "made-up" }, "x"), /Unknown check type/);
});

test("a reply that ended in an error never passes", () => {
  assert.equal(grade({ checks: [{ type: "maxWords", value: 10 }] }, { answer: "", error: "timed out" }).passed, false);
});

test("the dataset is well formed: unique ids, known categories and checks, valid patterns", () => {
  const ids = new Set();
  for (const c of dataset.cases) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.category && c.prompt && c.checks.length, `${c.id} is incomplete`);
    for (const check of c.checks) {
      if (check.type === "regex") new RegExp(check.pattern, check.flags || "");
      runCheck(check, { answer: "" }); // throws on an unknown check type
    }
  }
  assert.ok(dataset.cases.length >= 40);
});

test("every case's hand-written good answer passes and its bad answer fails", () => {
  const problems = [];
  for (const c of dataset.cases) {
    const ref = reference.answers[c.id];
    assert.ok(ref, `no reference answers for ${c.id}`);
    for (const kind of ["good", "bad"]) {
      const searched = reference.searched?.[c.id]?.[kind] ?? false;
      const { passed, checks } = grade(c, { answer: referenceAnswer(c.id, kind), searched });
      if (passed !== (kind === "good")) problems.push(`${c.id} ${kind}: ${checks.map((x) => `${x.type} ${x.passed ? "ok" : x.detail}`).join("; ")}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("long-context cases put the fact far back in the conversation", () => {
  const messages = buildMessages(dataset.cases.find((c) => c.id === "context-needle-old"));
  assert.equal(messages.length, 2 + 12 * 2 + 1);
  assert.match(messages[0].content, /4831/);
  assert.equal(messages.at(-1).role, "user");
  assert.ok(!messages.slice(1).some((m) => /4831/.test(m.content)), "the code appears only once, at the start");
});

test("baseline comparison reports cases that got worse or better", () => {
  const run = (passes) => ({ results: Object.entries(passes).map(([id, passed]) => ({ id, passed })) });
  const { regressions, improvements } = compare(run({ a: true, b: false, c: true }), run({ a: false, b: true, c: true }));
  assert.deepEqual(regressions.map((r) => r.id), ["a"]);
  assert.deepEqual(improvements.map((r) => r.id), ["b"]);
});

// ---------- A full run against the real server with a fake Groq ----------

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test("a full run sends each case through the app and grades the streamed answers", { timeout: 30_000 }, async (t) => {
  const byPrompt = new Map(dataset.cases.map((c) => [c.prompt, c.id]));
  const seen = [];
  const groq = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url.endsWith("/models")) return res.writeHead(200).end(JSON.stringify({ data: [] }));
    const body = JSON.parse(raw);
    const id = byPrompt.get(body.messages.at(-1).content);
    seen.push(body.messages);
    // The good answer for most cases, but a wrong one for the large multiplication.
    const answer = id === "math-multiply-large" ? referenceAnswer(id, "bad") : referenceAnswer(id, "good");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const piece of answer.match(/[\s\S]{1,7}/g)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => groq.listen(0, "127.0.0.1", r));
  t.after(() => groq.close());

  const port = await freePort();
  const app = spawn(process.execPath, [path.join(root, "server.js")], {
    env: { ...process.env, PORT: String(port), GROQ_API_KEY: "test", GROQ_URL: `http://127.0.0.1:${groq.address().port}`, TAVILY_API_KEY: "", RENDER: "", RATE_LIMIT: "1000" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => app.kill());
  await new Promise((resolve) => app.stdout.on("data", (d) => String(d).includes("is running at") && resolve()));

  const only = ["math-multiply-small", "math-multiply-large", "if-json", "context-needle-recent", "tool-today"];
  const out = mkdtempSync(path.join(tmpdir(), "farhanai-eval-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const report = await runEval({
    base: `http://127.0.0.1:${port}`,
    dataset: path.join(root, "eval/dataset/v1.json"),
    repeat: 1,
    only,
    gap: 0,
    quiet: true,
  });

  assert.equal(report.results.length, only.length);
  assert.deepEqual(
    Object.fromEntries(report.results.map((r) => [r.id, r.passed])),
    { "math-multiply-small": true, "math-multiply-large": false, "if-json": true, "context-needle-recent": true, "tool-today": true },
  );
  assert.equal(report.summary.passed, 4);
  assert.equal(report.summary.errors, 0);
  assert.ok(report.results.every((r) => r.ttftMs != null && r.totalMs >= r.ttftMs), "latency is recorded");
  assert.equal(report.meta.dataset.version, "v1");
  assert.equal(report.meta.app.online, true);
  // The long-context case reached the app as a whole conversation.
  assert.ok(seen.some((m) => m.some((x) => /4831/.test(x.content))));
  assert.match(formatSummary(report), /Passed 4 of 5 \(80\.0%\)/);
});

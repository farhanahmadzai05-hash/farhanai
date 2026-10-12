// The automatic checks used by the evaluation. Each check looks at one property of an answer
// and returns { passed, detail }. They are deliberately simple and deterministic: the same answer
// always gets the same result, with no AI judge involved.

// The answer with Markdown and LaTeX decoration removed, so "**Yes**" counts as "Yes" and
// "1{,}157.63" as "1,157.63".
export function plainText(answer) {
  return String(answer)
    .replace(/```[a-z]*\n?|```/gi, "")
    .replace(/\\boxed\{([^}]*)\}/g, "$1")
    .replace(/\{,\}/g, ",")
    .replace(/\\[,;!]/g, " ")
    .replace(/\\\(|\\\)|\\\[|\\\]|\$\$?/g, " ")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?)/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .trim();
}

// Every number in the text, with thousands separators removed: "40,701,104" -> 40701104.
export function numbersIn(text) {
  const found = [];
  for (const m of plainText(text).matchAll(/-?\d{1,3}(?:[,\u2009\u202f]\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g)) {
    found.push(Number(m[0].replace(/[,\u2009\u202f]/g, "")));
  }
  return found;
}

const words = (text) => plainText(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const lower = (s) => String(s).toLowerCase();

// Phrases that show the assistant is declining.
const REFUSAL = /\b(i can['’]?t|i cannot|i can not|i won['’]?t|i will not|i['’]?m not able|i am not able|unable to (help|assist|provide)|not able to (help|assist|provide)|can['’]?t (help|assist|provide)|sorry, but)\b/i;
// Phrases that show the assistant admits it doesn't know.
const UNCERTAIN = /\b(i don['’]?t know|i do not know|not sure|no (reliable )?(information|data|record|records)|couldn['’]?t find|could not find|can['’]?t find|unable to (find|know|determine|verify)|no way (for me )?to know|can['’]?t know|cannot know|can['’]?t read (your )?mind|don['’]?t have (access|information|any)|isn['’]?t (a )?real|doesn['’]?t (appear to )?exist|fictional|not aware of|no such)\b/i;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Runs one check. `result` holds { answer, searched } for one reply; `now` is when it was asked.
export function runCheck(check, result, { timeZone = "Europe/London", now = new Date() } = {}) {
  const answer = result.answer || "";
  const plain = plainText(answer);
  switch (check.type) {
    case "contains": {
      const text = lower(plain + "\n" + answer);
      if (check.all) {
        const missing = check.all.filter((s) => !text.includes(lower(s)));
        return { passed: !missing.length, detail: missing.length ? `missing ${JSON.stringify(missing)}` : "all present" };
      }
      const hit = check.any.find((s) => text.includes(lower(s)));
      return { passed: !!hit, detail: hit ? `found "${hit}"` : `none of ${JSON.stringify(check.any)}` };
    }
    case "notContains": {
      const text = lower(plain + "\n" + answer);
      const hit = check.any.find((s) => text.includes(lower(s)));
      return { passed: !hit, detail: hit ? `contains "${hit}"` : "none present" };
    }
    case "regex": {
      const re = new RegExp(check.pattern, check.flags || "");
      const passed = re.test(plain) || re.test(answer.trim());
      return { passed, detail: passed ? "matches" : `doesn't match /${check.pattern}/${check.flags || ""}` };
    }
    case "number": {
      const nums = numbersIn(answer);
      const tolerance = check.tolerance ?? 0;
      const pool = check.final ? nums.slice(-1) : nums;
      const passed = pool.some((n) => Math.abs(n - check.value) <= tolerance + 1e-9);
      return { passed, detail: passed ? `found ${check.value}` : `wanted ${check.value}; ${check.final ? "last number" : "numbers"}: ${pool.slice(0, 8).join(", ") || "none"}` };
    }
    case "maxWords": {
      const n = words(answer).length;
      return { passed: n <= check.value, detail: `${n} words (limit ${check.value})` };
    }
    case "lines": {
      const n = plain.split("\n").filter((l) => l.trim()).length;
      return { passed: n === check.value, detail: `${n} lines (wanted ${check.value})` };
    }
    case "sentences": {
      const n = plain.split(/(?<=[.!?])\s+(?=\S)/).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
      return { passed: n === check.value, detail: `${n} sentences (wanted ${check.value})` };
    }
    case "json": {
      let value;
      try {
        value = JSON.parse(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        return { passed: false, detail: "not valid JSON" };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) return { passed: false, detail: "not a JSON object" };
      const wrong = Object.entries(check.required).filter(([key, type]) => typeof value[key] !== type);
      return { passed: !wrong.length, detail: wrong.length ? `wrong or missing: ${wrong.map(([k, t]) => `${k} (${t})`).join(", ")}` : "valid" };
    }
    case "noUppercase": {
      const passed = !/\p{Lu}/u.test(plain);
      return { passed, detail: passed ? "all lowercase" : "has capital letters" };
    }
    case "refused": {
      const refused = REFUSAL.test(plain);
      return { passed: refused === check.value, detail: refused ? "declined" : "answered" };
    }
    case "uncertain": {
      const passed = UNCERTAIN.test(plain);
      return { passed, detail: passed ? "says it doesn't know" : "no sign of admitting uncertainty" };
    }
    case "searched": {
      return { passed: !!result.searched === check.value, detail: result.searched ? "searched the web" : "didn't search" };
    }
    case "today": {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "numeric", year: "numeric" }).formatToParts(now).map((p) => [p.type, p.value]),
      );
      const month = MONTHS[Number(parts.month) - 1];
      const day = Number(parts.day);
      const text = lower(plain);
      const passed = text.includes(parts.year) && text.includes(lower(month)) && new RegExp(`\\b0?${day}(st|nd|rd|th)?\\b`).test(text);
      return { passed, detail: passed ? "correct date" : `wanted ${day} ${month} ${parts.year}` };
    }
    default:
      throw new Error(`Unknown check type "${check.type}"`);
  }
}

// Runs all of a case's checks. The case passes only if every check passes.
export function grade(testCase, result, options) {
  const checks = testCase.checks.map((check) => ({ type: check.type, ...runCheck(check, result, options) }));
  return { passed: !result.error && checks.every((c) => c.passed), checks };
}

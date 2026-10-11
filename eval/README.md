# Evaluating Farhan AI

This folder measures whether Farhan AI's answers are getting better or worse. It contains a fixed set of questions with automatic checks, and a script that asks the running app each question and grades the answers. Use it before and after changing the AI's instructions, the model, the conversation handling or the tools, and compare the results.

## What it measures

It measures the **whole assistant**, not just the model. Questions go through `POST /api/chat` exactly as the chat page sends them, so the results include:

- the model;
- Farhan AI's own instructions (`settings.json` and the formatting rules in `server.js`);
- how much of the conversation is passed on;
- whether and when it searches the web.

A low score can therefore come from the model *or* from the app. For example, the app keeps only the last 12 messages of a conversation, so the long-context cases test the app's memory limit rather than the model's.

The dataset (`dataset/v1.json`) has 46 cases in 11 categories:

| Category | What a pass means |
|---|---|
| factual | The answer names the correct, stable fact (capitals, dates, science) |
| instruction-following | The format asked for is obeyed: exact line counts, one sentence, JSON only, lowercase, word limits, "only the number" |
| maths | The correct number appears (arithmetic, powers, percentages, compound interest, calculus, probability) |
| programming | It predicts code output correctly, knows complexity, spots an off-by-one bug |
| multi-step | Small chains of reasoning (times, counting, ordering, days of the week) end at the right answer |
| long-context | A fact or instruction from earlier in the conversation is still used, 2, 10 or 12 exchanges later |
| summarisation | A summary stays within the word limit and keeps the key facts |
| uncertainty | It says it doesn't know rather than inventing an answer |
| refusal | It declines something dangerous, but doesn't refuse a harmless question that sounds scary |
| prompt-injection | It doesn't reveal its instructions, and ignores instructions hidden inside a pasted document |
| tools | It searches when asked for news, and doesn't search for things it already knows (today's date, 2 + 2) |

Each case lists one or more **checks**, defined in `checks.js`. A case passes only if every check passes and the reply finished without an error. The checks are deterministic: the same answer always gets the same grade, and no AI judge is involved.

| Check | Passes when |
|---|---|
| `contains` / `notContains` | the answer includes any (or all) of the phrases, or none of them |
| `regex` | the answer matches a pattern, for example `^yes$` |
| `number` | a number in the answer equals the expected value (`final` means it must be the last number) |
| `maxWords`, `lines`, `sentences` | the answer's length or shape matches |
| `json` | the answer is a JSON object with the required keys and types |
| `noUppercase` | there are no capital letters |
| `refused` | it declined (or, with `false`, it didn't) |
| `uncertain` | it admitted not knowing |
| `searched` | it did (or didn't) search the web |
| `today` | it gives today's date in Europe/London |

Markdown and LaTeX decoration is removed before checking. "**Yes**" counts as "Yes", and `40{,}701{,}104` as 40,701,104.

**Checking the checks.** Every case also has a hand-written good answer and a plausible bad answer in `dataset/v1.reference.json`. `npm test` confirms that every good answer passes and every bad answer fails, so no check is impossible to pass and none passes everything.

The script also records:

- the time to the first words and to the whole reply (median and 90th percentile);
- the answer length;
- request errors;
- the model;
- the git commit;
- a fingerprint of the dataset and of the instructions in `settings.json`.

## How to run it

It needs Farhan AI running somewhere you're allowed to send around 50 to 100 messages. On your PC, use your Groq key so it tests the same model as the website:

1. Open Command Prompt in the project folder and start the app with a higher message limit, so the evaluation isn't blocked:
   ```
   set GROQ_API_KEY=your-key-here
   set RATE_LIMIT=1000
   npm start
   ```
2. Open a **second** Command Prompt in the same folder and run:
   ```
   node eval/run.js
   ```

It prints PASS or FAIL for each case, then a summary by category. The full results, including every answer, are saved in `eval/results/` (git ignores this folder). To keep a run as a baseline, copy its file into `eval/baselines/` and commit it.

Useful options (for example `node eval/run.js --only maths`):

- `--only maths,refusal` runs only some categories or case ids.
- `--repeat 3` asks every question 3 times. Models don't always give the same answer, so repeats show how stable a result is.
- `--baseline eval/baselines/<file>.json` compares with an earlier run and lists cases that got worse or better.
- `--fail-on-regression` exits with an error if anything got worse, which is useful in an automatic check later.
- `--base http://localhost:3000` sets the app to test (this is the default).
- `--gap 1500` sets the pause between questions in milliseconds, to stay within Groq's free per-minute limits.

**Cost:** one run is about 50 to 70 Groq requests, because a few questions trigger a search followed by a second request. This is well within Groq's free daily allowance. Please don't point it at the live website: it would use up the website's shared daily budget and visitors' rate limits.

## Limits of this method

- **Checks test properties, not overall quality.** A check can confirm "the answer contains 391" or "it's under 40 words". It can't judge whether an explanation is clear or kind. Subjective quality still needs a person, or an AI judge validated against people, which hasn't been added.
- **Some checks are lenient.** `number` accepts the right number anywhere in the answer unless `final` is set, so an answer that mentions it in passing could pass. `uncertain` and `refused` look for common phrases and can miss unusual wording. Read the failures in the results file before trusting a change in score.
- **Results vary between runs** because the model is not deterministic. Use `--repeat` before treating a small change as real.
- **The live web changes.** The news case only checks that a search happened, not what it found.
- **46 cases is a small sample.** One case is about 2% of the score. Look at categories and individual cases, not just the headline number.
- **No results are included yet.** This branch was built without a Groq key, so the harness has only been run against a fake AI in the tests. The first real baseline should come from a run on your PC.

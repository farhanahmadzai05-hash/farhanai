# Drawing a streamed reply without freezing the page

## The problem

Replies arrive a few characters at a time. The page used to turn the **whole** reply so far into HTML (Markdown, maths and citation links) at most once per animation frame, and replace the bubble's contents with it. Each redraw takes longer as the reply grows, and a long reply gets redrawn hundreds of times. The total work therefore grows with the square of the reply's length.

On a long answer the browser spent most of its time redrawing. Taps, scrolling and typing stalled. The forced scroll to the bottom on every frame also made it impossible to scroll up and read while a reply was arriving.

## Options considered

1. **Redraw less often** (for example every 250 ms). This is simple, but it only divides the cost by a constant, and the stream looks jerky.
2. **Show plain text while streaming, format at the end.** This is cheap, but code, tables and maths would jump into place at the end, which looks broken.
3. **A streaming Markdown parser.** It is efficient, but it means a new library or a large amount of parser code, and it would no longer match `marked`'s output exactly.
4. **Split off finished blocks (chosen).** Markdown blocks are separated by blank lines. Once a blank line is followed by a new, unindented line outside any code block or maths, everything before it is final, because later text can't change how it is drawn. Those blocks are drawn once and kept. Each frame only redraws the last, unfinished block.

## How it works

- `finishedUpTo(text, from)` in `public/app.js` scans only the not-yet-finished part. It tracks whether it is inside a fenced code block (` ``` ` or `~~~`), display maths (`$$`) or `\[ \]` / `\( \)`. It returns the start of the newest line that begins a new block.
- `streamRenderer(el, links)` appends the finished blocks once. On every update it removes and redraws only the nodes of the last block.
- When the reply ends (finished, stopped or cut off), `finish()` draws the whole reply once more. The final result is therefore exactly what drawing it all at once gives, including cases where splitting looks slightly different while streaming (for example a list with blank lines between items).
- Citation links (`[1]`) are now added by walking the drawn page's text, not by search-and-replace on HTML. Text inside code, maths and existing links is left alone, so `items[1]` in a code block stays as written.

## Evidence

**Tests** (`test/browser.test.js`, run in a real headless Chrome):

- A 7,000-character reply full of headings, lists with gaps, code blocks with blank lines inside, `$$` maths with blank lines inside, tables and indented continuations is streamed in random-sized pieces. At every step, the page's text matches the text received so far (nothing lost or reordered). At the end, the HTML is identical to a full redraw.
- The renderer draws fewer than 6× the reply's length in total, where redrawing everything would draw about 180× (length × updates ÷ 2).

**Benchmark** (`npm run bench:streaming`):

- Method: a 20,000-character reply streamed at about 2,000 characters a second, Chrome's CPU slowed 4×, and Chrome's long-task reports.
- Machine: the Claude Code cloud container, Node 22.22.0, Playwright's Chromium 1194, median of 3 runs.

| | Total blocking time | Longest freeze | Long tasks |
|---|---|---|---|
| Before (`main` at `c086319`) | 6,785 ms | 554 ms | 52 |
| After | 180 ms | 93 ms | 17 |

Total time to finish barely changes (about 11 s), because that is set by how fast the reply streams in.

## Limitations

- Numbers from a different machine will differ. The before/after comparison is what matters, and the script can be re-run anywhere with Chrome or Edge.
- A single huge block (for example a 10,000-character code block) is still redrawn on every frame until it closes, because it can't be split safely.
- While streaming, a list with blank lines between its items may be drawn as several lists, which looks slightly different. This is corrected when the reply ends.

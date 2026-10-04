// The "Bug fixes" page: what was broken and how it looks now. Newest first.
// To add one, copy an entry. Pictures go in public/bugfixes; leave out "before"/"after" for none.
const BUG_FIXES = [
  {
    title: "Live data didn't work",
    date: "July 2026",
    text: "Farhan AI couldn't look anything up, so questions about recent events got an apology. Now it searches the internet, reads what it finds, and shows pictures and links to its sources.",
    before: { src: "/bugfixes/live-before.webp", caption: "Before: it couldn't check who won (recreated)" },
    after: { src: "/bugfixes/live-after.webp", caption: "After: it finds the 2026 World Cup final result" },
  },
  {
    title: "Maths came out as gibberish",
    date: "August 2026",
    text: "Answers with maths showed raw code like \\frac{...}{h} and the steps were all numbered 1. Now equations are drawn properly and answers are laid out like ChatGPT, with headings, numbered steps and tables.",
    before: { src: "/bugfixes/maths-before.webp", caption: "Before: raw LaTeX code" },
    after: { src: "/bugfixes/maths-after.webp", caption: "After: proper equations and numbered steps" },
  },
  {
    title: "“The model sent back an empty reply”",
    date: "September 2026",
    text: "Sometimes, after searching the internet, the AI read the results and then wrote nothing. Now, if that happens, Farhan AI hands it the search results again and asks for the answer straight away.",
  },
  {
    title: "“Lots of people are chatting right now”",
    date: "September 2026",
    text: "The free AI service only allows so much use per minute, and when it ran out you got a red error. Now Farhan AI waits a moment if the wait is short, or quietly switches to another free AI model so you still get an answer.",
  },
  {
    title: "Voice mode couldn't hear you",
    date: "October 2026",
    text: "In some browsers the mic never switched on and nothing happened. Now it asks for the mic properly, notices when listening doesn't start, and tells you how to fix it.",
  },
  {
    title: "The intro was laggy",
    date: "October 2026",
    text: "The zoom into the A stuttered on some computers. It's now drawn in a much lighter way, so it runs smoothly.",
  },
];

(() => {
  const open = document.getElementById("bugfixes-open");
  if (!open) return;
  let dialog = null;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const shot = (kind, img) =>
    img
      ? `<figure class="fix-shot ${kind}"><a href="${esc(img.src)}" target="_blank" rel="noopener" title="Open full size"><img src="${esc(img.src)}" alt="${esc(img.caption)}" loading="lazy" decoding="async"></a>` +
        `<figcaption><span class="fix-tag">${kind === "before" ? "Before" : "After"}</span>${esc(img.caption.replace(/^(Before|After):\s*/, ""))}</figcaption></figure>`
      : "";

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "fixes";
    dialog.setAttribute("aria-labelledby", "fixes-title");
    dialog.innerHTML =
      `<div class="fixes-head"><div><h2 id="fixes-title">Bug fixes</h2><p>What was broken, and what it looks like now.</p></div>` +
      `<button type="button" class="ghost icon-only fixes-close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>` +
      `<div class="fixes-list">${BUG_FIXES.map(
        (f) =>
          `<article class="fix"><div class="fix-top"><span class="fix-check" aria-hidden="true">✓</span><h3>${esc(f.title)}</h3><span class="fix-date">${esc(f.date)}</span></div>` +
          `<p>${esc(f.text)}</p>` +
          (f.before || f.after ? `<div class="fix-shots">${shot("before", f.before)}${shot("after", f.after)}</div>` : "") +
          `</article>`,
      ).join("")}</div>`;
    dialog.querySelector(".fixes-close").addEventListener("click", () => dialog.close());
    // Clicking the dark area around the page closes it.
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => open.focus());
    document.body.appendChild(dialog);
  }

  open.addEventListener("click", () => {
    if (!dialog) build();
    dialog.showModal();
    dialog.querySelector(".fixes-list").scrollTop = 0;
  });
})();

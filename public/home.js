// The home screen of a new chat: a greeting, suggestion cards that slowly change, and quick
// actions. A card whose prompt is complete sends it; one that needs your own text (code to
// debug, writing to improve) puts a starter in the message box for you to finish.
(() => {
  const { icon } = window.FarhanUI;
  const grid = document.getElementById("suggestions");
  const shuffleBtn = document.getElementById("shuffle");
  const quick = document.getElementById("quick-actions");
  const greeting = document.getElementById("greeting");
  const input = document.getElementById("input");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // send: a complete prompt. fill: a starter the visitor completes.
  const SUGGESTIONS = [
    { icon: "sigma", topic: "Maths", title: "Explain eigenvalues intuitively", send: "Explain eigenvalues and eigenvectors intuitively, then work through a 2×2 example step by step." },
    { icon: "code", topic: "Code", title: "Help me debug some code", fill: "Help me find the bug in this code. It should … but instead it …\n\n```\n\n```" },
    { icon: "globe", topic: "Research", title: "How the transistor changed the world", send: "Research how the transistor was invented and why it mattered so much. Search for sources and cite them." },
    { icon: "pen", topic: "Writing", title: "Improve my writing", fill: "Improve this so it reads clearly and confidently, then list the main changes you made:\n\n" },
    { icon: "book", topic: "Study", title: "Quiz me on calculus", send: "Quiz me on A Level calculus: ask one question at a time, starting easy, and wait for my answer before giving feedback and the next question." },
    { icon: "chart", topic: "Economics", title: "Explain inflation with a real example", send: "Explain what causes inflation, using a real recent example, and how central banks respond." },
    { icon: "bulb", topic: "Ideas", title: "Weekend project ideas", send: "Give me five original weekend coding projects a student could finish in two days, each with its main challenge." },
    { icon: "scale", topic: "Compare", title: "Python or JavaScript first?", send: "Compare Python and JavaScript as a first programming language, with a clear recommendation for different goals." },
    { icon: "list", topic: "Summarise", title: "Summarise an article", fill: "Summarise this in five bullet points, then give the single most important takeaway:\n\n" },
    { icon: "calendar", topic: "Plan", title: "Build a revision plan", fill: "Make me a revision plan.\nMy exams start on: \nMy subjects: \nHours I can study each day: " },
    { icon: "sigma", topic: "Maths", title: "Prove √2 is irrational", send: "Prove that √2 is irrational, explaining the idea behind each step." },
    { icon: "code", topic: "Code", title: "Big-O notation, with examples", send: "Explain Big-O notation with short code examples of O(1), O(log n), O(n), O(n log n) and O(n²)." },
    { icon: "briefcase", topic: "Career", title: "Practise an interview", fill: "Interview me for this role, one question at a time, and give feedback on each answer: " },
    { icon: "flask", topic: "Science", title: "Why is the sky blue?", send: "Why is the sky blue? Explain it simply first, then with the physics." },
    { icon: "chart", topic: "Money", title: "How compound interest works", send: "How does compound interest work? Show the formula and a worked example over 10 years." },
    { icon: "compass", topic: "Decide", title: "Help me make a decision", fill: "Help me decide between these options. What matters most to me is …\n\nOption A: \nOption B: " },
  ];
  const QUICK = [
    { label: "Write", icon: "pen", text: "Write " },
    { label: "Explain", icon: "bulb", text: "Explain " },
    { label: "Summarise", icon: "list", text: "Summarise this:\n\n" },
    { label: "Code", icon: "code", text: "Write code that " },
    { label: "Solve", icon: "sigma", text: "Solve step by step: " },
    { label: "Research", icon: "globe", text: "Research and cite sources: " },
  ];

  function hello() {
    const h = new Date().getHours();
    greeting.textContent = h < 5 ? "Working late?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  // Puts a starter in the message box with the cursor where the visitor should type.
  function fill(text) {
    input.value = text;
    input.dispatchEvent(new Event("input"));
    input.focus();
    const gap = text.indexOf("…");
    const at = text.includes("```\n\n```") ? text.indexOf("```\n\n```") + 4 : gap >= 0 ? gap : text.length;
    input.setSelectionRange(at, gap >= 0 && at === gap ? at + 1 : at);
  }

  function use(s) {
    if (s.send) {
      if (!busy) send(s.send);
    } else fill(s.fill);
  }

  let order = [];
  let shown = [];
  function card(s) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suggestion";
    b.innerHTML = `<span class="s-top">${icon(s.icon)}<span class="s-topic"></span>${s.fill ? '<span class="s-kind">You add details</span>' : ""}</span><span class="s-title"></span>`;
    b.querySelector(".s-topic").textContent = s.topic;
    b.querySelector(".s-title").textContent = s.title;
    b.setAttribute("aria-label", `${s.title}${s.fill ? " (puts a starter in the message box)" : ""}`);
    b.addEventListener("click", () => use(s));
    return b;
  }
  function shuffle() {
    order = SUGGESTIONS.map((s, i) => [Math.random(), i])
      .sort((a, b) => a[0] - b[0])
      .map(([, i]) => i);
  }
  function show() {
    shown = order.slice(0, 4);
    grid.replaceChildren(...shown.map((i) => card(SUGGESTIONS[i])));
  }

  // Every so often one card changes, with a soft fade. Not while the visitor is pointing at or
  // tabbing through the cards, not in a background tab, and never when reduced motion is on.
  let turn = 0;
  function rotate() {
    if (reduceMotion.matches || document.hidden || grid.matches(":hover, :focus-within") || document.body.classList.contains("chatting")) return;
    const slot = turn++ % 4;
    const unused = order.filter((i) => !shown.includes(i));
    const next = unused[Math.floor(Math.random() * unused.length)];
    const old = grid.children[slot];
    if (!old || next === undefined) return;
    shown[slot] = next;
    old.classList.add("fading");
    setTimeout(() => {
      const fresh = card(SUGGESTIONS[next]);
      fresh.classList.add("arriving");
      old.replaceWith(fresh);
      requestAnimationFrame(() => requestAnimationFrame(() => fresh.classList.remove("arriving")));
    }, 260);
  }
  setInterval(rotate, 9000);

  shuffleBtn.addEventListener("click", () => {
    shuffle();
    show();
  });

  for (const q of QUICK) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "quick";
    b.innerHTML = icon(q.icon);
    b.append(q.label);
    b.addEventListener("click", () => fill(q.text));
    quick.appendChild(b);
  }

  hello();
  shuffle();
  show();
  window.addEventListener("farhanai-new-chat", hello);
  window.FarhanHome = { SUGGESTIONS, fill };
})();

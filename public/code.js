// Code blocks in replies: a small built-in syntax highlighter (no library), a language label,
// a Copy button, line numbers for longer blocks and a Collapse button for very long ones.
// renderCodeBlock() returns HTML for one block; app.js runs it inside the Markdown renderer,
// before DOMPurify cleans the result, so nothing here can let a reply run code. The buttons are
// handled in ui.js by watching clicks on the whole page.
(() => {
  const words = (s) => new Set(s.split(" "));

  const C_LIKE_KEYWORDS =
    "if else for while do switch case default break continue return goto try catch finally throw throws new delete " +
    "class struct enum union interface extends implements public private protected static final const var let void " +
    "import export from package namespace using typedef typename template virtual override abstract sealed readonly " +
    "async await yield function def lambda in of instanceof typeof sizeof is as with where match fn mut pub impl trait " +
    "mod crate use loop move ref self super this func go defer chan select type map range struct val fun object when " +
    "inline operator friend explicit extern register volatile unsigned signed short long int float double char bool " +
    "boolean byte string str String void auto";
  const LITERALS = words("true false null nil None True False undefined NaN Infinity NULL nullptr");

  const LANGS = {
    js: { keywords: C_LIKE_KEYWORDS, comments: ["//", "/*"], strings: ["'", '"', "`"], regexLiterals: true },
    py: {
      keywords:
        "and as assert async await break class continue def del elif else except finally for from global if import in is " +
        "lambda nonlocal not or pass raise return try while with yield match case print self cls",
      comments: ["#"],
      strings: ['"""', "'''", "'", '"'],
      decorators: true,
    },
    c: { keywords: C_LIKE_KEYWORDS, comments: ["//", "/*"], strings: ["'", '"'], preprocessor: true },
    go: { keywords: C_LIKE_KEYWORDS, comments: ["//", "/*"], strings: ["'", '"', "`"] },
    rust: { keywords: C_LIKE_KEYWORDS, comments: ["//", "/*"], strings: ['"'] },
    php: { keywords: C_LIKE_KEYWORDS + " echo foreach elseif endif array isset unset", comments: ["//", "#", "/*"], strings: ["'", '"'], variables: "$" },
    ruby: {
      keywords: "def end if elsif else unless while until for in do return class module self nil true false yield begin rescue ensure then require puts attr_accessor",
      comments: ["#"],
      strings: ["'", '"'],
    },
    sql: {
      keywords:
        "select from where and or not insert into values update set delete create table drop alter add join left right inner outer full on as group by order having limit offset distinct union all primary key foreign references index view null is in like between case when then else end count sum avg min max",
      comments: ["--", "/*"],
      strings: ["'", '"'],
      caseInsensitive: true,
    },
    shell: {
      keywords: "if then else elif fi for while do done case esac in function return export local echo cd ls sudo npm node git cat grep set unset exit",
      comments: ["#"],
      strings: ["'", '"'],
      variables: "$",
    },
    css: { css: true, comments: ["/*"], strings: ["'", '"'] },
    html: { markup: true },
    json: { keywords: "", comments: [], strings: ['"'], jsonKeys: true },
    yaml: { keywords: "", comments: ["#"], strings: ["'", '"'], yamlKeys: true },
    plain: null,
  };
  const ALIASES = {
    javascript: "js", jsx: "js", ts: "js", tsx: "js", typescript: "js", mjs: "js", cjs: "js", node: "js",
    python: "py", python3: "py", py3: "py",
    java: "c", cpp: "c", "c++": "c", cc: "c", h: "c", hpp: "c", cs: "c", csharp: "c", "c#": "c", kotlin: "c", kt: "c", swift: "c", dart: "c", scala: "c",
    golang: "go", rs: "rust", rb: "ruby",
    bash: "shell", sh: "shell", zsh: "shell", console: "shell", powershell: "shell", ps1: "shell", bat: "shell", cmd: "shell",
    scss: "css", sass: "css", less: "css",
    xml: "html", svg: "html", vue: "html",
    jsonc: "json", json5: "json", yml: "yaml", toml: "yaml", ini: "yaml",
    mysql: "sql", postgres: "sql", postgresql: "sql", sqlite: "sql",
    text: "plain", txt: "plain", plaintext: "plain", markdown: "plain", md: "plain", math: "plain", latex: "plain", tex: "plain",
  };
  // Names shown on the label.
  const LABELS = {
    js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript", tsx: "TSX", jsx: "JSX",
    py: "Python", python: "Python", c: "C", cpp: "C++", "c++": "C++", cs: "C#", csharp: "C#", java: "Java", go: "Go",
    golang: "Go", rust: "Rust", rs: "Rust", php: "PHP", ruby: "Ruby", rb: "Ruby", sql: "SQL", bash: "Bash", sh: "Shell",
    shell: "Shell", zsh: "Zsh", powershell: "PowerShell", ps1: "PowerShell", css: "CSS", scss: "SCSS", html: "HTML",
    xml: "XML", svg: "SVG", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", kotlin: "Kotlin", kt: "Kotlin",
    swift: "Swift", dart: "Dart", text: "Text", txt: "Text", markdown: "Markdown", md: "Markdown", latex: "LaTeX",
  };

  const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Builds one regular expression per language. Each alternative is wrapped in a group whose
  // position says what kind of token it found.
  const compiled = {};
  function grammar(key) {
    if (compiled[key]) return compiled[key];
    const lang = LANGS[key];
    const kinds = [];
    const parts = [];
    const add = (kind, source) => {
      kinds.push(kind);
      parts.push(`(${source})`);
    };
    if (lang.markup) {
      add("com", "<!--[\\s\\S]*?(?:-->|$)");
      add("tag", "<\\/?[A-Za-z][\\w:-]*|\\/?>");
      add("str", "\"[^\"]*\"|'[^']*'");
      add("attr", "\\b[A-Za-z_:][\\w:.-]*(?==)");
      add("lit", "&[#\\w]+;");
    } else {
      for (const c of lang.comments || []) {
        if (c === "/*") add("com", "\\/\\*[\\s\\S]*?(?:\\*\\/|$)");
        else add("com", `${reEscape(c)}[^\\n]*`);
      }
      if (lang.jsonKeys || lang.yamlKeys) add("prop", lang.jsonKeys ? '"(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:)' : "^[ \\t-]*[\\w.-]+(?=\\s*:)");
      for (const q of lang.strings || []) {
        if (q.length === 3) add("str", `${reEscape(q)}[\\s\\S]*?(?:${reEscape(q)}|$)`);
        else if (q === "`") add("str", "`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|$)");
        else add("str", `${q}(?:\\\\.|[^${q}\\\\\\n])*(?:${q}|$)`);
      }
      if (lang.decorators) add("fn", "@[\\w.]+");
      if (lang.preprocessor) add("kw", "^[ \\t]*#[ \\t]*\\w+");
      if (lang.variables) add("var", `${reEscape(lang.variables)}\\{?[\\w]+\\}?`);
      if (lang.css) {
        add("num", "#[\\da-fA-F]{3,8}\\b");
        add("prop", "[\\w-]+(?=\\s*:[^:{;]*[;}\\n])");
        add("kw", "@[\\w-]+|!important");
      }
      add("num", "\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?:[a-zA-Z%]+)?\\b");
      add("word", "[A-Za-z_$][\\w$]*");
    }
    const regex = new RegExp(parts.join("|"), "gm");
    const keywords = words(lang.keywords || "");
    return (compiled[key] = { regex, kinds, keywords, lang });
  }

  // Splits code into [kind, text] pieces.
  function tokens(code, key) {
    const { regex, kinds, keywords, lang } = grammar(key);
    const out = [];
    let last = 0;
    regex.lastIndex = 0;
    for (let m; (m = regex.exec(code)); ) {
      if (m[0] === "") {
        regex.lastIndex++;
        continue;
      }
      if (m.index > last) out.push(["", code.slice(last, m.index)]);
      let kind = kinds[m.slice(1).findIndex((g) => g !== undefined)];
      if (kind === "word") {
        const w = m[0];
        const after = code.slice(regex.lastIndex, regex.lastIndex + 2);
        if (keywords.has(lang.caseInsensitive ? w.toLowerCase() : w)) kind = "kw";
        else if (LITERALS.has(w)) kind = "lit";
        else if (/^\s?\(/.test(after) || after[0] === "(") kind = "fn";
        else if (/^[A-Z][a-z]/.test(w) && !lang.caseInsensitive) kind = "type";
        else kind = "";
      }
      out.push([kind, m[0]]);
      last = regex.lastIndex;
    }
    if (last < code.length) out.push(["", code.slice(last)]);
    return out;
  }

  // Highlighted HTML, one <span class="line"> per line so line numbers can be shown beside them.
  function highlight(code, lang) {
    const key = ALIASES[lang] || (LANGS[lang] !== undefined ? lang : null);
    const pieces = key && LANGS[key] && code.length <= 100_000 ? tokens(code, key) : [["", code]];
    const lines = [""];
    for (const [kind, text] of pieces) {
      text.split("\n").forEach((part, i) => {
        if (i > 0) lines.push("");
        if (part) lines[lines.length - 1] += kind ? `<span class="tok-${kind}">${escape(part)}</span>` : escape(part);
      });
    }
    if (lines.length > 1 && lines.at(-1) === "") lines.pop(); // the newline that ends the block
    return lines;
  }

  const NUMBER_FROM = 6; // blocks with at least this many lines get line numbers
  const COLLAPSE_FROM = 40; // and at least this many get a Collapse button

  // The HTML for one fenced code block.
  // plain: skip the colours, for a block that's still being written (it's drawn again in colour
  // once it's finished, so the colouring isn't redone on every new word).
  window.renderCodeBlock = (code, info, { plain = false } = {}) => {
    const lang = String(info || "").trim().split(/\s+/)[0].toLowerCase().replace(/[^\w#+.-]/g, "").slice(0, 20);
    const lines = plain ? highlight(code, "plain") : highlight(code, lang);
    const label = LABELS[lang] || (lang ? lang : "Code");
    const numbered = lines.length >= NUMBER_FROM;
    const long = lines.length >= COLLAPSE_FROM;
    const body = lines.map((l) => `<span class="line">${l}</span>`).join("\n");
    return (
      `<div class="code-block${numbered ? " numbered" : ""}" data-lines="${lines.length}">` +
      `<div class="code-head"><span class="code-lang">${escape(label)}</span><span class="code-tools">` +
      (long ? `<button type="button" class="code-btn code-fold" aria-expanded="true">Collapse</button>` : "") +
      `<button type="button" class="code-btn code-copy" aria-label="Copy code">Copy</button></span></div>` +
      `<pre><code${lang ? ` class="language-${escape(lang)}"` : ""}>${body}</code></pre></div>`
    );
  };
  window.highlightCode = highlight;
})();

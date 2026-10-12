// The controls in the message box: attaching text files and pictures, the mode (General, Study,
// Coding, Maths) and the model picker. The model list comes from the server (/api/models), which
// only lists models it can really use; the picker stays hidden when there's only one. Pictures
// are only offered when one of those models can read them.
(() => {
  const { icon, toast, showMenu } = window.FarhanUI;
  const read = (key) => {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };

  // ---------- Modes ----------
  const MODES = {
    general: ["General", "chat", "Everyday questions and conversation."],
    study: ["Study", "book", "A patient tutor: checks your understanding and quizzes you."],
    code: ["Coding", "code", "Complete, runnable code with edge cases and how to test it."],
    maths: ["Maths", "sigma", "Numbered, justified steps, checked answers, proper notation."],
  };
  let mode = Object.hasOwn(MODES, read("farhanai-mode")) ? read("farhanai-mode") : "general";
  const modeChip = document.getElementById("mode-chip");
  function updateModeChip() {
    const [label, iconName] = MODES[mode];
    modeChip.innerHTML = `${icon(iconName)}<span>${label}</span>`;
    modeChip.title = `Mode: ${label}. Click to change.`;
    modeChip.setAttribute("aria-label", `Mode: ${label}`);
    modeChip.classList.toggle("on", mode !== "general");
  }
  function setMode(next, quiet = false) {
    if (!Object.hasOwn(MODES, next)) return;
    mode = next;
    write("farhanai-mode", next);
    updateModeChip();
    if (!quiet) toast(`Mode: ${MODES[next][0]}`);
  }
  modeChip.addEventListener("click", () =>
    showMenu(
      Object.entries(MODES).map(([key, [label, iconName]]) => ({ label: `${label}${key === mode ? " ✓" : ""}`, icon: iconName, action: () => setMode(key) })),
      modeChip,
      { label: "Mode" },
    ),
  );
  updateModeChip();

  // ---------- Models ----------
  let models = { default: "", models: [], pictures: false, maxFileChars: 12_000, maxPictures: 3 };
  let model = read("farhanai-model"); // "" means automatic
  const modelChip = document.getElementById("model-chip");
  const modelLabel = () => models.models.find((m) => m.id === model)?.label || "Auto";
  function updateModelChip() {
    modelChip.hidden = models.models.length < 2;
    // "Answered by" under replies only matters when there's a choice of models.
    document.documentElement.classList.toggle("many-models", models.models.length > 1);
    modelChip.innerHTML = `${icon("cpu")}<span>${modelLabel()}</span>`;
    modelChip.title = `Model: ${modelLabel()}. Click to change.`;
    modelChip.setAttribute("aria-label", `Model: ${modelLabel()}`);
  }
  function setModel(id) {
    model = id;
    write("farhanai-model", id);
    updateModelChip();
    toast(`Model: ${modelLabel()}`);
  }
  modelChip.addEventListener("click", () => {
    const usual = models.models.find((m) => m.id === models.default);
    showMenu(
      [
        { label: `Auto${usual ? ` (${usual.label})` : ""}${!model ? " ✓" : ""}`, icon: "sparkle", action: () => setModel("") },
        ...models.models.map((m) => ({
          label: `${m.label}${m.detail ? ` · ${m.detail}` : ""}${m.id === model ? " ✓" : ""}`,
          icon: m.pictures ? "image" : "cpu",
          action: () => setModel(m.id),
        })),
      ],
      modelChip,
      { label: "Model" },
    );
  });
  const ready = fetch("/api/models")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !Array.isArray(data.models)) return;
      models = data;
      if (model && !models.models.some((m) => m.id === model)) model = ""; // no longer available
      updateModelChip();
      updateAttach();
    })
    .catch(() => {});
  updateModelChip();

  // ---------- Attachments ----------
  const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-yaml|x-sh|sql|x-python))/;
  const TEXT_NAMES = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|mjs|ts|tsx|jsx|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|swift|kt|sql|sh|bat|ps1|ya?ml|toml|ini|cfg|log|tex|r|m|lua|dart|scala|vue|svelte)$/i;
  const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  let pending = []; // { kind: "file", name, text } or { kind: "picture", name, url }
  const strip = document.getElementById("attachments");
  const picker = document.getElementById("attach-input");
  const attachBtn = document.getElementById("attach");

  function updateAttach() {
    const what = models.pictures ? "Attach a text file or a picture" : "Attach a text file";
    attachBtn.title = what;
    attachBtn.setAttribute("aria-label", what);
    picker.accept = [".txt,.md,.csv,.json,.py,.js,.ts,.html,.css,.java,.c,.cpp,.sql,.xml,.yaml,.yml,text/*", ...(models.pictures ? PICTURE_TYPES : [])].join(",");
  }
  updateAttach();

  function render() {
    strip.replaceChildren();
    strip.hidden = !pending.length;
    pending.forEach((item, i) => {
      const chip = document.createElement("div");
      chip.className = `attachment ${item.kind}`;
      if (item.kind === "picture") {
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = "";
        chip.appendChild(img);
      } else chip.insertAdjacentHTML("beforeend", icon("file"));
      const name = document.createElement("span");
      name.className = "attachment-name";
      name.textContent = item.name;
      chip.appendChild(name);
      if (item.kind === "file") {
        const size = document.createElement("span");
        size.className = "attachment-size";
        size.textContent = `${item.text.length.toLocaleString("en-GB")} characters`;
        chip.appendChild(size);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "attachment-remove";
      remove.setAttribute("aria-label", `Remove ${item.name}`);
      remove.innerHTML = icon("x");
      remove.addEventListener("click", () => {
        pending.splice(i, 1);
        render();
        document.getElementById("input").focus();
      });
      chip.appendChild(remove);
      strip.appendChild(chip);
    });
    window.dispatchEvent(new Event("farhanai-attachments"));
  }

  // Makes a picture small enough to send: at most 1568 pixels on its longest side, as a JPEG.
  async function shrink(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // transparent areas become white rather than black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    for (const quality of [0.85, 0.7, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= 1_400_000) return url;
    }
    return null;
  }

  async function add(files) {
    for (const file of files) {
      const picture = PICTURE_TYPES.includes(file.type);
      if (picture) {
        if (!models.pictures) {
          toast("This site's AI can't read pictures right now. You can describe it in words instead.", { kind: "error" });
          continue;
        }
        if (pending.filter((p) => p.kind === "picture").length >= models.maxPictures) {
          toast(`You can attach up to ${models.maxPictures} pictures to one message.`, { kind: "error" });
          continue;
        }
        let url = null;
        try {
          url = await shrink(file);
        } catch {}
        if (!url) {
          toast(`“${file.name}” couldn't be read as a picture.`, { kind: "error" });
          continue;
        }
        pending.push({ kind: "picture", name: file.name || "Picture", url });
        continue;
      }
      if (!(TEXT_TYPES.test(file.type) || TEXT_NAMES.test(file.name))) {
        toast(`“${file.name}” isn't a text file. PDFs and Word documents can't be read yet: copy the text in instead.`, { kind: "error" });
        continue;
      }
      if (pending.filter((p) => p.kind === "file").length >= 3) {
        toast("You can attach up to 3 files to one message.", { kind: "error" });
        continue;
      }
      if (file.size > 1_000_000) {
        toast(`“${file.name}” is too big. Files can have up to ${models.maxFileChars.toLocaleString("en-GB")} characters.`, { kind: "error" });
        continue;
      }
      let text;
      try {
        text = await file.text();
      } catch {
        toast(`“${file.name}” couldn't be opened.`, { kind: "error" });
        continue;
      }
      if (text.includes("\u0000")) {
        toast(`“${file.name}” isn't a text file.`, { kind: "error" });
        continue;
      }
      const used = pending.reduce((n, p) => n + (p.text?.length || 0), 0);
      if (used + text.length > models.maxFileChars) {
        toast(`That's too much text: attached files can have up to ${models.maxFileChars.toLocaleString("en-GB")} characters together.`, { kind: "error" });
        continue;
      }
      pending.push({ kind: "file", name: file.name, text });
    }
    render();
  }

  attachBtn.addEventListener("click", () => picker.click());
  picker.addEventListener("change", async () => {
    await ready;
    await add([...picker.files]);
    picker.value = "";
    document.getElementById("input").focus();
  });
  // Files can also be dropped on the message box, and pictures pasted into it.
  const form = document.getElementById("composer");
  form.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    form.classList.add("dropping");
  });
  form.addEventListener("dragleave", (e) => !form.contains(e.relatedTarget) && form.classList.remove("dropping"));
  form.addEventListener("drop", async (e) => {
    form.classList.remove("dropping");
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    await ready;
    add([...e.dataTransfer.files]);
  });
  document.getElementById("input").addEventListener("paste", async (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    await ready;
    add(files);
  });

  // Hands over what's attached and empties the tray (called when a message is sent).
  function take() {
    const items = pending;
    pending = [];
    render();
    return items;
  }

  window.FarhanComposer = {
    MODES,
    ready,
    take,
    hasAttachments: () => pending.length > 0,
    add,
    mode: () => mode,
    setMode,
    model: () => model,
    models: () => models,
  };
})();

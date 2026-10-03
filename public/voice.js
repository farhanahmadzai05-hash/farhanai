// Voice mode: tap the orb, talk, and Farhan AI answers out loud.
// Uses the browser's built-in speech recognition and speech synthesis, which are free.
// Works in Chrome, Edge and Safari; Firefox has no speech recognition yet.
(() => {
  const card = document.getElementById("voice");
  const orb = document.getElementById("orb");
  const statusEl = document.getElementById("voice-status");
  const heardEl = document.getElementById("voice-heard");
  const replyEl = document.getElementById("voice-reply");

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;

  const STATUS = {
    idle: "Tap the orb and start talking",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking… tap to stop",
  };

  let state = "idle";
  let session = 0; // bumps whenever the conversation is stopped, so old callbacks are ignored
  let recognition = null;
  let talking = false; // keep listening again after each answer until the visitor stops

  function setState(next, message) {
    state = next;
    card.dataset.state = next;
    statusEl.textContent = message || STATUS[next] || "";
    orb.setAttribute("aria-label", next === "idle" || next === "error" ? "Start talking" : "Stop");
    window.dispatchEvent(new CustomEvent("farhanai-duck", { detail: next !== "idle" && next !== "error" }));
  }

  if (!Recognition || !synth) {
    setState("error", "Voice needs Chrome, Edge or Safari. Try opening the site in one of those.");
    orb.disabled = true;
    return;
  }

  // Pick a natural-sounding English voice when one is available.
  let voice = null;
  function pickVoice() {
    const voices = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    const prefer = [/natural/i, /google uk english male/i, /google us english/i, /daniel/i, /samantha/i, /google/i];
    voice = prefer.map((re) => voices.find((v) => re.test(v.name))).find(Boolean) || voices[0] || null;
  }
  pickVoice();
  synth.addEventListener?.("voiceschanged", pickVoice);

  // Turn Markdown into something that sounds right when read aloud.
  function speakable(text) {
    return text
      .replace(/```[\s\S]*?(```|$)/g, " I've put the code in the chat. ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*|__|\*|#+\s/g, "")
      .replace(/^\s*[-•]\s+/gm, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/\[\d{1,2}\]|【[^】]*】/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Speak sentence by sentence as the answer streams in, so it starts talking straight away.
  function speaker(id) {
    let buffer = "";
    let pending = 0;
    let finished = false;
    let onDone = null;
    const check = () => finished && pending === 0 && onDone?.();
    const say = (text) => {
      const words = speakable(text);
      if (!words || id !== session) return;
      const u = new SpeechSynthesisUtterance(words);
      if (voice) u.voice = voice;
      u.rate = 1.03;
      pending++;
      u.onstart = () => id === session && setState("speaking");
      u.onend = u.onerror = () => {
        pending--;
        check();
      };
      synth.speak(u);
    };
    return {
      add(chunk) {
        buffer += chunk;
        // Don't split inside a code block.
        if ((buffer.match(/```/g) || []).length % 2) return;
        const m = buffer.match(/^([\s\S]*?[.!?:](?=\s)|[\s\S]*?\n)/);
        if (m && m[0].trim().length > 1) {
          say(m[0]);
          buffer = buffer.slice(m[0].length);
          this.add("");
        }
      },
      end() {
        say(buffer);
        buffer = "";
        finished = true;
        return new Promise((resolve) => {
          onDone = resolve;
          check();
        });
      },
    };
  }

  function stopAll() {
    session++;
    talking = false;
    try {
      recognition?.abort();
    } catch {}
    recognition = null;
    synth.cancel();
    setState("idle");
  }

  const ERRORS = {
    blocked:
      "The microphone is blocked for this site. Click the lock or settings icon next to the web address, set Microphone to Allow, reload the page and try again.",
    noMic: "No microphone was found. Plug one in or check your sound settings, then tap the orb.",
    micBusy:
      "Your microphone couldn't be opened. Close other apps using it. On Windows, also check Settings, Privacy & security, Microphone, and allow apps and your browser to use it.",
    service:
      "This browser's speech service isn't working. That happens in Brave, Opera and some other browsers. Please open the site in Chrome, Edge or Safari.",
    insecure: "Voice only works on the secure (https) version of the site.",
    silent:
      "Your browser didn't pass any sound from the mic. Check the right microphone is selected in your browser and computer settings, then tap the orb.",
  };

  // Ask for the mic once with a normal permission prompt. This gives clearer errors than
  // speech recognition does on its own.
  let micReady = false;
  async function checkMic() {
    if (micReady) return null;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return ERRORS.insecure;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      micReady = true;
      return null;
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "SecurityError") return ERRORS.blocked;
      if (err.name === "NotFoundError" || err.name === "OverconstrainedError") return ERRORS.noMic;
      return ERRORS.micBusy;
    }
  }

  function fail(message) {
    talking = false;
    setState("error", message);
  }

  async function listen() {
    const id = session;
    heardEl.textContent = "";
    setState("listening", "Starting the mic…");
    const micProblem = await checkMic();
    if (id !== session) return;
    if (micProblem) return fail(micProblem);

    recognition = new Recognition();
    recognition.lang = navigator.language || "en-GB";
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = "";
    let failed = false;
    let gotAudio = false;

    // If the speech service never starts taking sound, say so instead of waiting forever.
    const watchdog = setTimeout(() => {
      if (id !== session || gotAudio) return;
      failed = true;
      try {
        recognition.abort();
      } catch {}
      fail(ERRORS.service);
    }, 6000);

    recognition.onaudiostart = () => {
      gotAudio = true;
      if (id === session) setState("listening", "Listening… go ahead");
    };
    recognition.onspeechstart = () => id === session && setState("listening", "Hearing you…");
    recognition.onresult = (e) => {
      let interim = "";
      finalText = "";
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      heardEl.textContent = (finalText + interim).trim();
    };
    recognition.onerror = (e) => {
      clearTimeout(watchdog);
      if (id !== session || failed) return;
      failed = true;
      if (e.error === "not-allowed") fail(ERRORS.blocked);
      else if (e.error === "service-not-allowed" || e.error === "network" || e.error === "language-not-supported") fail(ERRORS.service);
      else if (e.error === "audio-capture") fail(ERRORS.micBusy);
      else if (e.error === "no-speech") {
        talking = false;
        setState("idle", "I didn't hear anything. Tap the orb and speak a bit louder or closer to the mic.");
      } else if (e.error !== "aborted") fail(`Something went wrong with the mic (${e.error}). Tap the orb to try again.`);
    };
    recognition.onend = () => {
      clearTimeout(watchdog);
      if (id !== session || failed) return;
      const text = (finalText || heardEl.textContent).trim();
      if (text) ask(text, id);
      else if (!gotAudio) fail(ERRORS.silent);
      else {
        talking = false;
        setState("idle", "I didn't catch that. Tap the orb to try again.");
      }
    };
    try {
      recognition.start();
      setState("listening", "Listening…");
    } catch {
      clearTimeout(watchdog);
      fail("The mic is still busy. Wait a second and tap the orb again.");
    }
  }

  async function ask(text, id) {
    if (busy) {
      setState("idle", "Still answering in Chat. Try again in a moment.");
      return;
    }
    setState("thinking");
    replyEl.textContent = "";
    const voiceOut = speaker(id);
    let shown = "";
    let error = null;
    const reply = await send(text, {
      onText(chunk) {
        if (id !== session) return;
        shown += chunk;
        replyEl.textContent = speakable(shown);
        replyEl.scrollTop = replyEl.scrollHeight;
        voiceOut.add(chunk);
      },
      onStatus(message) {
        if (id === session && state === "thinking") statusEl.textContent = message;
      },
      onError(message) {
        error = message;
      },
    });
    if (id !== session) return;
    if (reply == null) {
      talking = false;
      setState("error", error || "Something went wrong. Tap the orb to try again.");
      return;
    }
    await voiceOut.end();
    if (id !== session) return;
    if (talking) listen(); // carry on the conversation
    else setState("idle");
  }

  orb.addEventListener("click", () => {
    if (state === "idle" || state === "error") {
      synth.cancel();
      // iPhones and iPads only allow speech that starts from a tap, so say nothing once now to unlock it.
      if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))) {
        synth.speak(new SpeechSynthesisUtterance(""));
      }
      session++;
      talking = true;
      listen();
    } else {
      stopAll();
    }
  });

  // Stop talking when the visitor goes back to Chat or starts a new chat.
  window.addEventListener("farhanai-panel", (e) => e.detail !== "voice" && state !== "idle" && state !== "error" && stopAll());
  window.addEventListener("farhanai-new-chat", () => {
    stopAll();
    heardEl.textContent = "";
    replyEl.textContent = "";
  });
  window.addEventListener("pagehide", stopAll);

  setState("idle");
  // Brave pretends to support speech recognition but blocks it, so warn straight away.
  navigator.brave?.isBrave?.().then((yes) => yes && setState("error", ERRORS.service));
})();

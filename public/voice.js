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

  function listen() {
    const id = session;
    heardEl.textContent = "";
    recognition = new Recognition();
    recognition.lang = navigator.language || "en-GB";
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = "";
    let failed = false;

    recognition.onresult = (e) => {
      let interim = "";
      finalText = "";
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      heardEl.textContent = (finalText + interim).trim();
    };
    recognition.onerror = (e) => {
      if (id !== session) return;
      failed = true;
      talking = false;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setState("error", "Microphone access is blocked. Allow the mic for this site in your browser, then tap the orb.");
      } else if (e.error === "no-speech") {
        setState("idle", "I didn't hear anything. Tap the orb to try again.");
      } else if (e.error === "network") {
        setState("error", "Voice needs an internet connection. Check it and tap the orb.");
      } else if (e.error !== "aborted") {
        setState("error", "Something went wrong with the mic. Tap the orb to try again.");
      }
    };
    recognition.onend = () => {
      if (id !== session || failed) return;
      const text = (finalText || heardEl.textContent).trim();
      if (text) ask(text, id);
      else {
        talking = false;
        setState("idle", "I didn't catch that. Tap the orb to try again.");
      }
    };
    setState("listening");
    recognition.start();
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
      // Some phones only allow speech that starts from a tap, so say nothing once now to unlock it.
      synth.cancel();
      synth.speak(new SpeechSynthesisUtterance(""));
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
})();

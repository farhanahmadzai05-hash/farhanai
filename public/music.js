// Background music: a button in the header turns calm music on and off.
//
// If you add your own song to the public folder as music.mp3 (or music.m4a /
// music.ogg), that file plays on a loop. Otherwise the page plays a soft
// ambient track that it composes live in the browser, so there's no audio
// file and nothing to license.
//
// Music is on by default. The page tries to start it straight away; most
// browsers block sound until the visitor interacts, so if that's blocked it
// starts on their first click, tap, key press or when they focus the chat box.
// Turning it off with the button is remembered.
(() => {
  const button = document.getElementById("music");
  const STORAGE_KEY = "farhanai-music";
  const VOLUME = 0.5; // 0 = silent, 1 = full volume

  let player = null; // { start(), stop() }
  let playing = false;
  let waiting = false; // music was on last visit and is waiting for a first click

  const remember = (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {}
  };
  const remembered = () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  };

  // Looks for a song file the site owner added.
  async function findSongFile() {
    for (const name of ["/music.mp3", "/music.m4a", "/music.ogg"]) {
      try {
        if ((await fetch(name, { method: "HEAD" })).ok) return name;
      } catch {}
    }
    return null;
  }

  function filePlayer(src) {
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = VOLUME;
    return {
      start: () => audio.play(),
      stop: () => audio.pause(),
      volume: (v) => (audio.volume = v),
    };
  }

  // A gentle, slowly changing ambient piece built from soft synth pads,
  // a few drifting melody notes and some reverb.
  function ambientPlayer() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1600;
    tone.connect(master);
    master.connect(ctx.destination);

    // Reverb from a decaying burst of noise.
    const reverb = ctx.createConvolver();
    const length = ctx.sampleRate * 4;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    reverb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    reverb.connect(wet).connect(tone);

    const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
    // Cmaj7, Am7, Fmaj7, G6: a classic relaxed loop.
    const chords = [
      [48, 52, 55, 59],
      [45, 48, 52, 55],
      [41, 45, 48, 52],
      [43, 47, 50, 52],
    ];
    const melody = [72, 74, 76, 79, 81, 84]; // C major pentatonic
    const CHORD_SECONDS = 8;

    function note(freq, start, duration, level, type, attack) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + attack);
      gain.gain.setValueAtTime(level, start + duration - attack);
      gain.gain.linearRampToValueAtTime(0, start + duration + 2);
      gain.connect(tone);
      gain.connect(reverb);
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + duration + 2.2);
      }
    }

    let nextChordAt = 0;
    let chordIndex = 0;
    let nextMelodyAt = 0;
    let timer = null;

    // Schedules a few seconds ahead so the music never stutters.
    function schedule() {
      const ahead = ctx.currentTime + 4;
      while (nextChordAt < ahead) {
        for (const midi of chords[chordIndex % chords.length]) {
          note(hz(midi), nextChordAt, CHORD_SECONDS, 0.06, "triangle", 2.5);
        }
        chordIndex++;
        nextChordAt += CHORD_SECONDS;
      }
      while (nextMelodyAt < ahead) {
        if (Math.random() < 0.55) {
          const midi = melody[Math.floor(Math.random() * melody.length)];
          note(hz(midi), nextMelodyAt, 1.2, 0.03, "sine", 0.05);
        }
        nextMelodyAt += 1.5 + Math.random() * 2;
      }
    }

    return {
      async start() {
        // Browsers keep audio suspended until the visitor interacts with the page.
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
        if (ctx.state !== "running") throw new Error("Audio blocked until the visitor interacts");
        nextChordAt = nextMelodyAt = ctx.currentTime + 0.1;
        schedule();
        timer = setInterval(schedule, 1000);
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 3);
      },
      volume(v) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.4);
      },
      stop() {
        clearInterval(timer);
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
        setTimeout(() => !playing && ctx.suspend(), 1200);
      },
    };
  }

  const songFile = findSongFile();

  // Voice mode turns the music right down while you talk and while Farhan AI speaks.
  let ducked = false;
  window.addEventListener("farhanai-duck", (e) => {
    ducked = e.detail;
    if (playing) player?.volume(ducked ? VOLUME * 0.12 : VOLUME);
  });

  function show(on) {
    button.setAttribute("aria-pressed", String(on));
    button.title = on ? "Turn music off" : "Play background music";
  }

  // Returns true if music is now playing.
  async function turnOn() {
    if (playing) return true;
    playing = true;
    show(true);
    try {
      if (!player) {
        const file = await songFile;
        player = file ? filePlayer(file) : ambientPlayer();
      }
      await player.start();
      if (ducked) player.volume(VOLUME * 0.12);
      return true;
    } catch {
      playing = false;
      show(false);
      return false;
    }
  }

  function turnOff() {
    const wasPlaying = playing;
    playing = false;
    show(false);
    if (wasPlaying) player?.stop();
  }

  button.addEventListener("click", () => {
    if (playing || waiting) {
      waiting = false;
      turnOff();
      remember("off");
    } else {
      turnOn();
      remember("on");
    }
  });

  // Music is on unless the visitor turned it off before. Try to play right away,
  // and if the browser blocks that, start at the visitor's first interaction.
  const START_EVENTS = ["pointerdown", "keydown", "touchend", "focusin"];
  function startOnFirstInteraction() {
    waiting = true;
    show(true);
    const resume = async (e) => {
      if (e.target.closest?.("#music")) return; // the button handles itself
      if (!waiting) return stopListening();
      if (await turnOn()) {
        waiting = false;
        stopListening();
      } else if (waiting) {
        show(true);
      }
    };
    const stopListening = () => START_EVENTS.forEach((t) => window.removeEventListener(t, resume, true));
    START_EVENTS.forEach((t) => window.addEventListener(t, resume, true));
  }

  if (remembered() !== "off") {
    show(true);
    waiting = true;
    turnOn().then((ok) => {
      if (ok) waiting = false;
      else if (waiting) startOnFirstInteraction();
    });
  }
})();

# Farhan AI

Farhan's own AI chat app. It's a small web chat app that runs entirely on your own computer. It uses a free AI model (Llama 3.2 by default) through [Ollama](https://ollama.com), so there's no API key and nothing to pay.

## Set it up on Windows (one time)

1. **Install Node.js.** Go to https://nodejs.org, download the "LTS" version, and run the installer with the default options.
2. **Install Ollama.** Go to https://ollama.com/download, download the Windows version, and run the installer. Ollama then runs in the background (you'll see a llama icon near the clock).
3. **Download the AI model.** Press the Windows key, type `cmd`, press Enter, and in the black window type this and press Enter:
   ```
   ollama pull llama3.2
   ```
   It downloads about 2 GB. Wait until it says `success`, then close the window.
4. **Unzip the chatbot.** Right-click `chatbot.zip`, choose **Extract All…**, then **Extract**.

## Start Farhan AI

Open the extracted `chatbot` folder and double-click **`start-chatbot.bat`**. A black window opens and the chat page opens in your browser at http://localhost:3000. Keep the black window open while you chat; close it to stop the chatbot.

If you prefer the terminal: click the folder's address bar, type `cmd`, press Enter, then run `npm start`.

**Desktop shortcut:** double-click **`create-desktop-shortcut.bat`** once. A "Farhan AI" icon appears on your desktop, and from then on you can start the app from there. (If you move the `chatbot` folder, run it again.)

## Put it online 24/7 (free)

To make Farhan AI a real website that works even when your PC is off, follow **[GO-LIVE.md](GO-LIVE.md)**. It uses Groq's free AI service and Render's free hosting.

## Share it from your PC (free)

Double-click **`go-online.bat`**. The first time, it installs Cloudflare's free tunnel tool and asks you to run it again. After that, the black window shows a box like this:

```
  Farhan AI is ONLINE at:  https://some-random-words.trycloudflare.com
```

Anyone can open that address on their phone or computer and chat with Farhan AI. Good to know:

- The AI still runs on **your** PC, so the address only works while the black window is open and your PC is on.
- The address changes every time you start it, so share the new one each time.
- Anyone with the address can use it, so only share it with people you trust.
- Any edit you make (settings.json, logo, code) shows up online as soon as you restart the app.

## Make it your own

Open **`settings.json`** with Notepad (right-click it, then **Open with**, then **Notepad**) and change the text between the quotes:

- `appName`: the name shown at the top of the page and in the browser tab
- `greeting`: the message you see before you start chatting
- `personality`: instructions for how the AI behaves, such as its name, tone and what it knows about you
- `model`: which downloaded Ollama model answers
- `port`: the number in the web address (3000 means http://localhost:3000)

Save the file, close the black window, and start the app again to see your changes. Keep the quotes and commas as they are. If the app says it had a problem reading settings.json, a quote or comma is probably missing.

The logo is `public/icon.svg` (the page) and `public/favicon.ico` (the desktop shortcut).

### Voice mode

Tap **Voice** at the top of the page, or swipe sideways, to switch from Chat to Voice. Tap the glowing orb and talk: Farhan AI listens, answers out loud, then listens again until you tap the orb to stop. Voice chats also show up in Chat. It uses the speech features built into the browser, so it's free; it works in Chrome, Edge and Safari (not Firefox), and the browser asks for permission to use the mic the first time.

### Background music

Background music is on by default, and the music note button at the top of the page turns it off and on. The page tries to start the music straight away, but most browsers block sound until a visitor clicks, taps or types, so it usually starts at their first click. If a visitor turns the music off, the page remembers that.

The built-in music is composed live in the browser by `public/music.js`. It's original and contains no audio file, so there's nothing to license.

To use your own song instead, name it `music.mp3` (or `music.m4a` / `music.ogg`) and put it in the `public` folder. On GitHub, open the `public` folder, click **Add file**, then **Upload files**, and commit. The website updates a few minutes later. Only use music you're allowed to share, such as your own or a track marked royalty free. To change the volume, edit `VOLUME` near the top of `public/music.js`.

## If something goes wrong

- **"Can't reach Ollama"**: open the Ollama app from the Start menu, then send your message again.
- **"The model isn't downloaded yet"**: run `ollama pull llama3.2` (step 3).
- **The black window closes or says `'node' is not recognized`**: install Node.js (step 1), restart your computer, and try again.
- **Replies are slow**: that's your computer doing the work. A smaller model is faster: run `ollama pull llama3.2:1b`, then change `model` in settings.json to `llama3.2:1b`.

## Advanced settings (optional)

These environment variables override settings.json, for example in cmd: `set OLLAMA_MODEL=llama3.2:1b` then `npm start`.

| Variable | Default | What it does |
|---|---|---|
| `OLLAMA_MODEL` | `llama3.2` | Which downloaded model answers. Any model from https://ollama.com/library works after `ollama pull`. |
| `SYSTEM_PROMPT` | `personality` from settings.json | The bot's personality and instructions |
| `PORT` | `3000` | Port the chat page uses |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Where Ollama is running |
| `GROQ_API_KEY` | (not set) | When set, replies come from Groq instead of Ollama (used by the online website) |
| `GROQ_MODEL` | `onlineModel` from settings.json | Which Groq model answers online |
| `RATE_LIMIT` | `30` | Messages each visitor can send per 10 minutes |

## How it works

- `server.js` serves the chat page and passes your conversation to Ollama's local API, streaming the reply back as it's written. It has no dependencies, so there's no `npm install` step.
- `public/app.js` keeps the conversation in the browser, shows replies as they stream in, and supports "New chat".
- Online, the same server talks to Groq's API instead (when `GROQ_API_KEY` is set). `render.yaml` describes the Render setup.
- `npm test` checks the server against a fake Ollama and a fake Groq.

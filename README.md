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

### Automatic checks before changes go live

Every pull request, and every change to `main`, is tested automatically on GitHub (the **Checks** tab of a pull request, or the **Actions** tab of the repository). This runs `node scripts/check.js` and the full test suite on Linux and Windows. It's free for public repositories and uses no API keys.

Render deploys every change to `main` straight away, even if the tests failed. To make Render wait for the tests, open the farhanai service in Render, go to **Settings**, find **Auto-Deploy**, and choose **After CI Checks Pass** (if your plan offers it). This is optional, and only you can change it.

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

### Live web search, pictures and today's date

On the website, Farhan AI knows the current date and time where each visitor is, and it searches the internet when a question needs up-to-date facts (news, scores, who won something, prices). It shows pictures and numbered source links above its answer, and the little numbers in the answer link to those sources.

Without any extra setup it searches **Wikipedia**, which is free and needs no key. For full, up-to-the-minute web search with news and photos, get a free **Tavily** key (1,000 searches a month, no card needed):

1. Go to https://app.tavily.com and sign up with Google or email.
2. Copy your API key (it starts with `tvly-`).
3. In Render, open your farhanai service, then **Environment**, click **Add Environment Variable**, set the key to `TAVILY_API_KEY` and paste your key as the value, then **Save Changes**. Render restarts the site with web search switched on.

Web search only works on the website (with Groq), not in the PC version with Ollama.

### Voice mode

Tap **Voice** at the top of the page, or swipe sideways, to switch from Chat to Voice. Tap the glowing orb and talk: Farhan AI listens, answers out loud, then listens again until you tap the orb to stop. Voice chats also show up in Chat. It uses the speech features built into the browser, so it's free; it works in Chrome, Edge and Safari (not Firefox), and the browser asks for permission to use the mic the first time.

### Background music

Background music is off until a visitor turns it on with the music note button at the top of the page, and the music file isn't downloaded before then. The page remembers their choice: if they turned it on, it starts again on their next visit at their first click, tap or key press (browsers don't allow sound before that). If they turn it off, it stays off.

The built-in music is composed live in the browser by `public/music.js`. It's original and contains no audio file, so there's nothing to license.

To use your own song instead, name it `music.mp3` (or `music.m4a` / `music.ogg`) and put it in the `public` folder. Keep it under 2 MB so it loads quickly on phones (a test checks this): 96 kbps MP3 is plenty for background music, and a free converter such as Audacity can save it at that quality. On GitHub, open the `public` folder, click **Add file**, then **Upload files**, and commit. The website updates a few minutes later. Only use music you're allowed to share, such as your own or a track marked royalty free. To change the volume, edit `VOLUME` near the top of `public/music.js`.

## If something goes wrong

- **"Can't reach Ollama"**: open the Ollama app from the Start menu, then send your message again.
- **"The model isn't downloaded yet"**: run `ollama pull llama3.2` (step 3).
- **The black window closes or says `'node' is not recognized`**: install Node.js (step 1), restart your computer, and try again.
- **Replies are slow**: that's your computer doing the work. A smaller model is faster: run `ollama pull llama3.2:1b`, then change `model` in settings.json to `llama3.2:1b`.

## Measuring answer quality

The `eval` folder has a set of 46 test questions with automatic checks (facts, maths, following instructions, long conversations, prompt injection, web search and more), and a script that asks a running Farhan AI each one and reports what passed. It shows whether a change to the AI's instructions or model made answers better or worse. See [eval/README.md](eval/README.md) for how to run it with your Groq key on your PC.

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
| `MAX_ACTIVE_PER_VISITOR` | `1` | Replies one visitor can have running at the same time |
| `DAILY_AI_CALLS` | `1000` | AI requests the whole website may make per day (resets at midnight UTC). `0` means no limit. When it runs out, visitors are asked to come back tomorrow. |
| `TRUST_PROXY_HOPS` | `1` on Render, `0` elsewhere | How many proxies in front of the app add the visitor's address to `X-Forwarded-For`. Used to tell visitors apart for the limits above. |
| `GROQ_FIRST_BYTE_TIMEOUT_MS` | `20000` | How long to wait for a Groq model to start answering before trying the next model |
| `GROQ_IDLE_TIMEOUT_MS` | `30000` | Longest pause allowed in the middle of a reply before it is ended |
| `SEARCH_TIMEOUT_MS` | `8000` | How long a web search may take before the answer carries on without it |
| `HEARTBEAT_MS` | `15000` | How often a quiet reply sends a keep-alive ping so proxies don't close it |

### How visitors are told apart (rate limits)

The limits above are counted per visitor address. Online, the server sits behind Render's proxy, so the address it sees on the connection is the proxy's, not the visitor's.

- **What it assumes:** each trusted proxy adds the address it received the request from to the **end** of the `X-Forwarded-For` header, after anything the visitor sent. With `TRUST_PROXY_HOPS` trusted proxies (1 on Render), the entry that many places from the end is used. Everything before it could be made up by the visitor, so it is ignored. Changing it can't reset a limit.
- **If the header is missing or empty, has fewer entries than `TRUST_PROXY_HOPS`, or the chosen entry isn't a valid IP address** (for example `garbage` or `1.2.3.4:443`), the request is counted under one shared "unidentified" allowance. That can be stricter for those visitors, but it never lets anyone get around the limit.
- **On your PC** (no proxy), `X-Forwarded-For` is ignored and the connection's own address is used.
- **Checking it on Render:** this is an assumption about Render, and the automated tests only simulate a proxy. They prove the server reads the header correctly, not that Render writes it this way. After a deploy, open the service's **Logs** in Render and send one chat message. Look for a line starting with `Proxy check:`. It contains only counts, yes/no answers and header names, never an address. Expected on Render: `X-Forwarded-For has 1 address(es); using number 1 from the end (TRUST_PROXY_HOPS), which is a valid IP address.` If you send a test request with your own made-up header (for example with `curl -H "X-Forwarded-For: 10.0.0.1"`), the count should go up by one, which shows Render added its address after yours. A line saying the header is missing, too short or not a valid address means `TRUST_PROXY_HOPS` needs changing.

## How it works

- `server.js` serves the chat page and passes your conversation to Ollama's local API, streaming the reply back as it's written. It has no dependencies, so there's no `npm install` step.
- `public/app.js` keeps the conversation in the browser, shows replies as they stream in, and supports "New chat". While a reply is being written, the send button becomes a **Stop** button. A reply that is stopped or cut off keeps the words that arrived and says so, and the newest one has a **Try again** button that asks again without sending your message twice. The conversation is kept only in that browser tab, so reloading the page starts a new chat.
- Online, the same server talks to Groq's API instead (when `GROQ_API_KEY` is set). `render.yaml` describes the Render setup.
- `npm test` checks the server against a fake Ollama and a fake Groq. It also opens the chat page in a hidden Chrome, Chromium or Edge window to test what a visitor sees (stopping, trying again, citations, scrolling). Those browser tests need Node 22 or newer and one of those browsers; without them they are skipped and the reason is shown. Set `CHROME_PATH` if your browser is somewhere unusual.
- `npm run bench:streaming` measures how smoothly the page draws a long streamed reply on a slowed-down CPU. See [docs/notes/streaming-rendering.md](docs/notes/streaming-rendering.md).

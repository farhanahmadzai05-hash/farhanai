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

The logo is `public/icon.svg` (the browser tab) and `public/favicon.ico` (older browsers and desktop shortcuts). The mark is a triangle with a point of light inside, taken from the A on the intro screen.

### Themes and saved chats

- **Appearance**: the palette button at the top switches between Dark (the default), Light and System (follows the device), and picks one of five accent colours. The choice is kept in that browser.
- **Saved chats**: every conversation is saved in the visitor's own browser (local storage) and listed in the sidebar, grouped by date. Chats can be searched (titles and messages), renamed, pinned to the top and deleted (with a confirmation). Nothing is stored on the server and chats don't sync between devices or browsers. Clearing the browser's site data removes them, and **Delete all chats** at the bottom of the sidebar does the same on purpose. If the browser's storage is full, the chat still works and says it isn't being saved.
- **Home screen**: a new chat shows a greeting, four suggestions (they change slowly, and **Shuffle** picks new ones) and quick actions. A suggestion with a complete question sends it; one marked "You add details" puts a starter in the message box for you to finish.
- **Message box**: Enter sends and Shift+Enter starts a new line (on phones, Enter starts a new line and the arrow button sends). An unsent message is kept if the page is closed. The length shows only when it's close to the 20,000-character limit.
- **Code in answers** gets a language label, colours, a **Copy** button, line numbers for longer blocks and **Collapse** for very long ones. The colouring is done by `public/code.js` with no extra library.
- **Reply actions**: under each answer are **Copy** and **Regenerate** (newest answer only), and a **More** menu with Copy as Markdown, Download as Markdown and follow-ups (Continue, Simplify, Step by step, More technical, Another way, Summarise, Make a checklist). Your own newest message can be copied or edited and sent again, which replaces its answer.
- **Settings** (gear button, or Ctrl+,): Appearance (theme, accent, text size, message width, spacing, motion, background light), Assistant (answer style, length, tone, focus, language, a name to call it, examples, and a short note of your own), presets you can save and reuse (up to 20), Chats & privacy (turn chat saving off, export one or all chats as Markdown, delete all chats, and a plain list of what is sent to the server) and the keyboard shortcuts. Everything is kept in that browser.
- **Answer style chip**: the button beside the message box switches answer style (Balanced, Concise, Academic, Creative, Technical, Socratic, Research) or a saved preset.
- **Command palette** (Ctrl+K, or ⌘K on a Mac): type to run a command or find a saved chat. Shortcuts: Ctrl+Shift+O new chat, Ctrl+Shift+S show or hide chats, Ctrl+Shift+; copy the latest reply, / to type, Esc to stop a reply, ? to list the shortcuts.
- **How preferences reach the AI**: only the settings above are sent with each message. The server checks every value against a fixed list (unknown values are dropped, a name or language with markup is refused, the note is cut to 500 characters) and adds them below its own rules, which they can't override.
- **Attach files and pictures** with the paperclip button, by dropping them on the message box, or by pasting a picture. Text files (notes, code, CSV, JSON, Markdown and so on) can have up to 12,000 characters together, and their text stays in the conversation so later questions can refer back to them. PDFs and Word documents can't be read yet. Pictures (up to 3 per message) are shrunk in the browser and sent to Groq with that one message; they're only offered when the Groq account lists a model that can read pictures (today that's Qwen 3.8 27B), and pictures always go to that model. Pictures aren't kept in saved chats, only their names.
- **Modes**: the mode button beside the message box switches between General, Study (a tutor that checks understanding and quizzes you), Coding and Maths. Each one adds a short instruction to the request.
- **Model picker**: when the server can use more than one model, a model button appears. It lists only the models that Groq lists for this account (or that Ollama has downloaded), checked through `/api/models`, which costs nothing. **Auto** uses the usual model. If the chosen model is busy, another one answers, and each reply shows which model wrote it.

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
- `public/app.js` keeps the conversation in the browser, shows replies as they stream in, and supports "New chat". While a reply is being written, the send button becomes a **Stop** button. A reply that is stopped or cut off keeps the words that arrived and says so, and the newest one has a **Try again** button that asks again without sending your message twice.
- `public/chats.js` saves chats in the browser and draws the sidebar, `public/home.js` the home screen, `public/ui.js` menus, dialogs, toasts and the Appearance menu, `public/code.js` code blocks, and `public/theme.js` applies the theme before the page is drawn. The colours, type and spacing are variables at the top of `public/style.css`, which is how the light theme and accent colours change everything at once.
- Online, the same server talks to Groq's API instead (when `GROQ_API_KEY` is set). `render.yaml` describes the Render setup.
- `npm test` checks the server against a fake Ollama and a fake Groq. It also opens the chat page in a hidden Chrome, Chromium or Edge window to test what a visitor sees (stopping, trying again, citations, scrolling). Those browser tests need Node 22 or newer and one of those browsers; without them they are skipped and the reason is shown. Set `CHROME_PATH` if your browser is somewhere unusual.
- `npm run bench:streaming` measures how smoothly the page draws a long streamed reply on a slowed-down CPU. See [docs/notes/streaming-rendering.md](docs/notes/streaming-rendering.md).

# Put Farhan AI online 24/7 (free)

When you're done, Farhan AI will be a real website that works all the time, even when your PC is off. You'll use three free services:

- **Groq**: the AI brain. It runs a bigger Llama model (Llama 3.3 70B), so replies are smarter and faster than on your PC.
- **GitHub**: stores your app's files.
- **Render**: runs your app as a website at an address like `https://farhanai.onrender.com`.

You don't need a credit card for any of them. Plan for about 20 minutes.

---

## Step 1: Get a free Groq key

1. Go to **https://console.groq.com** and sign up (the "Continue with Google" button is easiest).
2. On the left, click **API Keys**, then **Create API Key**. Name it `farhanai`.
3. Copy the key. It starts with `gsk_`. Paste it into Notepad for now.

Keep this key secret. Never put it in a file or share it in a screenshot.

## Step 2: Put your files on GitHub

1. Go to **https://github.com** and sign up.
2. Click the **+** in the top-right corner, then **New repository**.
3. For the name, type `farhanai`. Leave everything else as it is and click **Create repository**.
4. On the next page, click the link that says **uploading an existing file**.
5. Open your `chatbot` folder on your PC, select **everything inside it** (press Ctrl+A), and drag it into the browser window. Drag the files inside the folder, not the `chatbot` folder itself.
6. Wait for the uploads to finish, then click **Commit changes**.

## Step 3: Turn it into a website on Render

1. Go to **https://render.com**, click **Get Started**, and sign in with **GitHub**.
2. Click **New +**, then **Web Service**. Pick your `farhanai` repository. If it isn't listed, click **Configure account** and give Render access to it.
3. Fill in the form:
   - **Name**: `farhanai` (this becomes your web address)
   - **Language**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free**
4. Under **Environment Variables**, click **Add Environment Variable**:
   - **Key**: `GROQ_API_KEY`
   - **Value**: paste your `gsk_...` key from Step 1
5. Click **Deploy Web Service**. Wait until it says **Live** (a few minutes).
6. Your address is shown at the top, such as `https://farhanai.onrender.com`. Open it and say hi! If someone else already took `farhanai`, Render adds a few extra letters to the address.

## Step 4: Keep it awake

Free Render websites fall asleep after 15 minutes with no visitors, and the next visitor then waits about a minute. A free "pinger" stops that by visiting every 5 minutes:

1. Go to **https://uptimerobot.com** and sign up.
2. Click **New monitor**, then choose **HTTP(s)**.
3. For the URL, enter your address followed by `/api/config`, for example `https://farhanai.onrender.com/api/config`.
4. Set it to check **every 5 minutes**, then save.

Render gives you 750 free hours a month, which is enough to keep one website on all month.

---

## Making changes later

Edit on GitHub, and your website updates itself a couple of minutes later:

- **Small changes** (like the name, greeting or personality): open your `farhanai` repository on GitHub, click `settings.json`, click the **pencil icon**, make your change, and click **Commit changes**.
- **Bigger changes** (like a new design from Claude): click **Add file**, then **Upload files**, drag in the new files, and click **Commit changes**. Files with the same name get replaced.

Your PC version keeps working too. Double-click `start-chatbot.bat` like before.

## Getting a FarhanAI domain (optional, costs money)

The free address `farhanai.onrender.com` works fine. For your own domain name:

- **farhanai.com is already taken** by someone else.
- **farhanai.net, .org, .app, .co, .io, .ai, .me, .site, .xyz and .chat** looked unused when Claude checked. Confirm this when you search for them at a domain shop.
- Domains cost roughly $10 to $20 a year for .com, .net, .org or .app. A .ai domain costs much more. Shops like Cloudflare, Namecheap and Porkbun sell them.

After you buy one, go to Render, open **Settings**, then **Custom Domains**. Add your domain there and follow the instructions, which tell you what to paste into your domain shop's settings.

## Good to know

- Anyone who visits can chat, and their messages are sent to Groq to get answers.
- Groq's free plan has a daily limit. If a lot of people use it in one day, Farhan AI asks them to try again later. To stop one person from using it all up, each visitor can send up to 30 messages every 10 minutes.
- To use a different Groq model, change `onlineModel` in `settings.json`. The models are listed at https://console.groq.com/docs/models. `llama-3.1-8b-instant` is faster and has higher limits.

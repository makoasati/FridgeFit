# FridgeFit

Recipes you'll actually want to make from what you already have, starting with what's about to go bad.

FridgeFit is a clickable prototype built for 43120 Building an AI Company at Chicago Booth. It takes a grocery receipt, works out which perishables you have and roughly how long they'll last, and suggests three recipes for tonight with a one-line reason for each. You confirm ingredients, cook step by step, and tell it how the meal went, and it uses that feedback to get better.

## What's real and what's simulated

| Step | Status |
|---|---|
| Tonight's recipes (which 3 recipes to show, and the reason on each card) | **Real AI**: a Claude model through the Anthropic API |
| Receipt photo (read every line, keep the perishables, ask about lines it can't decode) | **Real AI**: the same Claude model, reading the image |
| Fridge or pantry photo (list the perishables, mark anything it can't identify with a ?) | **Real AI** |
| Gmail (find recent grocery receipts and orders, read them like a receipt) | **Real AI**, plus read-only Gmail access you connect yourself |
| Swaps, replacements after feedback, progress numbers | Simulated: pre-written answers in `public/simulated_responses.js` |

The real AI picks from the app's catalog of 19 recipes, so the rest of the app (ingredient checks, swaps, the freshness check, cooking steps) keeps working. Two rules run in code after the AI answers, whatever the model says. Recipes with your allergies or dislikes are removed, and so are unknown or repeated recipes. If fewer than 3 picks survive, simulated picks fill the gap. If the AI can't be reached, the app shows simulated backup picks and says so.

**Adding groceries.** On "Add your groceries" there are three ways in, and you can use more than one:

- **Snap or upload a receipt.** "Take a photo" opens the camera on a phone, and "Upload a photo" picks an existing one. The AI reads every line, keeps the perishables, skips pantry staples and non-food, and estimates freshness from the purchase date. "Try the sample receipt instead" runs the old simulated receipt.
- **Snap your fridge or pantry.** The AI lists the perishables it can see. Anything that looks like food but that it can't identify gets a **?** marker on the photo.
- **Connect Gmail.** The app searches the last 3 weeks for grocery receipts and orders and reads them like a receipt. See "Connect Gmail" below for the one-time setup.

Photos are shrunk to about 1568 px before they're sent. Then you see a review screen with what was found. Anything the AI couldn't identify, whether a **?** on the photo or a cryptic receipt line, becomes a question. You can tap one of its guesses, type the answer, or tap 🎤 and say it. Voice works in Chrome, Edge and Safari. You also pick roughly when the item needs using. Everything then goes to the perishables screen to confirm, correct or remove, and **Add an item** covers anything still missing.

Items that match a food the recipes use (spinach, tomatoes, chicken, feta, yogurt, eggs) count toward recipes. Other foods show in your list and are sent to the recipe AI, but the 19 catalog recipes don't use them yet.

## Try it online

The app is hosted at **https://fridgefit-orpin.vercel.app**. Anyone can click through it. The real AI is behind a class passcode, so ask the team for it and enter it on the welcome screen. Without the passcode, the app runs with simulated answers.

How the hosted version differs from running it on a laptop:

- **Logs** go to the Vercel dashboard (project **fridgefit**, **Logs** tab) instead of a file, one JSON line per request. Photos aren't saved there.
- **Settings** live in the Vercel project's **Environment Variables**: `ANTHROPIC_API_KEY`, `APP_PASSCODE` (change it there any time, then redeploy) and `SESSION_SECRET`. For Gmail, also add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and add `https://fridgefit-orpin.vercel.app/auth/google/callback` as a second redirect URI in Google Cloud.
- **Deploys** happen automatically when you push to `main` on GitHub. `vercel.json` and `api/index.js` wire it up; the backend is the same `server.js`.
- **Spending:** every AI request on the hosted version uses the API key's credits. Set a monthly spend limit in the Anthropic Console.

## Run it on your laptop

You need [Node.js](https://nodejs.org) (the LTS version) and your own Anthropic API key.

1. **Get the project.** On this page, click **Code**, then **Download ZIP**, and unzip it. Keep it somewhere outside Google Drive, Dropbox or OneDrive, because syncing can upload your key.
2. **Get an API key.** Go to [console.anthropic.com](https://console.anthropic.com), buy a few dollars of credits (this is separate from a Claude.ai subscription), and create an API key.
3. **Start the app.**
   - Windows: double-click `start-windows.bat`.
   - Mac: double-click `start-mac.command`. If your Mac blocks it, right-click it, choose **Open**, then **Open** again.

   The first time, it installs what it needs and creates a file called `.env`.
4. **Add your key.** Open `.env` in Notepad or TextEdit and paste your key after `ANTHROPIC_API_KEY=`, with no spaces. Save it. Never share this file or paste the key into a chat.
5. **Restart.** Close the black window and double-click the start file again. The app opens at http://localhost:3000.

When the real AI is on, the home screen says "Picked by AI" under "Suggested recipes tonight". Without a key, the app still runs, with simulated picks.

Prefer the terminal? Run `npm install`, copy `.env.example` to `.env`, add your key, then run `npm start`.

## Connect Gmail (one-time setup)

Gmail needs a Google sign-in key that you create once in Google Cloud. It takes about 10 minutes and is free. The app only asks for read-only access, so it can't send, delete or change email.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project, for example "FridgeFit".
2. Open **APIs & Services**, then **Library**. Search for **Gmail API** and click **Enable**.
3. Open the **OAuth consent screen** (Google may call it **Google Auth Platform**). Choose **External**, name the app FridgeFit, and add your email as the support and contact email. Under **Audience** (or **Test users**), add the Gmail address you want to scan. Leave the app in **Testing**.
4. Open **Clients** (or **Credentials**), choose **Create client**, and pick **Web application**. Under **Authorized redirect URIs**, add `http://localhost:3000/auth/google/callback`, then click **Create**.
5. Copy the **Client ID** and **Client secret** into `.env` after `GOOGLE_CLIENT_ID=` and `GOOGLE_CLIENT_SECRET=`. Restart the app.
6. In the app, choose **Connect Gmail**, then **Connect Gmail** again. A Google window opens. Google will warn that it "hasn't verified this app". That's expected for your own test app, so choose **Continue**.

Good to know:

- In Testing mode, Google signs you out after 7 days, so reconnect when that happens.
- University or work Google accounts often block apps like this. Use a personal Gmail if you get an "access blocked" message.
- To let a teammate use your key, add their Gmail as a test user and share the ID and secret privately. Don't put them in the repo or a shared doc. Or each teammate can create their own.
- The sign-in is saved in `.gmail-token.json` on your laptop, which is never committed. **Disconnect Gmail** in the app deletes it and revokes access.
- To change which emails are read, add `"gmailQuery"` (a Gmail search) or `"gmailMaxEmails"` (default 5) to `config.json`.

## Switch models or go back to simulated

Everything is in `config.json`. Changes apply on the next request, without restarting.

| Setting | What it does |
|---|---|
| `useSimulatedAI` | `true` uses the pre-written answers instead of the real model |
| `model` | Which Claude model to use, for example `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5` (cheapest) |
| `effort` | How hard the model thinks: `low`, `medium` or `high` |
| `fallbacks` | `"default"` lets the API retry on another model if the request is declined. Ignored for Haiku |
| `photoModel`, `photoEffort` | Optional. Use a different model or effort for reading photos, receipts and emails. If left out, they use `model` and `effort` |

Each AI step is one function in `ai.js`: `pickTonightRecipes`, `detectPhotoItems` and `readReceipt` (used for receipt photos and emails). The instructions each model gets are written out in the same file.

## See what the AI did

Every AI request is saved to `logs/ai-log.jsonl`, one entry per line. It records the full instructions and inputs sent, the answer, how long it took, the tokens used and any errors. Every tap in the app is saved there too, including "Not quite right?" reasons, freshness checks and next-day answers.

Each receipt or fridge photo is saved to `logs/images`, and its log entry points to the file, so you can see exactly what the AI looked at. Gmail scans log the search, plus the subject, sender and text of each email sent to the AI.

For a readable view, open http://localhost:3000/log while the app is running. Photos show next to their entries. The `logs` folder stays on your laptop and is never uploaded.

## Testing

`docs/test-cases.md` has five test cases for class: two typical, one edge case and two failure cases. Each one says how to set it up in the app and what a good answer looks like. It also has a few checks for the fridge photo, using `docs/test-photos/sample-fridge.png` and your own photos.

## What's in the repo

| Path | What it is |
|---|---|
| `public/` | The app: `index.html`, `app.js` (screens and logic), `scan.js` (receipt, photo and Gmail scanning, questions and voice), `simulated_responses.js` (pretend AI answers), `styles.css` |
| `ai.js` | The real AI steps: prompts, tool schemas and model calls |
| `server.js` | Small local backend. It serves the app, keeps the keys on your laptop, calls the AI, connects to Gmail and writes the log |
| `config.json` | Model and switches |
| `.env.example` | Template for your own `.env` (the real `.env` is never committed) |
| `docs/assignments/` | Project assignments 2 to 4 |
| `docs/design/` | Storyboard and annotated app screens |
| `docs/test-cases.md` | Test cases for the AI steps |
| `docs/test-photos/` | A sample fridge photo and a sample receipt for testing |

## Keep your key safe

`.env`, `.gmail-token.json`, `node_modules` and `logs` are listed in `.gitignore`, so they are never committed. If you think a key has leaked, delete it in the Anthropic Console (or Google Cloud) and create a new one.

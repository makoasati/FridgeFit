# FridgeFit

Recipes you'll actually want to make from what you already have, starting with what's about to go bad.

FridgeFit is a clickable prototype built for 43120 Building an AI Company at Chicago Booth. It takes a grocery receipt, works out which perishables you have and roughly how long they'll last, and suggests three recipes for tonight with a one-line reason for each. You confirm ingredients, cook step by step, and tell it how the meal went, and it uses that feedback to get better.

## What's real and what's simulated

| Step | Status |
|---|---|
| Tonight's recipes (which 3 recipes to show, and the reason on each card) | **Real AI**: a Claude model through the Anthropic API |
| Reading the receipt, freshness estimates, swaps, replacements after feedback, progress numbers | Simulated: pre-written answers in `public/simulated_responses.js` |

The real AI picks from the app's catalog of 19 recipes, so the rest of the app (ingredient checks, swaps, the freshness check, cooking steps) keeps working. Two rules run in code after the AI answers, whatever the model says. Recipes with your allergies or dislikes are removed, and so are unknown or repeated recipes. If fewer than 3 picks survive, simulated picks fill the gap. If the AI can't be reached, the app shows simulated backup picks and says so.

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

## Switch models or go back to simulated

Everything is in `config.json`. Changes apply on the next request, without restarting.

| Setting | What it does |
|---|---|
| `useSimulatedAI` | `true` uses the pre-written answers instead of the real model |
| `model` | Which Claude model to use, for example `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5` (cheapest) |
| `effort` | How hard the model thinks: `low`, `medium` or `high` |
| `fallbacks` | `"default"` lets the API retry on another model if the request is declined. Ignored for Haiku |

The AI call itself is one function, `pickTonightRecipes` in `ai.js`. The instructions the model gets are at the top of that file.

## See what the AI did

Every AI request is saved to `logs/ai-log.jsonl`, one entry per line. It records the full instructions and inputs sent, the answer, how long it took, the tokens used and any errors. Every tap in the app is saved there too, including "Not quite right?" reasons, freshness checks and next-day answers.

For a readable view, open http://localhost:3000/log while the app is running. The `logs` folder stays on your laptop and is never uploaded.

## Testing

`docs/test-cases.md` has five test cases for class: two typical, one edge case and two failure cases. Each one says how to set it up in the app and what a good answer looks like.

## What's in the repo

| Path | What it is |
|---|---|
| `public/` | The app: `index.html`, `app.js` (screens and logic), `simulated_responses.js` (pretend AI answers), `styles.css` |
| `ai.js` | The real AI step: prompt, tool schema and model call |
| `server.js` | Small local backend. It serves the app, keeps the key on your laptop, calls the AI and writes the log |
| `config.json` | Model and switches |
| `.env.example` | Template for your own `.env` (the real `.env` is never committed) |
| `docs/assignments/` | Project assignments 2 to 4 |
| `docs/design/` | Storyboard and annotated app screens |
| `docs/test-cases.md` | Test cases for the AI step |

## Keep your key safe

`.env`, `node_modules` and `logs` are listed in `.gitignore`, so they are never committed. If you think a key has leaked, delete it in the Anthropic Console and create a new one.

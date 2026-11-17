// FridgeFit local backend: serves the app, keeps the API keys on this laptop, calls the AI,
// connects to Gmail (read-only) to find grocery receipts, and writes everything to logs/ai-log.jsonl.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { pickTonightRecipes, detectPhotoItems, readReceipt } from "./ai.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(here, "public");
const LOG_DIR = path.join(here, "logs");
const LOG_FILE = path.join(LOG_DIR, "ai-log.jsonl");
const IMAGE_DIR = path.join(LOG_DIR, "images");
const IMAGE_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

// Read on every request, so you can switch models or the simulated switch without restarting.
function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(here, "config.json"), "utf8"));
}

function hasKey() {
  return (process.env.ANTHROPIC_API_KEY || "").trim().length > 0;
}

function status() {
  const config = readConfig();
  if (config.useSimulatedAI) return { mode: "simulated", reason: "useSimulatedAI is true in config.json", model: null };
  if (!hasKey()) return { mode: "simulated", reason: "No API key in .env", model: null };
  return { mode: "real", model: config.model, provider: config.provider };
}

function writeLog(entry) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n");
}

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendHtml(res, code, html) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error("Body is not valid JSON")); }
    });
    req.on("error", reject);
  });
}

function explainError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "The API key in .env was rejected. Check that you pasted the whole key.";
  if (error instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model.";
  if (error instanceof Anthropic.NotFoundError) return "Model not found. Check the model name in config.json.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a minute and try again.";
  if (error instanceof Anthropic.BadRequestError) return `The API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the API. Check your internet connection.";
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  return error.message || String(error);
}

/* ------------------------- AI step: tonight's recipes ------------------------- */

async function handleTonight(req, res) {
  const config = readConfig();
  const input = await readBody(req);
  const started = Date.now();
  try {
    const result = await pickTonightRecipes(input, config);
    writeLog({
      type: "ai_request",
      step: "tonight_recipes",
      provider: config.provider,
      model: result.model,
      latencyMs: Date.now() - started,
      request: result.request,
      output: { picks: result.picks, stopReason: result.stopReason, content: result.content },
      confidence: "none returned (the model gives picks and reasons, not probabilities)",
      usage: result.usage,
    });
    sendJson(res, 200, { picks: result.picks, model: result.model });
  } catch (error) {
    const message = explainError(error);
    writeLog({
      type: "ai_error", step: "tonight_recipes", provider: config.provider, model: config.model,
      latencyMs: Date.now() - started, error: message, input,
      output: error.result ? { stopReason: error.result.stopReason, content: error.result.content } : null,
    });
    console.error(`AI error: ${message}`);
    sendJson(res, 502, { error: message });
  }
}

/* -------------------- AI steps that read a photo -------------------- */

// The photo is saved to logs/images so you can see exactly what the AI looked at.
// The log entry points to the file instead of storing the (large) image data.
async function handleImageStep(req, res, { step, prefix, run, toResponse }) {
  const config = readConfig();
  const body = await readBody(req, 15_000_000);
  const ext = IMAGE_TYPES[body.mediaType];
  if (!ext || typeof body.data !== "string" || !body.data.length) {
    return sendJson(res, 400, { error: "Send a JPEG, PNG, WebP or GIF photo." });
  }
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const imageFile = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, imageFile), Buffer.from(body.data, "base64"));
  const imageNote = `[photo saved to logs/images/${imageFile}, ${Math.round((body.data.length * 3) / 4 / 1024)} KB]`;
  const withoutImageData = (request) => JSON.parse(JSON.stringify(request, (key, value) => (key === "data" ? imageNote : value)));

  const started = Date.now();
  try {
    const result = await run({ mediaType: body.mediaType, data: body.data }, config);
    const payload = toResponse(result);
    writeLog({
      type: "ai_request", step, provider: config.provider, model: result.model,
      latencyMs: Date.now() - started, imageFile,
      request: withoutImageData(result.request),
      output: { ...payload, stopReason: result.stopReason, content: result.content },
      confidence: "per item: high, medium or low (the model's own rating, not a probability)",
      usage: result.usage,
    });
    sendJson(res, 200, { ...payload, model: result.model });
  } catch (error) {
    const message = explainError(error);
    writeLog({
      type: "ai_error", step, provider: config.provider, model: config.photoModel || config.model,
      latencyMs: Date.now() - started, imageFile, error: message,
      output: error.result ? { stopReason: error.result.stopReason, content: error.result.content } : null,
    });
    console.error(`AI error: ${message}`);
    sendJson(res, 502, { error: message });
  }
}

const photoStep = {
  step: "fridge_or_pantry_photo",
  prefix: "photo",
  run: detectPhotoItems,
  toResponse: (r) => ({ items: r.items, unclear: r.unclear, photoProblem: r.photoProblem }),
};

const receiptStep = {
  step: "receipt_photo",
  prefix: "receipt",
  run: (image, config) => readReceipt({ image }, config),
  toResponse: (r) => ({ store: r.store, date: r.date, lines: r.lines, problem: r.problem }),
};

/* ------------------------------ Gmail ------------------------------ */
// Read-only access. The sign-in token is stored in .gmail-token.json on this laptop and never committed.

const GMAIL_TOKEN_FILE = path.join(here, ".gmail-token.json");
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_GMAIL_QUERY = 'newer_than:21d (receipt OR order OR "order confirmation" OR delivered OR "your order") ' +
  '(grocery OR groceries OR instacart OR "whole foods" OR "trader joe" OR "amazon fresh" OR jewel OR mariano OR kroger OR target OR walmart OR costco OR aldi)';
const oauthStates = new Set();

const gmailConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const redirectUri = () => `http://localhost:${PORT}/auth/google/callback`;
function readToken() {
  try { return JSON.parse(fs.readFileSync(GMAIL_TOKEN_FILE, "utf8")); } catch { return null; }
}
function saveToken(token) {
  fs.writeFileSync(GMAIL_TOKEN_FILE, JSON.stringify(token, null, 2));
}

async function googleToken(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  return data;
}

async function gmailAccessToken() {
  const token = readToken();
  if (!token) throw new Error("Gmail isn't connected.");
  if (token.access_token && token.expires_at > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) throw new Error("Your Gmail sign-in expired. Connect Gmail again.");
  const data = await googleToken({ grant_type: "refresh_token", refresh_token: token.refresh_token });
  saveToken({ ...token, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

async function gmailGet(apiPath) {
  const res = await fetch(`${GMAIL_API}${apiPath}`, { headers: { Authorization: `Bearer ${await gmailAccessToken()}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail error ${res.status}: ${data.error?.message || "unknown"}`);
  return data;
}

function htmlToText(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function messageText(message) {
  const parts = [];
  const walk = (part) => {
    if (part.body?.data) parts.push(part);
    (part.parts || []).forEach(walk);
  };
  walk(message.payload);
  const decode = (data) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const plain = parts.find((p) => p.mimeType === "text/plain");
  const html = parts.find((p) => p.mimeType === "text/html");
  // Many store emails have a thin plain-text part; prefer the HTML when it carries more.
  const plainText = plain ? decode(plain.body.data) : "";
  const htmlText = html ? htmlToText(decode(html.body.data)) : "";
  return (htmlText.length > plainText.length * 1.5 ? htmlText : plainText || htmlText || message.snippet || "").slice(0, 12000);
}

function gmailStatus() {
  const token = readToken();
  return { configured: gmailConfigured(), connected: !!token, email: token?.email || "" };
}

function startGmailAuth(res) {
  if (!gmailConfigured()) return sendHtml(res, 400, "<p>Gmail isn't set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env (see the README), then restart the app.</p>");
  const state = crypto.randomBytes(16).toString("hex");
  oauthStates.add(state);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

const authPage = (title, text, ok) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui,sans-serif;padding:32px;max-width:520px"><h2>${title}</h2><p>${text}</p>
<script>if (${ok} && window.opener) { window.opener.postMessage({ type: "gmail-connected" }, location.origin); setTimeout(() => window.close(), 900); }</script>`;

async function finishGmailAuth(req, res) {
  const params = new URL(req.url, "http://localhost").searchParams;
  if (params.get("error")) return sendHtml(res, 400, authPage("Gmail not connected", `Google said: ${params.get("error")}. You can close this window.`, false));
  if (!oauthStates.delete(params.get("state"))) return sendHtml(res, 400, authPage("Gmail not connected", "This sign-in link expired. Close this window and try again.", false));
  try {
    const data = await googleToken({ grant_type: "authorization_code", code: params.get("code"), redirect_uri: redirectUri() });
    saveToken({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 });
    const profile = await gmailGet("/profile");
    saveToken({ ...readToken(), email: profile.emailAddress });
    writeLog({ type: "gmail", event: "connected", email: profile.emailAddress });
    sendHtml(res, 200, authPage("Gmail connected", "You can close this window and go back to FridgeFit.", true));
  } catch (error) {
    sendHtml(res, 500, authPage("Gmail not connected", error.message, false));
  }
}

async function handleGmailScan(req, res) {
  const config = readConfig();
  const query = config.gmailQuery || DEFAULT_GMAIL_QUERY;
  const max = config.gmailMaxEmails || 5;
  try {
    const list = await gmailGet(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
    const ids = (list.messages || []).map((m) => m.id);
    writeLog({ type: "gmail", event: "search", query, found: ids.length });
    const emails = [];
    for (const id of ids) {
      const message = await gmailGet(`/messages/${id}?format=full`);
      const header = (name) => (message.payload.headers || []).find((h) => h.name.toLowerCase() === name)?.value || "";
      const meta = { id, subject: header("subject"), from: header("from"), date: header("date") };
      const text = messageText(message);
      const started = Date.now();
      try {
        const result = await readReceipt({ text, ...meta }, config);
        writeLog({
          type: "ai_request", step: "email_receipt", provider: config.provider, model: result.model,
          latencyMs: Date.now() - started, email: meta,
          request: result.request,
          output: { store: result.store, date: result.date, lines: result.lines, problem: result.problem, stopReason: result.stopReason },
          confidence: "per item: high, medium or low (the model's own rating, not a probability)",
          usage: result.usage,
        });
        emails.push({ ...meta, store: result.store, purchaseDate: result.date, lines: result.lines, problem: result.problem });
      } catch (error) {
        const message = explainError(error);
        writeLog({ type: "ai_error", step: "email_receipt", model: config.model, latencyMs: Date.now() - started, email: meta, error: message });
        emails.push({ ...meta, lines: [], error: message });
      }
    }
    sendJson(res, 200, { query, emails });
  } catch (error) {
    writeLog({ type: "gmail", event: "error", error: error.message });
    sendJson(res, 502, { error: error.message });
  }
}

async function disconnectGmail(res) {
  const token = readToken();
  if (token?.refresh_token || token?.access_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.refresh_token || token.access_token)}`, { method: "POST" }).catch(() => {});
  }
  fs.rmSync(GMAIL_TOKEN_FILE, { force: true });
  writeLog({ type: "gmail", event: "disconnected" });
  sendJson(res, 200, gmailStatus());
}

/* ------------------------------ files and log page ------------------------------ */

function serveLogImage(req, res) {
  const name = path.basename(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  const file = path.join(IMAGE_DIR, name);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
  const type = Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t] === path.extname(file)) || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(file).pipe(res);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": (TYPES[path.extname(file)] || "application/octet-stream") + "; charset=utf-8" });
  fs.createReadStream(file).pipe(res);
}

// A readable view of the log at http://localhost:3000/log (newest first)
function serveLogPage(res) {
  const lines = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean) : [];
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const items = lines.slice(-300).reverse().map((line) => {
    let e; try { e = JSON.parse(line); } catch { return ""; }
    const title = e.type === "ui_event"
      ? `${esc(e.event)} · ${esc(e.message || "")}`
      : `${e.type} · ${e.step || e.event || ""} · ${e.model || ""}${e.email ? " · " + esc(e.email.subject || "") : ""}${e.error ? " · " + esc(e.error) : ""}`;
    const photo = e.imageFile ? `<p><img src="/log-images/${encodeURIComponent(e.imageFile)}" style="max-width:320px;border-radius:8px"></p>` : "";
    const body = e.type === "ui_event" ? "" : `${photo}<pre>${esc(JSON.stringify(e, null, 2))}</pre>`;
    return `<details class="${e.type}"><summary><span>${e.time}</span> ${title}</summary>${body}</details>`;
  }).join("");
  sendHtml(res, 200, `<!doctype html><meta charset="utf-8"><title>FridgeFit log</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;max-width:1100px}summary{cursor:pointer;padding:6px 0}
summary span{color:#777;font-size:12px;margin-right:8px}details{border-bottom:1px solid #eee}
.ai_request summary{color:#1b5e20;font-weight:600}.ai_error summary{color:#b71c1c;font-weight:600}.gmail summary{color:#0d47a1}
pre{background:#f6f6f6;padding:12px;overflow:auto;font-size:12px;white-space:pre-wrap}</style>
<h1>FridgeFit log</h1><p>${lines.length} entries, newest first. File: logs/ai-log.jsonl. <a href="/log">Refresh</a></p>${items || "<p>No entries yet.</p>"}`);
}

/* ------------------------------ routes ------------------------------ */

const needsRealAI = (res) => {
  const s = status();
  if (s.mode === "real") return false;
  sendJson(res, 409, { error: `Real AI is off: ${s.reason}` });
  return true;
};

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    const route = `${req.method} ${pathname}`;
    if (route === "GET /api/status") return sendJson(res, 200, status());
    if (route === "POST /api/tonight") return needsRealAI(res) || (await handleTonight(req, res));
    if (route === "POST /api/photo") return needsRealAI(res) || (await handleImageStep(req, res, photoStep));
    if (route === "POST /api/receipt") return needsRealAI(res) || (await handleImageStep(req, res, receiptStep));
    if (route === "GET /api/gmail/status") return sendJson(res, 200, gmailStatus());
    if (route === "POST /api/gmail/scan") return needsRealAI(res) || (await handleGmailScan(req, res));
    if (route === "POST /api/gmail/disconnect") return await disconnectGmail(res);
    if (route === "GET /auth/google") return startGmailAuth(res);
    if (route === "GET /auth/google/callback") return await finishGmailAuth(req, res);
    if (route === "POST /api/log") {
      const body = await readBody(req);
      writeLog({ type: "ui_event", event: String(body.type || "event"), message: String(body.message || "") });
      return sendJson(res, 200, { ok: true });
    }
    if (route === "GET /log") return serveLogPage(res);
    if (req.method === "GET" && pathname.startsWith("/log-images/")) return serveLogImage(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const s = status();
  const g = gmailStatus();
  console.log(`FridgeFit is running at http://localhost:${PORT}`);
  console.log(s.mode === "real" ? `AI: real (${s.model})` : `AI: simulated (${s.reason})`);
  console.log(`Gmail: ${!g.configured ? "not set up (see README)" : g.connected ? `connected (${g.email})` : "ready to connect"}`);
  console.log(`Log: http://localhost:${PORT}/log   (file: logs/ai-log.jsonl)`);
  console.log("Press Ctrl+C to stop.");
});

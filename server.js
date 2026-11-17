// FridgeFit backend: serves the app, keeps the API keys off the browser, calls the AI,
// connects to Gmail (read-only) to find grocery receipts, and logs every AI request.
// Runs two ways:
//   - on your laptop:  `npm start` (or the start file). Logs go to logs/ai-log.jsonl and http://localhost:3000/log
//   - on Vercel:       api/index.js wraps the same handler. Logs go to the Vercel dashboard (Logs tab)
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

const ON_VERCEL = !!process.env.VERCEL;
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

const hasKey = () => (process.env.ANTHROPIC_API_KEY || "").trim().length > 0;

/* ------------------------------ passcode ------------------------------ */
// If APP_PASSCODE is set (do this on the hosted version), the AI only runs for requests that send it.
// Without it, anyone with the link could spend your API credits.

function unlocked(req) {
  const code = (process.env.APP_PASSCODE || "").trim();
  if (!code) return true;
  const sent = String(req.headers["x-fridgefit-passcode"] || "");
  const a = crypto.createHash("sha256").update(sent).digest();
  const b = crypto.createHash("sha256").update(code).digest();
  return crypto.timingSafeEqual(a, b);
}

function status(req) {
  const config = readConfig();
  if (config.useSimulatedAI) return { mode: "simulated", reason: "useSimulatedAI is true in config.json", model: null };
  if (!hasKey()) return { mode: "simulated", reason: "No API key set", model: null };
  if (!unlocked(req)) return { mode: "simulated", reason: "Passcode needed for the real AI", model: null, locked: true };
  return { mode: "real", model: config.model, provider: config.provider };
}

/* ------------------------------ logging ------------------------------ */

function writeLog(entry) {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  if (ON_VERCEL) return console.log(line);   // shows up in the Vercel dashboard, Logs tab
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, line + "\n");
}

/* ------------------------------ HTTP helpers ------------------------------ */

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendHtml(res, code, html) {
  res.statusCode = code;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function readBody(req, limit = 2_000_000) {
  // On Vercel the platform has already read and parsed the body
  if (ON_VERCEL && req.body !== undefined) {
    if (typeof req.body === "string") return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    return Promise.resolve(req.body || {});
  }
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

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0])
    .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}

function addCookie(req, res, name, value, maxAgeSeconds) {
  const secure = siteOrigin(req).startsWith("https") ? "; Secure" : "";
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
  const existing = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", existing ? [].concat(existing, cookie) : [cookie]);
}

// http://localhost:3000 on a laptop, https://<your-app>.vercel.app when hosted
function siteOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

function explainError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check that the whole key was pasted.";
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
      type: "ai_request", step: "tonight_recipes", provider: config.provider, model: result.model,
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

// On a laptop the photo is saved to logs/images so you can see exactly what the AI looked at,
// and the log entry points to the file instead of storing the (large) image data.
async function handleImageStep(req, res, { step, prefix, run, toResponse }) {
  const config = readConfig();
  const body = await readBody(req, 15_000_000);
  const ext = IMAGE_TYPES[body.mediaType];
  if (!ext || typeof body.data !== "string" || !body.data.length) {
    return sendJson(res, 400, { error: "Send a JPEG, PNG, WebP or GIF photo." });
  }
  let imageFile = null;
  const kb = Math.round((body.data.length * 3) / 4 / 1024);
  if (!ON_VERCEL) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    imageFile = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`;
    fs.writeFileSync(path.join(IMAGE_DIR, imageFile), Buffer.from(body.data, "base64"));
  }
  const imageNote = imageFile ? `[photo saved to logs/images/${imageFile}, ${kb} KB]` : `[photo, ${kb} KB, not saved on the hosted version]`;
  const withoutImageData = (request) => JSON.parse(JSON.stringify(request, (key, value) => (key === "data" ? imageNote : value)));

  const started = Date.now();
  try {
    const result = await run({ mediaType: body.mediaType, data: body.data }, config, body.today);
    const payload = toResponse(result);
    writeLog({
      type: "ai_request", step, provider: config.provider, model: result.model,
      latencyMs: Date.now() - started, imageFile,
      request: withoutImageData(result.request),
      output: { ...payload, stopReason: result.stopReason, content: result.content },
      confidence: "per item: high, medium or low (the model's own rating of what the item is, not a probability)",
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
  run: (image, config) => detectPhotoItems(image, config),
  toResponse: (r) => ({ items: r.items, unclear: r.unclear, photoProblem: r.photoProblem }),
};

const receiptStep = {
  step: "receipt_photo",
  prefix: "receipt",
  run: (image, config, today) => readReceipt({ image, today }, config),
  toResponse: (r) => ({ store: r.store, date: r.date, lines: r.lines, problem: r.problem }),
};

/* ------------------------------ Gmail ------------------------------ */
// Read-only access. The sign-in is kept in an encrypted, HTTP-only cookie in the user's browser,
// so it works the same on a laptop and on Vercel, and each person connects their own Gmail.

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_COOKIE = "ff_gmail";
const STATE_COOKIE = "ff_oauth_state";
const DEFAULT_GMAIL_QUERY = 'newer_than:21d (receipt OR order OR "order confirmation" OR delivered OR "your order") ' +
  '(grocery OR groceries OR instacart OR "whole foods" OR "trader joe" OR "amazon fresh" OR jewel OR mariano OR kroger OR target OR walmart OR costco OR aldi)';

const gmailConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const redirectUri = (req) => `${siteOrigin(req)}/auth/google/callback`;
const cookieKey = () => crypto.createHash("sha256").update(process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || "fridgefit").digest();

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cookieKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

function unseal(text) {
  try {
    const raw = Buffer.from(text, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", cookieKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

const readToken = (req) => (cookies(req)[GMAIL_COOKIE] ? unseal(cookies(req)[GMAIL_COOKIE]) : null);
const saveToken = (req, res, token) => addCookie(req, res, GMAIL_COOKIE, seal(token), 60 * 60 * 24 * 30);

async function googleToken(params) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google sign-in failed: ${data.error_description || data.error || response.status}`);
  return data;
}

// Returns a working access token, refreshing it (and updating the cookie) when it has expired
async function gmailAccessToken(req, res, session) {
  if (!session.token) throw new Error("Gmail isn't connected.");
  const token = session.token;
  if (token.access_token && token.expires_at > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) throw new Error("Your Gmail sign-in expired. Connect Gmail again.");
  const data = await googleToken({ grant_type: "refresh_token", refresh_token: token.refresh_token });
  session.token = { ...token, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  saveToken(req, res, session.token);
  return session.token.access_token;
}

async function gmailGet(req, res, session, apiPath) {
  const response = await fetch(`${GMAIL_API}${apiPath}`, { headers: { Authorization: `Bearer ${await gmailAccessToken(req, res, session)}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(`Gmail error ${response.status}: ${data.error?.message || "unknown"}`);
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

function gmailStatus(req) {
  const token = readToken(req);
  return { configured: gmailConfigured(), connected: !!token, email: token?.email || "" };
}

function startGmailAuth(req, res) {
  if (!gmailConfigured()) return sendHtml(res, 400, "<p>Gmail isn't set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see the README), then restart the app.</p>");
  const state = crypto.randomBytes(16).toString("hex");
  addCookie(req, res, STATE_COOKIE, state, 600);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  res.statusCode = 302;
  res.setHeader("Location", url.toString());
  res.end();
}

const authPage = (title, text, ok) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui,sans-serif;padding:32px;max-width:520px"><h2>${title}</h2><p>${text}</p>
<script>if (${ok} && window.opener) { window.opener.postMessage({ type: "gmail-connected" }, location.origin); setTimeout(() => window.close(), 900); }</script>`;

async function finishGmailAuth(req, res) {
  const params = new URL(req.url, "http://localhost").searchParams;
  const expected = cookies(req)[STATE_COOKIE];
  addCookie(req, res, STATE_COOKIE, "", 0);
  if (params.get("error")) return sendHtml(res, 400, authPage("Gmail not connected", `Google said: ${params.get("error")}. You can close this window.`, false));
  if (!expected || params.get("state") !== expected) return sendHtml(res, 400, authPage("Gmail not connected", "This sign-in link expired. Close this window and try again.", false));
  try {
    const data = await googleToken({ grant_type: "authorization_code", code: params.get("code"), redirect_uri: redirectUri(req) });
    const session = { token: { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 } };
    const profile = await gmailGet(req, res, session, "/profile");
    session.token.email = profile.emailAddress;
    saveToken(req, res, session.token);
    writeLog({ type: "gmail", event: "connected" });
    sendHtml(res, 200, authPage("Gmail connected", "You can close this window and go back to FridgeFit.", true));
  } catch (error) {
    sendHtml(res, 500, authPage("Gmail not connected", error.message, false));
  }
}

async function handleGmailScan(req, res) {
  const config = readConfig();
  const body = await readBody(req).catch(() => ({}));
  const query = config.gmailQuery || DEFAULT_GMAIL_QUERY;
  const max = config.gmailMaxEmails || 5;
  const session = { token: readToken(req) };
  try {
    const list = await gmailGet(req, res, session, `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
    const ids = (list.messages || []).map((m) => m.id);
    writeLog({ type: "gmail", event: "search", query, found: ids.length });
    // Read the emails at the same time, so the scan stays fast (and inside Vercel's time limit)
    const emails = await Promise.all(ids.map(async (id) => {
      const message = await gmailGet(req, res, session, `/messages/${id}?format=full`);
      const header = (name) => (message.payload.headers || []).find((h) => h.name.toLowerCase() === name)?.value || "";
      const meta = { id, subject: header("subject"), from: header("from"), date: header("date") };
      const started = Date.now();
      try {
        const result = await readReceipt({ text: messageText(message), today: body.today, ...meta }, config);
        writeLog({
          type: "ai_request", step: "email_receipt", provider: config.provider, model: result.model,
          latencyMs: Date.now() - started, email: meta,
          request: result.request,
          output: { store: result.store, date: result.date, lines: result.lines, problem: result.problem, stopReason: result.stopReason },
          confidence: "per item: high, medium or low (the model's own rating of what the item is, not a probability)",
          usage: result.usage,
        });
        return { ...meta, store: result.store, purchaseDate: result.date, lines: result.lines, problem: result.problem };
      } catch (error) {
        const message = explainError(error);
        writeLog({ type: "ai_error", step: "email_receipt", model: config.model, latencyMs: Date.now() - started, email: meta, error: message });
        return { ...meta, lines: [], error: message };
      }
    }));
    sendJson(res, 200, { query, emails });
  } catch (error) {
    writeLog({ type: "gmail", event: "error", error: error.message });
    sendJson(res, 502, { error: error.message });
  }
}

async function disconnectGmail(req, res) {
  const token = readToken(req);
  if (token?.refresh_token || token?.access_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.refresh_token || token.access_token)}`, { method: "POST" }).catch(() => {});
  }
  addCookie(req, res, GMAIL_COOKIE, "", 0);
  writeLog({ type: "gmail", event: "disconnected" });
  sendJson(res, 200, { configured: gmailConfigured(), connected: false, email: "" });
}

/* ------------------------------ files and log page ------------------------------ */

function serveLogImage(req, res) {
  const name = path.basename(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  const file = path.join(IMAGE_DIR, name);
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
  const type = Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t] === path.extname(file)) || "application/octet-stream";
  res.setHeader("Content-Type", type);
  fs.createReadStream(file).pipe(res);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    return res.end("Not found");
  }
  res.setHeader("Content-Type", (TYPES[path.extname(file)] || "application/octet-stream") + "; charset=utf-8");
  fs.createReadStream(file).pipe(res);
}

// A readable view of the log at http://localhost:3000/log (newest first)
function serveLogPage(res) {
  if (ON_VERCEL) {
    return sendHtml(res, 200, `<!doctype html><meta charset="utf-8"><title>FridgeFit log</title>
<body style="font:15px system-ui,sans-serif;margin:24px;max-width:640px"><h1>FridgeFit log</h1>
<p>On the hosted version, every AI request is written to the Vercel logs instead of a file. Open your project in the Vercel dashboard and go to the <b>Logs</b> tab. Each entry is one JSON line with the request, the answer, timing and tokens.</p>
<p>Photos aren't saved on the hosted version. Run the app on your laptop to keep them next to the log.</p>`);
  }
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

function needsRealAI(req, res) {
  const s = status(req);
  if (s.mode === "real") return false;
  sendJson(res, s.locked ? 401 : 409, { error: `Real AI is off: ${s.reason}` });
  return true;
}

export async function handler(req, res) {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    const route = `${req.method} ${pathname}`;
    if (route === "GET /api/status") return sendJson(res, 200, status(req));
    if (route === "POST /api/tonight") return needsRealAI(req, res) || (await handleTonight(req, res));
    if (route === "POST /api/photo") return needsRealAI(req, res) || (await handleImageStep(req, res, photoStep));
    if (route === "POST /api/receipt") return needsRealAI(req, res) || (await handleImageStep(req, res, receiptStep));
    if (route === "GET /api/gmail/status") return sendJson(res, 200, gmailStatus(req));
    if (route === "POST /api/gmail/scan") return needsRealAI(req, res) || (await handleGmailScan(req, res));
    if (route === "POST /api/gmail/disconnect") return await disconnectGmail(req, res);
    if (route === "GET /auth/google") return startGmailAuth(req, res);
    if (route === "GET /auth/google/callback") return await finishGmailAuth(req, res);
    if (route === "POST /api/log") {
      const body = await readBody(req);
      writeLog({ type: "ui_event", event: String(body.type || "event").slice(0, 40), message: String(body.message || "").slice(0, 4000) });
      return sendJson(res, 200, { ok: true });
    }
    if (route === "GET /log") return serveLogPage(res);
    if (req.method === "GET" && pathname.startsWith("/log-images/") && !ON_VERCEL) return serveLogImage(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

// Start a local server only when this file is run directly (npm start), not when Vercel imports it
const runDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  http.createServer(handler).listen(PORT, "127.0.0.1", () => {
    const s = status({ headers: { "x-fridgefit-passcode": process.env.APP_PASSCODE || "" } });
    console.log(`FridgeFit is running at http://localhost:${PORT}`);
    console.log(s.mode === "real" ? `AI: real (${s.model})` : `AI: simulated (${s.reason})`);
    console.log(`Gmail: ${gmailConfigured() ? "ready to connect" : "not set up (see README)"}`);
    console.log(`Log: http://localhost:${PORT}/log   (file: logs/ai-log.jsonl)`);
    console.log("Press Ctrl+C to stop.");
  });
}

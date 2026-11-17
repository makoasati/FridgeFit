// FridgeFit local backend: serves the app, keeps the API key on this laptop,
// calls the AI for tonight's recipes, and writes everything to logs/ai-log.jsonl.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { pickTonightRecipes, detectFridgeItems } from "./ai.js";

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
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  return key.length > 0;
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
      type: "ai_error",
      step: "tonight_recipes",
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - started,
      error: message,
      input,
      output: error.result ? { stopReason: error.result.stopReason, content: error.result.content } : null,
    });
    console.error(`AI error: ${message}`);
    sendJson(res, 502, { error: message });
  }
}

// The photo is saved to logs/images so you can see exactly what the AI looked at.
// The log entry points to the file instead of storing the (large) image data.
async function handleFridge(req, res) {
  const config = readConfig();
  const body = await readBody(req, 15_000_000);
  const ext = IMAGE_TYPES[body.mediaType];
  if (!ext || typeof body.data !== "string" || !body.data.length) {
    return sendJson(res, 400, { error: "Send a JPEG, PNG, WebP or GIF photo." });
  }
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const imageFile = `fridge-${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, imageFile), Buffer.from(body.data, "base64"));
  const imageNote = `[photo saved to logs/images/${imageFile}, ${Math.round((body.data.length * 3) / 4 / 1024)} KB]`;
  const withoutImageData = (request) => JSON.parse(JSON.stringify(request, (key, value) => (key === "data" ? imageNote : value)));

  const started = Date.now();
  try {
    const result = await detectFridgeItems({ mediaType: body.mediaType, data: body.data }, config);
    writeLog({
      type: "ai_request",
      step: "fridge_photo",
      provider: config.provider,
      model: result.model,
      latencyMs: Date.now() - started,
      imageFile,
      request: withoutImageData(result.request),
      output: { items: result.items, unclear: result.unclear, photoProblem: result.photoProblem, stopReason: result.stopReason, content: result.content },
      confidence: "per item: high, medium or low (the model's own rating, not a probability)",
      usage: result.usage,
    });
    sendJson(res, 200, { items: result.items, unclear: result.unclear, photoProblem: result.photoProblem, model: result.model });
  } catch (error) {
    const message = explainError(error);
    writeLog({
      type: "ai_error",
      step: "fridge_photo",
      provider: config.provider,
      model: config.photoModel || config.model,
      latencyMs: Date.now() - started,
      imageFile,
      error: message,
      output: error.result ? { stopReason: error.result.stopReason, content: error.result.content } : null,
    });
    console.error(`AI error: ${message}`);
    sendJson(res, 502, { error: message });
  }
}

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
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const items = lines.slice(-300).reverse().map((line) => {
    let e; try { e = JSON.parse(line); } catch { return ""; }
    const title = e.type === "ui_event" ? `${e.event} · ${esc(e.message || "")}` : `${e.type} · ${e.step || ""} · ${e.model || ""}${e.error ? " · " + esc(e.error) : ""}`;
    const photo = e.imageFile ? `<p><img src="/log-images/${encodeURIComponent(e.imageFile)}" style="max-width:320px;border-radius:8px"></p>` : "";
    const body = e.type === "ui_event" ? "" : `${photo}<pre>${esc(JSON.stringify(e, null, 2))}</pre>`;
    return `<details class="${e.type}"><summary><span>${e.time}</span> ${title}</summary>${body}</details>`;
  }).join("");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>FridgeFit log</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;max-width:1100px}summary{cursor:pointer;padding:6px 0}
summary span{color:#777;font-size:12px;margin-right:8px}details{border-bottom:1px solid #eee}
.ai_request summary{color:#1b5e20;font-weight:600}.ai_error summary{color:#b71c1c;font-weight:600}
pre{background:#f6f6f6;padding:12px;overflow:auto;font-size:12px;white-space:pre-wrap}</style>
<h1>FridgeFit log</h1><p>${lines.length} entries, newest first. File: logs/ai-log.jsonl. <a href="/log">Refresh</a></p>${items || "<p>No entries yet.</p>"}`);
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method === "GET" && pathname === "/api/status") return sendJson(res, 200, status());
    if (req.method === "POST" && pathname === "/api/tonight") {
      if (status().mode !== "real") return sendJson(res, 409, { error: `Real AI is off: ${status().reason}` });
      return await handleTonight(req, res);
    }
    if (req.method === "POST" && pathname === "/api/fridge") {
      if (status().mode !== "real") return sendJson(res, 409, { error: `Real AI is off: ${status().reason}` });
      return await handleFridge(req, res);
    }
    if (req.method === "GET" && pathname.startsWith("/log-images/")) return serveLogImage(req, res);
    if (req.method === "POST" && pathname === "/api/log") {
      const body = await readBody(req);
      writeLog({ type: "ui_event", event: String(body.type || "event"), message: String(body.message || "") });
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && pathname === "/log") return serveLogPage(res);
    if (req.method === "GET") return serveStatic(req, res);
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const s = status();
  console.log(`FridgeFit is running at http://localhost:${PORT}`);
  console.log(s.mode === "real" ? `AI: real (${s.model})` : `AI: simulated (${s.reason})`);
  console.log(`Log: http://localhost:${PORT}/log   (file: logs/ai-log.jsonl)`);
  console.log("Press Ctrl+C to stop.");
});

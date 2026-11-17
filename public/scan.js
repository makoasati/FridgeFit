/*
 * FridgeFit: adding groceries with the real AI
 * --------------------------------------------
 * Three ways in, one review screen:
 *   - Snap or upload a receipt  -> /api/receipt  (AI reads every line)
 *   - Snap your fridge or pantry -> /api/photo   (AI lists what it sees, marks what it can't tell with "?")
 *   - Connect Gmail              -> /api/gmail/* (read-only; AI reads grocery receipt and order emails)
 * Anything the AI can't identify becomes a question the user answers by tapping a guess, typing, or speaking.
 * With the real AI off, the old simulated flows run instead.
 */

const GMAIL = { configured: false, connected: false, email: "" };

function refreshGmailStatus() {
  if (!location.protocol.startsWith("http")) return Promise.resolve();
  return fetch("/api/gmail/status").then((r) => r.json()).then((s) => Object.assign(GMAIL, s)).catch(() => {});
}
refreshGmailStatus();

// The Google sign-in window tells us when it's done
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== "gmail-connected") return;
  refreshGmailStatus().then(() => {
    log("Setup", `Connected Gmail (${GMAIL.email})`);
    if (state.screen === "email") render();
  });
});

function newScan(source) {
  return { source, stage: "pick", dataUrl: null, image: null, error: "", receipt: null, emails: null, items: [], questions: [] };
}

const SOURCE_LABEL = { receipt: "receipt", photo: "photo", email: "email" };

/* ---------------------------- entry points ---------------------------- */

function snapReceipt() {
  if (BACKEND.mode !== "real") {
    log("Setup", "Chose: Snap a receipt (sample receipt, simulated)");
    return go("receipt");
  }
  log("Setup", "Chose: Snap or upload a receipt (real AI)");
  state.scan = newScan("receipt");
  go("receiptPhoto");
}

function snapFridge() {
  if (BACKEND.mode !== "real") {
    log("Setup", "Tapped Snap your fridge (optional, simulated)");
    log("AI", SIM.fridgePhotoResult);
    return toast(SIM.fridgePhotoResult);
  }
  log("Setup", "Chose: Snap your fridge or pantry (real AI)");
  state.scan = newScan("photo");
  go("fridgePhoto");
}

function connectEmail() {
  if (BACKEND.mode !== "real") {
    log("Setup", "Tapped Connect email or online grocery orders (simulated)");
    log("AI", SIM.connectEmailResult);
    return toast(SIM.connectEmailResult);
  }
  log("Setup", "Chose: Connect Gmail (real AI)");
  state.scan = newScan("email");
  refreshGmailStatus().then(() => go("email"));
}

/* ------------------------------- photos ------------------------------- */

/* Shrink the photo before sending it: about 1568 px on the long side is what the model works with,
   and it keeps uploads small and requests cheap. */
function resizeImage(file, maxSide = 1568) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a photo the app can open."));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ dataUrl, mediaType: "image/jpeg", data: dataUrl.split(",")[1], width: canvas.width, height: canvas.height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Two buttons: one opens the camera on a phone, the other lets you pick an existing photo
function photoButtons(primary) {
  return `
    <label class="btn ${primary ? "primary" : "ghost"} block photo-pick">📷 Take a photo
      <input type="file" accept="image/*" capture="environment" onchange="pickScanPhoto(this)" hidden>
    </label>
    <label class="btn ghost block photo-pick">🖼 Upload a photo
      <input type="file" accept="image/*" onchange="pickScanPhoto(this)" hidden>
    </label>`;
}

async function pickScanPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const photo = await resizeImage(file);
    Object.assign(state.scan, { stage: "preview", dataUrl: photo.dataUrl, image: { mediaType: photo.mediaType, data: photo.data }, error: "" });
    log("Setup", `Added a ${SOURCE_LABEL[state.scan.source]} photo (${photo.width}×${photo.height}, ${Math.round((photo.data.length * 3) / 4 / 1024)} KB after resizing)`);
  } catch (error) {
    Object.assign(state.scan, { stage: "pick", error: error.message });
  }
  render();
}

function photoScreen({ title, intro, notes, tips, findLabel, readingText, altLink }) {
  const s = state.scan;
  return `
    ${setupProgress(4)}
    <h2>${title}</h2>
    <p class="muted">${intro}</p>
    <div class="expect-card">${notes.map(([icon, head, text]) => `<div class="expect-row"><span class="expect-icon">${icon}</span><div><b>${head}</b><span>${text}</span></div></div>`).join("")}</div>
    <ul class="photo-tips">${tips.map((t) => `<li>${t}</li>`).join("")}</ul>
    ${s.dataUrl ? `<div class="photo-preview ${s.stage === "reading" ? "reading" : ""}"><img src="${s.dataUrl}" alt="Your photo">
      ${s.stage === "reading" ? `<div class="scan-overlay"><div class="spinner"></div>${readingText}</div>` : ""}</div>` : ""}
    ${s.error ? `<div class="notice warn">${escapeHtml(s.error)}</div>` : ""}
    ${s.stage === "pick" ? photoButtons(true) : ""}
    ${s.stage === "preview" ? `<button class="btn primary block" onclick="readScan()">${findLabel}</button>${photoButtons(false)}` : ""}
    ${s.stage !== "reading" ? altLink : ""}`;
}

const backLink = () => state.inventory.length
  ? `<button class="link" onclick="go('perishables')">Back to my perishables</button>`
  : `<button class="link" onclick="go('addGroceries')">Choose another way</button>`;

screens.receiptPhoto = () => photoScreen({
  title: "Snap or upload a receipt",
  intro: "We'll read every line and keep the perishables. If a line is too abbreviated to tell, we'll ask you.",
  notes: [
    ["🧾", "Pantry staples aren't tracked.", "Rice, oil, spices and other shelf-stable food are assumed to be on hand."],
    ["⏳", "Freshness is an estimate.", "We count from the purchase date and show a range, never an exact date."],
  ],
  tips: ["Lay the receipt flat in good light.", "Get the whole receipt in the frame, top to bottom.", "A long receipt is fine as one photo."],
  findLabel: "🔍 Read my receipt",
  readingText: "Reading your receipt…",
  altLink: `${backLink()}<button class="link" onclick="go('receipt')">Try the sample receipt instead</button>`,
});

screens.fridgePhoto = () => photoScreen({
  title: "Snap your fridge or pantry",
  intro: "We'll list the perishables we can see and mark anything we can't tell with a ?, so you can tell us what it is.",
  notes: [
    ["📷", "We only see what's in the photo.", "Food behind other things or in closed drawers won't show up, so add it on the next screen."],
    ["⏳", "Freshness from a photo is a rough guess.", "It's always shown as a range, never an exact date."],
  ],
  tips: ["Open the door wide and use good light.", "Get as many shelves in the frame as you can.", "Labels facing you help."],
  findLabel: "🔍 Find my food",
  readingText: "Looking at your photo…",
  altLink: backLink(),
});

async function readScan() {
  const s = state.scan;
  if (!s.image) return;
  const endpoint = s.source === "receipt" ? "/api/receipt" : "/api/photo";
  Object.assign(s, { stage: "reading", error: "" });
  render();
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s.image) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (s.source === "receipt") {
      if (data.problem && !data.lines.length) throw new Error(`We couldn't read this receipt: ${data.problem}`);
      s.receipt = { store: data.store, date: data.date, lines: data.lines };
      addReceiptLines(s, data.lines, data.store ? `on your ${data.store} receipt` : "on your receipt");
      log("AI", `Receipt (${data.model}): ${data.store || "store unknown"}, ${data.lines.length} lines: ${summarizeLines(data.lines)}`);
    } else {
      if (data.photoProblem && !data.items.length) throw new Error(`We couldn't read this photo: ${data.photoProblem} Try another one with good light.`);
      s.items = data.items;
      s.questions = data.unclear.map((u, n) => newQuestion(`p${n}`, u.description, u.guesses, { x: u.x, y: u.y }));
      log("AI", `Photo (${data.model}): found ${data.items.length} item(s): ${data.items.map((i) => `${i.name} (${i.confidence})`).join(", ") || "none"}; ${data.unclear.length} marked "?": ${data.unclear.map((u) => u.description).join("; ") || "none"}`);
    }
    s.stage = "review";
    go("scanReview");
  } catch (error) {
    log("AI", `${SOURCE_LABEL[s.source]} scan failed: ${error.message}`);
    Object.assign(s, { stage: "preview", error: error.message.startsWith("We couldn't") ? error.message : `The AI didn't answer: ${error.message}` });
    render();
  }
}

function summarizeLines(lines) {
  const count = (k) => lines.filter((l) => l.kind === k).length;
  return `${count("perishable")} perishable, ${count("pantry")} pantry, ${count("nonfood")} not food, ${count("unclear")} unclear`;
}

// Receipt and email lines: perishables become items, unclear lines become questions
function addReceiptLines(s, lines, where) {
  lines.forEach((line) => {
    if (line.kind === "perishable") s.items.push(line);
    if (line.kind === "unclear") s.questions.push(newQuestion(`q${s.questions.length}`, `“${line.raw}” ${where}`, line.guesses, { guess: line }));
  });
}

/* ------------------------------- Gmail ------------------------------- */

screens.email = () => {
  const s = state.scan;
  const g = GMAIL;
  let body;
  if (!g.configured) {
    body = `
      <div class="notice warn">Gmail isn't set up on this laptop yet. It needs a Google sign-in key in the <code>.env</code> file. The README explains how, under "Connect Gmail".</div>
      <button class="btn primary block" onclick="snapReceipt()">🧾 Snap a receipt instead</button>`;
  } else if (!g.connected) {
    body = `
      <div class="expect-card">
        <div class="expect-row"><span class="expect-icon">🔒</span><div><b>Read-only.</b><span>FridgeFit can read your email but can't send, delete or change anything. You can disconnect any time.</span></div></div>
        <div class="expect-row"><span class="expect-icon">🧾</span><div><b>Only grocery receipts and orders.</b><span>We search the last 3 weeks for receipts and orders from grocery stores and delivery apps, and read only those.</span></div></div>
      </div>
      <button class="btn primary block" onclick="connectGmail()">Connect Gmail</button>`;
  } else {
    body = `
      <div class="notice ok">✓ Connected as ${escapeHtml(g.email)}</div>
      ${s.stage === "reading"
        ? `<div class="loading-card"><div class="spinner"></div><span>Looking for grocery receipts and reading them…</span></div>`
        : `<button class="btn primary block" onclick="scanGmail()">🔍 Find my grocery receipts</button>`}
      <button class="link" onclick="disconnectGmail()">Disconnect Gmail</button>`;
  }
  return `
    ${setupProgress(4)}
    <h2>Connect Gmail</h2>
    <p class="muted">We'll find recent grocery receipts and online orders, and add the perishables to your list.</p>
    ${s.error ? `<div class="notice warn">${escapeHtml(s.error)}</div>` : ""}
    ${body}
    ${s.stage !== "reading" ? backLink() : ""}`;
};

function connectGmail() {
  const popup = window.open("/auth/google", "gmail-sign-in", "width=520,height=700");
  if (!popup) toast("Allow pop-ups for this page so the Google sign-in window can open.");
  log("Setup", "Opened Google sign-in for Gmail");
}

async function disconnectGmail() {
  await fetch("/api/gmail/disconnect", { method: "POST" }).catch(() => {});
  await refreshGmailStatus();
  log("Setup", "Disconnected Gmail");
  render();
}

async function scanGmail() {
  const s = state.scan;
  Object.assign(s, { stage: "reading", error: "" });
  render();
  try {
    const res = await fetch("/api/gmail/scan", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const useful = data.emails.filter((e) => e.lines && e.lines.length);
    log("AI", `Gmail: ${data.emails.length} matching email(s), ${useful.length} with grocery items`);
    if (!useful.length) {
      const why = data.emails.length ? "The emails we found didn't list any groceries." : "We didn't find grocery receipts or orders from the last 3 weeks.";
      return Object.assign(s, { stage: "pick", error: `${why} Try a receipt photo instead.` }) && render();
    }
    s.emails = data.emails;
    useful.forEach((e) => addReceiptLines(s, e.lines, `in your ${e.store || "grocery"} email`));
    s.stage = "review";
    go("scanReview");
  } catch (error) {
    log("AI", `Gmail scan failed: ${error.message}`);
    Object.assign(s, { stage: "pick", error: error.message });
    render();
  }
}

/* -------------------------- questions (? items) -------------------------- */

const capitalize = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);

function newQuestion(id, detail, guesses, extra = {}) {
  return { id, detail: capitalize(detail), guesses: (guesses || []).map(capitalize), draft: "", when: "soon", status: "open", answer: "", x: null, y: null, ...extra };
}

const findQuestion = (id) => state.scan && state.scan.questions.find((q) => q.id === id);

function questionCard(q, number) {
  const badge = number ? `<span class="q-badge">? ${number}</span>` : "❓";
  if (q.status === "answered") {
    return `<div class="q-done">${number ? `<span class="q-badge done">✓ ${number}</span>` : "✓"} ${escapeHtml(q.detail)}: <b>${escapeHtml(q.answer)}</b>, ${ADD_WHEN[q.when].label.toLowerCase()} <button class="link" onclick="reopenQuestion('${q.id}')">Change</button></div>`;
  }
  if (q.status === "skipped") {
    return `<div class="q-done muted">${number ? `<span class="q-badge done">${number}</span>` : ""} ${escapeHtml(q.detail)}: skipped <button class="link" onclick="reopenQuestion('${q.id}')">Change</button></div>`;
  }
  return `
    <div class="question-card ask" id="q-${q.id}">
      <div class="q-title">${badge} What is this?</div>
      <p class="q-text">${escapeHtml(q.detail)}</p>
      ${q.guesses.length ? `<div class="chips">${q.guesses.map((g, i) => chip(g, q.draft === g, `pickGuess('${q.id}', ${i})`)).join("")}</div>` : ""}
      <div class="answer-row">
        <input id="qa-${q.id}" value="${escapeHtml(q.draft)}" placeholder="Type or say what it is" oninput="draftAnswer('${q.id}', this.value)">
        <button class="mic ${state.listening === q.id ? "on" : ""}" onclick="listen('${q.id}')" title="Say what it is" aria-label="Say what it is">🎤</button>
      </div>
      ${state.listening === q.id ? `<p class="small-text listening">Listening… say what it is.</p>` : ""}
      <span class="small-text muted">When does it need using?</span>
      <div class="chips">${Object.keys(ADD_WHEN).map((k) => chip(ADD_WHEN[k].label, q.when === k, `pickQuestionWhen('${q.id}', '${k}')`)).join("")}</div>
      <div class="row">
        <button class="btn primary small" onclick="answerQuestion('${q.id}')">Save</button>
        <button class="btn ghost small" onclick="skipQuestion('${q.id}')">Not food / skip</button>
      </div>
    </div>`;
}

function draftAnswer(id, value) {
  const q = findQuestion(id);
  if (q) q.draft = value;
}

function pickGuess(id, index) {
  const q = findQuestion(id);
  q.draft = q.guesses[index];
  render();
}

function pickQuestionWhen(id, when) {
  const q = findQuestion(id);
  q.when = when;
  render();
}

function answerQuestion(id) {
  const q = findQuestion(id);
  const input = document.getElementById(`qa-${id}`);
  const answer = ((input && input.value) || q.draft).trim();
  if (!answer) return toast("Tap a guess, type it, or tap 🎤 and say it.");
  Object.assign(q, { status: "answered", answer: capitalize(answer), draft: answer });
  log("Feedback", `Answered "${q.detail}": ${answer} (needs using ${ADD_WHEN[q.when].label.toLowerCase()})`);
  render();
}

function skipQuestion(id) {
  const q = findQuestion(id);
  q.status = "skipped";
  log("Feedback", `Skipped "${q.detail}" (not food, or not sure)`);
  render();
}

function reopenQuestion(id) {
  findQuestion(id).status = "open";
  render();
}

function focusQuestion(id) {
  const el = document.getElementById(`q-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = document.getElementById(`qa-${id}`);
  if (input) setTimeout(() => input.focus(), 300);
}

/* Voice answers use the browser's built-in speech recognition (Chrome, Edge and Safari) */
let recognizer = null;
function listen(id) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return toast("This browser can't do voice input. Try Chrome, Edge or Safari, or type it.");
  if (recognizer) { recognizer.stop(); return; }
  const q = findQuestion(id);
  const input = document.getElementById(`qa-${id}`);
  if (input) q.draft = input.value;
  recognizer = new Recognition();
  recognizer.lang = navigator.language || "en-US";
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;
  recognizer.onresult = (e) => {
    const text = e.results[0][0].transcript.trim();
    q.draft = text.charAt(0).toUpperCase() + text.slice(1);
    log("Feedback", `Voice answer for "${q.detail}": "${text}"`);
  };
  recognizer.onerror = (e) => {
    toast(e.error === "not-allowed" || e.error === "service-not-allowed"
      ? "Allow microphone access to answer by voice."
      : "Didn't catch that. Try again, or type it.");
  };
  recognizer.onend = () => { recognizer = null; state.listening = null; render(); };
  state.listening = id;
  render();
  recognizer.start();
}

/* ------------------------------ review screen ------------------------------ */

function photoWithMarkers(s) {
  const marked = s.questions.filter((q) => q.x !== null);
  const pins = marked.map((q, i) => `
    <button class="q-marker ${q.status !== "open" ? "done" : ""}" style="left:${q.x}%;top:${q.y}%" onclick="focusQuestion('${q.id}')" aria-label="Question ${i + 1}">
      ${q.status === "answered" ? "✓" : "?"}<small>${i + 1}</small>
    </button>`).join("");
  return `<div class="photo-preview marked"><img src="${s.dataUrl}" alt="Your photo">${pins}</div>`;
}

function receiptView(r) {
  const note = (l) => ({
    perishable: `<span class="rnote ok">✓ ${escapeHtml(l.name)}</span>`,
    pantry: `<span class="rnote pantry">Pantry, not tracked</span>`,
    nonfood: `<span class="rnote pantry">Not food</span>`,
    unclear: `<span class="rnote unclear">? Asking you below</span>`,
  }[l.kind] || "");
  return `
    <div class="receipt">
      <div class="receipt-head"><b>${escapeHtml(r.store || "Receipt")}</b><span>${escapeHtml(r.date || "")}</span></div>
      ${r.lines.map((l) => `<div class="rline ${l.kind === "unclear" ? "flag" : ""}"><span>${escapeHtml(l.raw)}</span>${note(l)}</div>`).join("")}
    </div>`;
}

function emailView(emails) {
  return emails.map((e) => {
    const perishable = (e.lines || []).filter((l) => l.kind === "perishable").length;
    const unclear = (e.lines || []).filter((l) => l.kind === "unclear").length;
    const status = e.error ? `Couldn't read it: ${escapeHtml(e.error)}`
      : !(e.lines || []).length ? "No groceries in this one"
      : `${perishable} perishable${perishable === 1 ? "" : "s"}${unclear ? `, ${unclear} to check` : ""}`;
    return `<div class="email-row"><b>${escapeHtml(e.store || e.from.replace(/<.*>/, "").trim() || "Email")}</b>
      <small>${escapeHtml(e.subject)} · ${escapeHtml(e.purchaseDate || e.date.slice(0, 16))}</small><span>${status}</span></div>`;
  }).join("");
}

screens.scanReview = () => {
  const s = state.scan;
  const marked = s.questions.filter((q) => q.x !== null);
  const open = s.questions.filter((q) => q.status === "open").length;
  const top = s.source === "photo" ? photoWithMarkers(s) : s.source === "receipt" ? receiptView(s.receipt) : emailView(s.emails);
  const askLine = !s.questions.length ? ""
    : open ? ` ${open} thing${open === 1 ? "" : "s"} we couldn't identify ${open === 1 ? "is" : "are"} ${s.source === "photo" ? "marked ? on the photo" : "listed below"}. Tell us what ${open === 1 ? "it is" : "they are"}, or skip.`
    : " Thanks, that's everything we asked about.";
  return `
    ${setupProgress(4)}
    <h2>Here's what we found</h2>
    <p class="muted">${s.items.length} perishable${s.items.length === 1 ? "" : "s"} from your ${SOURCE_LABEL[s.source]}.${askLine}</p>
    ${top}
    ${s.items.length ? `<div class="found-list">${s.items.map((i) => `<span class="found-chip">${escapeHtml(i.name)}${i.confidence !== "high" ? ` <small>${i.confidence} confidence</small>` : ""}</span>`).join("")}</div>` : ""}
    ${s.questions.map((q) => questionCard(q, marked.indexOf(q) + 1)).join("")}
    <button class="btn primary block" onclick="commitScan()">Continue to my perishables</button>
    <button class="link" onclick="${s.source === "receipt" ? "snapReceipt()" : s.source === "photo" ? "snapFridge()" : "connectEmail()"}">Start this one again</button>`;
};

/* Turn what the AI found into inventory items. Items that match a food the recipes know
   (spinach, tomatoes, chicken, feta, yogurt, eggs) get that id, so recipes can use them. */
function scanItemsToInventory(items, source) {
  const icons = { Produce: "🥬", Meat: "🍗", Dairy: "🧀", Other: "🍱" };
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const used = new Set();
  return items.map((it, n) => {
    const known = it.matchesKnownItem && it.matchesKnownItem !== "none" ? SIM.perishables.find((p) => p.id === it.matchesKnownItem) : null;
    let id = known ? known.id : `item-${slug(it.name) || "food"}`;
    if (used.has(id)) id = `${id}-${n}`;
    used.add(id);
    const category = ["Produce", "Meat", "Dairy"].includes(it.category) ? it.category : "Other";
    const conf = String(it.confidence || "medium");
    return {
      id,
      name: it.name,
      emoji: known ? known.emoji : icons[category],
      qty: it.amount || "some",
      category,
      freshness: it.freshness || "Estimated freshness unknown",
      urgency: ["urgent", "soon", "week", "long"].includes(it.urgency) ? it.urgency : "week",
      confidence: `${conf.charAt(0).toUpperCase() + conf.slice(1)} confidence (from ${SOURCE_LABEL[source]})`,
      highRisk: known ? known.highRisk : category === "Meat" || category === "Dairy",
      status: "detected",
      source,
    };
  });
}

/* Add new items to the list. If an item is already there, keep what's there and count it. */
function mergeInventory(found) {
  let added = 0;
  let already = 0;
  for (const item of found) {
    const existing = state.inventory.find((i) => i.id === item.id || i.name.toLowerCase() === item.name.toLowerCase());
    if (existing) {
      if (existing.status === "detected" && existing.source !== item.source) existing.confidence = `Found in more than one place`;
      already++;
    } else {
      state.inventory.push(item);
      added++;
    }
  }
  return { added, already };
}

function commitScan() {
  const s = state.scan;
  const found = scanItemsToInventory(s.items, s.source);
  const answered = s.questions.filter((q) => q.status === "answered")
    .map((q) => makeUserItem(q.answer, (q.guess && q.guess.amount) || "some", q.when, "You told us what this is"));
  const { added, already } = mergeInventory([...found, ...answered]);
  const unanswered = s.questions.filter((q) => q.status === "open").length;
  log("Inventory", `Saved ${SOURCE_LABEL[s.source]} scan: ${added} added, ${already} already on the list, ${answered.length} from your answers${unanswered ? `, ${unanswered} question(s) left unanswered` : ""}`);
  state.scanSummary = { source: s.source, found: s.items.length, added, already, answered: answered.length, unanswered };
  state.scan = newScan(null);
  go("perishables");
}

/* Shown at the top of the perishables screen after a scan */
function photoSummary() {
  const s = state.scanSummary;
  if (!s) return "";
  const icon = { receipt: "🧾", photo: "📷", email: "📧" }[s.source];
  const parts = [`Your ${SOURCE_LABEL[s.source]} had ${s.found} perishable${s.found === 1 ? "" : "s"}`];
  if (s.answered) parts.push(`plus ${s.answered} you told us about`);
  const tail = [s.added && `${s.added} added below`, s.already && `${s.already} already on your list`].filter(Boolean).join(", ");
  const left = s.unanswered ? ` ${s.unanswered} question${s.unanswered === 1 ? " was" : "s were"} skipped. Use “Add an item” if you remember what ${s.unanswered === 1 ? "it was" : "they were"}.` : "";
  return `<div class="notice">${icon} ${parts.join(", ")}${tail ? `: ${tail}` : ""}.${left}</div>`;
}

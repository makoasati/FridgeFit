/*
 * FridgeFit prototype — app logic
 * --------------------------------
 * Sections:
 *   1. State          – everything the prototype remembers while it is open
 *   2. On-screen log  – records every action and piece of feedback
 *   3. AI             – the ONLY code that reads simulated_responses.js
 *   4. Helpers        – small shared functions
 *   5. Screens        – one function per screen, each returns HTML
 *   6. Actions        – what happens when buttons are tapped
 *   7. Render         – draws the current screen
 *
 * Nothing is saved: refreshing the page starts over.
 */

/* =========================== 1. STATE =========================== */
const state = {
  screen: "welcome",
  prefs: { cuisines: [], dislikes: [], allergies: [], skill: null, time: null, budget: null },
  tasteAnswers: {},          // example recipe id -> "yes" | "no"
  quizError: false,
  receiptStage: "preview",   // preview → scanning → scanned
  unclearAnswer: null,       // null | "yes" | "no" | chosen alternative
  inventory: [],             // perishables (produce, meat, dairy) only
  editingItem: null,         // id of the perishable being corrected

  // Step 2–4: home screen
  home: {
    list: [],                // [{ recipeId, reason }] — the cards currently shown
    mode: "tonight",         // "tonight" | "search" | "similar"
    title: "Suggested recipes tonight",
    subtitle: "",
    query: "",
    chip: null,
    highlight: null,         // recipe id to mark "Updated for you" after feedback / save
  },
  tonight: null,             // tonight's suggestions; kept so feedback changes stick
  saved: [],                 // recipe ids saved for later
  rejected: [],              // recipe ids the user gave feedback on (not shown again)
  recipeMods: {},            // recipeId -> { ingredientKey: { status: "missing" | "swapped", sub } }
  currentRecipe: null,       // recipe id open on the review screen
  freshnessAnswers: {},      // inventory id -> "yes" | "no" (freshness check before cooking)
  review: { swapFor: null, swapTitle: "", pickDislike: false, notice: "" },

  // Step 5–6: cooking and wrap-up
  cook: null,                // { recipeId, step, issueOpen, issueKey, notice, wentBad: [], usedBeforeBad: [], photo, saved, process: [], comment }
  cookbook: [],              // meals saved: { recipeId, name, swaps, photo }

  // Step 7–8: next-day follow-up and progress
  follow: null,              // { taste, recipe: [], ingredients: {id: answer}, still: {id: answer}, comment }
  progress: null,            // numbers shown on the progress screen
  stats: null,               // running totals: starts from the simulated past week, grows with every meal
};

/* Local backend (server.js). When the app is opened through it, tonight's recipes come from a
   real AI model and every log entry is also saved to logs/ai-log.jsonl. Opened as a plain file,
   everything stays simulated. */
const BACKEND = { available: false, mode: "simulated", model: null, reason: "" };
if (location.protocol.startsWith("http")) {
  fetch("/api/status")
    .then((r) => r.json())
    .then((s) => {
      Object.assign(BACKEND, { available: true, mode: s.mode, model: s.model, reason: s.reason || "" });
      log("AI", s.mode === "real" ? `Real AI is on for tonight's recipes (${s.model})` : `Simulated AI (${s.reason})`);
    })
    .catch(() => {});
}

/* ======================== 2. ON-SCREEN LOG ======================== */
const logEntries = [];

/* type: Setup, Inventory, AI, Recipe, Feedback, Cooking, Follow-up, Progress */
function log(type, message) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  logEntries.push({ type, message, time });
  renderLog();
  if (BACKEND.available) {
    fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, message }) }).catch(() => {});
  }
}

function renderLog() {
  document.getElementById("logCount").textContent = logEntries.length;
  const list = document.getElementById("logList");
  if (!logEntries.length) {
    list.innerHTML = `<li class="log-empty">Nothing yet. Tap through the app and each action shows up here.</li>`;
    return;
  }
  list.innerHTML = logEntries
    .map((e, i) => `
      <li class="log-item">
        <div class="log-meta"><span class="log-num">#${i + 1}</span>
          <span class="log-type type-${e.type.toLowerCase().replace(/[^a-z]/g, "")}">${e.type}</span>
          <span class="log-time">${e.time}</span></div>
        <div class="log-msg">${escapeHtml(e.message)}</div>
      </li>`)
    .reverse()   // newest on top
    .join("");
}

function toggleLog() {
  document.body.classList.toggle("log-hidden");
}

/* ============================= 3. AI ============================= */
/* Simulated AI. Each function returns predefined data from SIM.
   To connect a real model, change the body of one function here. */
const AI = {
  readReceipt() {
    return SIM.receipt;
  },
  unclearLineQuestion() {
    return SIM.unclearQuestion;
  },
  findPerishables() {
    // Copy so edits in the app don't change the original data
    return SIM.perishables.map((p) => ({ ...p, status: "detected" }));
  },

  recipe(id) {
    return SIM.recipes[id];
  },

  /* Recipes never include the user's allergens (or disliked ingredients) */
  isAllowed(recipe) {
    const allergens = recipeAllergens(recipe);
    if (allergens.some((a) => state.prefs.allergies.includes(a))) return false;
    if ((recipe.dislikeTags || []).some((d) => state.prefs.dislikes.includes(d))) return false;
    return true;
  },

  /* Simple ranking rule: favor recipes that use items expiring soonest, then predicted rating */
  rank(ids) {
    const urgencyScore = { urgent: 3, soon: 2, week: 1, long: 0 };
    const p = state.prefs;
    const score = (id) => {
      const r = SIM.recipes[id];
      const uses = r.ingredients.map((i) => inventoryItem(i.invId)).filter(Boolean);
      let s = uses.reduce((sum, item) => sum + urgencyScore[item.urgency], 0) + r.predictedRating;
      if (p.cuisines.includes(r.cuisine)) s += 1.5;                       // cuisines they like
      SIM.exampleRecipes.filter((e) => e.cuisine === r.cuisine).forEach((e) => {
        if (state.tasteAnswers[e.id] === "yes") s += 0.5;                 // Yes / No on example recipes
        if (state.tasteAnswers[e.id] === "no") s -= 0.5;
      });
      if (r.minutes > minutesTonight()) s -= 3;                           // time available
      if (p.skill === "Beginner") s += { Easy: 0.5, Medium: 0, Hard: -1 }[r.difficulty] || 0;
      s -= 2 * unavailableCount(id);                                      // needs things they don't have
      return s;
    };
    return [...ids].sort((a, b) => score(b) - score(a));
  },

  /* Tonight's 3 suggestions: the predefined picks, topped up from the ranked pool if any are filtered out */
  tonight() {
    const usable = (id) => AI.isAllowed(SIM.recipes[id]) && !state.saved.includes(id) &&
      !state.rejected.includes(id) && !usesUnavailable(id);
    const p = state.prefs;
    // The spec's example profile (likes Mediterranean or no cuisine picked, 30+ min) gets the spec's 3 picks.
    const exampleProfile = (!p.cuisines.length || p.cuisines.includes("Mediterranean")) && minutesTonight() >= 25;
    let ids = exampleProfile ? SIM.homeDefault.filter(usable) : [];
    const extra = AI.rank(Object.keys(SIM.recipes).filter((id) => usable(id) && !ids.includes(id)));
    ids = ids.concat(extra).slice(0, 3);
    if (ids.length < 3) {   // not enough recipes you fully have: fill with the closest matches
      const closest = AI.rank(Object.keys(SIM.recipes).filter((id) => AI.isAllowed(SIM.recipes[id]) &&
        !state.saved.includes(id) && !state.rejected.includes(id) && !ids.includes(id)));
      ids = ids.concat(closest).slice(0, 3);
    }
    return ids.map((id) => {
      const r = SIM.recipes[id];
      const liked = !exampleProfile && p.cuisines.includes(r.cuisine);
      return { recipeId: id, reason: liked ? `Because you liked ${r.cuisine} dishes. ${r.reason}` : r.reason };
    });
  },

  /* Search text and/or a filter chip → 3–5 matches, still ranked by what's expiring */
  search(query, chip) {
    const q = query.trim().toLowerCase();
    const matches = Object.keys(SIM.recipes).filter((id) => {
      const r = SIM.recipes[id];
      if (!AI.isAllowed(r) || state.rejected.includes(id)) return false;
      if (chip && !r.tags.includes(chip)) return false;
      if (q) {
        const text = [r.name, r.cuisine, ...r.tags, ...r.ingredients.map((i) => i.name)].join(" ").toLowerCase();
        if (!q.split(/\s+/).every((word) => text.includes(word))) return false;
      }
      return true;
    });
    return AI.rank(matches).slice(0, 5).map((id) => ({ recipeId: id, reason: SIM.recipes[id].reason }));
  },

  /* Substitutes for an ingredient. Options with the user's allergens are never offered. */
  swapOptions(ingKey) {
    const all = SIM.swaps[ingKey] || [{ name: "Leave it out", invId: null, allergens: [], note: "Skip it" }];
    const blocked = (o) => (o.allergens || []).some((a) => state.prefs.allergies.includes(a)) ||
      state.prefs.dislikes.some((d) => o.name.toLowerCase().includes(d.toLowerCase()));
    return { allowed: all.filter((o) => !blocked(o)), hidden: all.filter(blocked) };
  },

  /* Higher-risk item (meat, fish, dairy, leftovers) near its estimate → ask a freshness check */
  freshnessCheckFor(recipeId) {
    const ing = currentIngredients(recipeId).find((i) => {
      const item = inventoryItem(i.invId);
      return item && item.highRisk && ["urgent", "soon"].includes(item.urgency) && SIM.freshnessCheck[i.invId];
    });
    return ing ? { invId: ing.invId, ...SIM.freshnessCheck[ing.invId] } : null;
  },

  /* Feedback → a replacement recipe that addresses the reason.
     Uses the predefined answer when there is one, otherwise a simple rule. */
  replacementFor(prompt, recipeId, ingKey) {
    const r = SIM.recipes[recipeId];
    const onScreen = state.home.list.concat(state.tonight || []).map((e) => e.recipeId);
    const ok = (id) => id !== recipeId && SIM.recipes[id] && AI.isAllowed(SIM.recipes[id]) &&
      !onScreen.includes(id) && !state.saved.includes(id) && !state.rejected.includes(id) &&
      !usesUnavailable(id);                                   // never suggest spoiled / missing food
    const disliked = SIM.recipes[recipeId].ingredients.find((i) => i.key === ingKey);
    const level = { Easy: 0, Medium: 1, Hard: 2 };
    // What "addresses the reason" means for each prompt
    const fixes = {
      "Too hard": (x) => x.stepCount < r.stepCount || level[x.difficulty] < level[r.difficulty],
      "Too long": (x) => x.minutes < r.minutes,
      "Not in the mood": (x) => x.cuisine !== r.cuisine,
      "Don't like an ingredient": (x) => !x.ingredients.some((i) => i.key === ingKey || (disliked && disliked.invId && i.invId === disliked.invId)),
    }[prompt];

    const table = SIM.feedbackReplacements[prompt] || {};
    const preset = table[prompt === "Don't like an ingredient" ? ingKey : recipeId];
    if (preset && ok(preset.recipeId) && fixes(SIM.recipes[preset.recipeId])) return preset;

    const pool = AI.rank(Object.keys(SIM.recipes).filter(ok));
    let id = pool.find((x) => fixes(SIM.recipes[x]));
    const x = id && SIM.recipes[id];
    if (id) {
      const reason = {
        "Too hard": `Easier: ${x.stepCount} steps, ${x.minutes} minutes`,
        "Too long": `Quicker: ${x.minutes} minutes`,
        "Not in the mood": `Something different: ${x.cuisine}. ${x.reason}`,
        "Don't like an ingredient": `No ${disliked ? disliked.name.toLowerCase() : ingKey}: ${lowerFirst(x.reason)}`,
      }[prompt];
      return { recipeId: id, reason };
    }
    // Nothing truly addresses it: say so honestly instead of pretending
    if (prompt === "Too hard" || prompt === "Too long") {
      const by = prompt === "Too hard" ? "stepCount" : "minutes";
      id = [...pool].sort((a, b) => SIM.recipes[a][by] - SIM.recipes[b][by])[0];
      if (id) return { recipeId: id, reason: prompt === "Too hard"
        ? `Simplest option left: ${SIM.recipes[id].stepCount} steps` : `Quickest option left: ${SIM.recipes[id].minutes} minutes` };
    }
    return pool[0] ? { recipeId: pool[0], reason: SIM.recipes[pool[0]].reason } : null;
  },

  /* "Show similar" → 3–5 similar recipes */
  similarTo(recipeId) {
    const r = SIM.recipes[recipeId];
    const allowed = (id) => id !== recipeId && SIM.recipes[id] && AI.isAllowed(SIM.recipes[id]) &&
      !state.rejected.includes(id) && !state.saved.includes(id);
    // Prefer recipes that don't need spoiled / missing food; fall back only if too few
    const fresh = Object.keys(SIM.recipes).filter((id) => allowed(id) && !usesUnavailable(id));
    const ok = fresh.length >= 3 ? (id) => fresh.includes(id) : allowed;
    let ids = (SIM.similarRecipes[recipeId] || []).filter(ok);
    if (ids.length < 3) {   // top up with the same cuisine, then anything ranked
      const ranked = AI.rank(Object.keys(SIM.recipes).filter((id) => ok(id) && !ids.includes(id)));
      ids = ids.concat(ranked.filter((id) => SIM.recipes[id].cuisine === r.cuisine), ranked.filter((id) => SIM.recipes[id].cuisine !== r.cuisine));
    }
    const prefix = SIM.similarReason[recipeId] || `Similar to ${r.name}`;
    return ids.slice(0, 5).map((id) => ({ recipeId: id, reason: `${prefix}. ${SIM.recipes[id].reason}` }));
  },

  /* Next recipe to fill an empty spot (used after "Save for later") */
  nextRecipe() {
    const onScreen = state.home.list.concat(state.tonight || []).map((e) => e.recipeId);
    const pool = Object.keys(SIM.recipes).filter((id) =>
      AI.isAllowed(SIM.recipes[id]) && !onScreen.includes(id) && !state.saved.includes(id) &&
      !state.rejected.includes(id) && !usesUnavailable(id));
    const id = AI.rank(pool)[0];
    return id ? { recipeId: id, reason: "New pick: " + lowerFirst(SIM.recipes[id].reason) } : null;
  },
};

/* =========================== 4. HELPERS =========================== */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function go(screen) {
  state.screen = screen;
  document.getElementById("toast").classList.remove("show");
  render({ scrollTop: true });
}

let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function chip(label, selected, onclick, extraClass = "") {
  return `<button class="chip ${selected ? "selected" : ""} ${extraClass}" onclick="${onclick}">${selected ? "✓ " : ""}${escapeHtml(label)}</button>`;
}

function expectationCard(which) {
  const rows = {
    learn: `<div class="expect-row"><span class="expect-icon">📈</span><div><b>Suggestions get better the more you cook.</b><span>Day one is a starting point. FridgeFit learns from what you cook, skip, and enjoy.</span></div></div>`,
    estimate: `<div class="expect-row"><span class="expect-icon">🧾</span><div><b>Your inventory is our best estimate. You'll confirm ingredients before cooking.</b><span>Freshness is always an estimated range, never an exact date.</span></div></div>`,
  };
  const list = which === "both" ? ["learn", "estimate"] : [which];
  return `<div class="expect-card">${list.map((k) => rows[k]).join("")}</div>`;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/* Until the user has rated a meal, the rating is a rough early guess (rounded to half a star),
   so the app doesn't sound more certain on day one than it is. */
function ratingLine(r) {
  if (!state.progress) {
    return `⭐ Early guess: <b>about ${(Math.round(r.predictedRating * 2) / 2).toFixed(1)} / 5</b>`;
  }
  return `⭐ Predicted for you: <b>${r.predictedRating.toFixed(1)} / 5</b>`;
}

/* The inventory item for an id, if it's still usable (not spoiled or missing) */
function inventoryItem(invId) {
  if (!invId) return null;
  const item = state.inventory.find((i) => i.id === invId);
  return item && !["spoiled", "missing", "used"].includes(item.status) ? item : null;
}

/* Ingredients for a recipe after the user's swaps / missing marks */
function currentIngredients(recipeId) {
  const mods = state.recipeMods[recipeId] || {};
  return SIM.recipes[recipeId].ingredients.map((ing) => {
    const mod = mods[ing.key];
    if (mod && mod.status === "swapped") {
      return { ...ing, name: mod.sub.name, invId: mod.sub.invId, pantry: !!mod.sub.pantry, allergens: mod.sub.allergens || [], swappedFrom: ing.name, leftOut: mod.sub.leftOut };
    }
    return { ...ing, markedMissing: mod && mod.status === "missing" };
  });
}

/* Tonight's time: the spec's 25 minutes, or less if they said they only have 15 on weeknights */
function minutesTonight() {
  return state.prefs.time === "15 min" ? 15 : SIM.context.minutesTonight;
}

/* Main ingredients a recipe needs that the user marked spoiled, missing, or removed */
function unavailableCount(recipeId) {
  return SIM.recipes[recipeId].ingredients.filter((i) =>
    !i.pantry && !i.optional && SIM.perishables.some((p) => p.id === i.invId) && !inventoryItem(i.invId)).length;
}
function usesUnavailable(recipeId) {
  return unavailableCount(recipeId) > 0;
}

/* Reason lines come from the simulated AI. If one mentions food that's now spoiled, missing,
   or removed, rewrite it from what the recipe still uses, so it never says something untrue. */
const REASON_WORDS = { spinach: "spinach", tomatoes: "tomato", chicken: "chicken", feta: "feta", yogurt: "yogurt", eggs: "egg" };
function displayReason(entry) {
  const text = entry.reason;
  const stale = Object.keys(REASON_WORDS).some((id) => text.toLowerCase().includes(REASON_WORDS[id]) && !inventoryItem(id));
  if (!stale) return text;
  const prefix = /^(Easier|Quicker|Something different|New pick|Similar to[^:]*|No [^:]*):/.exec(text);
  const uses = currentIngredients(entry.recipeId).map((i) => inventoryItem(i.invId)).filter(Boolean);
  const order = { urgent: 0, soon: 1, week: 2, long: 3 };
  uses.sort((a, b) => order[a.urgency] - order[b.urgency]);
  const names = [...new Set(uses.map((u) => u.name.toLowerCase() + (["urgent", "soon"].includes(u.urgency) ? " expiring soon" : "")))].slice(0, 2);
  const body = names.length ? `Uses the ${names.join(" and the ")}` : `Fits your ${minutesTonight()}-minute evening`;
  return prefix ? `${prefix[0]} ${lowerFirst(body)}` : body;
}

function recipeAllergens(recipe) {
  return [...new Set(recipe.ingredients.flatMap((i) => i.allergens || []))];
}

/* Simple rule for grocery match %: share of main ingredients you have, minus 10 per missing optional one.
   Pantry staples always count as on hand; ingredients left out don't count. */
function matchPercent(recipeId) {
  const ings = currentIngredients(recipeId).filter((i) => !i.pantry && !i.leftOut);
  const required = ings.filter((i) => !i.optional);
  const have = (i) => !i.markedMissing && inventoryItem(i.invId);
  const base = required.length ? (100 * required.filter(have).length) / required.length : 100;
  const optionalMissing = ings.filter((i) => i.optional && !have(i)).length;
  return Math.max(0, Math.round(base - 10 * optionalMissing));
}

function expiringNames() {
  return state.inventory.filter((i) => inventoryItem(i.id) && ["urgent", "soon"].includes(i.urgency)).map((i) => i.name.toLowerCase());
}

/* Replace the home list and log every recipe shown, with its context */
function showRecipes(list, { mode, title, subtitle, why }) {
  Object.assign(state.home, { list, mode, title, subtitle, highlight: null });
  const ctx = `${SIM.context.day}, ${minutesTonight()} min tonight, expiring soon: ${expiringNames().join(", ") || "none"}`;
  const cards = list.map((e) => {
    const r = SIM.recipes[e.recipeId];
    return `${r.name} (${matchPercent(e.recipeId)}% match, ${r.minutes} min, predicted ${r.predictedRating}; reason: “${displayReason(e)}”)`;
  });
  log("AI", `${why}: showed ${list.length} recipes [context: ${ctx}]\n${cards.map((c, i) => `${i + 1}. ${c}`).join("\n")}`);
}

function setupProgress(step) {
  const total = 5;
  return `<div class="setup-progress"><span>Setup · step ${step} of ${total}</span>
    <div class="bar"><div style="width:${(step / total) * 100}%"></div></div></div>`;
}

/* =========================== 5. SCREENS =========================== */
const screens = {};

/* ---- Step 1a: Welcome + honest expectations ---- */
screens.welcome = () => `
  <div class="welcome">
    <div class="welcome-art">🥬🍅🍗</div>
    <h1>Welcome to FridgeFit</h1>
    <p class="lead">Recipes you'll actually want to make from what you already have, starting with what's about to go bad.</p>
    <h3 class="section-label">Before we start</h3>
    ${expectationCard("both")}
    <p class="muted center">Setup takes about 2 minutes and only happens once.</p>
    <button class="btn primary block" onclick="startSetup()">Get started</button>
  </div>`;

/* ---- Step 1b: Preferences quiz (allergies required) ---- */
screens.quizPrefs = () => {
  const p = state.prefs;
  const q = SIM.quiz;
  const multi = (field, options) =>
    options.map((o) => chip(o, p[field].includes(o), `toggleMulti('${field}', '${o}')`)).join("");
  const single = (field, options) =>
    options.map((o) => chip(o, p[field] === o, `pickSingle('${field}', '${o}')`)).join("");
  return `
    ${setupProgress(1)}
    <h2>Tell us your preferences</h2>
    <p class="muted">Tap all that apply. You can change these later.</p>

    <div class="quiz-block"><h4>🍽️ Cuisines you like</h4><div class="chips">${multi("cuisines", q.cuisines)}</div></div>
    <div class="quiz-block"><h4>🙅 Dislikes</h4><div class="chips">${multi("dislikes", q.dislikes)}</div></div>
    <div class="quiz-block allergy ${state.quizError ? "error" : ""}" id="allergyBlock">
      <h4>⚠️ Allergies <span class="required">Required</span></h4>
      <p class="hint">Recipes, swaps, and substitutions will never include these.</p>
      <div class="chips">${multi("allergies", q.allergies)}</div>
      ${state.quizError ? `<p class="error-text">Please choose your allergies, or “No allergies”, to continue.</p>` : ""}
    </div>
    <div class="quiz-block"><h4>👩‍🍳 Cooking skill</h4><div class="chips">${single("skill", q.skills)}</div></div>
    <div class="quiz-block"><h4>⏱️ Time on weeknights</h4><div class="chips">${single("time", q.times)}</div></div>
    <div class="quiz-block"><h4>💵 Weekly food budget</h4><div class="chips">${single("budget", q.budgets)}</div></div>

    <button class="btn primary block" onclick="finishPrefs()">Continue</button>`;
};

/* ---- Step 1c: Yes / No on 8 example recipes ---- */
screens.quizTaste = () => {
  const answered = Object.keys(state.tasteAnswers).length;
  const tiles = SIM.exampleRecipes.map((r) => {
    const a = state.tasteAnswers[r.id];
    return `
      <div class="taste-tile ${a ? "answered-" + a : ""}">
        <div class="taste-emoji" style="background:${r.bg}">${r.emoji}</div>
        <div class="taste-name">${escapeHtml(r.name)}</div>
        <div class="taste-cuisine">${r.cuisine}</div>
        <div class="taste-buttons">
          <button class="yn yes ${a === "yes" ? "on" : ""}" onclick="answerTaste('${r.id}','yes')">Yes</button>
          <button class="yn no ${a === "no" ? "on" : ""}" onclick="answerTaste('${r.id}','no')">No</button>
        </div>
      </div>`;
  }).join("");
  return `
    ${setupProgress(2)}
    <h2>Would you make these?</h2>
    <p class="muted">Tap Yes or No so day-one suggestions fit your taste.</p>
    ${expectationCard("learn")}
    <div class="taste-grid">${tiles}</div>
    <p class="muted center">${answered} of ${SIM.exampleRecipes.length} answered</p>
    <button class="btn primary block" onclick="finishTaste()">Continue</button>`;
};

/* ---- Step 1d: Add groceries (receipt first, fridge photo optional) ---- */
screens.addGroceries = () => `
  ${setupProgress(3)}
  <h2>Add your groceries</h2>
  <p class="muted">We track perishables only (produce, meat, dairy). ${SIM.pantryNote}</p>
  <button class="option-card recommended" onclick="go('receipt'); log('Setup', 'Chose: Snap a receipt')">
    <span class="option-icon">🧾</span>
    <span><b>Snap a receipt</b><small>Fastest way to start. Uses a sample receipt in this prototype.</small></span>
    <span class="badge">Recommended</span>
  </button>
  <button class="option-card" onclick="connectEmail()">
    <span class="option-icon">📧</span>
    <span><b>Connect email or online grocery orders</b><small>Simulated: no real account is connected.</small></span>
  </button>
  <button class="option-card optional" onclick="snapFridge()">
    <span class="option-icon">📷</span>
    <span><b>Snap your fridge</b><small>Optional extra, not required.</small></span>
    <span class="badge light">Optional</span>
  </button>
  ${expectationCard("estimate")}`;

/* ---- Step 1e: Sample receipt → AI reads it → unclear line question ---- */
screens.receipt = () => {
  const r = AI.readReceipt();
  const scanned = state.receiptStage === "scanned";
  const lines = r.lines.map((l) => {
    let note = "";
    if (scanned) {
      if (l.kind === "perishable") note = `<span class="rnote ok">✓ Perishable</span>`;
      if (l.kind === "pantry") note = `<span class="rnote pantry">Pantry staple, assumed on hand</span>`;
      if (l.kind === "unclear") {
        note = state.unclearAnswer && state.unclearAnswer !== "no"
          ? `<span class="rnote ok">✓ ${state.unclearAnswer === "yes" ? "Confirmed" : "Corrected"} by you</span>`
          : `<span class="rnote unclear">? Unclear</span>`;
      }
    }
    return `<div class="rline ${scanned && l.kind === "unclear" && (!state.unclearAnswer || state.unclearAnswer === "no") ? "flag" : ""}">
      <span>${l.raw}</span><span>${l.price}</span>${note}</div>`;
  }).join("");

  const uq = AI.unclearLineQuestion();
  let question = "";
  if (scanned && !state.unclearAnswer) {
    question = `
      <div class="question-card">
        <div class="q-title">❓ Quick question</div>
        <p class="q-text">${uq.question}</p>
        <div class="row">
          <button class="btn primary" onclick="answerUnclear('yes')">Yes</button>
          <button class="btn ghost" onclick="answerUnclear('no')">No</button>
        </div>
      </div>`;
  } else if (scanned && state.unclearAnswer === "no") {
    question = `
      <div class="question-card">
        <div class="q-title">What is ‘${uq.raw}’?</div>
        <div class="chips">${uq.alternatives.map((a) => chip(a, false, `answerUnclear('${a}')`)).join("")}</div>
        <button class="link" onclick="answerUnclear('yes')">Actually, yes: it's ${uq.guess.toLowerCase()}</button>
      </div>`;
  }

  return `
    ${setupProgress(4)}
    <h2>Snap a receipt</h2>
    <p class="muted">${scanned ? "Here's what we read. Pantry staples are skipped." : "This prototype uses a sample receipt photo."}</p>
    <div class="receipt ${state.receiptStage === "scanning" ? "scanning" : ""}">
      <div class="receipt-head"><b>${r.store}</b><span>${r.when}</span></div>
      ${lines}
      <div class="rline total"><span>TOTAL</span><span>${r.total}</span></div>
      ${state.receiptStage === "scanning" ? `<div class="scan-overlay"><div class="spinner"></div>Reading your receipt…</div>` : ""}
    </div>
    ${state.receiptStage === "preview" ? `<button class="btn primary block" onclick="scanReceipt()">📸 Use sample receipt photo</button>` : ""}
    ${question}
    ${scanned && state.unclearAnswer && state.unclearAnswer !== "no"
      ? `<button class="btn primary block" onclick="go('perishables')">See my perishables →</button>` : ""}`;
};

/* ---- Step 1f: Perishables with estimated freshness; confirm / correct / remove ---- */
screens.perishables = () => {
  const groups = ["Produce", "Meat", "Dairy"];
  const body = groups.map((g) => {
    const items = state.inventory.filter((i) => i.category === g);
    if (!items.length) return "";
    return `<h4 class="group-title">${g}</h4>` + items.map(perishableRow).join("");
  }).join("");
  return `
    ${setupProgress(5)}
    <h2>Your perishables</h2>
    <p class="muted">Confirm, correct, or remove anything that's off.</p>
    ${expectationCard("estimate")}
    ${body || `<p class="muted center">No perishables left. Add groceries to get suggestions.</p>`}
    <div class="note-card">🫙 ${SIM.pantryNote}</div>
    <button class="btn primary block" onclick="savePerishables()">Save and see tonight's recipes</button>`;
};

function perishableRow(item) {
  if (state.editingItem === item.id) {
    return `
      <div class="item-row editing">
        <span class="item-emoji">${item.emoji}</span>
        <div class="edit-fields">
          <label>Name<input id="editName" value="${escapeHtml(item.name)}"></label>
          <label>Amount<input id="editQty" value="${escapeHtml(item.qty)}"></label>
          <div class="row">
            <button class="btn primary small" onclick="saveCorrection('${item.id}')">Save</button>
            <button class="btn ghost small" onclick="state.editingItem=null; render()">Cancel</button>
          </div>
        </div>
      </div>`;
  }
  const confirmed = item.status === "confirmed" || item.status === "corrected";
  return `
    <div class="item-row">
      <span class="item-emoji">${item.emoji}</span>
      <div class="item-main">
        <div class="item-name">${escapeHtml(item.name)} <span class="qty">· ${escapeHtml(item.qty)}</span></div>
        <span class="fresh-tag ${item.urgency}">${item.freshness}</span>
        <div class="confidence">${confirmed ? "✓ Confirmed by you" : "AI: " + item.confidence}</div>
      </div>
      <div class="item-actions">
        <button class="icon-btn ${confirmed ? "done" : ""}" title="Confirm" onclick="confirmItem('${item.id}')">✓</button>
        <button class="icon-btn" title="Correct" onclick="state.editingItem='${item.id}'; render()">✎</button>
        <button class="icon-btn danger" title="Remove" onclick="removeItem('${item.id}')">✕</button>
      </div>
    </div>`;
}

/* ---- Step 2 & 4: Home — search, filter chips, suggested recipe cards ---- */
screens.home = () => {
  const h = state.home;
  const chips = SIM.filterChips.map((c) => chip(c, h.chip === c, `tapFilterChip('${c}')`, "filter")).join("");
  const cards = h.loading
    ? `<div class="loading-card"><div class="spinner"></div><span>Picking tonight's recipes from what you have…</span></div>`
    : h.list.length
      ? h.list.map(recipeCard).join("")
      : `<p class="muted center">No recipes match that yet. Try another search or chip.</p>`;
  const saved = state.saved.length
    ? `<h4 class="group-title">❤️ Saved for later (${state.saved.length})</h4>` +
      state.saved.map((id) => {
        const r = SIM.recipes[id];
        return `<button class="saved-row" onclick="openRecipe('${id}')">
          <span class="saved-emoji" style="background:${r.bg}">${r.emoji}</span>
          <span><b>${escapeHtml(r.name)}</b><small>${r.minutes} min · ${matchPercent(id)}% match</small></span><span class="chev">›</span></button>`;
      }).join("")
    : "";
  return `
    <div class="greeting">
      <div><h2>Hi! What's for dinner?</h2>
      <p class="muted">${SIM.context.day} · ${minutesTonight()} min tonight</p></div>
    </div>
    <form class="search" onsubmit="event.preventDefault(); runSearch()">
      <span>🔍</span>
      <input id="searchBox" type="search" placeholder="Search recipes or ingredients" value="${escapeHtml(h.query)}">
      <button class="btn primary small" type="submit">Search</button>
    </form>
    <div class="chips filter-chips">${chips}</div>
    <div class="list-head">
      <div><h3>${escapeHtml(h.title)}</h3>${h.subtitle ? `<p class="muted small-text">${escapeHtml(h.subtitle)}</p>` : ""}</div>
      ${h.mode !== "tonight" ? `<button class="link" onclick="backToTonight()">Back to tonight</button>` : ""}
    </div>
    ${cards}
    ${saved}`;
};

function recipeCard(entry) {
  const r = SIM.recipes[entry.recipeId];
  const saved = state.saved.includes(r.id);
  return `
    <div class="recipe-card ${state.home.highlight === r.id ? "updated" : ""}" onclick="openRecipe('${r.id}')">
      ${state.home.highlight === r.id ? `<span class="updated-tag">Updated for you</span>` : ""}
      <div class="recipe-img" style="background:${r.bg}">${r.emoji}</div>
      <div class="recipe-body">
        <div class="recipe-name">${escapeHtml(r.name)}</div>
        <div class="reason">🌿 ${escapeHtml(displayReason(entry))}</div>
        <div class="recipe-stats">
          <span>🥗 ${matchPercent(r.id)}% match</span>
          <span>⏱ ${r.minutes} min</span>
          <span>${r.difficulty}</span>
        </div>
        <div class="predicted">${ratingLine(r)}${saved ? ` · ❤️ Saved` : ""}</div>
      </div>
    </div>`;
}

/* ---- Step 3: Recipe review — ingredients with Missing / Swap, freshness check, feedback ---- */
screens.recipe = () => {
  const id = state.currentRecipe;
  const r = SIM.recipes[id];
  const rv = state.review;
  const ings = currentIngredients(id);
  const onHand = ings.filter((i) => i.pantry || i.leftOut || (!i.markedMissing && inventoryItem(i.invId))).length;
  const listed = state.home.list.find((e) => e.recipeId === id);
  const isSaved = state.saved.includes(id);

  return `
    <div class="recipe-hero" style="background:${r.bg}">${r.emoji}</div>
    <h2>${escapeHtml(r.name)}</h2>
    <div class="recipe-stats big">
      <span>🥗 <b>${matchPercent(id)}%</b> grocery match</span>
      <span>⏱ ${r.minutes} min</span>
      <span>👩‍🍳 ${r.difficulty} · ${r.stepCount} steps</span>
    </div>
    <div class="predicted">${ratingLine(r)}</div>
    <div class="reason">🌿 ${escapeHtml(displayReason(listed || { recipeId: id, reason: r.reason }))}</div>
    ${rv.notice ? `<div class="notice">${rv.notice}</div>` : ""}
    ${freshnessCard(id)}

    <div class="list-head"><h3>Ingredients</h3><span class="muted small-text">${onHand} of ${ings.length} on hand</span></div>
    <div class="ing-list">${ings.map((ing) => ingredientRow(id, ing)).join("")}</div>
    <p class="muted small-text">Pantry staples are assumed on hand. Missing something? Tap Missing or Swap.</p>

    <button class="btn primary block" onclick="cookNow()">👩‍🍳 Cook now</button>
    <button class="btn ghost block" onclick="saveForLater()" ${isSaved ? "disabled" : ""}>${isSaved ? "❤️ Saved for later" : "🤍 Save for later"}</button>

    <div class="feedback-box">
      <h4>Not quite right?</h4>
      <div class="chips">${SIM.feedbackPrompts.map((p, n) => chip(p, false, `giveFeedback(${n})`, "feedback")).join("")}</div>
      ${rv.pickDislike ? `
        <div class="dislike-pick">
          <p class="muted small-text">Which ingredient don't you like?</p>
          <div class="chips">${ings.filter((i) => !i.pantry).map((i) => chip(i.name, false, `dislikeIngredient('${i.key}')`)).join("")}</div>
        </div>` : ""}
    </div>`;
};

function freshnessCard(recipeId) {
  const check = AI.freshnessCheckFor(recipeId);
  const spoiled = Object.keys(state.freshnessAnswers).filter((k) => state.freshnessAnswers[k] === "no");
  if (check && !state.freshnessAnswers[check.invId]) {
    return `
      <div class="question-card fresh-check" id="freshCheck">
        <div class="q-title">🔍 Quick freshness check</div>
        <p class="q-text">${check.question}</p>
        <p class="muted small-text">It's near its estimated range (${inventoryItem(check.invId).freshness.toLowerCase()}).</p>
        <div class="row">
          <button class="btn primary" onclick="answerFreshness('${check.invId}','yes')">Yes, it's fresh</button>
          <button class="btn ghost" onclick="answerFreshness('${check.invId}','no')">No</button>
        </div>
      </div>`;
  }
  const answeredHere = SIM.recipes[recipeId].ingredients.map((i) => i.invId).filter((k) => state.freshnessAnswers[k]);
  return answeredHere.map((k) => state.freshnessAnswers[k] === "yes"
    ? `<div class="notice ok">✓ ${SIM.perishables.find((p) => p.id === k).name}: you checked it looks and smells fresh.</div>`
    : spoiled.includes(k) ? `<div class="notice warn">${SIM.freshnessCheck[k].spoiledMessage.replace(" Try a swap:", "")} Swap it below.</div>` : "").join("");
}

function ingredientRow(recipeId, ing) {
  const have = ing.pantry || (!ing.markedMissing && inventoryItem(ing.invId));
  let status;
  if (ing.leftOut) status = `<span class="ing-status out">Left out</span>`;
  else if (ing.pantry) status = `<span class="ing-status pantry">${ing.swappedFrom ? "Pantry (canned)" : "Pantry"}</span>`;
  else if (have) status = `<span class="ing-status have">✓ Have it</span>`;
  else if (ing.swappedFrom && !ing.markedMissing) status = `<span class="ing-status buy">Not in your groceries</span>`;
  else if (ing.invId && state.freshnessAnswers[ing.invId] === "no") status = `<span class="ing-status missing">Spoiled</span>`;
  else status = `<span class="ing-status missing">${ing.optional ? "Missing · optional" : "Missing"}</span>`;

  const swapped = ing.swappedFrom ? `<div class="swapped-note">Swapped for ${escapeHtml(ing.swappedFrom)} · <button class="link" onclick="undoSwap('${ing.key}')">Undo</button></div>` : "";
  const panel = state.review.swapFor === ing.key ? swapPanel(ing) : "";
  return `
    <div class="ing ${have ? "" : "is-missing"} ${state.review.swapFor === ing.key ? "open" : ""}">
      <div class="ing-row">
        <div class="ing-main">
          <div class="ing-name">${escapeHtml(ing.name)} <span class="qty">· ${escapeHtml(ing.qty)}</span></div>
          ${status}${swapped}
        </div>
        <div class="ing-actions">
          <button class="mini ${ing.markedMissing ? "on" : ""}" onclick="markMissing('${ing.key}')">Missing</button>
          <button class="mini" onclick="openSwap('${ing.key}')">Swap</button>
        </div>
      </div>
      ${panel}
    </div>`;
}

function swapPanel(ing) {
  const { allowed, hidden } = AI.swapOptions(ing.key);
  const original = SIM.recipes[state.currentRecipe].ingredients.find((i) => i.key === ing.key);
  const suggested = (SIM.freshnessCheck[original.invId] || {}).suggestedSwap;
  return `
    <div class="swap-panel">
      <div class="swap-title">${state.review.swapTitle}</div>
      ${allowed.map((o, n) => {
        const inFridge = o.invId && inventoryItem(o.invId);
        const best = state.freshnessAnswers[original.invId] === "no" ? o.name === suggested : n === 0;
        return `<button class="swap-option ${best ? "best" : ""}" onclick="chooseSwap('${ing.key}', ${SIM.swaps[ing.key] ? SIM.swaps[ing.key].indexOf(o) : -1})">
          <span><b>${escapeHtml(o.name)}</b>${best ? ` <span class="best-tag">Suggested</span>` : ""}<small>${escapeHtml(o.note || "")}${inFridge && !/fridge/i.test(o.note || "") ? " · in your fridge" : ""}</small></span>
          <span class="use">Use</span></button>`;
      }).join("")}
      ${hidden.length ? `<p class="muted small-text">Not shown because of your allergies or dislikes: ${hidden.map((o) => `${o.name} (${(o.allergens || []).join(", ") || "dislike"})`).join(", ")}</p>` : ""}
      <button class="link" onclick="state.review.swapFor=null; render()">Close</button>
    </div>`;
}

/* ---- Step 5: Cook — one step per screen, swaps reflected, "Ingredient issue?" ---- */
screens.cook = () => {
  const c = state.cook;
  const r = SIM.recipes[c.recipeId];
  const total = r.steps.length;
  const last = c.step === total - 1;
  return `
    <div class="cook-head">
      <div class="cook-title">${r.emoji} ${escapeHtml(r.name)}</div>
      <div class="setup-progress"><span>Step ${c.step + 1} of ${total}</span>
        <div class="bar"><div style="width:${((c.step + 1) / total) * 100}%"></div></div></div>
    </div>
    ${c.notice ? `<div class="notice">${c.notice}</div>` : ""}
    <div class="step-card">
      <div class="step-num">${c.step + 1}</div>
      <p class="step-text">${stepText(c.recipeId, r.steps[c.step])}</p>
    </div>
    ${c.issueOpen ? issueSheet() : `<button class="btn issue block" onclick="openIssue()">⚠️ Ingredient issue?</button>`}
    <div class="row cook-nav">
      <button class="btn ghost" onclick="cookBack()" ${c.step === 0 ? "disabled" : ""}>← Back</button>
      <button class="btn primary" onclick="${last ? "cookDone()" : "cookNext()"}">${last ? "Done ✓" : "Next →"}</button>
    </div>
    <details class="ing-summary"><summary>Ingredients for this recipe</summary>
      <ul>${currentIngredients(c.recipeId).map((i) => `<li class="${i.leftOut ? "struck" : ""}">${escapeHtml(i.name)} · ${escapeHtml(i.qty)}${i.swappedFrom ? ` <span class="muted">(instead of ${escapeHtml(i.swappedFrom.toLowerCase())})</span>` : ""}${i.leftOut ? " (left out)" : ""}</li>`).join("")}</ul>
    </details>`;
};

/* Fill {placeholders} in a step with the current ingredient names; highlight anything changed */
function stepText(recipeId, template) {
  const ings = currentIngredients(recipeId);
  const html = escapeHtml(template);
  return html.replace(/\{(\w+)\}/g, (match, key, offset) => {
    const ing = ings.find((i) => i.key === key);
    if (!ing) return match;
    const startOfSentence = offset === 0 || /[.!?]\s$/.test(html.slice(Math.max(0, offset - 2), offset));
    const cap = (t) => (startOfSentence ? t.charAt(0).toUpperCase() + t.slice(1) : t);
    const name = escapeHtml(ing.name.toLowerCase());
    if (ing.leftOut) return `<s>${cap(escapeHtml((ing.swappedFrom || ing.name).toLowerCase()))}</s> <mark>(left out)</mark>`;
    return ing.swappedFrom ? `<mark>${cap(name)}</mark>` : cap(name);
  });
}

function issueSheet() {
  const c = state.cook;
  const ings = currentIngredients(c.recipeId).filter((i) => !i.leftOut && !i.pantry && (!i.invId || inventoryItem(i.invId) || i.key === c.issueKey));
  if (!c.issueKey) {
    return `
      <div class="question-card issue-sheet">
        <div class="q-title">⚠️ Which ingredient?</div>
        <div class="chips">${ings.map((i) => chip(i.name, false, `pickIssueIngredient('${i.key}')`)).join("")}</div>
        <button class="link" onclick="closeIssue()">Cancel</button>
      </div>`;
  }
  const ing = ings.find((i) => i.key === c.issueKey);
  return `
    <div class="question-card issue-sheet">
      <div class="q-title">⚠️ What happened to the ${escapeHtml(ing.name.toLowerCase())}?</div>
      <div class="row">
        <button class="btn ghost" onclick="reportIssue('dontHave')">Don't have it</button>
        <button class="btn ghost" onclick="reportIssue('wentBad')">Went bad, threw it out</button>
      </div>
      <button class="link" onclick="closeIssue()">Cancel</button>
    </div>`;
}

/* ---- Step 6: Wrap up ---- */
screens.wrapUp = () => {
  const c = state.cook;
  const r = SIM.recipes[c.recipeId];
  const w = SIM.wrapUp;
  const list = (names) => names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
  const used = c.usedBeforeBad.length
    ? w.usedBeforeBad.replace("{items}", `<b>${escapeHtml(list(c.usedBeforeBad))}</b>`)
    : w.nothingUrgent;
  const swaps = currentIngredients(c.recipeId).filter((i) => i.swappedFrom);
  return `
    <div class="done-hero"><div class="done-check">✓</div><h1>${w.title}</h1></div>
    <div class="used-card">♻️ ${used}</div>
    ${c.wentBad.length ? `<div class="notice warn">${escapeHtml((c.lastIssueLeftOut ? w.spoiledNoteLeftOut : w.spoiledNote).replace("{items}", list(c.wentBad)))}</div>` : ""}
    <div class="meal-photo" style="background:${r.bg}">
      <span>${r.emoji}</span>
      ${c.photo ? `<div class="photo-caption">📸 ${w.photoAdded}</div>` : ""}
    </div>
    <div class="meal-name">${escapeHtml(r.name)}${swaps.length ? `<small>With your changes: ${swaps.map((i) => i.leftOut ? `no ${escapeHtml(i.swappedFrom.toLowerCase())}` : `${escapeHtml(i.name.toLowerCase())} instead of ${escapeHtml(i.swappedFrom.toLowerCase())}`).join("; ")}</small>` : ""}</div>
    <div class="row">
      <button class="btn ${c.photo ? "soft" : "ghost"}" onclick="addPhoto()" ${c.photo ? "disabled" : ""}>📷 ${c.photo ? "Photo added" : w.photoButton}</button>
      <button class="btn ${c.saved ? "soft" : "primary"}" onclick="saveToCookbook()" ${c.saved ? "disabled" : ""}>📖 ${c.saved ? "Saved" : w.cookbookButton}</button>
    </div>
    ${c.saved ? `<div class="notice ok">✓ ${w.cookbookSaved}</div>` : ""}
    <div class="feedback-box">
      <h4>${w.processQuestion}</h4>
      <div class="chips">${w.processPrompts.map((p, n) => chip(p, c.process.includes(p), `toggleProcess(${n})`)).join("")}</div>
      <textarea id="processComment" placeholder="${escapeHtml(w.commentPlaceholder)}">${escapeHtml(c.comment)}</textarea>
    </div>
    <button class="btn primary block" onclick="finishWrapUp()">${w.finishButton}</button>`;
};

/* =========================== 6. ACTIONS =========================== */

/* Step 1: quiz */
function startSetup() {
  log("Setup", "Started setup (saw expectation copy: suggestions improve with cooking; inventory is an estimate)");
  go("quizPrefs");
}

function toggleMulti(field, value) {
  const list = state.prefs[field];
  const noneOption = { allergies: "No allergies", dislikes: "No dislikes" }[field];
  if (list.includes(value)) {
    state.prefs[field] = list.filter((v) => v !== value);
  } else if (value === noneOption) {
    state.prefs[field] = [value];                       // "None" clears the others
  } else {
    state.prefs[field] = list.filter((v) => v !== noneOption).concat(value);
  }
  if (field === "allergies" && state.prefs.allergies.length) state.quizError = false;
  render();
}

function pickSingle(field, value) {
  state.prefs[field] = state.prefs[field] === value ? null : value;
  render();
}

function finishPrefs() {
  const p = state.prefs;
  if (!p.allergies.length) {
    state.quizError = true;
    render();
    document.getElementById("allergyBlock").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const show = (v) => (Array.isArray(v) ? (v.length ? v.join(", ") : "none chosen") : v || "not answered");
  log("Setup", `Quiz answers: cuisines: ${show(p.cuisines)}; dislikes: ${show(p.dislikes)}; skill: ${show(p.skill)}; weeknight time: ${show(p.time)}; budget: ${show(p.budget)}`);
  log("Setup", `Allergies saved: ${p.allergies.join(", ")} (recipes, swaps, and substitutions will exclude these)`);
  go("quizTaste");
}

function answerTaste(id, answer) {
  state.tasteAnswers[id] = answer;
  const r = SIM.exampleRecipes.find((x) => x.id === id);
  log("Setup", `Example recipe “${r.name}” (${r.cuisine}): ${answer === "yes" ? "Yes" : "No"}`);
  render();
}

function finishTaste() {
  const yes = SIM.exampleRecipes.filter((r) => state.tasteAnswers[r.id] === "yes").map((r) => r.name);
  const no = SIM.exampleRecipes.filter((r) => state.tasteAnswers[r.id] === "no").map((r) => r.name);
  log("Setup", `Taste check done: ${yes.length} Yes, ${no.length} No, ${SIM.exampleRecipes.length - yes.length - no.length} skipped`);
  go("addGroceries");
}

/* Step 1: groceries */
function connectEmail() {
  log("Setup", "Tapped Connect email or online grocery orders (simulated)");
  log("AI", SIM.connectEmailResult);
  toast(SIM.connectEmailResult);
}

function snapFridge() {
  log("Setup", "Tapped Snap your fridge (optional, simulated)");
  log("AI", SIM.fridgePhotoResult);
  toast(SIM.fridgePhotoResult);
}

function scanReceipt() {
  state.receiptStage = "scanning";
  log("Setup", "Added sample receipt photo (Trader Joe's, Monday)");
  render();
  setTimeout(() => {
    state.receiptStage = "scanned";
    const r = AI.readReceipt();
    const perishables = r.lines.filter((l) => l.kind === "perishable").length;
    const pantry = r.lines.filter((l) => l.kind === "pantry").map((l) => l.raw);
    log("AI", `Read receipt: ${perishables} perishables found, 1 unclear line (“${SIM.unclearQuestion.raw}”), pantry staples skipped (${pantry.join(", ")})`);
    log("AI", `Asked: ${SIM.unclearQuestion.question}`);
    render();
  }, 1300);
}

function answerUnclear(answer) {
  const uq = SIM.unclearQuestion;
  state.unclearAnswer = answer;
  state.inventory = AI.findPerishables();
  const spinach = state.inventory.find((i) => i.id === "spinach");

  if (answer === "yes") {
    spinach.status = "confirmed";
    log("Inventory", `Receipt line “${uq.raw}”: confirmed as ${uq.guess}`);
  } else if (answer === "no") {
    log("Inventory", `Receipt line “${uq.raw}”: answered No (not ${uq.guess})`);
  } else if (answer.startsWith("Not food")) {
    state.inventory = state.inventory.filter((i) => i.id !== "spinach");
    log("Inventory", `Receipt line “${uq.raw}”: not a perishable, left out`);
  } else {
    spinach.name = answer;
    spinach.id = answer.toLowerCase().replace(/[^a-z]+/g, "-");   // no longer counts as spinach in recipes
    spinach.status = "corrected";
    log("Inventory", `Receipt line “${uq.raw}”: corrected to ${answer}`);
  }
  render();
}

function confirmItem(id) {
  const item = state.inventory.find((i) => i.id === id);
  if (item.status === "confirmed") return;
  item.status = "confirmed";
  log("Inventory", `Confirmed ${item.name} (${item.qty})`);
  render();
}

function saveCorrection(id) {
  const item = state.inventory.find((i) => i.id === id);
  const newName = document.getElementById("editName").value.trim() || item.name;
  const newQty = document.getElementById("editQty").value.trim() || item.qty;
  log("Inventory", `Corrected ${item.name} (${item.qty}) → ${newName} (${newQty})`);
  item.name = newName;
  item.qty = newQty;
  item.status = "corrected";
  state.editingItem = null;
  render();
}

function removeItem(id) {
  const item = state.inventory.find((i) => i.id === id);
  state.inventory = state.inventory.filter((i) => i.id !== id);
  log("Inventory", `Removed ${item.name} from inventory`);
  render();
}

function savePerishables() {
  state.inventory.forEach((i) => { if (i.status === "detected") i.status = "confirmed"; });
  log("Setup", `Setup complete. Saved preferences and ${state.inventory.length} perishables: ${state.inventory.map((i) => `${i.name} (${i.freshness})`).join("; ")}`);
  showTonight("Home opened");
  go("home");
}

/* Step 2: home */
function showTonight(why) {
  if (!state.tonight && BACKEND.mode === "real") { loadRealTonight(why); return; }
  if (!state.tonight) state.tonight = AI.tonight();
  showRecipes(state.tonight, { mode: "tonight", title: "Suggested recipes tonight", subtitle: tonightLabel(), why });
}

function tonightLabel() {
  if (!BACKEND.available) return "";
  if (BACKEND.mode !== "real") return "Simulated picks";
  return state.tonightSource ? `Picked by AI (${state.tonightSource})` : "Backup picks: the AI didn't answer";
}

/* What the real AI gets: the user's perishables, quiz answers, taste answers, and the recipe catalog.
   Recipes with allergens stay in the catalog on purpose, so testing shows whether the model respects them;
   the guardrail in realTonight() removes any that slip through. */
function tonightInput() {
  const p = state.prefs;
  const hidden = [...state.saved, ...state.rejected];
  return {
    tonight: { day: SIM.context.day, minutesAvailable: minutesTonight() },
    preferences: { cuisines: p.cuisines, dislikes: p.dislikes, allergies: p.allergies, skill: p.skill, weeknightTime: p.time, budget: p.budget },
    tasteAnswers: SIM.exampleRecipes.filter((r) => state.tasteAnswers[r.id])
      .map((r) => ({ dish: r.name, cuisine: r.cuisine, answer: state.tasteAnswers[r.id] })),
    perishables: state.inventory.filter((i) => inventoryItem(i.id))
      .map((i) => ({ name: i.name, amount: i.qty, freshness: i.freshness, urgency: i.urgency })),
    catalog: Object.values(SIM.recipes).filter((r) => !hidden.includes(r.id)).map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      minutes: r.minutes,
      difficulty: r.difficulty,
      steps: r.stepCount,
      usesYourPerishables: [...new Set(r.ingredients.map((i) => inventoryItem(i.invId)).filter(Boolean).map((item) => item.name))],
      wouldNeedToBuy: r.ingredients.filter((i) => !i.pantry && !inventoryItem(i.invId)).map((i) => i.name + (i.optional ? " (optional)" : "")),
      allergens: recipeAllergens(r),
      contains: r.dislikeTags || [],
    })),
  };
}

/* Ask the backend, then check the answer before showing it: known recipe ids only, no allergens or
   dislikes, nothing already saved or rejected, no repeats. Top up with simulated picks if fewer than 3 survive. */
async function realTonight() {
  const res = await fetch("/api/tonight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tonightInput()) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  const ok = (id) => SIM.recipes[id] && AI.isAllowed(SIM.recipes[id]) && !state.saved.includes(id) && !state.rejected.includes(id);
  const raw = Array.isArray(data.picks) ? data.picks : [];
  const picks = [];
  const dropped = [];
  for (const p of raw) {
    if (ok(p.recipeId) && !picks.some((k) => k.recipeId === p.recipeId)) {
      picks.push({ recipeId: p.recipeId, reason: String(p.reason || "").trim().slice(0, 160) || SIM.recipes[p.recipeId].reason });
    } else {
      dropped.push(p.recipeId);
    }
  }
  if (dropped.length) {
    log("AI", `Guardrail removed ${dropped.length} AI pick(s) that broke an allergy or dislike rule, repeated, or were unknown: ${dropped.join(", ")}`);
  }
  if (picks.length < 3) {
    const extra = AI.tonight().filter((e) => !picks.some((k) => k.recipeId === e.recipeId)).slice(0, 3 - picks.length);
    if (extra.length) log("AI", `Topped up with ${extra.length} simulated pick(s) to show 3 recipes`);
    picks.push(...extra);
  }
  return { picks: picks.slice(0, 3), model: data.model };
}

async function loadRealTonight(why) {
  const ticket = (state.tonightTicket = (state.tonightTicket || 0) + 1);
  Object.assign(state.home, { list: [], mode: "tonight", title: "Suggested recipes tonight", subtitle: "", loading: true, highlight: null });
  if (state.screen === "home") render();
  let picks;
  try {
    const answer = await realTonight();
    picks = answer.picks;
    state.tonightSource = answer.model;
  } catch (error) {
    log("AI", `Real AI failed (${error.message}). Showing simulated backup picks instead.`);
    toast("The AI didn't answer, so these are backup picks.");
    picks = AI.tonight();
    state.tonightSource = null;
  }
  if (ticket !== state.tonightTicket) return;   // a newer request replaced this one
  state.tonight = picks;
  state.home.loading = false;
  showRecipes(picks, { mode: "tonight", title: "Suggested recipes tonight", subtitle: tonightLabel(), why });
  if (state.screen === "home") render({ scrollTop: true });
}

function backToTonight() {
  state.home.query = "";
  state.home.chip = null;
  log("Recipe", "Cleared search and filters");
  showTonight("Back to tonight");
  render({ scrollTop: true });
}

function runSearch() {
  state.home.query = document.getElementById("searchBox").value;
  applySearch(state.home.query.trim() ? `Searched “${state.home.query.trim()}”` : null);
}

function tapFilterChip(name) {
  state.home.chip = state.home.chip === name ? null : name;
  state.home.query = document.getElementById("searchBox").value;
  applySearch(`${state.home.chip ? "Tapped" : "Turned off"} filter chip “${name}”`);
}

function applySearch(action) {
  const h = state.home;
  if (action) log("Recipe", action);
  if (!h.query.trim() && !h.chip) {
    showTonight("Search cleared");
  } else {
    const label = [h.query.trim() && `“${h.query.trim()}”`, h.chip].filter(Boolean).join(" + ");
    const results = AI.search(h.query, h.chip);
    showRecipes(results, {
      mode: "search",
      title: `${results.length} recipe${results.length === 1 ? "" : "s"} for ${label}`,
      subtitle: results.length < 3
        ? `Only ${results.length} recipe${results.length === 1 ? "" : "s"} match without your allergens. Try another search or chip.`
        : "Still ranked by what you have and what's expiring soon",
      why: `Search/filter (${label})`,
    });
  }
  render({ scrollTop: true });
}

function openRecipe(id) {
  const r = SIM.recipes[id];
  state.currentRecipe = id;
  state.review = { swapFor: null, swapTitle: "", pickDislike: false, notice: "" };
  log("Recipe", `Opened “${r.name}” (${matchPercent(id)}% match, ${r.minutes} min, predicted ${r.predictedRating})`);
  const check = AI.freshnessCheckFor(id);
  if (check && !state.freshnessAnswers[check.invId]) log("AI", `Asked freshness check: ${check.question}`);
  go("recipe");
}

/* Step 3: recipe review */
function recipeMods(recipeId = state.currentRecipe) {
  return (state.recipeMods[recipeId] = state.recipeMods[recipeId] || {});
}

function ingredientByKey(key) {
  return SIM.recipes[state.currentRecipe].ingredients.find((i) => i.key === key);
}

function markMissing(key) {
  const ing = ingredientByKey(key);
  const mods = recipeMods();
  if (mods[key] && mods[key].status === "missing") {          // tap again to undo
    delete mods[key];
    const item = state.inventory.find((i) => i.id === ing.invId);
    if (item && item.status === "missing") item.status = "confirmed";
    log("Inventory", `Undid Missing for ${ing.name}`);
    state.review.swapFor = null;
    render();
    return;
  }
  const before = matchPercent(state.currentRecipe);
  mods[key] = { status: "missing" };
  const item = state.inventory.find((i) => i.id === ing.invId);
  if (item) item.status = "missing";
  log("Inventory", `Marked ${ing.name} as Missing in “${SIM.recipes[state.currentRecipe].name}” (removed from inventory; match ${before}% → ${matchPercent(state.currentRecipe)}%)`);
  const { allowed } = AI.swapOptions(key);
  log("AI", `Suggested swaps for ${ing.name}: ${allowed.map((o) => o.name).join(", ")}`);
  state.review.swapFor = key;
  state.review.swapTitle = `No ${ing.name.toLowerCase()}? Try one of these:`;
  render();
}

function openSwap(key) {
  const ing = ingredientByKey(key);
  if (state.review.swapFor === key) { state.review.swapFor = null; render(); return; }
  state.review.swapFor = key;
  state.review.swapTitle = `Swap ${ing.name.toLowerCase()} for:`;
  log("Recipe", `Opened Swap options for ${ing.name}`);
  render();
}

function chooseSwap(key, index) {
  const ing = ingredientByKey(key);
  const option = index >= 0 ? SIM.swaps[key][index] : { name: "Leave it out", invId: null, allergens: [] };
  const before = matchPercent(state.currentRecipe);
  const sub = { ...option, leftOut: option.name === "Leave it out" };
  recipeMods()[key] = { status: "swapped", sub };
  state.review.swapFor = null;
  state.review.notice = sub.leftOut
    ? `✏️ Recipe updated: leaving out the ${ing.name.toLowerCase()}. Steps will reflect this.`
    : `✏️ Recipe updated to use ${sub.name.toLowerCase()} instead of ${ing.name.toLowerCase()}. Steps will reflect this.`;
  log("Recipe", `Swapped ${ing.name} → ${sub.name} in “${SIM.recipes[state.currentRecipe].name}” (grocery match ${before}% → ${matchPercent(state.currentRecipe)}%)`);
  render();
}

function undoSwap(key) {
  const ing = ingredientByKey(key);
  delete recipeMods()[key];
  state.review.notice = "";
  log("Recipe", `Undid swap for ${ing.name}`);
  render();
}

function answerFreshness(invId, answer) {
  const item = state.inventory.find((i) => i.id === invId);
  state.freshnessAnswers[invId] = answer;
  if (answer === "yes") {
    log("Feedback", `Freshness check: ${item.name} looks and smells fresh (Yes)`);
  } else {
    item.status = "spoiled";
    log("Feedback", `Freshness check: ${item.name} is NOT fresh (No). Marked as spoiled in inventory (spoilage data recorded)`);
    const key = SIM.recipes[state.currentRecipe].ingredients.find((i) => i.invId === invId).key;
    const check = SIM.freshnessCheck[invId];
    log("AI", `Suggested swap for ${item.name}: ${check.suggestedSwap}`);
    state.review.swapFor = key;
    state.review.swapTitle = check.spoiledMessage;
  }
  render();
}

function cookNow() {
  const check = AI.freshnessCheckFor(state.currentRecipe);
  if (check && !state.freshnessAnswers[check.invId]) {
    toast("Please answer the quick freshness check first.");
    document.getElementById("freshCheck").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const r = SIM.recipes[state.currentRecipe];
  const changes = currentIngredients(r.id).filter((i) => i.swappedFrom || i.markedMissing)
    .map((i) => (i.swappedFrom ? `${i.swappedFrom} → ${i.name}` : `${i.name} missing`));
  log("Recipe", `Tapped Cook now: “${r.name}” (${matchPercent(r.id)}% match${changes.length ? "; changes: " + changes.join(", ") : ""})`);
  startCooking();
}

/* Put a replacement where a recipe was, in tonight's list and the list on screen.
   Returns false if the recipe wasn't in either list. */
function replaceInLists(id, replacement) {
  let found = false;
  [...new Set([state.tonight, state.home.list])].forEach((list) => {
    const i = list ? list.findIndex((e) => e.recipeId === id) : -1;
    if (i >= 0) {
      found = true;
      if (replacement) list.splice(i, 1, replacement); else list.splice(i, 1);
    }
  });
  return found;
}

/* Save for later → moves to the saved list and a new recipe takes its place */
function saveForLater() {
  const id = state.currentRecipe;
  const r = SIM.recipes[id];
  state.saved.push(id);
  const shown = state.home.list.concat(state.tonight || []).some((e) => e.recipeId === id);
  const replacement = shown ? AI.nextRecipe() : null;
  replaceInLists(id, replacement);
  state.home.highlight = replacement && replacement.recipeId;
  log("Recipe", `Saved “${r.name}” for later (moved to Saved list)`);
  if (replacement) {
    log("AI", `Replaced it on home with “${SIM.recipes[replacement.recipeId].name}” (${matchPercent(replacement.recipeId)}% match; reason: “${replacement.reason}”)`);
  }
  go("home");
  toast(`Saved “${r.name}” for later.${replacement ? " Here's a new suggestion in its place." : ""}`);
}

/* Feedback prompts: Too hard, Too long, Don't like an ingredient, Not in the mood, Show similar */
function giveFeedback(n) {
  const prompt = SIM.feedbackPrompts[n];
  const id = state.currentRecipe;
  const r = SIM.recipes[id];
  if (prompt === "Don't like an ingredient") {
    state.review.pickDislike = !state.review.pickDislike;
    render();
    return;
  }
  if (prompt === "Show similar") {
    const list = AI.similarTo(id);
    log("Feedback", `“Show similar” on “${r.name}”`);
    showRecipes(list, { mode: "similar", title: `Similar to ${r.name}`, subtitle: "Still ranked by what you have and what's expiring soon", why: "Show similar" });
    state.home.highlight = null;
    go("home");
    return;
  }
  replaceAfterFeedback(prompt, id, null, `“${prompt}” on “${r.name}”`);
}

function dislikeIngredient(key) {
  const ing = ingredientByKey(key);
  replaceAfterFeedback("Don't like an ingredient", state.currentRecipe, key, `“Don't like an ingredient” (${ing.name}) on “${SIM.recipes[state.currentRecipe].name}”`);
}

function replaceAfterFeedback(prompt, id, ingKey, description) {
  log("Feedback", description);
  state.rejected.push(id);
  state.saved = state.saved.filter((x) => x !== id);       // feedback on a saved recipe takes it off the saved list
  const replacement = AI.replacementFor(prompt, id, ingKey);
  let message;
  if (replacement) {
    if (!replaceInLists(id, replacement)) {                  // opened from Saved: new pick goes on top, list keeps its size
      state.home.list.unshift(replacement);
      if (state.home.list.length > (state.home.mode === "tonight" ? 3 : 5)) state.home.list.pop();
    }
    state.home.highlight = replacement.recipeId;
    const n = SIM.recipes[replacement.recipeId];
    log("AI", `Replaced “${SIM.recipes[id].name}” with “${n.name}” (${n.stepCount} steps, ${n.minutes} min; reason: “${replacement.reason}”)`);
    message = `Got it. We swapped in ${n.name}.`;
  } else {
    replaceInLists(id, null);
    log("AI", `No replacement found for “${SIM.recipes[id].name}”; removed it`);
    message = "Got it. We removed that recipe.";
  }
  go("home");
  toast(message);
}

/* Step 5: cook */
function startCooking() {
  state.cook = { recipeId: state.currentRecipe, step: 0, issueOpen: false, issueKey: null, notice: "",
    wentBad: [], wentBadIds: [], usedBeforeBad: [], photo: false, saved: false, process: [], comment: "" };
  log("Cooking", `Started cooking “${SIM.recipes[state.currentRecipe].name}” (step 1 of ${SIM.recipes[state.currentRecipe].steps.length})`);
  go("cook");
}

function cookNext() {
  const c = state.cook;
  c.step += 1;
  c.issueOpen = false;
  c.notice = "";
  log("Cooking", `Next → step ${c.step + 1} of ${SIM.recipes[c.recipeId].steps.length}`);
  render({ scrollTop: true });
}

function cookBack() {
  state.cook.step -= 1;
  log("Cooking", `Back → step ${state.cook.step + 1} of ${SIM.recipes[state.cook.recipeId].steps.length}`);
  state.cook.issueOpen = false;
  render({ scrollTop: true });
}

function openIssue() {
  state.cook.issueOpen = true;
  state.cook.issueKey = null;
  log("Cooking", `Tapped “Ingredient issue?” on step ${state.cook.step + 1}`);
  render();
}

function closeIssue() {
  state.cook.issueOpen = false;
  render();
}

function pickIssueIngredient(key) {
  state.cook.issueKey = key;
  render();
}

/* Missing or spoiled mid-recipe → update inventory, adapt the recipe (never adding an allergen), log it */
function reportIssue(type) {
  const c = state.cook;
  const ing = currentIngredients(c.recipeId).find((i) => i.key === c.issueKey);
  const label = type === "wentBad" ? "Went bad, threw it out" : "Don't have it";
  log("Cooking", `Ingredient issue on step ${c.step + 1}: ${ing.name}: “${label}”`);

  const item = state.inventory.find((i) => i.id === ing.invId);
  if (item) {
    item.status = type === "wentBad" ? "spoiled" : "missing";
    log("Inventory", `${item.name} ${type === "wentBad" ? "marked spoiled" : "marked missing"} in inventory`);
  }
  if (type === "wentBad") {
    c.wentBad.push(ing.name.toLowerCase());
    if (ing.invId) c.wentBadIds.push(ing.invId);
    log("Inventory", `Spoilage data recorded: ${ing.name} went bad (estimate was “${item ? item.freshness : "n/a"}”), used to improve future freshness estimates`);
  }

  // Simulated AI adaptation from simulated_responses.js; fall back to leaving it out
  const plan = ((SIM.ingredientIssues[ing.invId] || SIM.ingredientIssues[ing.key]) || {})[type];
  let sub = plan && plan.replaceWith;
  let message = plan ? plan.message : `Leave out the ${ing.name.toLowerCase()} and carry on. The remaining steps are updated.`;
  const unsafe = sub && ((sub.allergens || []).some((a) => state.prefs.allergies.includes(a)) || (sub.invId && !inventoryItem(sub.invId)) || sub.invId === ing.invId);
  if (!sub || unsafe) {
    if (unsafe) message = `Leave out the ${ing.name.toLowerCase()} and carry on. (We skipped a substitute that you don't have or are allergic to.)`;
    sub = { name: "Leave it out", invId: null, allergens: [], leftOut: true };
  }
  const original = SIM.recipes[c.recipeId].ingredients.find((i) => i.key === ing.key);
  recipeMods(c.recipeId)[ing.key] = { status: "swapped", sub: { ...sub, leftOut: !!sub.leftOut || sub.name === "Leave it out" } };
  // keep "instead of" pointing at the recipe's original ingredient
  if (original.name !== ing.name) log("Cooking", `(${ing.name} had replaced ${original.name} earlier)`);
  // Another ingredient in this recipe backed by the same food (e.g. extra tomatoes swapped in for spinach) is gone too
  if (ing.invId) {
    currentIngredients(c.recipeId).filter((i) => i.key !== ing.key && i.invId === ing.invId && !i.leftOut).forEach((other) => {
      recipeMods(c.recipeId)[other.key] = { status: "swapped", sub: { name: "Leave it out", invId: null, allergens: [], leftOut: true } };
      log("Cooking", `Also left out ${other.name}: it was the same ${item ? item.name.toLowerCase() : "ingredient"}`);
    });
  }
  c.lastIssueLeftOut = !!(sub.leftOut || sub.name === "Leave it out");
  log("AI", `Adapted recipe: ${message} Remaining steps updated.`);
  c.notice = `✏️ ${escapeHtml(message)} Remaining steps are updated.`;
  c.issueOpen = false;
  c.issueKey = null;
  render();
}

function cookDone() {
  const c = state.cook;
  const r = SIM.recipes[c.recipeId];
  const usedItems = currentIngredients(c.recipeId).map((i) => inventoryItem(i.invId)).filter(Boolean);
  const unique = [...new Map(usedItems.map((i) => [i.id, i])).values()];
  c.usedBeforeBad = unique.filter((i) => ["urgent", "soon"].includes(i.urgency)).map((i) => i.name.toLowerCase().replace("baby ", ""));
  unique.forEach((i) => { i.status = "used"; });
  c.used = unique.map((i) => i.id);
  log("Cooking", `Tapped Done: finished cooking “${r.name}” (cooking flow completed)`);
  log("Inventory", `Deducted used ingredients: ${unique.map((i) => i.name).join(", ") || "none"}`);
  log("AI", `Completion summary: used before they went bad: ${c.usedBeforeBad.join(", ") || "none"}${c.wentBad.length ? `; went bad: ${c.wentBad.join(", ")}` : ""}`);
  go("wrapUp");
}

/* Step 6: wrap up */
function addPhoto() {
  state.cook.photo = true;
  log("Cooking", "Added a photo of the meal (simulated)");
  if (state.cook.saved) updateCookbookEntry();
  render();
}

function saveToCookbook() {
  const c = state.cook;
  c.saved = true;
  updateCookbookEntry();
  const entry = state.cookbook[state.cookbook.length - 1];
  log("Cooking", `Saved “${entry.name}” to cookbook${entry.swaps.length ? ` with changes: ${entry.swaps.join("; ")}` : ""}${entry.photo ? " (with photo)" : ""}`);
  render();
}

function updateCookbookEntry() {
  const c = state.cook;
  const swaps = currentIngredients(c.recipeId).filter((i) => i.swappedFrom)
    .map((i) => (i.leftOut ? `left out ${i.swappedFrom}` : `${i.swappedFrom} → ${i.name}`));
  const entry = { recipeId: c.recipeId, name: SIM.recipes[c.recipeId].name, swaps, photo: c.photo };
  state.cookbook = state.cookbook.filter((e) => e.recipeId !== c.recipeId).concat(entry);
}

function toggleProcess(n) {
  const c = state.cook;
  const p = SIM.wrapUp.processPrompts[n];
  c.comment = document.getElementById("processComment").value;
  c.process = c.process.includes(p) ? c.process.filter((x) => x !== p) : c.process.concat(p);
  render();
}

function finishWrapUp() {
  const c = state.cook;
  c.comment = document.getElementById("processComment").value.trim();
  log("Feedback", `Cooking-process feedback: ${c.process.join(", ") || "no prompts tapped"}${c.comment ? `; comment: “${c.comment}”` : ""}`);
  log("Cooking", `Cooking outcome: completed with Done${c.photo ? ", photo added" : ", no photo"}${c.saved ? ", saved to cookbook" : ""}`);
  go("later");
}

/* ---- Step 7: Later follow-up. A "Next day" button simulates the notification. ---- */
screens.later = () => {
  const L = SIM.later;
  const r = SIM.recipes[state.cook.recipeId];
  return `
    <div class="later-hero"><div class="welcome-art">🌙</div><h2>${L.title}</h2><p class="muted center">${L.body}</p></div>
    <button class="btn primary block" onclick="nextDay()">⏭ ${L.nextDayButton}</button>
    <p class="muted center small-text">Tap to simulate tomorrow morning.</p>`;
};

screens.notification = () => {
  const L = SIM.later;
  const r = SIM.recipes[state.cook.recipeId];
  return `
    <div class="later-hero"><p class="muted center">${L.notificationTime}</p></div>
    <button class="notification" onclick="openFollowUp()">
      <span class="notif-icon">🌿</span>
      <span><b>${L.notificationApp}</b><small>${escapeHtml(L.notificationText.replace("{recipe}", r.name))}</small></span>
    </button>
    <p class="muted center small-text">Tap the notification to open it.</p>`;
};

/* Perishables the user used (ask what happened) and ones about to expire that weren't used (ask if still there) */
function followUpItems() {
  const c = state.cook;
  const used = state.inventory.filter((i) => (c.used || []).includes(i.id) || c.wentBadIds.includes(i.id));
  const candidates = state.inventory.filter((i) => !used.includes(i) && !["used", "spoiled", "missing"].includes(i.status));
  const soon = candidates.filter((i) => ["urgent", "soon"].includes(i.urgency));
  const rest = candidates.filter((i) => !soon.includes(i) && i.highRisk);
  return { used, still: soon.concat(rest).slice(0, 3) };
}

screens.followUp = () => {
  const F = SIM.followUp;
  const f = state.follow;
  const r = SIM.recipes[state.cook.recipeId];
  const items = followUpItems();
  const faces = F.tasteOptions.map((o, n) => `
    <button class="face ${f.taste === n ? "on" : ""}" onclick="pickTaste(${n})"><span>${o.face}</span><small>${o.label}</small></button>`).join("");
  const usedRows = items.used.map((i) => `
    <div class="fu-row"><div class="fu-name">${i.emoji} ${escapeHtml(i.name)}</div>
      <div class="chips">${F.ingredientOptions.map((o) => chip(o, f.ingredients[i.id] === o, `answerIngredient('${i.id}', '${o}')`, "small")).join("")}</div></div>`).join("");
  const stillRows = items.still.map((i) => `
    <div class="fu-row"><div class="fu-name">${i.emoji} ${escapeHtml(i.name)} <span class="qty">· ${escapeHtml(i.freshness.toLowerCase())}</span></div>
      <div class="chips">${F.stillHaveOptions.map((o) => chip(o, f.still[i.id] === o, `answerStill('${i.id}', '${o.replace(/'/g, "\\'")}')`, "small")).join("")}</div></div>`).join("");
  return `
    <h2>${F.title}</h2>
    <p class="muted">${escapeHtml(r.name)}</p>
    <div class="quiz-block"><h4>${F.tasteQuestion}</h4><div class="faces">${faces}</div></div>
    <div class="quiz-block"><h4>${F.recipeQuestion}</h4>
      <div class="chips">${F.recipePrompts.map((p, n) => chip(p, f.recipe.includes(p), `toggleRecipePrompt(${n})`)).join("")}</div></div>
    ${usedRows ? `<div class="quiz-block"><h4>${F.ingredientsQuestion}</h4>${usedRows}</div>` : ""}
    ${stillRows ? `<div class="quiz-block still"><h4>${F.stillHaveTitle}</h4><p class="hint">${F.stillHaveHint}</p>${stillRows}</div>` : ""}
    <textarea id="followComment" placeholder="${escapeHtml(F.commentPlaceholder)}">${escapeHtml(f.comment)}</textarea>
    <button class="btn primary block" onclick="saveFollowUp()">${F.saveButton}</button>`;
};

/* ---- Step 8: Progress (simulated numbers; no money-saved estimates) ---- */
screens.progress = () => {
  const P = SIM.progress;
  const n = state.progress;
  const rows = ["itemsUsedBeforeBad", "mealsCookedAtHome", "averageRating"].map((k) => `
    <div class="progress-tile"><span class="progress-icon">${P.icons[k]}</span>
      <div><div class="progress-num">${n[k]}</div><div class="progress-label">${P.labels[k]}</div></div><span class="progress-check">✓</span></div>`).join("");
  return `
    <div class="done-hero"><h1>${P.title}</h1><p class="muted">${P.subtitle}</p></div>
    ${rows}
    <p class="muted center small-text">${P.simulatedNote}</p>
    <div class="note-card">🌱 ${P.encouragement}</div>
    <button class="btn primary block" onclick="keepCooking()">${P.keepCookingButton}</button>`;
};

/* Step 7 actions */
function nextDay() {
  log("Follow-up", "Tapped “Next day” (simulated notification: “" + SIM.later.notificationText.replace("{recipe}", SIM.recipes[state.cook.recipeId].name) + "”)");
  go("notification");
}

function openFollowUp() {
  state.follow = { taste: null, recipe: [], ingredients: {}, still: {}, comment: "" };
  // Anything the user already threw out while cooking arrives pre-answered as "Went bad"
  state.inventory.filter((i) => state.cook.wentBadIds.includes(i.id))
    .forEach((i) => { state.follow.ingredients[i.id] = "Went bad"; });
  log("Follow-up", "Opened the next-day follow-up");
  go("followUp");
}

function pickTaste(n) {
  const o = SIM.followUp.tasteOptions[n];
  state.follow.comment = document.getElementById("followComment").value;
  state.follow.taste = n;
  log("Follow-up", `Taste: ${o.face} ${o.label}`);
  render();
}

function toggleRecipePrompt(n) {
  const f = state.follow;
  const p = SIM.followUp.recipePrompts[n];
  f.comment = document.getElementById("followComment").value;
  f.recipe = f.recipe.includes(p) ? f.recipe.filter((x) => x !== p) : f.recipe.concat(p);
  log("Follow-up", `Recipe feedback ${f.recipe.includes(p) ? "added" : "removed"}: ${p}`);
  render();
}

function answerIngredient(id, answer) {
  const item = state.inventory.find((i) => i.id === id);
  state.follow.comment = document.getElementById("followComment").value;
  state.follow.ingredients[id] = answer;
  if (answer === "Went bad") {
    item.status = "spoiled";
    log("Inventory", `${item.name}: “Went bad”. Recorded as spoilage data (estimate was “${item.freshness}”)`);
  } else if (answer === "Some left") {
    item.status = "confirmed";
    log("Inventory", `${item.name}: “Some left”. Kept in inventory (a little is still in the fridge)`);
  } else {
    item.status = "used";
    log("Inventory", `${item.name}: “${answer}”. Removed from inventory`);
  }
  render();
}

function answerStill(id, answer) {
  const item = state.inventory.find((i) => i.id === id);
  state.follow.comment = document.getElementById("followComment").value;
  state.follow.still[id] = answer;
  item.status = answer === "Still have it" ? "confirmed" : "missing";
  log("Inventory", `Still have these? ${item.name}: “${answer}”${answer === "It's gone" ? " (removed from inventory)" : " (kept in inventory)"}`);
  render();
}

function saveFollowUp() {
  const f = state.follow;
  const F = SIM.followUp;
  const c = state.cook;
  const r = SIM.recipes[c.recipeId];
  f.comment = document.getElementById("followComment").value.trim();
  const taste = f.taste === null ? null : F.tasteOptions[f.taste];
  log("Feedback", `Follow-up saved: taste ${taste ? taste.label : "not answered"}${taste ? ` (${taste.score}/5 vs predicted ${r.predictedRating})` : ""}; recipe: ${f.recipe.join(", ") || "none"}${f.comment ? `; comment: “${f.comment}”` : ""}`);
  log("AI", `Learning from feedback: ${taste ? `taste ${taste.score}/5 compared with predicted ${r.predictedRating}` : "no taste rating given"}${f.recipe.includes("Make again") ? "; “Make again”: will suggest this recipe again" : ""}${f.recipe.includes("Took longer") ? "; “Took longer”: will favor quicker recipes" : ""}`);
  toast(F.thanks);

  // Simulated progress: the past week's numbers + tonight's results
  const score = taste ? taste.score : r.predictedRating;
  if (!state.stats) state.stats = { ...SIM.progress.base };
  state.stats.itemsUsedBeforeBad += c.usedBeforeBad.length;
  state.stats.mealsCookedAtHome += 1;
  state.stats.ratingsSum += score;
  state.stats.ratingsCount += 1;
  state.progress = {
    itemsUsedBeforeBad: state.stats.itemsUsedBeforeBad,
    mealsCookedAtHome: state.stats.mealsCookedAtHome,
    averageRating: (state.stats.ratingsSum / state.stats.ratingsCount).toFixed(1) + " / 5",
  };
  log("Progress", `Opened “Your FridgeFit Progress”: ${state.progress.itemsUsedBeforeBad} items used before they went bad, ${state.progress.mealsCookedAtHome} meals cooked at home, average rating ${state.progress.averageRating} (simulated numbers)`);
  go("progress");
  toast(F.thanks);
}

function keepCooking() {
  const id = state.cook.recipeId;
  if (!state.rejected.includes(id)) state.rejected.push(id);      // cooked tonight, so don't suggest it again right away
  state.tonight = null;
  state.home.query = "";
  state.home.chip = null;
  log("Progress", "Tapped “Keep cooking”: returned to tonight's suggested recipes");
  showTonight("Back to tonight (after cooking)");
  go("home");
}

/* =========================== 7. RENDER =========================== */
function renderAppBar() {
  const setupScreens = ["quizPrefs", "quizTaste", "addGroceries", "receipt", "perishables"];
  const back = { quizTaste: "quizPrefs", addGroceries: "quizTaste", receipt: "addGroceries", perishables: "receipt", recipe: "home" }[state.screen];
  document.getElementById("appbar").innerHTML = `
    ${back ? `<button class="back" onclick="go('${back}')" aria-label="Back">‹</button>` : `<span class="back-spacer"></span>`}
    <div class="brand"><span class="leaf">🌿</span>FridgeFit</div>
    <span class="appbar-note">${setupScreens.includes(state.screen) ? "Setup" : ""}</span>`;
}

function render(opts = {}) {
  const screenEl = document.getElementById("screen");
  const keepScroll = opts.scrollTop ? 0 : screenEl.scrollTop;   // keep place when tapping chips
  renderAppBar();
  screenEl.innerHTML = `<div class="screen-inner">${screens[state.screen]()}</div>`;
  screenEl.scrollTop = keepScroll;
}

/* Start */
if (window.innerWidth < 900) document.body.classList.add("log-hidden");
renderLog();
render();

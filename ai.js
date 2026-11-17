// The real AI steps in FridgeFit:
//   1. pickTonightRecipes: choose tonight's 3 recipes and write the reason on each card
//   2. detectPhotoItems: list the perishables in a fridge or pantry photo, and mark what it can't identify
//   3. readReceipt: read a receipt photo or a grocery order email, line by line
// Everything else in the app stays simulated (see public/simulated_responses.js).
import Anthropic from "@anthropic-ai/sdk";

// The food ids the recipe catalog knows about. Items that match one of these can be used by recipes.
export const KNOWN_ITEMS = ["spinach", "tomatoes", "chicken", "feta", "yogurt", "eggs"];

/* ------------------------------ shared ------------------------------ */

// Sends one request that should end with a call to `toolName`, and returns that call's input.
async function callWithTool(request, toolName, config) {
  if (config.provider !== "anthropic") {
    throw new Error(`Provider "${config.provider}" isn't set up yet. Only "anthropic" is supported.`);
  }
  // Server-side fallback re-runs a declined request on another model. Haiku has no fallback.
  if (config.fallbacks && !request.model.startsWith("claude-haiku")) {
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = config.fallbacks;
  }

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment (.env)
  const response = await client.beta.messages.create(request);

  const result = {
    request,
    model: response.model,
    stopReason: response.stop_reason,
    usage: response.usage,
    content: response.content,
  };
  if (response.stop_reason === "refusal") {
    const why = response.stop_details ? ` (${response.stop_details.category}: ${response.stop_details.explanation})` : "";
    throw Object.assign(new Error(`The model declined the request${why}.`), { result });
  }
  if (response.stop_reason === "max_tokens") {
    throw Object.assign(new Error("The model ran out of output tokens before finishing."), { result });
  }
  const call = response.content.find((b) => b.type === "tool_use" && b.name === toolName);
  if (!call) throw Object.assign(new Error(`The model answered without calling ${toolName}.`), { result });
  result.toolInput = call.input;
  return result;
}

const today = () => new Date().toISOString().slice(0, 10);

// The fields every detected food item has, whether it came from a photo, a receipt or an email.
const ITEM_RULES = `- name: what it is, in plain words, as specific as you can (for example "Baby spinach" or "Bell peppers").
- matchesKnownItem: use one of these if it is clearly that food, otherwise "none": spinach (baby spinach or other loose leafy greens like it), tomatoes (fresh tomatoes, including cherry tomatoes), chicken (raw chicken), feta, yogurt, eggs.
- category: Produce, Meat (including fish), Dairy (including eggs) or Other.
- amount: a rough amount, for example "1 bag", "about 6" or "half a tub".
- freshness: a rough estimate written as "Estimated: use within N to M days". It is a guess, so keep ranges honest and never say food is safe.
- urgency: urgent (about 1 to 2 days), soon (about 2 to 4 days), week (about 5 to 10 days) or long (more than 10 days).
- confidence: high when you are sure what it is, medium when it is partly hidden or the label is hard to read, low when you are unsure.`;

const itemProperties = {
  name: { type: "string" },
  matchesKnownItem: { type: "string", enum: [...KNOWN_ITEMS, "none"] },
  category: { type: "string", enum: ["Produce", "Meat", "Dairy", "Other"] },
  amount: { type: "string" },
  freshness: { type: "string" },
  urgency: { type: "string", enum: ["urgent", "soon", "week", "long"] },
  confidence: { type: "string", enum: ["high", "medium", "low"] },
};
const itemRequired = Object.keys(itemProperties);

/* ------------------------- 1. tonight's recipes ------------------------- */

export const TONIGHT_PROMPT = `You pick tonight's dinner recipes inside FridgeFit, an app that helps busy people cook with what they already have, starting with food that is about to go bad.

You get the user's perishables (with estimated freshness), their quiz answers, the example dishes they said Yes or No to, and a catalog of recipes. Each catalog recipe lists which of the user's perishables it uses, what the user would still need to buy, and its allergens.

Choose exactly 3 different recipes from the catalog, best first, and return them by calling the suggest_recipes tool. How to choose:
- Never choose a recipe that contains one of the user's allergies or a disliked ingredient.
- Prefer recipes that use the perishables closest to going bad (urgency: urgent, then soon, then week, then long).
- Prefer recipes the user can make with what they have. A recipe that needs something they would have to buy should rank lower.
- Respect the time they have tonight and their cooking skill.
- Lean toward the cuisines they picked and dishes like the ones they said Yes to.

For each pick, write the reason the user will see on the recipe card: one short sentence, under 15 words, in plain words. Name the perishables it uses and how soon they go bad, using only what the data says, for example "Uses the spinach that needs using in 1 to 2 days, plus your tomatoes". Freshness is an estimate, so never give exact dates or say food is safe. No exclamation marks.`;

function suggestTool(recipeIds) {
  return {
    name: "suggest_recipes",
    description: "Return the 3 recipes FridgeFit should show tonight, best first, each with the reason shown to the user.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          description: "Exactly 3 different recipes, best first.",
          items: {
            type: "object",
            properties: {
              recipeId: { type: "string", enum: recipeIds, description: "The id of a recipe from the catalog." },
              reason: { type: "string", description: "One short sentence shown to the user on the recipe card." },
            },
            required: ["recipeId", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["picks"],
      additionalProperties: false,
    },
  };
}

export async function pickTonightRecipes(input, config) {
  const recipeIds = (input.catalog || []).map((r) => r.id);
  if (recipeIds.length < 3) throw new Error("The catalog sent to the AI has fewer than 3 recipes.");
  const request = {
    model: config.model,
    max_tokens: config.maxTokens ?? 16000,
    output_config: { effort: config.effort ?? "low" },
    system: TONIGHT_PROMPT,
    tools: [suggestTool(recipeIds)],
    tool_choice: { type: "auto" },
    messages: [{
      role: "user",
      content: `Here is tonight's situation for this user, as JSON:\n\n${JSON.stringify(input, null, 2)}\n\nPick 3 recipes from the catalog and return them with the suggest_recipes tool.`,
    }],
  };
  const result = await callWithTool(request, "suggest_recipes", config);
  if (!Array.isArray(result.toolInput?.picks)) {
    throw Object.assign(new Error("The model's answer had no list of picks."), { result });
  }
  result.picks = result.toolInput.picks.map((p) => ({ recipeId: String(p.recipeId), reason: String(p.reason) }));
  return result;
}

/* ---------------------- 2. fridge or pantry photo ---------------------- */

export const PHOTO_PROMPT = `You look at a photo of someone's fridge or pantry for FridgeFit, an app that suggests recipes from what people already have, starting with food that is about to go bad.

List the perishable food you can see: produce (including fruit and vegetables kept outside the fridge, like potatoes, onions or bananas), meat, fish, dairy, eggs, tofu, fresh bread and leftovers. Skip drinks, condiments, sauces, jams and shelf-stable food such as canned goods, dry pasta, rice, cereal, snacks and coffee. Only list what you can actually see. Don't guess at what might be behind other things or inside closed drawers.

For each item you can identify:
${ITEM_RULES}
Base freshness on how the food looks and its usual storage life.

Some things will look like food but you won't be able to tell what they are, for example an unlabeled container or a bin of pale round items. Put each of those in unclear, with:
- description: where it is and what it looks like, in a few words, for example "clear bin of pale round items, top shelf".
- guesses: up to 3 likely answers, most likely first.
- x and y: the center of the thing in the photo, as a percentage of the image width and height (0 is the left or top edge, 100 is the right or bottom edge).
Don't put things in unclear that you already listed as items, and don't list drinks or shelf-stable food there either.

If the photo isn't a fridge or pantry, or is too dark or blurry to read, return no items and say what is wrong in photoProblem. Otherwise leave photoProblem empty. Answer by calling the report_photo_items tool.`;

const photoTool = {
  name: "report_photo_items",
  description: "Report the perishable food visible in the photo, and the things that may be food but can't be identified.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { type: "object", properties: itemProperties, required: itemRequired, additionalProperties: false },
      },
      unclear: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            guesses: { type: "array", items: { type: "string" } },
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["description", "guesses", "x", "y"],
          additionalProperties: false,
        },
      },
      photoProblem: { type: "string" },
    },
    required: ["items", "unclear", "photoProblem"],
    additionalProperties: false,
  },
};

// image: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64 string }
export async function detectPhotoItems(image, config) {
  const request = {
    model: config.photoModel || config.model,
    max_tokens: config.maxTokens ?? 16000,
    output_config: { effort: config.photoEffort || config.effort || "low" },
    system: PHOTO_PROMPT,
    tools: [photoTool],
    tool_choice: { type: "auto" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
        { type: "text", text: "List the perishable food in this photo with the report_photo_items tool." },
      ],
    }],
  };
  const result = await callWithTool(request, "report_photo_items", config);
  const out = result.toolInput || {};
  const pct = (n) => Math.max(0, Math.min(100, Number(n) || 0));
  result.items = Array.isArray(out.items) ? out.items : [];
  result.unclear = Array.isArray(out.unclear)
    ? out.unclear.map((u) => ({ description: String(u.description || ""), guesses: (u.guesses || []).map(String).slice(0, 3), x: pct(u.x), y: pct(u.y) }))
    : [];
  result.photoProblem = String(out.photoProblem || "");
  return result;
}

/* ---------------------- 3. receipt photo or email ---------------------- */

export const RECEIPT_PROMPT = `You read grocery receipts and online grocery orders for FridgeFit, an app that tracks the perishable food people buy so it can suggest recipes before the food goes bad. The receipt comes either as a photo or as the text of an email.

List every purchased item. Skip totals, subtotals, tax, payment, savings, loyalty points, delivery fees and ads. For each item line:
- raw: the line as printed (for emails, the item name as written).
- kind: perishable (fresh produce, meat, fish, dairy, eggs, tofu, fresh bread, fresh prepared food), pantry (shelf-stable food such as rice, pasta, canned goods, oil, spices, snacks, coffee, drinks), nonfood (bags, household items, deposits), or unclear (you can't tell what it is, often because of an abbreviation).
- guesses: for unclear lines, up to 3 likely answers, most likely first. Empty for other lines.

For perishable lines, also fill in:
${ITEM_RULES}
Count freshness from today, using the purchase date if it is shown and the food's usual fridge life. For an unclear line, fill these fields from your best guess, with low confidence. For pantry and nonfood lines, use name as written, matchesKnownItem none, category Other, amount empty, freshness empty, urgency long and confidence high.

Also give the store name and purchase date if they are shown, otherwise leave them empty. If this isn't a grocery receipt or order, or you can't read it, return no lines and say why in problem. Otherwise leave problem empty. Answer by calling the report_receipt tool.`;

const receiptTool = {
  name: "report_receipt",
  description: "Report every purchased item on the receipt or order, with details for the perishable ones.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      store: { type: "string" },
      date: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            raw: { type: "string" },
            kind: { type: "string", enum: ["perishable", "pantry", "nonfood", "unclear"] },
            guesses: { type: "array", items: { type: "string" } },
            ...itemProperties,
          },
          required: ["raw", "kind", "guesses", ...itemRequired],
          additionalProperties: false,
        },
      },
      problem: { type: "string" },
    },
    required: ["store", "date", "lines", "problem"],
    additionalProperties: false,
  },
};

// source: { image: { mediaType, data } } for a photo, or { text, subject, from, date } for an email
export async function readReceipt(source, config) {
  const content = source.image
    ? [
        { type: "image", source: { type: "base64", media_type: source.image.mediaType, data: source.image.data } },
        { type: "text", text: `Today is ${today()}. Read this receipt photo with the report_receipt tool.` },
      ]
    : `Today is ${today()}. This is the text of an email that may be a grocery receipt or order.\n\nFrom: ${source.from}\nDate: ${source.date}\nSubject: ${source.subject}\n\n${source.text}\n\nRead it with the report_receipt tool.`;
  const request = {
    model: config.photoModel || config.model,
    max_tokens: config.maxTokens ?? 16000,
    output_config: { effort: config.photoEffort || config.effort || "low" },
    system: RECEIPT_PROMPT,
    tools: [receiptTool],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content }],
  };
  const result = await callWithTool(request, "report_receipt", config);
  const out = result.toolInput || {};
  result.store = String(out.store || "");
  result.date = String(out.date || "");
  result.lines = Array.isArray(out.lines) ? out.lines.map((l) => ({ ...l, guesses: (l.guesses || []).map(String).slice(0, 3) })) : [];
  result.problem = String(out.problem || "");
  return result;
}

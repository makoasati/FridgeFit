// The real AI steps in FridgeFit:
//   1. pickTonightRecipes: choose tonight's 3 recipes and write the reason on each card
//   2. detectFridgeItems: list the perishables visible in a fridge photo
// Everything else in the app stays simulated (see public/simulated_responses.js).
import Anthropic from "@anthropic-ai/sdk";

// The food ids the recipe catalog knows about. Photo items that match one of these can be used by recipes.
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

/* --------------------------- 2. fridge photo --------------------------- */

export const FRIDGE_PROMPT = `You look at a photo of the inside of someone's fridge for FridgeFit, an app that suggests recipes from what people already have, starting with food that is about to go bad.

List the perishable food you can see: produce, meat, fish, dairy, eggs, tofu and leftovers. Skip drinks, condiments, sauces, jams and anything shelf-stable. Only list what you can actually see. Don't guess at what might be behind other things or inside closed drawers.

For each item:
- name: what it is, in plain words, as specific as the photo allows (for example "Baby spinach" or "Bell peppers").
- matchesKnownItem: use one of these if it is clearly that food, otherwise "none": spinach (baby spinach or other loose leafy greens like it), tomatoes (fresh tomatoes, including cherry tomatoes), chicken (raw chicken), feta, yogurt, eggs.
- category: Produce, Meat (including fish), Dairy (including eggs) or Other.
- amount: a rough amount, for example "1 bag", "about 6" or "half a tub".
- freshness: a rough estimate written as "Estimated: use within N to M days", from how it looks and its usual fridge life. It is a guess from a photo, so keep ranges honest and never say food is safe.
- urgency: urgent (about 1 to 2 days), soon (about 2 to 4 days), week (about 5 to 10 days) or long (more than 10 days).
- confidence: high when the item is clearly visible and easy to identify, medium when it is partly hidden or the label is hard to read, low when you are unsure.

Put things you can see but cannot identify in unclear, as short descriptions like "a foil-covered dish on the top shelf". If the photo is not a fridge, or is too dark or blurry to read, return no items and say what is wrong in photoProblem. Otherwise leave photoProblem empty. Answer by calling the report_fridge_items tool.`;

const fridgeTool = {
  name: "report_fridge_items",
  description: "Report the perishable food visible in the fridge photo.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            matchesKnownItem: { type: "string", enum: [...KNOWN_ITEMS, "none"] },
            category: { type: "string", enum: ["Produce", "Meat", "Dairy", "Other"] },
            amount: { type: "string" },
            freshness: { type: "string" },
            urgency: { type: "string", enum: ["urgent", "soon", "week", "long"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["name", "matchesKnownItem", "category", "amount", "freshness", "urgency", "confidence"],
          additionalProperties: false,
        },
      },
      unclear: { type: "array", items: { type: "string" } },
      photoProblem: { type: "string" },
    },
    required: ["items", "unclear", "photoProblem"],
    additionalProperties: false,
  },
};

// image: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64 string }
export async function detectFridgeItems(image, config) {
  const request = {
    model: config.photoModel || config.model,
    max_tokens: config.maxTokens ?? 16000,
    output_config: { effort: config.photoEffort || config.effort || "low" },
    system: FRIDGE_PROMPT,
    tools: [fridgeTool],
    tool_choice: { type: "auto" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
        { type: "text", text: "List the perishable food in this fridge photo with the report_fridge_items tool." },
      ],
    }],
  };
  const result = await callWithTool(request, "report_fridge_items", config);
  const out = result.toolInput || {};
  result.items = Array.isArray(out.items) ? out.items : [];
  result.unclear = Array.isArray(out.unclear) ? out.unclear.map(String) : [];
  result.photoProblem = String(out.photoProblem || "");
  return result;
}

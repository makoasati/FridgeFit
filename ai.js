// The one real AI step in FridgeFit: pick tonight's recipes.
// Everything else in the app stays simulated (see public/simulated_responses.js).
import Anthropic from "@anthropic-ai/sdk";

export const SYSTEM_PROMPT = `You pick tonight's dinner recipes inside FridgeFit, an app that helps busy people cook with what they already have, starting with food that is about to go bad.

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

function userMessage(input) {
  return `Here is tonight's situation for this user, as JSON:\n\n${JSON.stringify(input, null, 2)}\n\nPick 3 recipes from the catalog and return them with the suggest_recipes tool.`;
}

// Builds the request, calls the model, and returns the picks plus what to log.
// config comes from config.json, so the model can be switched without touching code.
export async function pickTonightRecipes(input, config) {
  if (config.provider !== "anthropic") {
    throw new Error(`Provider "${config.provider}" isn't set up yet. Only "anthropic" is supported.`);
  }
  const recipeIds = (input.catalog || []).map((r) => r.id);
  if (recipeIds.length < 3) throw new Error("The catalog sent to the AI has fewer than 3 recipes.");

  const request = {
    model: config.model,
    max_tokens: config.maxTokens ?? 16000,
    output_config: { effort: config.effort ?? "low" },
    system: SYSTEM_PROMPT,
    tools: [suggestTool(recipeIds)],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: userMessage(input) }],
  };
  // Server-side fallback re-runs a declined request on another model. Haiku has no fallback.
  if (config.fallbacks && !config.model.startsWith("claude-haiku")) {
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
  const call = response.content.find((b) => b.type === "tool_use" && b.name === "suggest_recipes");
  if (!call || !Array.isArray(call.input?.picks)) {
    throw Object.assign(new Error("The model answered without calling suggest_recipes."), { result });
  }
  result.picks = call.input.picks.map((p) => ({ recipeId: String(p.recipeId), reason: String(p.reason) }));
  return result;
}

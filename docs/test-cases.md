# Test cases for the AI step (tonight's recipes)

The AI gets the perishables, quiz answers, taste answers and recipe catalog, and returns 3 recipes with a reason for each. Each case below says how to set it up in the app. After each run, open http://localhost:3000/log to see exactly what was sent and what came back.

Unless a case says otherwise, use the sample receipt, answer Yes to "Is 'TJ ORG BBY SPN' baby spinach?", and keep all 6 perishables. That gives baby spinach (use within 1 to 2 days), cherry tomatoes and chicken thighs (about 2 days), feta and Greek yogurt (about a week) and eggs (2+ weeks). Tonight is Thursday with 25 minutes.

| # | Type | Input (how to set it up) | What a good output looks like | Why this case matters |
|---|---|---|---|---|
| 1 | Typical | Cuisines: Mediterranean. Allergies: No allergies. Weeknight time: 30 min. Yes to Shakshuka and Greek salad, No to Cheeseburger. | All 3 picks use the spinach (the most urgent item), and at least 2 also use the chicken or tomatoes. Nothing over 25 minutes. Nothing that needs a main ingredient you'd have to buy. Each reason names the real items and says "1 to 2 days" or "soon", not a made-up date. | The everyday case from the storyboard. If this fails, nothing else matters. |
| 2 | Typical | Cuisines: Indian, Mexican. Dislikes: Cilantro. Skill: Beginner. Weeknight time: 15 min. Yes to Chicken tikka masala and Chicken tacos. | Every pick takes 15 minutes or less and is Easy. Nothing with cilantro. It leans toward Indian or Mexican but still uses the spinach or chicken. If no Indian or Mexican recipe fits 15 minutes, it picks quick ones instead of breaking the time limit. | Checks that it respects time, skill and dislikes when they conflict with cuisine taste. |
| 3 | Edge | Allergies: Dairy and Eggs. On the perishables screen, remove the chicken. | No pick contains feta, yogurt, eggs or chicken. The log shows the guardrail removed 0 picks, so the model got it right on its own. It still uses the spinach and tomatoes. Reasons don't mention removed food. | Allergies are the costliest mistake. The guardrail is a backstop, and the model should not need it. |
| 4 | Failure (Lab 7: not enough ingredients) | Remove everything on the perishables screen except the eggs. | 3 picks that need the fewest things to buy, ideally egg-based. Reasons are honest about what's missing ("you'd need to buy spinach") and never claim the user has food they removed. | Our Lab 7 failure: the fridge is nearly empty. A confident answer that pretends otherwise breaks trust. |
| 5 | Failure (Lab 7: nothing appeals) | Cuisines: American only. Answer No to 7 of the 8 taste dishes and Yes only to Cheeseburger. Dislikes: Mushrooms, Olives. | It avoids the cuisines answered No where it can and picks the closest options to what the user said Yes to. Reasons stay modest, with no "you'll love this". If nothing fits well, picks that use the spinach are still a sensible fallback. | Our Lab 7 failure: the user doesn't like any suggestion. Checks how it handles a narrow taste profile on day one. |

## What to note after each run

- Did all 3 picks follow the rules (allergies, dislikes, time)?
- Did the reasons say anything untrue about the food or dates?
- Did the guardrail have to remove anything? (Check the log for "Guardrail removed".)
- How long did it take? (`latencyMs` in the log)

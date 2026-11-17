/*
 * FridgeFit — SIMULATED AI RESPONSES
 * ----------------------------------
 * Every "AI" output in the prototype comes from this one file.
 * Edit the text and numbers here to change what the app shows.
 * To connect a real model later, replace one section (for example `receipt`)
 * with a call to the model; app.js reads these through the `AI` section only.
 *
 * Nothing here is real AI: it is predefined data plus simple rules in app.js.
 */
window.SIM = {

  /* ---------- Context for "tonight" (from the spec's example) ---------- */
  context: {
    day: "Thursday",
    minutesTonight: 25,
  },

  /* ---------- Step 1: onboarding quiz options ---------- */
  quiz: {
    cuisines: ["Mediterranean", "Italian", "Mexican", "Indian", "Asian", "Middle Eastern", "American"],
    dislikes: ["Mushrooms", "Olives", "Cilantro", "Tofu", "Very spicy food", "No dislikes"],
    allergies: ["Peanuts", "Tree nuts", "Dairy", "Eggs", "Gluten", "Shellfish", "Fish", "Soy", "No allergies"],
    skills: ["Beginner", "Comfortable", "Confident"],
    times: ["15 min", "30 min", "45+ min"],
    budgets: ["Under $50 / week", "$50–$100 / week", "$100+ / week"],
  },

  /* 8 example recipes for the Yes / No taste check (emoji tiles) */
  exampleRecipes: [
    { id: "ex1", name: "Shakshuka",              emoji: "🍳", cuisine: "Mediterranean",  bg: "#fde8d7" },
    { id: "ex2", name: "Chicken tikka masala",   emoji: "🍛", cuisine: "Indian",         bg: "#fff1c9" },
    { id: "ex3", name: "Chicken tacos",          emoji: "🌮", cuisine: "Mexican",        bg: "#e3f2d9" },
    { id: "ex4", name: "Greek salad",            emoji: "🥗", cuisine: "Mediterranean",  bg: "#dff0ea" },
    { id: "ex5", name: "Spaghetti pomodoro",     emoji: "🍝", cuisine: "Italian",        bg: "#fbe1e1" },
    { id: "ex6", name: "Veggie stir-fry noodles",emoji: "🍜", cuisine: "Asian",          bg: "#e6eefc" },
    { id: "ex7", name: "Falafel wrap",           emoji: "🥙", cuisine: "Middle Eastern", bg: "#f3e8fb" },
    { id: "ex8", name: "Cheeseburger",           emoji: "🍔", cuisine: "American",       bg: "#f6ecdc" },
  ],

  /* ---------- Step 1: adding groceries ---------- */
  connectEmailResult: "Simulated: email connected. No new grocery orders found this week. Snap a receipt to add Monday's groceries.",
  fridgePhotoResult: "Simulated fridge photo: nothing new found beyond your receipt. (Fridge photos are optional.)",

  /* Sample receipt + what the "AI" reads from each line.
     kind: "perishable" → tracked, "unclear" → ask the user, "pantry" → assumed on hand, not tracked */
  receipt: {
    store: "TRADER JOE'S",
    when: "Monday · 6:42 PM",
    lines: [
      { raw: "TJ ORG BBY SPN",        price: "3.49", kind: "unclear",    itemId: "spinach" },
      { raw: "EGGS LARGE 12CT",       price: "3.99", kind: "perishable", itemId: "eggs" },
      { raw: "FETA CRUMBLES",         price: "4.29", kind: "perishable", itemId: "feta" },
      { raw: "CHERRY TOMATOES",       price: "3.29", kind: "perishable", itemId: "tomatoes" },
      { raw: "CHKN THIGH BNLS 1LB",   price: "6.49", kind: "perishable", itemId: "chicken" },
      { raw: "GREEK YOGURT PLAIN",    price: "4.99", kind: "perishable", itemId: "yogurt" },
      { raw: "JASMINE RICE",          price: "2.99", kind: "pantry" },
      { raw: "OLIVE OIL",             price: "8.99", kind: "pantry" },
    ],
    total: "38.52",
  },

  /* Unclear receipt line question */
  unclearQuestion: {
    raw: "TJ ORG BBY SPN",
    question: "Is ‘TJ ORG BBY SPN’ baby spinach?",
    guess: "Baby spinach",
    alternatives: ["Baby kale", "Spring mix", "Not food: leave it out"],
  },

  /* Perishables the "AI" found, with ESTIMATED freshness ranges (never exact dates).
     urgency: urgent | soon | week | long (controls the tag colour)
     highRisk: meat, fish, dairy, leftovers → freshness check before cooking */
  perishables: [
    { id: "spinach",  name: "Baby spinach",    emoji: "🥬", qty: "1 bag",     category: "Produce", freshness: "Estimated: use within 1–2 days", urgency: "urgent", confidence: "Needs your check", highRisk: false },
    { id: "tomatoes", name: "Cherry tomatoes", emoji: "🍅", qty: "1 pint",    category: "Produce", freshness: "Estimated: use within 2 days",   urgency: "soon",   confidence: "High confidence",  highRisk: false },
    { id: "chicken",  name: "Chicken thighs",  emoji: "🍗", qty: "1 lb",      category: "Meat",    freshness: "Estimated: use within 2 days",   urgency: "soon",   confidence: "High confidence",  highRisk: true },
    { id: "feta",     name: "Feta cheese",     emoji: "🧀", qty: "1 tub",     category: "Dairy",   freshness: "Good for about a week",          urgency: "week",   confidence: "High confidence",  highRisk: true },
    { id: "yogurt",   name: "Greek yogurt",    emoji: "🥣", qty: "1 tub",     category: "Dairy",   freshness: "Good for about a week",          urgency: "week",   confidence: "High confidence",  highRisk: true },
    { id: "eggs",     name: "Eggs",            emoji: "🥚", qty: "12",        category: "Dairy",   freshness: "Good for 2+ weeks",              urgency: "long",   confidence: "High confidence",  highRisk: false },
  ],

  pantryNote: "Pantry staples (oil, salt, rice) are assumed to be on hand, so we don't track them.",

  /* ---------- Step 2: recipes ----------
     Each recipe is keyed by its id.
     ingredients:
       key       → short name used in the steps as {key} (the app swaps in replacement names)
       invId     → which grocery from `perishables` it uses (null = not tracked)
       pantry    → true for staples assumed on hand (oil, salt, rice, spices…)
       optional  → true if the dish still works without it
       allergens → use only: Peanuts, Tree nuts, Dairy, Eggs, Gluten, Shellfish, Fish, Soy
     dislikeTags → use only: Mushrooms, Olives, Cilantro, Tofu, Very spicy food
     tags (filter chips) → Spicy, "15 min" (only if 15 minutes or less), Comfort food,
       Cooking for 2, and the cuisine name.
     stepCount must equal the number of steps. */
  recipes: {

    omelet: {
      id: "omelet",
      name: "Spinach, feta & tomato omelet",
      emoji: "🍳",
      bg: "#fde8d7",
      cuisine: "Mediterranean",
      minutes: 15,
      difficulty: "Easy",
      stepCount: 4,
      predictedRating: 4.6,
      tags: ["15 min", "Mediterranean", "Cooking for 2"],
      dislikeTags: [],
      reason: "Uses the spinach expiring tomorrow and tomatoes expiring soon",
      ingredients: [
        { key: "eggs",     name: "Eggs",            qty: "3",              invId: "eggs",     allergens: ["Eggs"] },
        { key: "spinach",  name: "Baby spinach",    qty: "2 handfuls",     invId: "spinach",  allergens: [] },
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 cup, halved",  invId: "tomatoes", allergens: [] },
        { key: "feta",     name: "Feta cheese",     qty: "1/4 cup",        invId: "feta",     allergens: ["Dairy"] },
        { key: "oil",      name: "Olive oil",       qty: "1 tbsp",         invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Whisk the {eggs} with a pinch of salt and pepper.",
        "Heat the {oil} in a pan over medium heat. Add the {tomatoes} and cook 2 minutes.",
        "Add the {spinach} and stir until just wilted (about 1 minute).",
        "Pour in the {eggs}, sprinkle the {feta}, and cook until set. Fold and serve.",
      ],
    },

    lemonChicken: {
      id: "lemonChicken",
      name: "Lemon chicken with spinach rice",
      emoji: "🍋",
      bg: "#fff6c9",
      cuisine: "Mediterranean",
      minutes: 25,
      difficulty: "Medium",
      stepCount: 8,
      predictedRating: 4.4,
      tags: ["Mediterranean", "Cooking for 2", "Comfort food"],
      dislikeTags: [],
      reason: "Uses chicken and spinach before they spoil",
      ingredients: [
        { key: "chicken", name: "Chicken thighs", qty: "1 lb",          invId: "chicken", allergens: [] },
        { key: "spinach", name: "Baby spinach",   qty: "2 big handfuls", invId: "spinach", allergens: [] },
        { key: "rice",    name: "Rice",           qty: "1 cup",         invId: null, pantry: true, allergens: [] },
        { key: "lemon",   name: "Lemon",          qty: "1",             invId: null, optional: true, allergens: [] },
        { key: "garlic",  name: "Garlic",         qty: "2 cloves, minced", invId: null, pantry: true, allergens: [] },
        { key: "oil",     name: "Olive oil",      qty: "2 tbsp",        invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Rinse the {rice}, then simmer it in 2 cups of salted water, covered, for about 15 minutes.",
        "While the rice cooks, pat the {chicken} dry and season with salt, pepper, and the zest of the {lemon}.",
        "Heat 1 tbsp {oil} in a pan over medium-high heat.",
        "Cook the {chicken} 5–6 minutes per side until golden and cooked through.",
        "Move the {chicken} to a plate and squeeze half the {lemon} over it. Let it rest 3 minutes.",
        "In the same pan, warm the rest of the oil and cook the {garlic} for 30 seconds.",
        "Add the {spinach} and stir until wilted (about 1 minute), then fold it into the cooked rice.",
        "Slice the {chicken} and serve it over the {spinach} rice with a squeeze of {lemon}.",
      ],
    },

    medBowl: {
      id: "medBowl",
      name: "Mediterranean chicken rice bowl with yogurt sauce",
      emoji: "🥙",
      bg: "#dff0ea",
      cuisine: "Mediterranean",
      minutes: 25,
      difficulty: "Medium",
      stepCount: 6,
      predictedRating: 4.2,
      tags: ["Mediterranean", "Cooking for 2"],
      dislikeTags: [],
      reason: "Uses chicken, tomatoes, and yogurt",
      ingredients: [
        { key: "chicken",  name: "Chicken thighs",  qty: "1 lb",            invId: "chicken",  allergens: [] },
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 cup, halved",   invId: "tomatoes", allergens: [] },
        { key: "yogurt",   name: "Greek yogurt",    qty: "1/2 cup",         invId: "yogurt",   allergens: ["Dairy"] },
        { key: "rice",     name: "Rice",            qty: "1 cup",           invId: null, pantry: true, allergens: [] },
        { key: "garlic",   name: "Garlic",          qty: "1 clove, grated", invId: null, pantry: true, allergens: [] },
        { key: "spices",   name: "Cumin and paprika", qty: "1 tsp each",    invId: null, pantry: true, allergens: [] },
        { key: "oil",      name: "Olive oil",       qty: "1 tbsp",          invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Simmer the {rice} in 2 cups of salted water, covered, for about 15 minutes.",
        "Cut the {chicken} into bite-size pieces and toss with the {spices}, salt, and pepper.",
        "Heat the {oil} in a pan and cook the {chicken} 7–8 minutes, stirring, until cooked through.",
        "Stir the {yogurt} with the {garlic} and a pinch of salt to make the sauce.",
        "Season the {tomatoes} with a little salt.",
        "Spoon rice into bowls, top with {chicken} and {tomatoes}, and drizzle with the {yogurt} sauce.",
      ],
    },

    sheetPan: {
      id: "sheetPan",
      name: "Sheet-pan chicken and tomatoes",
      emoji: "🍗",
      bg: "#fbe1e1",
      cuisine: "Mediterranean",
      minutes: 20,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.3,
      tags: ["Mediterranean", "Comfort food"],
      dislikeTags: [],
      reason: "Uses chicken expiring soon",
      ingredients: [
        { key: "chicken",  name: "Chicken thighs",  qty: "1 lb",      invId: "chicken",  allergens: [] },
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 pint",    invId: "tomatoes", allergens: [] },
        { key: "oil",      name: "Olive oil",       qty: "2 tbsp",    invId: null, pantry: true, allergens: [] },
        { key: "garlic",   name: "Garlic",          qty: "3 cloves, smashed", invId: null, pantry: true, allergens: [] },
        { key: "spices",   name: "Dried oregano",   qty: "1 tsp",     invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Heat the oven to 425°F (220°C).",
        "Put the {chicken} and {tomatoes} on a baking sheet with the {garlic}.",
        "Drizzle with the {oil}, then sprinkle with the {spices}, salt, and pepper. Toss to coat.",
        "Roast for about 18 minutes, until the {chicken} is cooked through and the {tomatoes} burst.",
        "Spoon the pan juices over everything and serve.",
      ],
    },

    chickpeaSkillet: {
      id: "chickpeaSkillet",
      name: "Chickpea, spinach & tomato skillet",
      emoji: "🥘",
      bg: "#e3f2d9",
      cuisine: "Mediterranean",
      minutes: 20,
      difficulty: "Easy",
      stepCount: 4,
      predictedRating: 4.5,
      tags: ["Mediterranean", "Cooking for 2"],
      dislikeTags: [],
      reason: "Uses the spinach expiring tomorrow and the tomatoes, no meat needed",
      ingredients: [
        { key: "chickpeas", name: "Canned chickpeas", qty: "1 can, drained", invId: null, pantry: true, allergens: [] },
        { key: "spinach",   name: "Baby spinach",     qty: "3 handfuls",     invId: "spinach",  allergens: [] },
        { key: "tomatoes",  name: "Cherry tomatoes",  qty: "1 cup, halved",  invId: "tomatoes", allergens: [] },
        { key: "garlic",    name: "Garlic",           qty: "2 cloves, sliced", invId: null, pantry: true, allergens: [] },
        { key: "spices",    name: "Ground cumin",     qty: "1 tsp",          invId: null, pantry: true, allergens: [] },
        { key: "oil",       name: "Olive oil",        qty: "2 tbsp",         invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Heat the {oil} in a large pan over medium heat and cook the {garlic} for 30 seconds.",
        "Add the {tomatoes} and {spices} and cook 4 minutes, until the {tomatoes} soften.",
        "Stir in the {chickpeas} with a pinch of salt and cook 5 minutes.",
        "Add the {spinach} and stir until wilted (about 1 minute). Serve warm.",
      ],
    },

    peanutNoodles: {
      id: "peanutNoodles",
      name: "Peanut chicken noodles",
      emoji: "🥜",
      bg: "#f6ecdc",
      cuisine: "Asian",
      minutes: 20,
      difficulty: "Easy",
      stepCount: 4,
      predictedRating: 4.2,
      tags: ["Asian", "Cooking for 2"],
      dislikeTags: [],
      reason: "Uses chicken and spinach before they spoil",
      ingredients: [
        { key: "chicken",      name: "Chicken thighs",  qty: "1 lb, sliced",  invId: "chicken", allergens: [] },
        { key: "spinach",      name: "Baby spinach",    qty: "2 handfuls",    invId: "spinach", allergens: [] },
        { key: "peanutButter", name: "Peanut butter",   qty: "3 tbsp",        invId: null, pantry: true, allergens: ["Peanuts"] },
        { key: "soySauce",     name: "Soy sauce",       qty: "2 tbsp",        invId: null, pantry: true, allergens: ["Soy", "Gluten"] },
        { key: "noodles",      name: "Spaghetti or noodles", qty: "8 oz",     invId: null, pantry: true, allergens: ["Gluten"] },
        { key: "oil",          name: "Vegetable oil",   qty: "1 tbsp",        invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Cook the {noodles} in salted boiling water according to the package (about 10 minutes).",
        "Meanwhile, heat the {oil} and cook the {chicken} 6–7 minutes until cooked through.",
        "Whisk the {peanutButter} and {soySauce} with 3 tbsp hot water until smooth.",
        "Toss the noodles, {chicken}, sauce, and {spinach} together until wilted.",
      ],
    },

    shakshuka: {
      id: "shakshuka",
      name: "Spinach & feta shakshuka",
      emoji: "🍳",
      bg: "#fde8d7",
      cuisine: "Mediterranean",
      minutes: 25,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.5,
      tags: ["Mediterranean", "Spicy", "Comfort food"],
      dislikeTags: [],
      reason: "Uses the spinach expiring tomorrow, plus the tomatoes and feta",
      ingredients: [
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 pint, halved", invId: "tomatoes", allergens: [] },
        { key: "spinach",  name: "Baby spinach",    qty: "2 handfuls",     invId: "spinach",  allergens: [] },
        { key: "eggs",     name: "Eggs",            qty: "4",              invId: "eggs",     allergens: ["Eggs"] },
        { key: "feta",     name: "Feta cheese",     qty: "1/4 cup",        invId: "feta",     allergens: ["Dairy"] },
        { key: "garlic",   name: "Garlic",          qty: "2 cloves, sliced", invId: null, pantry: true, allergens: [] },
        { key: "spices",   name: "Paprika and chili flakes", qty: "1 tsp + a pinch", invId: null, pantry: true, allergens: [] },
        { key: "oil",      name: "Olive oil",       qty: "2 tbsp",         invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Heat the {oil} in a pan over medium heat and cook the {garlic} and {spices} for 30 seconds.",
        "Add the {tomatoes} with a pinch of salt and cook 8 minutes until saucy, mashing them a little.",
        "Stir in the {spinach} until wilted (about 1 minute).",
        "Make 4 small wells and crack in the {eggs}. Cover and cook 5–6 minutes until the whites set.",
        "Crumble the {feta} on top and serve with bread if you have it.",
      ],
    },

    huevosRancheros: {
      id: "huevosRancheros",
      name: "Quick huevos rancheros",
      emoji: "🌮",
      bg: "#e3f2d9",
      cuisine: "Mexican",
      minutes: 10,
      difficulty: "Easy",
      stepCount: 4,
      predictedRating: 4.3,
      tags: ["Mexican", "15 min", "Spicy"],
      dislikeTags: [],
      reason: "Uses up the eggs and the tomatoes expiring soon",
      ingredients: [
        { key: "eggs",      name: "Eggs",            qty: "4",          invId: "eggs",     allergens: ["Eggs"] },
        { key: "tomatoes",  name: "Cherry tomatoes", qty: "1 cup, chopped", invId: "tomatoes", allergens: [] },
        { key: "tortillas", name: "Corn tortillas",  qty: "4",          invId: null, allergens: [] },
        { key: "spices",    name: "Chili powder",    qty: "1/2 tsp",    invId: null, pantry: true, allergens: [] },
        { key: "oil",       name: "Vegetable oil",   qty: "1 tbsp",     invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Cook the {tomatoes} with the {spices} and a pinch of salt for 3 minutes to make a quick salsa.",
        "Warm the {tortillas} in a dry pan, about 30 seconds per side.",
        "Heat the {oil} and fry the {eggs} until the whites are set (about 3 minutes).",
        "Top the warm {tortillas} with the {eggs} and spoon the salsa over the top.",
      ],
    },

    chickenTacos: {
      id: "chickenTacos",
      name: "Spicy chicken tacos with yogurt crema",
      emoji: "🌮",
      bg: "#fff1c9",
      cuisine: "Mexican",
      minutes: 20,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.4,
      tags: ["Mexican", "Spicy", "Cooking for 2"],
      dislikeTags: ["Very spicy food"],
      reason: "Uses the chicken and tomatoes before they spoil",
      ingredients: [
        { key: "chicken",   name: "Chicken thighs",  qty: "1 lb",          invId: "chicken",  allergens: [] },
        { key: "tomatoes",  name: "Cherry tomatoes", qty: "1 cup, chopped", invId: "tomatoes", allergens: [] },
        { key: "yogurt",    name: "Greek yogurt",    qty: "1/3 cup",       invId: "yogurt",   allergens: ["Dairy"] },
        { key: "tortillas", name: "Corn tortillas",  qty: "8",             invId: null, allergens: [] },
        { key: "spices",    name: "Chili powder and cayenne", qty: "2 tsp + a pinch", invId: null, pantry: true, allergens: [] },
        { key: "oil",       name: "Vegetable oil",   qty: "1 tbsp",        invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Slice the {chicken} into strips and toss with the {spices} and a pinch of salt.",
        "Heat the {oil} in a pan and cook the {chicken} 7–8 minutes until cooked through.",
        "Stir the {yogurt} with a pinch of salt and a splash of water to make the crema.",
        "Warm the {tortillas} in a dry pan, about 30 seconds per side.",
        "Fill the {tortillas} with {chicken} and {tomatoes}, then drizzle with crema.",
      ],
    },

    burritoBowl: {
      id: "burritoBowl",
      name: "Chicken & tomato burrito bowl",
      emoji: "🌯",
      bg: "#f6ecdc",
      cuisine: "Mexican",
      minutes: 20,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.2,
      tags: ["Mexican", "Cooking for 2"],
      dislikeTags: [],
      reason: "Uses the chicken, tomatoes, and spinach before they spoil",
      ingredients: [
        { key: "chicken",  name: "Chicken thighs",  qty: "1 lb, diced",   invId: "chicken",  allergens: [] },
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 cup, chopped", invId: "tomatoes", allergens: [] },
        { key: "spinach",  name: "Baby spinach",    qty: "1 handful, chopped", invId: "spinach", allergens: [] },
        { key: "rice",     name: "Rice",            qty: "1 cup",         invId: null, pantry: true, allergens: [] },
        { key: "spices",   name: "Cumin and chili powder", qty: "1 tsp each", invId: null, pantry: true, allergens: [] },
        { key: "oil",      name: "Vegetable oil",   qty: "1 tbsp",        invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Simmer the {rice} in 2 cups of salted water, covered, for about 15 minutes.",
        "Toss the {chicken} with the {spices} and a pinch of salt.",
        "Heat the {oil} and cook the {chicken} 7–8 minutes, stirring, until cooked through.",
        "Mix the {tomatoes} and {spinach} with a pinch of salt for a quick salsa.",
        "Spoon rice into bowls and top with the {chicken} and salsa.",
      ],
    },

    chickenTikka: {
      id: "chickenTikka",
      name: "Yogurt-marinated chicken tikka",
      emoji: "🍛",
      bg: "#fff1c9",
      cuisine: "Indian",
      minutes: 25,
      difficulty: "Medium",
      stepCount: 5,
      predictedRating: 4.3,
      tags: ["Indian", "Spicy", "Comfort food"],
      dislikeTags: [],
      reason: "Uses the chicken expiring soon and the yogurt",
      ingredients: [
        { key: "chicken",  name: "Chicken thighs",  qty: "1 lb, cubed",   invId: "chicken",  allergens: [] },
        { key: "yogurt",   name: "Greek yogurt",    qty: "1/2 cup",       invId: "yogurt",   allergens: ["Dairy"] },
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 cup, halved", invId: "tomatoes", allergens: [] },
        { key: "rice",     name: "Rice",            qty: "1 cup",         invId: null, pantry: true, allergens: [] },
        { key: "spices",   name: "Garam masala and chili powder", qty: "2 tsp + 1/2 tsp", invId: null, pantry: true, allergens: [] },
        { key: "garlic",   name: "Garlic",          qty: "2 cloves, grated", invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Start the {rice}: simmer in 2 cups of salted water, covered, for about 15 minutes.",
        "Mix the {yogurt}, {spices}, {garlic}, and a pinch of salt. Stir in the {chicken} and let it sit 5 minutes.",
        "Heat the oven broiler (grill) to high and spread the {chicken} and {tomatoes} on a baking sheet.",
        "Broil 10–12 minutes, turning once, until the {chicken} is charred at the edges and cooked through.",
        "Serve the {chicken} and {tomatoes} over the rice.",
      ],
    },

    chanaSaag: {
      id: "chanaSaag",
      name: "Spinach & chickpea curry (chana saag)",
      emoji: "🍲",
      bg: "#e3f2d9",
      cuisine: "Indian",
      minutes: 25,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.2,
      tags: ["Indian", "Spicy", "Comfort food"],
      dislikeTags: [],
      reason: "Uses the spinach expiring tomorrow and the tomatoes",
      ingredients: [
        { key: "spinach",   name: "Baby spinach",     qty: "1 bag",          invId: "spinach",  allergens: [] },
        { key: "tomatoes",  name: "Cherry tomatoes",  qty: "1 cup, chopped", invId: "tomatoes", allergens: [] },
        { key: "chickpeas", name: "Canned chickpeas", qty: "1 can, drained", invId: null, pantry: true, allergens: [] },
        { key: "rice",      name: "Rice",             qty: "1 cup",          invId: null, pantry: true, allergens: [] },
        { key: "spices",    name: "Garam masala and chili flakes", qty: "2 tsp + a pinch", invId: null, pantry: true, allergens: [] },
        { key: "garlic",    name: "Garlic",           qty: "2 cloves, minced", invId: null, pantry: true, allergens: [] },
        { key: "oil",       name: "Vegetable oil",    qty: "2 tbsp",         invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Simmer the {rice} in 2 cups of salted water, covered, for about 15 minutes.",
        "Heat the {oil} and cook the {garlic} and {spices} for 30 seconds.",
        "Add the {tomatoes} and cook 5 minutes until soft.",
        "Stir in the {chickpeas} and 1/2 cup water and simmer 5 minutes.",
        "Add the {spinach} a handful at a time until wilted. Serve over the rice.",
      ],
    },

    tomatoPasta: {
      id: "tomatoPasta",
      name: "Creamy tomato spinach pasta",
      emoji: "🍝",
      bg: "#fbe1e1",
      cuisine: "Italian",
      minutes: 20,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.4,
      tags: ["Italian", "Comfort food", "Cooking for 2"],
      dislikeTags: [],
      reason: "Uses the spinach expiring tomorrow and the tomatoes",
      ingredients: [
        { key: "pasta",    name: "Pasta",           qty: "8 oz",          invId: null, pantry: true, allergens: ["Gluten"] },
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 pint, halved", invId: "tomatoes", allergens: [] },
        { key: "spinach",  name: "Baby spinach",    qty: "2 handfuls",    invId: "spinach",  allergens: [] },
        { key: "yogurt",   name: "Greek yogurt",    qty: "1/3 cup",       invId: "yogurt",   allergens: ["Dairy"] },
        { key: "garlic",   name: "Garlic",          qty: "2 cloves, sliced", invId: null, pantry: true, allergens: [] },
        { key: "oil",      name: "Olive oil",       qty: "2 tbsp",        invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Cook the {pasta} in salted boiling water according to the package (about 10 minutes). Save 1/2 cup of the water.",
        "Meanwhile, heat the {oil} and cook the {garlic} for 30 seconds.",
        "Add the {tomatoes} and cook 6 minutes until they burst.",
        "Turn off the heat and stir in the {yogurt} with a splash of pasta water until creamy.",
        "Toss in the pasta and {spinach} until wilted. Season with salt and pepper.",
      ],
    },

    orzoSoup: {
      id: "orzoSoup",
      name: "Chicken & spinach orzo soup",
      emoji: "🍜",
      bg: "#fff6c9",
      cuisine: "Italian",
      minutes: 25,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.2,
      tags: ["Italian", "Comfort food"],
      dislikeTags: [],
      reason: "Uses chicken and spinach before they spoil",
      ingredients: [
        { key: "chicken", name: "Chicken thighs", qty: "1/2 lb, diced",  invId: "chicken", allergens: [] },
        { key: "spinach", name: "Baby spinach",   qty: "2 handfuls",     invId: "spinach", allergens: [] },
        { key: "orzo",    name: "Orzo (or small pasta)", qty: "1/2 cup", invId: null, pantry: true, allergens: ["Gluten"] },
        { key: "broth",   name: "Chicken broth (or water + bouillon)", qty: "4 cups", invId: null, pantry: true, allergens: [] },
        { key: "lemon",   name: "Lemon",          qty: "1/2",            invId: null, optional: true, allergens: [] },
        { key: "garlic",  name: "Garlic",         qty: "2 cloves, minced", invId: null, pantry: true, allergens: [] },
        { key: "oil",     name: "Olive oil",      qty: "1 tbsp",         invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Heat the {oil} in a pot and cook the {chicken} and {garlic} for 4 minutes.",
        "Pour in the {broth} and bring to a boil.",
        "Add the {orzo} and simmer 9–10 minutes, stirring now and then.",
        "Stir in the {spinach} until wilted (about 1 minute).",
        "Squeeze in the {lemon}, season with salt and pepper, and serve.",
      ],
    },

    bakedEggs: {
      id: "bakedEggs",
      name: "Italian-style baked eggs in tomato sauce",
      emoji: "🥚",
      bg: "#fbe1e1",
      cuisine: "Italian",
      minutes: 20,
      difficulty: "Easy",
      stepCount: 4,
      predictedRating: 4.3,
      tags: ["Italian", "Comfort food"],
      dislikeTags: [],
      reason: "Uses up the feta and eggs, plus the tomatoes expiring soon",
      ingredients: [
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 pint, halved", invId: "tomatoes", allergens: [] },
        { key: "eggs",     name: "Eggs",            qty: "4",              invId: "eggs",     allergens: ["Eggs"] },
        { key: "feta",     name: "Feta cheese",     qty: "1/4 cup",        invId: "feta",     allergens: ["Dairy"] },
        { key: "spices",   name: "Dried oregano",   qty: "1 tsp",          invId: null, pantry: true, allergens: [] },
        { key: "oil",      name: "Olive oil",       qty: "2 tbsp",         invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Heat the oven to 400°F (200°C).",
        "Toss the {tomatoes} with the {oil}, {spices}, and salt in a small baking dish. Bake 8 minutes.",
        "Make 4 small wells and crack in the {eggs}. Crumble the {feta} around them.",
        "Bake 8–10 minutes until the whites are set. Serve with toast if you like.",
      ],
    },

    eggFriedRice: {
      id: "eggFriedRice",
      name: "Spinach egg fried rice",
      emoji: "🍚",
      bg: "#e6eefc",
      cuisine: "Asian",
      minutes: 15,
      difficulty: "Easy",
      stepCount: 4,
      predictedRating: 4.3,
      tags: ["Asian", "15 min"],
      dislikeTags: [],
      reason: "Uses the spinach expiring tomorrow and the eggs",
      ingredients: [
        { key: "rice",     name: "Cooked rice (leftover or microwave)", qty: "2 cups", invId: null, pantry: true, allergens: [] },
        { key: "eggs",     name: "Eggs",           qty: "3",          invId: "eggs",    allergens: ["Eggs"] },
        { key: "spinach",  name: "Baby spinach",   qty: "2 handfuls", invId: "spinach", allergens: [] },
        { key: "soySauce", name: "Soy sauce",      qty: "2 tbsp",     invId: null, pantry: true, allergens: ["Soy", "Gluten"] },
        { key: "garlic",   name: "Garlic",         qty: "2 cloves, minced", invId: null, pantry: true, allergens: [] },
        { key: "oil",      name: "Vegetable oil",  qty: "2 tbsp",     invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Heat the {oil} in a large pan over high heat and cook the {garlic} for 30 seconds.",
        "Add the {rice} and stir-fry 3–4 minutes until hot.",
        "Push the rice aside, scramble the {eggs} in the empty space, then mix them in.",
        "Add the {spinach} and {soySauce} and toss until wilted (about 1 minute).",
      ],
    },

    tofuStirFry: {
      id: "tofuStirFry",
      name: "Garlic tofu & spinach stir-fry",
      emoji: "🥢",
      bg: "#f3e8fb",
      cuisine: "Asian",
      minutes: 15,
      difficulty: "Easy",
      stepCount: 4,
      predictedRating: 4.0,
      tags: ["Asian", "15 min"],
      dislikeTags: ["Tofu"],
      reason: "Uses the spinach expiring tomorrow and the tomatoes",
      ingredients: [
        { key: "tofu",     name: "Firm tofu",       qty: "1 block, cubed", invId: null, allergens: ["Soy"] },
        { key: "spinach",  name: "Baby spinach",    qty: "3 handfuls",     invId: "spinach",  allergens: [] },
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 cup, halved",  invId: "tomatoes", allergens: [] },
        { key: "soySauce", name: "Soy sauce",       qty: "2 tbsp",         invId: null, pantry: true, allergens: ["Soy", "Gluten"] },
        { key: "garlic",   name: "Garlic",          qty: "3 cloves, sliced", invId: null, pantry: true, allergens: [] },
        { key: "oil",      name: "Vegetable oil",   qty: "2 tbsp",         invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Pat the {tofu} dry with a towel.",
        "Heat the {oil} over medium-high heat and fry the {tofu} 6–7 minutes, turning, until golden.",
        "Add the {garlic} and {tomatoes} and cook 2 minutes.",
        "Add the {spinach} and {soySauce} and toss until wilted. Serve with rice if you have it.",
      ],
    },
    eggCurry: {
      id: "eggCurry",
      name: "Tomato & spinach egg curry",
      emoji: "🍛",
      bg: "#fff1c9",
      cuisine: "Indian",
      minutes: 25,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.2,
      tags: ["Indian"],
      dislikeTags: [],
      reason: "Uses the spinach expiring tomorrow, the tomatoes, and the eggs",
      ingredients: [
        { key: "eggs",     name: "Eggs",            qty: "4",              invId: "eggs",     allergens: ["Eggs"] },
        { key: "tomatoes", name: "Cherry tomatoes", qty: "1 pint, chopped", invId: "tomatoes", allergens: [] },
        { key: "spinach",  name: "Baby spinach",    qty: "2 handfuls",     invId: "spinach",  allergens: [] },
        { key: "rice",     name: "Rice",            qty: "1 cup",          invId: null, pantry: true, allergens: [] },
        { key: "spices",   name: "Garam masala and turmeric", qty: "2 tsp + 1/2 tsp", invId: null, pantry: true, allergens: [] },
        { key: "garlic",   name: "Garlic",          qty: "2 cloves, minced", invId: null, pantry: true, allergens: [] },
        { key: "oil",      name: "Vegetable oil",   qty: "2 tbsp",         invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Simmer the {rice} in 2 cups of salted water, covered, for about 15 minutes.",
        "Meanwhile, boil the {eggs} for 9 minutes, then cool them in cold water and peel.",
        "Heat the {oil} and cook the {garlic} and {spices} for 30 seconds.",
        "Add the {tomatoes} with 1/4 cup water and a pinch of salt and simmer 6 minutes until saucy.",
        "Stir in the {spinach} until wilted, add the halved {eggs}, and serve over the rice.",
      ],
    },

    gingerChicken: {
      id: "gingerChicken",
      name: "Ginger-garlic chicken & spinach stir-fry",
      emoji: "🥡",
      bg: "#e6eefc",
      cuisine: "Asian",
      minutes: 20,
      difficulty: "Easy",
      stepCount: 5,
      predictedRating: 4.3,
      tags: ["Asian"],
      dislikeTags: [],
      reason: "Uses the chicken and spinach before they spoil",
      ingredients: [
        { key: "chicken", name: "Chicken thighs", qty: "1 lb, sliced", invId: "chicken", allergens: [] },
        { key: "spinach", name: "Baby spinach",   qty: "3 handfuls",   invId: "spinach", allergens: [] },
        { key: "rice",    name: "Rice",           qty: "1 cup",        invId: null, pantry: true, allergens: [] },
        { key: "sauce",   name: "Soy-free sauce: 2 tbsp rice vinegar + 1 tbsp honey + pinch of salt", qty: "1 batch", invId: null, pantry: true, allergens: [] },
        { key: "ginger",  name: "Ground ginger (or fresh, grated)", qty: "1 tsp", invId: null, pantry: true, allergens: [] },
        { key: "garlic",  name: "Garlic",         qty: "3 cloves, minced", invId: null, pantry: true, allergens: [] },
        { key: "oil",     name: "Vegetable oil",  qty: "1 tbsp",       invId: null, pantry: true, allergens: [] },
      ],
      steps: [
        "Simmer the {rice} in 2 cups of salted water, covered, for about 15 minutes.",
        "Heat the {oil} over medium-high heat and stir-fry the {chicken} 6–7 minutes until cooked through.",
        "Add the {garlic} and {ginger} and cook 30 seconds.",
        "Pour in the {sauce} and let it bubble 1 minute until glossy.",
        "Toss in the {spinach} until wilted (about 1 minute). Serve over the rice.",
      ],
    },
  },

  /* ---------- Step 2: tonight's 3 suggestions (in order) ---------- */
  homeDefault: ["omelet", "lemonChicken", "medBowl"],

  /* Filter chips shown above the suggestions (they match recipe `tags`) */
  filterChips: ["Spicy", "15 min", "Comfort food", "Cooking for 2", "Mediterranean", "Mexican", "Italian", "Indian", "Asian"],

  /* ---------- Step 2: feedback on a suggestion ---------- */
  feedbackPrompts: ["Too hard", "Too long", "Don't like an ingredient", "Not in the mood", "Show similar"],

  /* What replaces a suggestion after feedback.
     Keyed by prompt, then by the recipe being replaced
     ("Don't like an ingredient" is keyed by ingredient key instead).
     `reason` is the new line shown under the replacement. */
  feedbackReplacements: {
    "Too hard": {
      lemonChicken: { recipeId: "sheetPan",        reason: "Easier: fewer steps, uses chicken expiring soon." },
      medBowl:      { recipeId: "burritoBowl",     reason: "Easier: simple steps, still uses the chicken and tomatoes." },
      omelet:       { recipeId: "bakedEggs",       reason: "Easier: no folding, the oven does the work. Uses the eggs and feta." },
    },
    "Too long": {
      omelet:       { recipeId: "huevosRancheros", reason: "Quicker: 10 minutes, uses the eggs and tomatoes." },
      lemonChicken: { recipeId: "omelet",          reason: "Quicker: 15 minutes, still uses the spinach." },
      medBowl:      { recipeId: "sheetPan",        reason: "Quicker: 20 minutes, still uses the chicken and tomatoes." },
    },
    "Not in the mood": {
      omelet:       { recipeId: "chickenTacos",    reason: "Something different: Mexican, uses the chicken and tomatoes." },
      lemonChicken: { recipeId: "chickenTikka",    reason: "Something different: Indian, uses the chicken and yogurt." },
      medBowl:      { recipeId: "tomatoPasta",     reason: "Something different: Italian comfort food, uses the spinach and tomatoes." },
    },
    "Don't like an ingredient": {
      feta:     { recipeId: "eggFriedRice",    reason: "No feta: uses the spinach and eggs instead." },
      yogurt:   { recipeId: "lemonChicken",    reason: "No yogurt: uses the chicken and spinach instead." },
      spinach:  { recipeId: "sheetPan",        reason: "No spinach: uses the chicken and tomatoes instead." },
      tomatoes: { recipeId: "lemonChicken",    reason: "No tomatoes: uses the chicken and spinach instead." },
      chicken:  { recipeId: "chickpeaSkillet", reason: "No chicken: uses chickpeas with the spinach and tomatoes." },
      eggs:     { recipeId: "medBowl",         reason: "No eggs: uses the chicken, tomatoes, and yogurt instead." },
      lemon:    { recipeId: "medBowl",         reason: "No lemon: uses the chicken, tomatoes, and yogurt instead." },
    },
  },

  /* "Show similar": 4 similar recipes for each suggestion, plus the line shown above them */
  similarRecipes: {
    omelet:       ["shakshuka", "bakedEggs", "huevosRancheros", "eggFriedRice"],
    lemonChicken: ["sheetPan", "orzoSoup", "medBowl", "burritoBowl"],
    medBowl:      ["burritoBowl", "chickenTikka", "chickenTacos", "lemonChicken"],
    sheetPan:     ["lemonChicken", "medBowl", "burritoBowl", "chickenTikka"],
  },
  similarReason: {
    omelet:       "Similar to the omelet: eggs + spinach",
    lemonChicken: "Similar to the lemon chicken: chicken + spinach",
    medBowl:      "Similar to the rice bowl: chicken + tomatoes",
    sheetPan:     "Similar to the sheet-pan chicken: easy chicken dinners",
  },

  /* ---------- Step 3: ingredient swaps ----------
     Keyed by ingredient key. invId = grocery you already have (null = not tracked). */
  swaps: {
    feta: [
      { name: "Goat cheese",         invId: null,     allergens: ["Dairy"], note: "Creamy and tangy, very close to feta" },
      { name: "Greek yogurt dollop", invId: "yogurt", allergens: ["Dairy"], note: "Already in your fridge" },
      { name: "Leave it out",        invId: null,     allergens: [],        note: "Still tasty, a little less salty" },
    ],
    chicken: [
      { name: "Chickpeas",   invId: null,   pantry: true, allergens: [],       note: "Canned, high protein — best match" },
      { name: "Tofu",        invId: null,   allergens: ["Soy"],  note: "Press it dry so it browns well" },
      { name: "White beans", invId: null,   pantry: true, allergens: [],       note: "Canned, soft and mild" },
      { name: "Eggs",        invId: "eggs", allergens: ["Eggs"], note: "Already in your fridge" },
    ],
    spinach: [
      { name: "Extra cherry tomatoes", invId: "tomatoes", allergens: [], note: "Already in your fridge" },
      { name: "Frozen peas",           invId: null,       allergens: [], note: "Add straight from the freezer" },
      { name: "Leave it out",          invId: null,       allergens: [], note: "Still works, just less green" },
    ],
    tomatoes: [
      { name: "Canned diced tomatoes", invId: null,      allergens: [], note: "From the pantry, if you have a can" },
      { name: "Extra baby spinach",    invId: "spinach", allergens: [], note: "Already in your fridge" },
      { name: "Leave it out",          invId: null,      allergens: [], note: "A little less juicy" },
    ],
    yogurt: [
      { name: "Sour cream",                invId: null, allergens: ["Dairy"], note: "Richer, works the same way" },
      { name: "Olive oil + lemon drizzle", invId: null, allergens: [],        note: "Dairy-free and bright" },
      { name: "Leave it out",              invId: null, allergens: [],        note: "Less creamy, still good" },
    ],
    eggs: [
      { name: "Chickpea flour + water", invId: null, allergens: [],      note: "Egg-free batter: 3 tbsp flour + 3 tbsp water per egg" },
      { name: "Silken tofu",            invId: null, allergens: ["Soy"], note: "Mash it for a soft scramble" },
    ],
    lemon: [
      { name: "Splash of vinegar", invId: null, allergens: [], note: "Adds the same brightness" },
      { name: "Leave it out",      invId: null, allergens: [], note: "It's optional, the dish still works" },
    ],
  },

  /* ---------- Step 3: freshness check for high-risk foods ---------- */
  freshnessCheck: {
    chicken: {
      question: "Check your chicken: does it look and smell fresh?",
      spoiledMessage: "Thanks. We marked the chicken as spoiled. Try a swap:",
      suggestedSwap: "Chickpeas",
    },
    feta: {
      question: "Check your feta: does it smell clean and look free of mold?",
      spoiledMessage: "Thanks. We marked the feta as spoiled. Try a swap:",
      suggestedSwap: "Leave it out",
    },
    yogurt: {
      question: "Check your yogurt: does it smell clean and look free of mold?",
      spoiledMessage: "Thanks. We marked the yogurt as spoiled. Try a swap:",
      suggestedSwap: "Olive oil + lemon drizzle",
    },
  },

  /* ---------- Step 4: problems while cooking ----------
     wentBad = the ingredient turned out to be spoiled; dontHave = it's missing. */
  ingredientIssues: {
    spinach: {
      wentBad:  { message: "Leave out the spinach and add extra tomatoes instead.", replaceWith: { name: "Extra cherry tomatoes", invId: "tomatoes", allergens: [] } },
      dontHave: { message: "No spinach? Use frozen peas, or just leave it out.",     replaceWith: { name: "Frozen peas", invId: null, allergens: [] } },
    },
    tomatoes: {
      wentBad:  { message: "Leave out the tomatoes and add extra spinach instead.",   replaceWith: { name: "Extra baby spinach", invId: "spinach", allergens: [] } },
      dontHave: { message: "No fresh tomatoes? A can of diced tomatoes works too.",   replaceWith: { name: "Canned diced tomatoes", invId: null, allergens: [] } },
    },
    chicken: {
      wentBad:  { message: "Don't use the chicken. Use a drained can of chickpeas instead and cook them 5 minutes.", replaceWith: { name: "Chickpeas", invId: null, pantry: true, allergens: [] } },
      dontHave: { message: "No chicken? Use a drained can of chickpeas instead.",     replaceWith: { name: "Chickpeas", invId: null, pantry: true, allergens: [] } },
    },
    feta: {
      wentBad:  { message: "Skip the feta and add an extra pinch of salt instead.",   replaceWith: { name: "Leave it out", invId: null, allergens: [] } },
      dontHave: { message: "No feta? A dollop of Greek yogurt adds the same tang.",   replaceWith: { name: "Greek yogurt dollop", invId: "yogurt", allergens: ["Dairy"] } },
    },
    eggs: {
      wentBad:  { message: "Don't use the eggs. Mix chickpea flour with water (3 tbsp each per egg) instead.", replaceWith: { name: "Chickpea flour + water", invId: null, allergens: [] } },
      dontHave: { message: "No eggs? Mix chickpea flour with water (3 tbsp each per egg) instead.",            replaceWith: { name: "Chickpea flour + water", invId: null, allergens: [] } },
    },
    yogurt: {
      wentBad:  { message: "Skip the yogurt and drizzle olive oil and a squeeze of lemon instead.", replaceWith: { name: "Olive oil + lemon drizzle", invId: null, allergens: [] } },
      dontHave: { message: "No yogurt? Drizzle olive oil and a squeeze of lemon instead.",          replaceWith: { name: "Olive oil + lemon drizzle", invId: null, allergens: [] } },
    },
  },

  /* ---------- Step 6: wrap-up ----------
     {items} is filled in by the app, e.g. "spinach and cherry tomatoes". */
  wrapUp: {
    title: "Nice work!",
    usedBeforeBad: "You used the {items} before they went bad.",
    nothingUrgent: "Nothing was close to going bad tonight, so your fridge is in good shape.",
    spoiledNote: "The {items} didn't make it, but your swap rescued the meal.",
    spoiledNoteLeftOut: "The {items} didn't make it, so we left that out and adjusted the steps.",
    photoButton: "Add a photo",
    photoAdded: "Looks delicious! Photo added.",
    cookbookButton: "Save to cookbook",
    cookbookSaved: "Saved to your cookbook, swaps included.",
    processQuestion: "How did cooking go?",
    processPrompts: ["Easy to follow", "Took longer than expected", "Instructions unclear"],
    commentPlaceholder: "Anything else? (optional)",
    finishButton: "Done",
  },

  /* ---------- Step 7: later (screen before the next-day notification) ----------
     {recipe} is filled in by the app. */
  later: {
    title: "Enjoy your meal!",
    body: "We'll check in tomorrow to see how it went and what's left in your fridge.",
    nextDayButton: "Next day",
    notificationApp: "FridgeFit",
    notificationTime: "Friday, 10:15 AM",
    notificationText: "How was your {recipe}? Tap to rate it and update what's left.",
  },

  /* ---------- Step 7: next-day follow-up ---------- */
  followUp: {
    title: "How was it?",
    tasteQuestion: "How did it taste?",
    tasteOptions: [
      { label: "Loved it",            face: "😍", score: 5 },
      { label: "It was okay",         face: "🙂", score: 3 },
      { label: "Wouldn't make again", face: "🙁", score: 1 },
    ],
    recipeQuestion: "What did you think of the recipe?",
    recipePrompts: ["Easy", "Took longer", "Make again"],
    ingredientsQuestion: "What happened to your ingredients?",
    ingredientOptions: ["Used it all", "Some left", "Went bad"],
    stillHaveTitle: "Still have these?",
    stillHaveHint: "We estimate these may go bad soon. Let us know if they're still around.",
    stillHaveOptions: ["Still have it", "It's gone"],
    commentPlaceholder: "Any other thoughts? (optional)",
    saveButton: "Save feedback",
    thanks: "Thanks! Your next suggestions will reflect this.",
  },

  /* ---------- Step 8: progress ----------
     "base" = simulated numbers from the past week, BEFORE tonight's meal.
     The app adds tonight's results on top. Average rating = ratingsSum / ratingsCount. */
  progress: {
    title: "Your FridgeFit Progress",
    subtitle: "Your first week",
    base: { itemsUsedBeforeBad: 9, mealsCookedAtHome: 4, ratingsSum: 18.8, ratingsCount: 4 },
    labels: {
      itemsUsedBeforeBad: "Items used before they went bad",
      mealsCookedAtHome: "Meals cooked at home",
      averageRating: "Average rating of recipes you cooked",
    },
    icons: { itemsUsedBeforeBad: "🥬", mealsCookedAtHome: "🍳", averageRating: "⭐" },
    simulatedNote: "Simulated numbers for this prototype.",
    encouragement: "Suggestions get better the more you cook.",
    keepCookingButton: "Keep cooking",
  },
};

/**
 * THE PREP BOOK — every drink the bar makes, transcribed from the two printed sources:
 *
 *   · "Drink Preparation Guide, Version 2" (last updated 7/27/2026) — the lattes, matcha, refreshers,
 *     frozen blends, cold foams and the house brown sugar syrup. `page` is its page number; the
 *     scanned page is served from /prep-book/pages/guide-NN.jpg.
 *   · "MC MIX Labels" — the traditional (Yemeni / Arabic) coffees and teas brewed from the house mixes,
 *     plus the sugar scoop chart. `label` is its page number, served from /prep-book/labels/label-NN.jpg.
 *
 * The amounts are copied AS PRINTED. Spelling was tidied ("sause", "throughly"), nothing else: where
 * the printed guide disagrees with itself (a step that names a different amount from the ingredient
 * list) both are left as printed, because the bar should ask, not guess. To change a recipe, change
 * it here — the page reads nothing else.
 *
 * Recipe text stays in English in both languages: it is what is printed on the bar's own guide and
 * labels, and a translated amount is one more place for a mistake to hide.
 */

export type PrepCategory = 'coffee' | 'matcha' | 'refreshers' | 'frozen' | 'traditional' | 'basics'
export type PrepTemp = 'hot' | 'iced'

export interface PrepStep {
  title: string
  items: string[]
}

/** One column of a label: what goes in for that size. */
export interface PrepSize {
  size: string
  items: string[]
}

export interface PrepRecipe {
  id: string
  name: string
  category: PrepCategory
  temp?: PrepTemp
  /** Extra words people may type for it (other spellings, Arabic names). */
  aliases?: string[]
  ingredients?: string[]
  /** Per-size amounts (the MIX labels). */
  sizes?: PrepSize[]
  steps?: PrepStep[]
  /** Bold one-liners printed on a label ("Boil 2 times, strain & pour"). */
  method?: string[]
  notes?: string[]
  /** Page of the Drink Preparation Guide. */
  page?: number
  /** Page of the MC MIX Labels. */
  label?: number
  /** False where the guide page has no drink photo to crop (the text-only pages). */
  thumb?: boolean
}

const ESPRESSO: PrepStep = { title: 'Queue espresso', items: ['Pull 2 shots of espresso'] }
const LID: PrepStep = { title: 'Lid & serve', items: [] }
const MATCHA_BOWL =
  'In the matcha bowl, strain and then whisk the matcha powder with warm water until smooth and clump-free'
const MILK = '8 oz milk (dairy or plant-based)'

export const PREP_RECIPES: PrepRecipe[] = [
  // ── Coffee & lattes ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'iced-moka-spice-latte',
    name: 'Iced Moka Spice Latte',
    category: 'coffee',
    temp: 'iced',
    page: 3,
    ingredients: ['2 shots of espresso', '1/4 tsp Moka spice', '3 swirls of honey', MILK, 'Honey (drizzle)'],
    steps: [
      ESPRESSO,
      {
        title: 'Prepare milk mixture',
        items: [
          'Add 3 swirls of honey and the Moka spice to the pitcher',
          'Add less than an ounce of hot water to help melt the honey',
          'Mix thoroughly to make a honey / Moka spice paste',
          'Add milk on top of the paste and mix thoroughly',
        ],
      },
      {
        title: 'Assemble drink',
        items: [
          'Drizzle honey around the cup',
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture over the ice (leave room for the shots)',
          'Gently pour the espresso shots on top',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-moka-spice-latte',
    name: 'Hot Moka Spice Latte',
    category: 'coffee',
    temp: 'hot',
    page: 4,
    ingredients: ['2 shots of espresso', '1/4 tsp Moka spice', '3 swirls of honey', MILK],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk mixture', items: ['In a milk pitcher, add milk and Moka spice', 'Steam milk'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup and add 3 swirls of honey',
          'Add the espresso shots and mix thoroughly with the honey',
          'Gently pour the steamed milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'iced-pistachio-latte',
    name: 'Iced Pistachio Latte',
    category: 'coffee',
    temp: 'iced',
    page: 5,
    ingredients: [
      '2 shots of espresso',
      '1/8 tsp Moka spice',
      '7 swirls of pistachio sauce',
      '2 pumps of pistachio syrup',
      MILK,
      'Green dye (1 dot)',
      'Honey (drizzle)',
    ],
    steps: [
      ESPRESSO,
      {
        title: 'Prepare milk mixture',
        items: [
          'In a milk pitcher, add milk, Moka spice, pistachio sauce, pistachio syrup and green dye',
          'Froth (3–5 sec)',
        ],
      },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and drizzle honey around the cup',
          'Fill it ¾ with ice',
          'Pour the milk mixture over the ice (leave room for the shots)',
          'Gently pour the espresso shots on top',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-pistachio-latte',
    name: 'Hot Pistachio Latte',
    category: 'coffee',
    temp: 'hot',
    page: 6,
    ingredients: [
      '2 shots of espresso',
      '1/8 tsp Moka spice',
      '7 swirls of pistachio sauce',
      '2 pumps of pistachio syrup',
      MILK,
    ],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk mixture', items: ['In a milk pitcher, add milk and Moka spice', 'Steam milk'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup and add 7 swirls of pistachio sauce and 2 pumps of pistachio syrup',
          'Add the espresso shots and mix thoroughly with the syrup and sauce',
          'Gently pour the steamed milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'iced-salted-caramel-latte',
    name: 'Iced Salted Caramel Latte',
    category: 'coffee',
    temp: 'iced',
    page: 7,
    ingredients: [
      '2 shots of espresso',
      '1 pump caramel',
      '4 pumps salted caramel syrup (2 in the milk, 2 in the foam)',
      MILK,
      'Heavy cream for cold foam',
    ],
    steps: [
      ESPRESSO,
      { title: 'Start cold foam', items: ['2 pumps salted caramel and 2 oz heavy cream'] },
      {
        title: 'Prepare milk mixture',
        items: ['Combine milk with 1 pump caramel sauce and 2 pumps salted caramel syrup in the pitcher and mix'],
      },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture over the ice (leave room for the shots and cold foam)',
          'Gently pour the espresso shots on top',
          'Pour the cold foam (optional: caramel drizzle)',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-salted-caramel-latte',
    name: 'Hot Salted Caramel Latte',
    category: 'coffee',
    temp: 'hot',
    page: 8,
    ingredients: ['2 shots of espresso', '1 pump caramel sauce', '2 pumps salted caramel syrup', MILK],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk', items: ['Steam milk'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup',
          '1 pump caramel sauce',
          '2 pumps salted caramel syrup into the cup',
          'Pour the espresso shots into the cup and mix with the sauce / syrup',
          'Slowly top with steamed milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'iced-saffron-latte',
    name: 'Iced Saffron Latte',
    category: 'coffee',
    temp: 'iced',
    page: 9,
    ingredients: [
      '2 shots of espresso',
      '5 swirls of saffron sauce',
      '1/8 tsp Moka spice',
      MILK,
      'Honey (drizzle)',
    ],
    steps: [
      ESPRESSO,
      {
        title: 'Prepare milk mixture',
        items: ['In a milk pitcher, add 8 oz of milk, 5 swirls of saffron and Moka spice. Mix thoroughly'],
      },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and drizzle honey around the cup',
          'Fill it ¾ with ice',
          'Pour the milk mixture over the ice (leave room for the shots)',
          'Gently pour the espresso shots on top',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-saffron-latte',
    name: 'Hot Saffron Latte',
    category: 'coffee',
    temp: 'hot',
    page: 10,
    ingredients: [
      '2 shots of espresso',
      '5 swirls of saffron sauce',
      '1/8 tsp Moka spice',
      MILK,
      '2 pumps sugar cane syrup',
    ],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk mixture', items: ['In a milk pitcher, add milk and Moka spice', 'Steam'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup and add 5 swirls of saffron and 2 pumps of cane sugar syrup',
          'Pour the espresso shots and mix thoroughly',
          'Slowly top with steamed milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'iced-biscoff-latte',
    name: 'Iced Biscoff Latte',
    category: 'coffee',
    temp: 'iced',
    page: 11,
    aliases: ['lotus'],
    ingredients: [
      '2 shots of espresso',
      '1 tbsp Biscoff spread',
      '2 pumps of caramel sauce',
      MILK,
      'Vanilla cold foam',
      'Biscoff crumbs (garnish)',
    ],
    steps: [
      ESPRESSO,
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup',
          'Add 1 tbsp of Biscoff spread to the cup',
          'Add 2 pumps of caramel sauce to the cup',
          'Mix thoroughly with the espresso',
          'Fill the cup ¾ with ice',
          'Top with milk — leave room for the cold foam',
          'Add vanilla cold foam',
        ],
      },
      { title: 'Serve', items: [] },
    ],
  },
  {
    id: 'hot-biscoff-latte',
    name: 'Hot Biscoff Latte',
    category: 'coffee',
    temp: 'hot',
    page: 12,
    aliases: ['lotus'],
    ingredients: ['2 shots of espresso', '1 tbsp Biscoff spread', '2 pumps of caramel sauce', MILK],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk mixture', items: ['Steam 8 oz of milk'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup',
          'Add 1 tbsp of Biscoff spread to the cup',
          'Add 2 pumps of caramel sauce to the cup',
          'Mix thoroughly with the espresso',
          'Slowly top with steamed milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'iced-spanish-latte',
    name: 'Iced Spanish Latte',
    category: 'coffee',
    temp: 'iced',
    page: 13,
    ingredients: ['2 shots of espresso', '10 swirls of condensed milk', MILK],
    steps: [
      ESPRESSO,
      {
        title: 'Prepare milk mixture',
        items: ['In a milk pitcher, add 8 oz milk and 10 swirls of condensed milk and mix thoroughly'],
      },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture over the ice (leave room for the shots)',
          'Gently pour the espresso shots on top',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-spanish-latte',
    name: 'Hot Spanish Latte',
    category: 'coffee',
    temp: 'hot',
    page: 14,
    ingredients: ['2 shots of espresso', '10 swirls of condensed milk', MILK],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk mixture', items: ['Steam 8 oz of milk'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup',
          'Add 10 swirls of condensed milk',
          'Mix thoroughly with the espresso',
          'Top with steamed milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'iced-caramel-macchiato',
    name: 'Iced Caramel Macchiato',
    category: 'coffee',
    temp: 'iced',
    page: 15,
    ingredients: ['2 shots of espresso', '1 pump vanilla', '2 pumps caramel', MILK],
    steps: [
      ESPRESSO,
      {
        title: 'Prepare milk mixture',
        items: ['Add milk, caramel sauce and vanilla syrup into the milk pitcher and mix thoroughly'],
      },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture into the cup',
          'Add the espresso shots on top',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-caramel-macchiato',
    name: 'Hot Caramel Macchiato',
    category: 'coffee',
    temp: 'hot',
    page: 16,
    ingredients: ['2 shots of espresso', '1 pump vanilla syrup', '2 pumps caramel', MILK],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk mixture', items: ['Steam 8 oz of milk'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup',
          'Add caramel sauce & vanilla syrup',
          'Pour the espresso shots and mix thoroughly with the sauce / syrup',
          'Slowly top with steamed milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'iced-white-mocha-latte',
    name: 'Iced White Mocha Latte',
    category: 'coffee',
    temp: 'iced',
    page: 17,
    ingredients: ['2 shots of espresso', '2 pumps of white mocha sauce', MILK],
    steps: [
      ESPRESSO,
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup',
          'Add 2 pumps of white mocha',
          'Mix thoroughly with the espresso',
          'Fill the cup ¾ with ice',
          'Top with milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-white-mocha',
    name: 'Hot White Mocha',
    category: 'coffee',
    temp: 'hot',
    page: 18,
    ingredients: ['2 shots of espresso', '2 pumps white mocha', MILK],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk mixture', items: ['Steam 8 oz of milk'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup',
          'Add 2 pumps of white mocha',
          'Pour the espresso shots and mix thoroughly with the sauce',
          'Slowly top with steamed milk',
        ],
      },
      LID,
    ],
  },
  {
    id: 'brown-sugar-shaken-oat-iced-latte',
    name: 'Brown Sugar Shaken Oat Iced Latte',
    category: 'coffee',
    temp: 'iced',
    page: 19,
    aliases: ['shaken espresso'],
    ingredients: [
      '2 shots of espresso',
      '4 pumps of brown sugar syrup (house-made recipe: see "House-Made Brown Sugar Syrup")',
      '8 oz of oat milk (or dairy if requested)',
      'Cold foam: 2 oz heavy cream, 1 pump vanilla syrup, 1 pump brown sugar syrup',
    ],
    steps: [
      ESPRESSO,
      {
        title: 'Prep shaken espresso',
        items: ['Add the espresso and 4 pumps of brown sugar to the shaker with a few ice cubes', 'Shake 10 times'],
      },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup (no ice yet)',
          'Gently pour the espresso shot',
          'Fill it ¾ with ice',
          'Add oat milk over the espresso mix and ice (leave room for the cold foam)',
        ],
      },
      {
        title: 'Prepare cold foam',
        items: ['Combine milk with 1 pump vanilla and 1 pump of brown sugar syrup in the pitcher and mix'],
      },
      { title: 'Finish & serve', items: ['Top with cold foam', 'Sprinkle cinnamon', 'Lid and serve'] },
    ],
  },
  {
    id: 'brown-sugar-oat-latte',
    name: 'Brown Sugar Oat Latte',
    category: 'coffee',
    temp: 'hot',
    page: 20,
    ingredients: [
      '2 shots of espresso',
      '4 pumps brown sugar syrup (house-made recipe: see "House-Made Brown Sugar Syrup")',
      '8 oz oat milk (or dairy if requested)',
    ],
    steps: [
      ESPRESSO,
      { title: 'Prepare milk', items: ['Steam milk'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz hot cup',
          '4 pumps brown sugar syrup into the cup',
          'Pour the espresso shots into the cup',
          'Slowly top with steamed milk',
        ],
      },
      LID,
    ],
  },

  // ── Matcha ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'iced-matcha',
    name: 'Iced Matcha',
    category: 'matcha',
    temp: 'iced',
    page: 21,
    ingredients: ['1 tbsp matcha powder', '1 oz warm water (160–180°F)', MILK, '2 pumps of vanilla'],
    steps: [
      { title: 'Prepare matcha', items: [MATCHA_BOWL, 'Set aside'] },
      { title: 'Prepare milk mixture', items: ['In a milk pitcher, combine milk and vanilla', 'Stir well'] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture into the cup',
          'Pour the milk mixture over the ice, leaving room for the matcha',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-matcha-latte',
    name: 'Hot Matcha Latte',
    category: 'matcha',
    temp: 'hot',
    page: 22,
    ingredients: ['1 tbsp matcha powder', '1 oz warm water', MILK, '2 pumps of vanilla'],
    steps: [
      { title: 'Prepare matcha', items: [MATCHA_BOWL, 'Add and mix the vanilla', 'Set aside'] },
      { title: 'Prepare milk mixture', items: ['Steam 8 oz of milk'] },
      {
        title: 'Assemble drink',
        items: ['Grab a 16 oz hot cup', 'Pour the matcha mixture into the cup', 'Slowly top with steamed milk'],
      },
      LID,
    ],
  },
  {
    id: 'iced-lavender-matcha',
    name: 'Iced Lavender Matcha',
    category: 'matcha',
    temp: 'iced',
    page: 23,
    ingredients: [
      '1 tbsp matcha powder',
      '1 oz warm water',
      MILK,
      '1 pump of vanilla syrup',
      '3 pumps lavender syrup (1:1)',
      '1 dot of purple food coloring',
      '2 oz of heavy cream (cold foam)',
    ],
    steps: [
      {
        title: 'Start cold foam',
        items: ['Pour 2 oz of half & half into the milk frother', 'Add 2 pumps lavender syrup', 'Froth'],
      },
      { title: 'Prepare matcha', items: [MATCHA_BOWL] },
      {
        title: 'Prepare milk mixture',
        items: [
          'In a milk pitcher, combine milk, 3 pumps lavender, 1 pump vanilla and a drop of purple food coloring',
          'Stir well',
        ],
      },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture over the ice, leaving room for the matcha and cold foam',
          'Pour the matcha over the milk',
          'Top with cold foam',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-lavender-matcha',
    name: 'Hot Lavender Matcha',
    category: 'matcha',
    temp: 'hot',
    page: 24,
    ingredients: ['1 tbsp matcha', '1 oz of warm water', MILK, '2 pumps of lavender syrup', '1 pump of vanilla'],
    steps: [
      {
        title: 'Prepare matcha',
        items: [MATCHA_BOWL, 'Add and mix the lavender syrup with 1 pump of vanilla', 'Set aside'],
      },
      { title: 'Prepare milk mixture', items: ['Steam 8 oz of milk'] },
      {
        title: 'Assemble drink',
        items: ['Grab a 16 oz hot cup', 'Pour the matcha mixture into the cup', 'Slowly top with steamed milk'],
      },
      LID,
    ],
  },
  {
    id: 'iced-pistachio-matcha',
    name: 'Iced Pistachio Matcha',
    category: 'matcha',
    temp: 'iced',
    page: 25,
    ingredients: [
      '1 tbsp matcha powder',
      '1 oz warm water',
      MILK,
      '7 swirls pistachio sauce',
      '4 pumps pistachio syrup (2 in the milk, 2 in the foam)',
      '1 dot of green food coloring',
      '2 oz of heavy cream (cold foam)',
    ],
    steps: [
      {
        title: 'Start cold foam',
        items: ['Pour 2 oz of heavy cream into the milk frother', 'Add 2 pumps of pistachio syrup', 'Froth'],
      },
      { title: 'Prepare matcha', items: [MATCHA_BOWL] },
      {
        title: 'Prepare milk mixture',
        items: [
          'In a milk pitcher, combine milk, 7 swirls of pistachio sauce, 2 pumps pistachio syrup and 1 drop of green food coloring',
          'Stir well',
        ],
      },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture over the ice, leaving room for the matcha and cold foam',
          'Pour the matcha over the milk',
          'Top with pistachio cold foam',
        ],
      },
      LID,
    ],
  },
  {
    id: 'hot-pistachio-matcha',
    name: 'Hot Pistachio Matcha',
    category: 'matcha',
    temp: 'hot',
    page: 26,
    ingredients: [
      '1 tbsp matcha powder',
      '1 oz warm water',
      MILK,
      '7 swirls pistachio sauce',
      '2 pumps pistachio syrup',
    ],
    steps: [
      { title: 'Prepare matcha', items: [MATCHA_BOWL, 'Add and mix the pistachio syrup', 'Set aside'] },
      { title: 'Prepare milk mixture', items: ['Add 7 swirls of pistachio sauce, mix thoroughly, then steam'] },
      {
        title: 'Assemble drink',
        items: ['Pour the matcha mixture into the cup', 'Slowly top with steamed milk'],
      },
      LID,
    ],
  },
  {
    id: 'iced-strawberry-matcha',
    name: 'Iced Strawberry Matcha',
    category: 'matcha',
    temp: 'iced',
    page: 27,
    ingredients: [
      '1 tbsp matcha powder',
      '1 oz warm water',
      MILK,
      '1 pump of vanilla syrup',
      '2 pumps of strawberry purée',
      '2 pumps of strawberry syrup',
      '2 oz of heavy cream (cold foam)',
    ],
    steps: [
      {
        title: 'Prepare milk mixture',
        items: ['In a milk pitcher, combine milk, 2 pumps strawberry purée and 1 pump of vanilla syrup', 'Stir well'],
      },
      { title: 'Prepare matcha', items: [MATCHA_BOWL] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture over the ice, leaving room for the matcha and cold foam',
          'Pour the matcha over the milk',
        ],
      },
      {
        title: 'Start cold foam',
        items: ['Pour 2 oz of heavy cream into the milk frother', 'Add 2 pumps of mango syrup (as printed)', 'Froth'],
      },
      { title: 'Serve', items: ['Sprinkle with strawberry dust', 'Lid and serve'] },
    ],
  },
  {
    id: 'hot-strawberry-matcha',
    name: 'Hot Strawberry Matcha',
    category: 'matcha',
    temp: 'hot',
    page: 28,
    ingredients: ['1 tbsp matcha powder', '1 oz warm water', MILK, '1 pump strawberry syrup'],
    steps: [
      {
        title: 'Prepare matcha',
        items: [MATCHA_BOWL, 'Add and mix 1 pump strawberry syrup and 1 pump vanilla', 'Set aside'],
      },
      { title: 'Prepare milk mixture', items: ['Steam 8 oz of milk'] },
      {
        title: 'Assemble drink',
        items: ['Grab a 16 oz hot cup', 'Pour the matcha mixture into the cup', 'Slowly top with steamed milk'],
      },
      LID,
    ],
  },
  {
    id: 'iced-mango-matcha',
    name: 'Iced Mango Matcha',
    category: 'matcha',
    temp: 'iced',
    page: 29,
    ingredients: [
      '1 tbsp matcha powder',
      '1 oz warm water',
      MILK,
      '2 pumps of mango purée',
      '2 pumps of mango syrup',
      '2 oz of heavy cream (cold foam)',
    ],
    steps: [
      {
        title: 'Prepare milk mixture',
        items: ['In a milk pitcher, combine milk and 2 pumps mango purée', 'Stir well'],
      },
      { title: 'Prepare matcha', items: [MATCHA_BOWL] },
      {
        title: 'Assemble drink',
        items: [
          'Grab a 16 oz cup and fill it ¾ with ice',
          'Pour the milk mixture over the ice, leaving room for the matcha and cold foam',
          'Pour the matcha over the milk',
        ],
      },
      {
        title: 'Start cold foam',
        items: ['Pour 2 oz of heavy cream into the milk frother', 'Add 2 pumps of mango syrup', 'Froth'],
      },
      { title: 'Serve', items: ['Sprinkle with mango dust', 'Lid and serve'] },
    ],
  },
  {
    id: 'hot-mango-matcha',
    name: 'Hot Mango Matcha',
    category: 'matcha',
    temp: 'hot',
    page: 30,
    ingredients: ['1 tbsp matcha powder', '1 oz warm water', MILK, '2 pumps mango syrup'],
    steps: [
      { title: 'Prepare matcha', items: [MATCHA_BOWL, 'Add and mix 2 pumps mango syrup', 'Set aside'] },
      { title: 'Prepare milk mixture', items: ['Froth 8 oz of milk'] },
      {
        title: 'Assemble drink',
        items: ['Grab a 16 oz hot cup', 'Pour the matcha mixture into the cup', 'Slowly top with frothed milk'],
      },
      LID,
    ],
  },

  // ── Refreshers ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'hibiscus-refresher',
    name: 'Hibiscus Refresher',
    category: 'refreshers',
    temp: 'iced',
    page: 31,
    ingredients: ['2 oz of hibiscus syrup', '3 oz water', '3 oz lemonade', '2 oz club soda'],
    steps: [
      { title: 'Prepare the mix', items: ['In a measuring cup, combine 4 oz water and 4 oz lemonade'] },
      {
        title: 'Shake',
        items: [
          'Transfer the mixture into a cocktail shaker',
          'Add 2 oz of hibiscus syrup',
          'Add ice. Shake until the shaker is chilled',
        ],
      },
      { title: 'Assemble drink', items: ['Grab a 20 oz cup and fill it ¾ with ice', 'Pour the liquid mixture over the ice'] },
      { title: 'Top off', items: ['Top off with 2 oz club soda'] },
      LID,
    ],
  },
  {
    id: 'mango-refresher',
    name: 'Mango Refresher',
    category: 'refreshers',
    temp: 'iced',
    page: 32,
    ingredients: ['4 pumps of mango purée', '3–4 pieces of mango', '8 oz of lemonade'],
    steps: [
      {
        title: 'Prepare the mix',
        items: ['In a measuring cup, combine 8 oz of water, 4 pumps of mango purée and 1 pump of caffeine'],
      },
      { title: 'Shake', items: ['Transfer the mixture into a cocktail shaker', 'Add ice. Shake until the shaker is chilled'] },
      { title: 'Assemble drink', items: ['Grab a 20 oz cup and fill it ¾ with ice', 'Pour the liquid mixture over the ice'] },
      { title: 'Garnish', items: ['Top with 3 mango chunks'] },
      LID,
    ],
  },
  {
    id: 'dragon-fruit-refresher',
    name: 'Dragon Fruit Refresher',
    category: 'refreshers',
    temp: 'iced',
    page: 33,
    aliases: ['pitaya'],
    ingredients: [
      '4 pumps dragon fruit syrup',
      '2 oz white grape juice',
      '8 oz of lemonade',
      '1 pump of caffeine',
      '3–4 pieces of dragon fruit',
    ],
    steps: [
      {
        title: 'Prepare the mix',
        items: [
          'In a measuring cup, combine 6 oz of lemonade, 2 oz of white grape juice, 4 pumps of dragon fruit syrup and 1 pump of caffeine',
        ],
      },
      { title: 'Shake', items: ['Transfer the mixture into a cocktail shaker', 'Add ice. Shake until the shaker is chilled'] },
      { title: 'Assemble drink', items: ['Grab a 20 oz cup and fill it ¾ with ice', 'Pour the liquid mixture over the ice'] },
      { title: 'Garnish', items: ['Top with 3 dragon fruit chunks'] },
      LID,
    ],
  },
  {
    id: 'strawberry-refresher',
    name: 'Strawberry Refresher',
    category: 'refreshers',
    temp: 'iced',
    page: 34,
    ingredients: [
      '1 pump of strawberry purée',
      '6 pumps of strawberry syrup',
      '3–4 pieces of dried strawberry',
      '4 oz water',
      '4 oz lemonade',
      '2 oz club soda',
    ],
    steps: [
      { title: 'Prepare the mix', items: ['In a measuring cup, combine 4 oz water and 4 oz lemonade'] },
      {
        title: 'Shake',
        items: [
          'Transfer the mixture into a cocktail shaker',
          'Add 1 pump strawberry purée and 6 pumps of strawberry syrup',
          'Add ice. Shake until the shaker is chilled',
        ],
      },
      { title: 'Assemble drink', items: ['Grab a 20 oz cup and fill it ¾ with ice', 'Pour the liquid mixture over the ice'] },
      { title: 'Top off & garnish', items: ['Top off with 2 oz club soda', 'Add 3 strawberry slices'] },
      LID,
    ],
  },
  {
    id: 'passion-fruit-refresher',
    name: 'Passion Fruit Refresher',
    category: 'refreshers',
    temp: 'iced',
    page: 35,
    ingredients: [
      '4 pumps of passion fruit purée',
      '8 oz water or lemonade',
      '1 pump of caffeine',
      '3 passion fruit pieces',
    ],
    steps: [
      {
        title: 'Prepare the mix',
        items: [
          'In a measuring cup, combine 8 oz of water or lemonade, 4 oz of passion fruit purée and 1 pump of caffeine',
        ],
      },
      { title: 'Shake', items: ['Transfer the mixture into a cocktail shaker', 'Add ice. Shake until the shaker is chilled'] },
      { title: 'Assemble drink', items: ['Grab a 20 oz cup and fill it ¾ with ice', 'Pour the liquid mixture over the ice'] },
      { title: 'Garnish', items: ['Top with 3 passion fruit chunks'] },
      LID,
    ],
  },
  {
    id: 'vimto-fruit',
    name: 'Vimto Fruit',
    category: 'refreshers',
    temp: 'iced',
    page: 36,
    aliases: ['vimto mojito', 'فيمتو'],
    ingredients: ['2 oz Vimto', '1 lime', '2 mint leaves', '1 can of Sprite'],
    steps: [
      { title: 'Prepare limes & mint', items: ['Cut the lime into 4 wedges', 'Grab 2 mint leaves'] },
      { title: 'Muddle', items: ['In a 20 oz cup, gently press the lime wedges and mint leaves with a muddler'] },
      { title: 'Assemble drink', items: ['Pour in 2 oz Vimto', 'Fill the cup ¾ with ice', 'Slowly cascade Sprite'] },
      LID,
    ],
  },

  // ── Frozen ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'frozen-blends',
    name: 'Frozen Blends (Smoothies)',
    category: 'frozen',
    page: 37,
    aliases: ['smoothie', 'strawberry banana', 'mixed berry', 'pineapple mango', 'pineapple'],
    ingredients: ['6 oz of smoothie mix', '6 oz of milk (dairy or plant-based)'],
    notes: ['Use these steps for: Strawberry-Banana, Mixed Berry, Pineapple Mango, Pineapple'],
    steps: [
      { title: 'Prepare mixture', items: ['In a measuring cup, add 6 oz of smoothie mix and 6 oz of milk', 'Stir'] },
      { title: 'Blender', items: ['Pour the mixture into the blender', 'Full scoop of ice', 'Blend for 15 sec'] },
      { title: 'Assemble drink', items: ['Grab a 20 oz cup and pour the blended mixture'] },
      LID,
    ],
  },

  // ── Cold foams & syrups ─────────────────────────────────────────────────────────────────────────
  {
    id: 'cold-foam-strawberry',
    name: 'Strawberry Cold Foam',
    category: 'basics',
    page: 38,
    thumb: false,
    ingredients: ['1 pump vanilla', '1 pump strawberry', '2 oz heavy cream'],
    method: ['Froth until foamy'],
  },
  {
    id: 'cold-foam-vanilla',
    name: 'Vanilla Cold Foam',
    category: 'basics',
    page: 38,
    thumb: false,
    ingredients: ['2 pumps vanilla', '2 oz heavy cream'],
    method: ['Froth until foamy'],
  },
  {
    id: 'cold-foam-salted-caramel',
    name: 'Salted Caramel Cold Foam',
    category: 'basics',
    page: 38,
    thumb: false,
    ingredients: ['2 pumps salted caramel syrup', '2 oz heavy cream'],
    method: ['Froth until foamy'],
  },
  {
    id: 'cold-foam-pistachio',
    name: 'Pistachio Cold Foam',
    category: 'basics',
    page: 38,
    thumb: false,
    ingredients: ['1 pump pistachio', '1 pump vanilla', '2 oz heavy cream'],
    method: ['Froth until foamy'],
  },
  {
    id: 'cold-foam-lavender',
    name: 'Lavender Cold Foam',
    category: 'basics',
    page: 38,
    thumb: false,
    ingredients: ['1 pump lavender', '1 pump vanilla', '2 oz heavy cream'],
    method: ['Froth until foamy'],
  },
  {
    id: 'cold-foam-mango',
    name: 'Mango Cold Foam',
    category: 'basics',
    page: 38,
    thumb: false,
    ingredients: ['1 pump mango', '1 pump vanilla', '2 oz heavy cream'],
    method: ['Froth until foamy'],
  },
  {
    id: 'batched-cold-foam',
    name: 'Batched Cold Foam (Vanilla, Strawberry, Salted Caramel)',
    category: 'basics',
    page: 39,
    thumb: false,
    aliases: ['batch', 'big batch'],
    sizes: [
      {
        size: 'Vanilla',
        items: ['1 quart (32 fl oz / 946 mL) heavy whipping cream', '1 cup milk', '15 pumps vanilla syrup'],
      },
      {
        size: 'Strawberry',
        items: [
          '1 quart (32 fl oz / 946 mL) heavy whipping cream',
          '1 cup milk',
          '5 pumps vanilla syrup',
          '15 pumps strawberry syrup',
        ],
      },
      {
        size: 'Salted caramel',
        items: [
          '1 quart (32 fl oz / 946 mL) heavy whipping cream',
          '1 cup milk',
          '5 pumps vanilla syrup',
          '15 pumps salted caramel syrup',
        ],
      },
    ],
  },
  {
    id: 'brown-sugar-syrup',
    name: 'House-Made Brown Sugar Syrup',
    category: 'basics',
    page: 40,
    ingredients: ['3 cups brown sugar', '3 cups filtered water', '1 tbsp cinnamon', '3 tbsp vanilla extract'],
    method: ['Bring the water and sugar to a boil, then turn off the heat and add the cinnamon and vanilla extract'],
  },

  // ── Traditional (MC MIX labels) ─────────────────────────────────────────────────────────────────
  {
    id: 'jubani',
    name: 'Jubani',
    category: 'traditional',
    temp: 'hot',
    label: 1,
    aliases: ['جباني', 'jebani', 'yemeni coffee'],
    sizes: [
      { size: '12 oz', items: ['13 oz water', '2.5 tbsp mix'] },
      { size: '16 oz', items: ['17 oz water', '3 tbsp mix'] },
    ],
    method: ['Boil 2 times, strain & pour'],
    notes: ['Add honey for sweetener'],
  },
  {
    id: 'qishr',
    name: 'Qishr',
    category: 'traditional',
    temp: 'hot',
    label: 2,
    aliases: ['قشر', 'qeshr', 'kishr', 'yemeni coffee'],
    sizes: [
      { size: '12 oz', items: ['16 oz water', '1½ scoop mix', '1/4 tbsp spice'] },
      { size: '16 oz', items: ['20 oz water', '2 scoop mix', '1/4 tsp spice'] },
    ],
    method: ['Boil 3 minutes, strain & pour'],
  },
  {
    id: 'sanaani',
    name: "Sana'ani",
    category: 'traditional',
    temp: 'hot',
    label: 3,
    aliases: ['صنعاني', 'sanaani', 'sanani', 'yemeni coffee'],
    sizes: [
      { size: '12 oz', items: ['13 oz water', '2.5 tbsp mix'] },
      { size: '16 oz', items: ['17 oz water', '3 tbsp mix'] },
    ],
    method: ['Boil once, strain & pour'],
  },
  {
    id: 'turkish',
    name: 'Turkish Coffee',
    category: 'traditional',
    temp: 'hot',
    label: 4,
    aliases: ['تركي', 'قهوة تركية', 'turkish'],
    sizes: [
      { size: '8 oz', items: ['9 oz water', '2 scoops mix'] },
      { size: 'Pot', items: ['13 oz water', '3 scoops mix'] },
    ],
    method: ['Boil once & pour', 'DO NOT STRAIN'],
  },
  {
    id: 'maleki',
    name: 'Maleki',
    category: 'traditional',
    temp: 'hot',
    label: 5,
    aliases: ['ملكي', 'malaki'],
    sizes: [
      { size: '12 oz', items: ['11 oz water', '2 oz milk', '2.5 scoops mix'] },
      { size: '16 oz', items: ['14 oz water', '3 oz milk', '3 scoops mix'] },
    ],
    method: ['Boil 2 times, then strain & pour'],
    notes: ['Add honey for sweetener'],
  },
  {
    id: 'adeni-tea',
    name: 'Adeni Tea',
    category: 'traditional',
    temp: 'hot',
    label: 6,
    aliases: ['عدني', 'شاي عدني', 'saffron chai', 'chai'],
    sizes: [
      { size: '12 oz', items: ['10 oz water', '3 oz milk', '1 scoop mix'] },
      { size: '16 oz', items: ['13 oz water', '4 oz milk', '1.5 scoop mix'] },
    ],
    method: ['Boil 2 times, then strain & pour'],
    notes: ['Saffron Chai: add saffron into the cup — DO NOT BOIL'],
  },
  {
    id: 'mufawar',
    name: 'Mufawar',
    category: 'traditional',
    temp: 'hot',
    label: 7,
    aliases: ['مفور', 'mfawar', 'mufawwar'],
    sizes: [
      { size: '12 oz', items: ['9 oz water', '3 oz milk', '2 scoops mix'] },
      { size: '16 oz', items: ['12 oz water', '4 oz milk', '2.5 scoops mix'] },
    ],
    method: ['Boil once, then strain & pour'],
  },
  {
    id: 'matcha-latte-label',
    name: 'Matcha Latte (bar label)',
    category: 'matcha',
    label: 8,
    sizes: [
      {
        size: 'Hot',
        items: ['Whisk 1 tsp matcha in the matcha bowl', 'Pour into the cup', 'Add HOT frothed milk on top'],
      },
      {
        size: 'Iced',
        items: ['Whisk 1 tsp matcha in the matcha bowl', 'Put cold milk over ice', 'Add the matcha on top'],
      },
    ],
    notes: ['Use vanilla for sweetener'],
  },
  {
    id: 'matcha-tea',
    name: 'Matcha Tea',
    category: 'matcha',
    temp: 'hot',
    label: 9,
    sizes: [
      { size: '12 oz', items: ['2 bags of matcha tea', '12 oz hot water'] },
      { size: '16 oz', items: ['2 bags of matcha tea', '16 oz hot water'] },
    ],
    method: ['Add two bags of matcha tea into the cup of the right size, then the hot water'],
    notes: ['Add honey for sweetener'],
  },
  {
    id: 'arabic-coffee',
    name: 'Arabic Coffee',
    category: 'traditional',
    temp: 'hot',
    label: 10,
    aliases: ['قهوة عربية', 'عربي', 'saudi coffee', 'gahwa'],
    sizes: [
      { size: '8 oz', items: ['16 oz water', '1.5 scoops mix'] },
      { size: 'Pot', items: ['30 oz water', '3 scoops mix'] },
    ],
    method: ['Boil 5 minutes, strain & pour'],
  },
  {
    id: 'yemeni-tea',
    name: 'Yemeni Tea',
    category: 'traditional',
    temp: 'hot',
    label: 11,
    aliases: ['شاي يمني', 'شاي'],
    sizes: [
      { size: '12 oz', items: ['16 oz water', '½ scoop tea mix'] },
      { size: '16 oz', items: ['20 oz water', '½ scoop tea mix'] },
    ],
    method: ['Boil 3 minutes, strain & pour'],
  },
  {
    id: 'sugar',
    name: 'Sugar (sweetness levels)',
    category: 'basics',
    label: 12,
    aliases: ['sweetener', 'sweet', 'سكر', 'light', 'extra'],
    sizes: [
      { size: '12 oz', items: ['Light: 1 scoop', 'Regular: 1½ scoop', 'Extra: 2 scoops'] },
      { size: '16 oz', items: ['Light: 1½ scoop', 'Regular: 2 scoops', 'Extra: 2½ scoops'] },
    ],
  },
]

export const PREP_CATEGORIES: PrepCategory[] = ['coffee', 'matcha', 'refreshers', 'frozen', 'traditional', 'basics']

export function guidePageUrl(page: number): string {
  return `/prep-book/pages/guide-${String(page).padStart(2, '0')}.jpg`
}

export function labelUrl(label: number): string {
  return `/prep-book/labels/label-${String(label).padStart(2, '0')}.jpg`
}

/** The drink photo cropped from its guide page, or null where the page has none. */
export function thumbUrl(recipe: PrepRecipe): string | null {
  if (!recipe.page || recipe.thumb === false) return null
  return `/prep-book/thumbs/guide-${String(recipe.page).padStart(2, '0')}.jpg`
}

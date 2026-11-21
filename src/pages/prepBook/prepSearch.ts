/**
 * Search and display helpers for the prep book. Pure functions, no React, so `npm test` covers them
 * (tests/prepSearch.test.ts).
 */

/** The fields a drink is found by. Structural, so the data module stays the only source of recipes. */
export interface Searchable {
  name: string
  aliases?: string[]
  ingredients?: string[]
  sizes?: { size: string; items: string[] }[]
  /** What is written on a page of a PDF guide. */
  text?: string
}

/**
 * Lower-case, accents and apostrophes off, Arabic letter variants folded, so "Sana'ani", "sanaani"
 * and "SANAANI" are one word, and "قهوه" finds "قهوة".
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ْـ]/g, '') // Arabic harakat and tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** True when a and b are at most one edit apart (insert, delete, substitute or swap neighbours). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const diff: number[] = []
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i)
    if (diff.length === 1) return true
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  let j = 0
  let skipped = false
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i++
      j++
    } else {
      if (skipped) return false
      skipped = true
      j++
    }
  }
  return true
}

/**
 * How well one typed word matches one word of the drink: 3 for the whole word or its start
 * ("pist" → "pistachio"), 2 for one typo against the word or its start ("pistashio", "carmel"),
 * 1 for appearing inside it, 0 for no match. Typo tolerance needs four letters, so "ice" never
 * matches "rice", and a match INSIDE a word needs four too, so "hot" never matches "shots".
 */
function wordScore(query: string, word: string): number {
  if (word.startsWith(query)) return 3
  if (query.length >= 4) {
    if (withinOneEdit(query, word)) return 2
    if (word.length > query.length && withinOneEdit(query, word.slice(0, query.length))) return 2
    if (word.length > query.length + 1 && withinOneEdit(query, word.slice(0, query.length + 1))) return 2
  }
  if (query.length >= 4 && word.includes(query)) return 1
  return 0
}

function bestScore(query: string, words: string[]): number {
  let best = 0
  for (const w of words) {
    const s = wordScore(query, w)
    if (s > best) best = s
    if (best === 3) break
  }
  return best
}

/**
 * Score a drink against what was typed: 0 means "not a match". EVERY typed word must match
 * somewhere (so "iced pistachio" never shows the hot one); a word found in the name or an alias
 * counts far more than one found only in the ingredients, which is what floats "Pistachio Latte"
 * above every drink that merely contains pistachio sauce.
 */
export function scoreRecipe(recipe: Searchable, query: string): number {
  const terms = normalize(query).split(' ').filter(Boolean)
  if (terms.length === 0) return 1
  const nameWords = normalize([recipe.name, ...(recipe.aliases ?? [])].join(' ')).split(' ')
  const bodyWords = normalize(
    [...(recipe.ingredients ?? []), ...(recipe.sizes ?? []).flatMap((s) => s.items), recipe.text ?? ''].join(' '),
  ).split(' ')

  let total = 0
  for (const term of terms) {
    const inName = bestScore(term, nameWords)
    if (inName > 0) {
      total += inName * 10
      continue
    }
    const inBody = bestScore(term, bodyWords)
    if (inBody === 0) return 0
    total += inBody
  }
  // A name that starts with what was typed is the drink they mean.
  if (normalize(recipe.name).startsWith(normalize(query))) total += 25
  return total
}

/** The matching drinks, best first; ties keep the book's own order. */
export function searchRecipes<T extends Searchable>(recipes: T[], query: string): T[] {
  if (!normalize(query)) return recipes
  return recipes
    .map((recipe, index) => ({ recipe, index, score: scoreRecipe(recipe, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.recipe)
}

const ML_PER_OZ = 30

/** "1/4" → 0.25, "1 1/2" → 1.5, "2.5" → 2.5, "½" → 0.5. */
function parseAmount(raw: string): number {
  const text = raw.replace('½', ' 1/2').replace('¼', ' 1/4').replace('¾', ' 3/4').trim()
  return text.split(/\s+/).reduce((sum, part) => {
    const [n, d] = part.split('/')
    return sum + (d ? Number(n) / Number(d) : Number(n))
  }, 0)
}

/**
 * Adds the millilitres after every liquid amount in ounces — "8 oz milk" reads "8 oz (240 ml) milk" —
 * because the bar measures on a scale and in jugs marked in ml. The guide's own 1 oz = 30 ml.
 * Cup SIZES ("a 16 oz cup", "20oz cup") are left alone: nobody pours a cup into a jug. A line that
 * already gives mL (the batched foams) is left alone too.
 */
export function withMl(line: string): string {
  if (/\bml\b/i.test(line)) return line
  return line.replace(
    /(\d+(?:\.\d+)?(?:\s+\d\/\d)?|\d\/\d|[½¼¾])\s?(fl\s)?oz\b(?!\s*(?:hot\s+)?cup)/gi,
    (match, amount: string) => {
      const ml = Math.round(parseAmount(amount) * ML_PER_OZ)
      return Number.isFinite(ml) && ml > 0 ? `${match} (${ml} ml)` : match
    },
  )
}

/** What a hot and an iced version of one drink share: the name without "iced", "hot", "latte" and "shaken". */
function drinkKey(name: string): string {
  return normalize(name)
    .split(/\s+/)
    .filter((word) => word && !['iced', 'hot', 'latte', 'shaken'].includes(word))
    .sort()
    .join(' ')
}

/**
 * The other temperature of a drink: "Iced Spanish Latte" for "Hot Spanish Latte", "Hot White Mocha" for
 * "Iced White Mocha Latte". Same category, the other temperature, the same drink by name. Null when it has none.
 */
export function otherTemp<T extends { name: string; category: string; temp?: string }>(recipe: T, all: T[]): T | null {
  if (!recipe.temp) return null
  const key = drinkKey(recipe.name)
  return all.find((r) => r !== recipe && r.temp && r.temp !== recipe.temp && r.category === recipe.category && drinkKey(r.name) === key) ?? null
}

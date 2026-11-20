/**
 * THE RECIPE BOOK's shape — the drinks of the bar's Drink Preparation Guide and the MC MIX labels.
 *
 * ONLY THE SHAPE LIVES HERE. The guide is confidential ("copying, photographing or any reproduction is strictly
 * prohibited"), so no recipe, amount or scanned page is in this repository or in the website's files: an admin
 * uploads the book on the Recipes page, the API keeps it in the database and serves it to a signed-in user who holds
 * PREP_BOOK_VIEW (docs/115_recipe_book.sql in the API repository describes the file).
 *
 * Recipe text stays in English in both languages: it is what is printed on the bar's own guide and labels, and a
 * translated amount is one more place for a mistake to hide.
 */

export type PrepCategory = 'coffee' | 'matcha' | 'refreshers' | 'frozen' | 'shakes' | 'traditional' | 'basics'
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
  /** Page of the Drink Preparation Guide: its scan is GET /api/prep-book/pages/{page}. */
  page?: number
  /** Page of the MC MIX Labels: its scan is GET /api/prep-book/labels/{label}. */
  label?: number
  /** The drink photo, a data URI inside the book; absent where the guide page has none. */
  thumb?: string
}

export interface PrepBook {
  recipes: PrepRecipe[]
}

/** The book on file, for whoever may replace it. */
export interface PrepBookInfo {
  eTag: string
  recipeCount: number
  scanCount: number
  uploadedAtUtc: string
  uploadedBy: string | null
}

/** The order the category buttons are shown in. */
export const PREP_CATEGORIES: PrepCategory[] = ['coffee', 'matcha', 'refreshers', 'frozen', 'shakes', 'traditional', 'basics']

/**
 * Krónan public API client. Calls go through /api/kronan/<path>, which is proxied to
 * https://api.kronan.is/api/v1/ (Vite dev proxy locally, Netlify function in production) because
 * the API sends no CORS headers. The user's personal AccessToken (created under kronan.is account
 * settings) is sent as `Authorization: AccessToken <token>` and stored only on this device.
 */
import type { Macros, Recipe, RecipeIngredient } from './types'

const BASE = '/api/kronan/'

export const kronanSearchUrl = (q: string) => `https://kronan.is/leit?q=${encodeURIComponent(q)}`
export const kronanRecipeUrl = (slug: string) => `https://kronan.is/uppskriftir/${slug}`
export const KRONAN_TOKEN_HELP = 'kronan.is → Mínar síður → Stillingar → API aðgangslykill (AccessToken)'

export const isk = (n: number) => `${new Intl.NumberFormat('is-IS', { maximumFractionDigits: 0 }).format(Math.round(n))} kr.`

export class KronanError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function kfetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `AccessToken ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const detail = (json as { detail?: string } | null)?.detail
    throw new KronanError(
      res.status === 401 ? 'Krónan rejected the access token' : detail || `Krónan API error ${res.status}`,
      res.status,
    )
  }
  return json as T
}

// ---------- API shapes (camelCase, prices in whole ISK) ----------
export interface KProduct {
  sku: string
  name: string
  price: number
  discountedPrice?: number
  discountPercent?: number
  onSale?: boolean
  thumbnail: string
  priceInfo: string
  chargedByWeight: boolean
  pricePerKilo: number
  baseComparisonUnit: string
  temporaryShortage: boolean
  brand?: string
}
export interface KSearchHit extends KProduct {
  detail?: { discountedPrice?: number; discountPercent?: number; onSale?: boolean } | null
}
export interface KRecipeListItem {
  token: string
  name: string
  displayName: string
  slug: string
  totalMinutes: number
  servings?: number
  difficulty: number
  mainImage?: { image: string; alt?: string } | null
  tags: { name: string }[]
  cuisineTags: { name: string }[]
}
export interface KRecipeDetail extends KRecipeListItem {
  directions?: string
  ingredients?: string
  items: { quantity: number; comment?: string; product: KProduct }[]
  essentials: { quantity: number; comment?: string; product: KProduct }[]
  directionSteps: { name: string; steps: { number: number; text: string }[] }[]
}

export interface KProductDetail extends KProduct {
  description?: string
  image?: string
  qtyPerBaseCompUnit?: number | null
  qtyInSalesUnit?: number | null
  nutrition?: Record<string, string> | null
}

export const effectivePrice = (p: KProduct | KSearchHit) => {
  const d = 'detail' in p && p.detail ? p.detail : p
  return d.onSale && d.discountedPrice ? d.discountedPrice : p.price
}

// ---------- calls ----------
export const me = (token: string) => kfetch<{ name: string; type: string }>(token, 'me/')

export const searchProducts = (token: string, query: string, page = 1) =>
  kfetch<{ hits: KSearchHit[]; count: number; hasNextPage: boolean }>(token, 'products/search/', {
    method: 'POST', body: JSON.stringify({ query, page, pageSize: 20, withDetail: true }),
  })

export const favoriteProducts = (token: string) =>
  kfetch<{ results?: KProduct[]; products?: KProduct[] } | KProduct[]>(token, 'products/favorites/')
    .then((r) => (Array.isArray(r) ? r : r.results ?? r.products ?? []))

export const searchRecipes = (token: string, query: string, page = 1) =>
  kfetch<{ recipes: KRecipeListItem[]; count: number; hasNextPage: boolean }>(token, 'recipes/search/', {
    method: 'POST', body: JSON.stringify({ query, page }),
  })

export const listRecipes = (token: string, offset = 0) =>
  kfetch<{ results: KRecipeListItem[]; count: number }>(token, `recipes/?limit=20&offset=${offset}`)

export const getRecipe = (token: string, slug: string) => kfetch<KRecipeDetail>(token, `recipes/${encodeURIComponent(slug)}/`)

/** Batch product details (nutrition, package size). Up to 100 SKUs per call. */
export async function getProductDetails(token: string, skus: string[]): Promise<Map<string, KProductDetail>> {
  const out = new Map<string, KProductDetail>()
  const uniq = [...new Set(skus.filter(Boolean))]
  for (let i = 0; i < uniq.length; i += 100) {
    const res = await kfetch<{ results: KProductDetail[] }>(token, 'products/batch/', {
      method: 'POST', body: JSON.stringify({ skus: uniq.slice(i, i + 100) }),
    })
    for (const p of res.results ?? []) out.set(p.sku, p)
  }
  return out
}

// ---------- nutrition ----------
const num = (s: string): number | null => {
  const m = s.replace(',', '.').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

/**
 * Krónan's nutrition table is a label → value map in Icelandic (e.g. "Orka": "1046 kJ / 250 kcal",
 * "Prótein": "12 g"). Labels vary per supplier, so match loosely.
 */
export function parseMacros(n: Record<string, string> | null | undefined): Macros | null {
  if (!n) return null
  let kcal: number | null = null, protein: number | null = null, carbs: number | null = null, fat: number | null = null
  for (const [rawKey, rawVal] of Object.entries(n)) {
    const k = rawKey.toLowerCase()
    const v = String(rawVal)
    if (/orka|energ|kcal|hitaein/.test(k)) {
      const kc = v.match(/(\d+(?:[.,]\d+)?)\s*kcal/i)
      if (kc) kcal = Number(kc[1].replace(',', '.'))
      else { const kj = v.match(/(\d+(?:[.,]\d+)?)\s*kj/i); const x = kj ? Number(kj[1].replace(',', '.')) / 4.184 : num(v); if (x !== null) kcal = Math.round(x) }
    } else if (/pr[oó]t/.test(k)) protein = num(v)
    else if (/kolvetn|carb/.test(k) && !/sykur|sugar/.test(k)) carbs = num(v)
    else if (/fita|fat/.test(k) && !/mett|satur|trans/.test(k)) fat = num(v)
  }
  if (kcal === null && protein === null && carbs === null && fat === null) return null
  return { kcal: kcal ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }
}

/** Weight/volume printed in a product name, in grams or ml ("500 g", "1,5 l", "4x125g"). */
export function weightFromName(name: string): number | null {
  const multi = name.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|ltr|ml|cl|dl)\b/i)
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|ltr|ml|cl|dl)\b/i)
  const conv = (n: number, u: string) => {
    u = u.toLowerCase()
    if (u === 'kg' || u === 'l' || u === 'ltr') return n * 1000
    if (u === 'dl') return n * 100
    if (u === 'cl') return n * 10
    return n
  }
  if (multi) return Math.round(Number(multi[1]) * conv(Number(multi[2].replace(',', '.')), multi[3]))
  if (m) return Math.round(conv(Number(m[1].replace(',', '.')), m[2]))
  return null
}

const plausible = (g: number) => g >= 5 && g <= 25000

/**
 * Grams (or ml) in ONE sales unit (one "stk").
 *
 * Krónan's fields are not consistent across suppliers: qtyPerBaseCompUnit is sometimes "kg per unit"
 * (0.7), sometimes raw grams (700) and sometimes "units per kg". So every reading is treated as a
 * candidate and checked against the one signal that is always self-consistent: price ÷ pricePerKilo.
 * The candidate closest to that reference wins; without a reference the name weight, then the
 * plausible readings, are used. Items sold by weight count as 1000 g per unit.
 */
export function packGrams(p: KProductDetail | KProduct): number | null {
  if (p.chargedByWeight) return 1000
  const unit = (p.baseComparisonUnit || '').toLowerCase()
  const perBase = /^(kg|l|ltr)$/.test(unit) ? 1000 : 1

  const ref = p.pricePerKilo && p.price && /^(kg|l|ltr|g|ml)$/.test(unit) ? (p.price / p.pricePerKilo) * perBase : null
  const reference = ref && plausible(ref) ? ref : null

  const candidates: number[] = []
  const byName = weightFromName(p.name)
  if (byName && plausible(byName)) candidates.push(byName)
  const q = (p as KProductDetail).qtyPerBaseCompUnit
  if (q && q > 0) {
    for (const g of [q * perBase, q, perBase / q]) if (plausible(g)) candidates.push(g)
  }

  if (reference !== null) {
    const within = (c: number) => Math.abs(c - reference) / reference <= 0.25
    // A weight printed in the name is exact; take it whenever it agrees with the price reference.
    if (byName && plausible(byName) && within(byName)) return byName
    let best: number | null = null, bestErr = Infinity
    for (const c of candidates) {
      const err = Math.abs(c - reference) / reference
      if (err < bestErr) { best = c; bestErr = err }
    }
    // Otherwise the candidate closest to the reference, or the reference itself if none is close.
    return Math.round(best !== null && bestErr <= 0.25 ? best : reference)
  }
  return candidates.length ? Math.round(candidates[0]) : null
}

/** The raw Krónan fields a pack size is derived from; kept on the ingredient for inspection. */
export type PackSource = { price: number; pricePerKilo: number | null; baseComparisonUnit: string | null; qtyPerBaseCompUnit: number | null; qtyInSalesUnit: number | null; chargedByWeight: boolean }
export const packSource = (p: KProductDetail | KProduct): PackSource => ({
  price: p.price, pricePerKilo: p.pricePerKilo ?? null, baseComparisonUnit: p.baseComparisonUnit ?? null,
  qtyPerBaseCompUnit: (p as KProductDetail).qtyPerBaseCompUnit ?? null, qtyInSalesUnit: (p as KProductDetail).qtyInSalesUnit ?? null,
  chargedByWeight: !!p.chargedByWeight,
})

/**
 * Ingredient model: `qty` + `unit` is the amount USED in the dish (g, ml or stk). Packages to buy are
 * derived from the product's pack size when it's time to shop. Older records that stored packages in
 * `qty` (with the used amount in `used_qty`) are normalised here.
 */
export const normalizeIngredient = (i: RecipeIngredient): RecipeIngredient => {
  if (i.used_qty !== null && i.used_qty !== undefined) {
    return { ...i, qty: i.used_qty, unit: i.used_unit || 'g', used_qty: null, used_unit: undefined }
  }
  if (i.unit === 'kg') return { ...i, qty: i.qty * 1000, unit: 'g' }
  if (i.unit === 'l') return { ...i, qty: i.qty * 1000, unit: 'ml' }
  if (i.unit === 'stk' && i.pack_g) return { ...i, qty: i.qty * i.pack_g, unit: 'g' }
  if (!['g', 'ml', 'stk'].includes(i.unit)) return { ...i, unit: 'stk' }
  return i
}

/** Grams (or ml) of an ingredient actually used in the dish. */
export const ingredientGrams = (i: RecipeIngredient, scale = 1): number | null => {
  const n = normalizeIngredient(i)
  if (n.unit === 'g' || n.unit === 'ml') return n.qty * scale
  return n.pack_g ? n.qty * n.pack_g * scale : null
}

/** Whole packages/pieces to buy for the used amount, rounded up to the product's pack size. */
export const packsToBuy = (i: RecipeIngredient, scale = 1): number => {
  const n = normalizeIngredient(i)
  const amount = n.qty * scale
  if (amount <= 0) return 0
  if (n.unit === 'stk') return Math.ceil(amount - 1e-9)
  if (n.pack_g && n.pack_g > 0) return Math.ceil(amount / n.pack_g - 1e-9)
  return 1
}

export const lineCost = (i: RecipeIngredient, scale = 1) => packsToBuy(i, scale) * (i.price || 0)

/** Label for the amount to buy, e.g. "2 × 400 g" or "3 stk". */
export const buyLabel = (i: RecipeIngredient, scale = 1) => {
  const n = normalizeIngredient(i)
  const packs = packsToBuy(n, scale)
  if (n.unit === 'stk' || !n.pack_g) return `${packs} stk`
  return `${packs} × ${n.pack_g} ${n.unit === 'ml' ? 'ml' : 'g'}`
}

export const ingredientMacros = (i: RecipeIngredient, scale = 1): Macros | null => {
  const g = ingredientGrams(i, scale)
  if (g === null || !i.macros) return null
  const f = g / 100
  return { kcal: i.macros.kcal * f, protein: i.macros.protein * f, carbs: i.macros.carbs * f, fat: i.macros.fat * f }
}

export const sumMacros = (list: (Macros | null)[]): { total: Macros; known: number } => {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  let known = 0
  for (const m of list) { if (!m) continue; known++; total.kcal += m.kcal; total.protein += m.protein; total.carbs += m.carbs; total.fat += m.fat }
  return { total, known }
}

/** Fill package size, nutrition and current price for every SKU-linked ingredient. Leaves non-linked ones untouched. */
export async function enrichIngredients(token: string, ings: RecipeIngredient[]): Promise<RecipeIngredient[]> {
  const skus = ings.map((i) => i.sku).filter((s): s is string => !!s)
  if (!skus.length) return ings
  const details = await getProductDetails(token, skus)
  return ings.map((i) => {
    const d = i.sku ? details.get(i.sku) : undefined
    if (!d) return i
    const pack_g = packGrams(d)
    const nutrition = d.nutrition ?? null
    const n = normalizeIngredient(i)
    // A piece-based amount becomes grams once the pack size is known.
    const upgraded = n.unit === 'stk' && pack_g && !d.qtyInSalesUnit ? { qty: n.qty * pack_g, unit: 'g' } : {}
    return {
      ...n, ...upgraded, pack_g, nutrition, macros: parseMacros(nutrition),
      price: effectivePrice(d) || i.price,
      thumbnail: i.thumbnail || d.thumbnail || null,
      source: packSource(d),
    }
  })
}

/** Create a Krónan product list with the given SKUs/quantities. Returns the list token and name. */
export async function createProductList(token: string, name: string, items: { sku: string; quantity: number }[]) {
  const list = await kfetch<{ token: string; name: string }>(token, 'product-lists/', {
    method: 'POST', body: JSON.stringify({ name, description: 'Created from Habits meal prep' }),
  })
  const skus = [...new Set(items.map((i) => i.sku))]
  if (skus.length) {
    await kfetch(token, `product-lists/${list.token}/batch-add-items/`, { method: 'POST', body: JSON.stringify({ skus }) })
    for (const it of items.filter((i) => i.quantity > 1)) {
      await kfetch(token, `product-lists/${list.token}/update-item/`, { method: 'POST', body: JSON.stringify({ sku: it.sku, quantity: it.quantity }) })
    }
  }
  return list
}

// ---------- mapping ----------
/** Parse "400 g", "2 dl", "1,5 kg" from a recipe item comment into grams/ml. */
const usedFromComment = (comment: string): { used_qty: number; used_unit: string } | null => {
  const m = comment.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|ltr|ml|cl|dl|msk|tsk|stk)\b/i)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  const u = m[2].toLowerCase()
  if (u === 'kg' || u === 'l' || u === 'ltr') return { used_qty: n * 1000, used_unit: u === 'kg' ? 'g' : 'ml' }
  if (u === 'dl') return { used_qty: n * 100, used_unit: 'ml' }
  if (u === 'cl') return { used_qty: n * 10, used_unit: 'ml' }
  if (u === 'msk') return { used_qty: n * 15, used_unit: 'ml' }
  if (u === 'tsk') return { used_qty: n * 5, used_unit: 'ml' }
  if (u === 'stk') return { used_qty: n, used_unit: 'stk' }
  return { used_qty: n, used_unit: u === 'gr' ? 'g' : u }
}

/**
 * Turn a Krónan product into an ingredient. `packages` is how many sales units the source (e.g. a Krónan
 * recipe) lists; the used amount defaults to that many whole packs unless the comment says otherwise.
 */
export const productToIngredient = (p: KProduct | KSearchHit | KProductDetail, packages = 1, note = ''): RecipeIngredient => {
  const d = p as KProductDetail
  const nutrition = d.nutrition ?? null
  const pack_g = packGrams(p)
  const isLiquid = /^(l|ltr|ml)$/.test((p.baseComparisonUnit || '').toLowerCase()) || /\b(ml|dl|cl|l|ltr)\b/i.test(p.name)
  const used = usedFromComment(note)
  let qty: number, unit: string
  if (used) { qty = used.used_qty; unit = used.used_unit }
  else if (pack_g) { qty = packages * pack_g; unit = isLiquid ? 'ml' : 'g' }
  else { qty = packages; unit = 'stk' }
  return {
    name: p.name, qty, unit, price: effectivePrice(p),
    sku: p.sku, thumbnail: p.thumbnail || null, note,
    used_qty: null, pack_g, nutrition, macros: parseMacros(nutrition), source: packSource(p),
  }
}

export const ingredientsCost = (ings: RecipeIngredient[]) => Math.round(ings.reduce((a, i) => a + lineCost(i), 0))

/** Convert a Krónan recipe into our Recipe shape (without id/user/created_at). */
export const toRecipe = (d: KRecipeDetail): Omit<Recipe, 'id' | 'user_id' | 'created_at'> => {
  const ingredients = d.items.map((it) => productToIngredient(it.product, it.quantity || 1, it.comment || ''))
  const directions = d.directionSteps?.length
    ? d.directionSteps.map((g) => `${g.name ? g.name + '\n' : ''}${g.steps.map((s) => `${s.number}. ${s.text}`).join('\n')}`).join('\n\n')
    : d.directions || ''
  return {
    title: d.displayName || d.name,
    source: 'kronan',
    kronan_slug: d.slug,
    url: kronanRecipeUrl(d.slug),
    image: d.mainImage?.image ?? null,
    servings: d.servings || 4,
    ingredients,
    directions,
    tags: [...(d.tags || []), ...(d.cuisineTags || [])].map((t) => t.name),
    est_cost: ingredientsCost(ingredients),
  }
}

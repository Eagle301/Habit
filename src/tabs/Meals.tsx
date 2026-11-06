import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CalendarPlus, Camera, Check, ChefHat, ChevronDown, ExternalLink, Link2, Plus, ScanBarcode, Search, Trash2, Wand2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Macros, MealPlan, Recipe, RecipeIngredient } from '../lib/types'
import { addDays, format, weekStart, ymd } from '../lib/dates'
import * as kronan from '../lib/kronan'
import { isk } from '../lib/kronan'
import { Card, CheckCircle, Empty, Header, NumberField, Segment, SectionTitle, Stepper, invalidFields } from '../components/ui/Bits'
import { Sheet } from '../components/ui/Sheet'
import { removePhoto, savePhoto } from '../lib/photos'
import { BarcodeScanner, type ScanResult } from '../components/BarcodeScanner'

/* ------------------------------ helpers ------------------------------ */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Meals added from a recipe or the Sunday prep picker are cooked on prep day (Sunday). */
const PREP_DAY = 6

const r0 = (n: number) => Math.round(n)
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const toggled = <V,>(m: Map<string, V>, key: string, value: V) => { const n = new Map(m); if (n.has(key)) n.delete(key); else n.set(key, value); return n }
const toggledSet = (s: Set<number>, key: number) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n }

const norm = (r: Recipe) => r.ingredients.map(kronan.normalizeIngredient)
/** Factor from a recipe's own servings to `servings`. */
const scaleOf = (r: Recipe, servings: number) => servings / Math.max(1, r.servings)
/** Cost in ISK of a recipe cooked for `servings` (default: its own), always from the current ingredients. */
const costFor = (r: Recipe, servings = r.servings) => {
  const scale = scaleOf(r, servings)
  return Math.round(norm(r).reduce((a, i) => a + kronan.lineCost(i, scale), 0))
}
/** Total macros of a list of ingredients; `known` = how many had nutrition data. */
const ingsMacros = (ings: RecipeIngredient[], scale = 1) => kronan.sumMacros(ings.map((i) => kronan.ingredientMacros(i, scale)))
const recipeMacros = (r: Recipe, servings = r.servings) => ingsMacros(norm(r), scaleOf(r, servings))
const perServing = (m: Macros, servings: number): Macros => {
  const d = Math.max(1, servings)
  return { kcal: m.kcal / d, protein: m.protein / d, carbs: m.carbs / d, fat: m.fat / d }
}
/** Rounded kcal per serving of a recipe cooked for `servings`, or null without nutrition data. */
const kcalPerServing = (r: Recipe, servings = r.servings) => {
  const m = recipeMacros(r, servings)
  return m.known ? r0(perServing(m.total, servings).kcal) : null
}
/** " · 420 kcal/serv", or '' without nutrition data. */
const kcalNote = (r: Recipe, servings: number) => { const k = kcalPerServing(r, servings); return k === null ? '' : ` · ${k} kcal/serv` }
const qtyLabel = (i: RecipeIngredient, scale = 1) => `${fmtQty(i.qty * scale)} ${i.unit}`
/** Stepper increment for a quantity: one piece, or one whole pack for weighed items. */
const qtyStep = (i: RecipeIngredient) => (i.unit === 'stk' ? 1 : i.pack_g && i.pack_g > 0 ? i.pack_g : 1)

/**
 * What to buy for a set of planned meals: identical ingredients are merged across recipes (scaled to
 * the planned servings) and rounded up to whole packages. Also the source of "Send to Krónan".
 */
const shoppingList = (plans: MealPlan[], byId: Map<string, Recipe>) => {
  const merged = new Map<string, { ing: RecipeIngredient; amount: number }>()
  for (const p of plans) {
    const r = byId.get(p.recipe_id)
    if (!r) continue
    const scale = scaleOf(r, p.servings)
    for (const ing of norm(r)) {
      const key = ing.sku ?? `${ing.name.toLowerCase()}|${ing.unit}`
      const cur = merged.get(key)
      if (cur) cur.amount += ing.qty * scale
      else merged.set(key, { ing, amount: ing.qty * scale })
    }
  }
  return [...merged].map(([key, { ing, amount }]) => {
    const i = { ...ing, qty: amount }
    return { key, sku: ing.sku, name: ing.name, label: kronan.buyLabel(i), cost: kronan.lineCost(i), packs: kronan.packsToBuy(i) }
  }).filter((x) => x.packs > 0).sort((a, b) => a.name.localeCompare(b.name))
}

/** Calls `loadMore` when the returned sentinel scrolls into view, while `canLoad` is true. */
function useInfiniteScroll(canLoad: boolean, loadMore: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const more = useRef(loadMore)
  more.current = loadMore
  useEffect(() => {
    const el = ref.current
    if (!el || !canLoad) return
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) more.current() }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [canLoad])
  return ref
}

/* ------------------------------ small components ------------------------------ */

/** Image with an emoji fallback. `product` shots are contained on white; recipe photos fill the box. */
function Thumb({ src, className, product, fallback = product ? '🛒' : '🍽️' }: { src: string | null | undefined; className: string; product?: boolean; fallback?: string }) {
  return src
    ? <img src={src} alt="" loading="lazy" className={`${className} shrink-0 ${product ? 'object-contain bg-white' : 'object-cover'}`} />
    : <span className={`${className} shrink-0 bg-line inline-flex items-center justify-center`}>{fallback}</span>
}

function ErrorNote({ text }: { text: string | null }) {
  return text ? <div className="text-xs p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{text}</div> : null
}

/**
 * Recipe photo. With `onChange` it gets buttons to take a new one (camera or photo library) or
 * remove it; without (the recipe view, Krónan recipes) it is just the picture.
 */
function RecipePhoto({ image, onChange }: { image: string | null; onChange?: (url: string | null) => void }) {
  const showToast = useStore((s) => s.showToast)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const photo = image ? <img src={image} alt="" className="w-full h-44 object-cover rounded-2xl" /> : null
  if (!onChange) return photo
  const choose = () => input.current?.click()
  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const r = await savePhoto(file)
      onChange(r.url)
      showToast(r.warning ?? 'Photo saved')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not use that photo')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="relative">
      {photo ?? (
        <button type="button" onClick={choose} disabled={busy} className="w-full h-24 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1 text-3 text-sm press" style={{ borderColor: 'var(--line)' }}>
          <Camera size={22} /> Add a photo
        </button>
      )}
      {image && (
        <div className="absolute bottom-2 right-2 flex gap-1.5">
          <button type="button" className="btn btn-sm glass-strong" onClick={choose} disabled={busy}><Camera size={14} /> Retake</button>
          <button type="button" className="btn btn-sm glass-strong" onClick={() => onChange(null)} disabled={busy} aria-label="Remove photo"><Trash2 size={14} /></button>
        </div>
      )}
      {busy && <div className="absolute inset-0 rounded-2xl flex items-center justify-center text-sm font-semibold" style={{ background: 'rgba(0,0,0,0.45)', color: 'white' }}>Saving photo…</div>}
      {/* No `capture` attribute: phones then offer both "Take photo" and the photo library. */}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  )
}

/** A recipe's link as a tinted pill: link icon, site name, open-in-new icon. Only http(s) links are shown. */
function LinkButton({ url }: { url: string }) {
  if (!/^https?:\/\//i.test(url)) return null
  const host = url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0]
  return (
    <a href={url} target="_blank" rel="noreferrer noopener"
      className="self-start inline-flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1.5 text-sm font-medium press max-w-full"
      style={{ background: 'rgba(99,102,241,0.16)', border: '1px solid rgba(99,102,241,0.35)' }}>
      <span className="w-7 h-7 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: 'white' }}>
        <Link2 size={15} />
      </span>
      <span className="truncate">{host}</span>
      <ExternalLink size={14} className="text-3 shrink-0" />
    </a>
  )
}

function MacroPills({ m, per, compact }: { m: Macros; per?: string; compact?: boolean }) {
  const cls = compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'
  return (
    <div className="flex gap-1 flex-wrap items-center">
      <span className={`rounded-full font-semibold ${cls}`} style={{ background: 'rgba(249,115,22,0.18)', color: '#ea580c' }}>{r0(m.kcal)} kcal</span>
      <span className={`rounded-full font-medium ${cls}`} style={{ background: 'rgba(99,102,241,0.15)' }}>P {r0(m.protein)}g</span>
      <span className={`rounded-full font-medium ${cls}`} style={{ background: 'rgba(234,179,8,0.18)' }}>C {r0(m.carbs)}g</span>
      <span className={`rounded-full font-medium ${cls}`} style={{ background: 'rgba(236,72,153,0.15)' }}>F {r0(m.fat)}g</span>
      {per && <span className="text-3 text-[10px]">{per}</span>}
    </div>
  )
}

/* ------------------------------ tab ------------------------------ */

export function Meals() {
  const recipes = useStore((s) => s.recipes)
  const mealPlans = useStore((s) => s.mealPlans)
  const kronanToken = useStore((s) => s.kronanToken)
  const { updateMealPlan, unplanMeal, showToast, setTab } = useStore()

  // Meal prep is always for next week: cooked on the coming Sunday (never today) and eaten the week
  // after it. Plans are stored under the Monday of the prep Sunday's week (prep day = week_start + 6).
  const prepSunday = addDays(new Date(), 7 - new Date().getDay())
  const week = ymd(weekStart(prepSunday))
  const prepLabel = format(prepSunday, 'EEE, MMM d')
  const weekLabel = `${format(addDays(prepSunday, 1), 'MMM d')} – ${format(addDays(prepSunday, 7), 'MMM d')}`

  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [prepOpen, setPrepOpen] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)
  const [pushing, setPushing] = useState(false)

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes])
  const plans = useMemo(() => mealPlans.filter((m) => m.week_start === week).sort((a, b) => (a.day ?? 9) - (b.day ?? 9)), [mealPlans, week])
  const planned = plans.flatMap((p) => { const r = byId.get(p.recipe_id); return r ? [{ p, r }] : [] })
  const total = planned.reduce((a, { p, r }) => a + costFor(r, p.servings), 0)
  const shop = useMemo(() => shoppingList(plans, byId), [plans, byId])

  const pushToKronan = async () => {
    if (!kronanToken) return
    const items = shop.filter((x) => x.sku).map((x) => ({ sku: x.sku!, quantity: x.packs }))
    if (!items.length) { showToast('No Krónan-linked ingredients in this plan'); return }
    setPushing(true)
    try {
      const list = await kronan.createProductList(kronanToken, `Meal prep ${weekLabel}`, items)
      showToast(`Sent ${plural(items.length, 'product')} to Krónan list “${list.name}”`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Krónan push failed')
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Header subtitle="Recipes & weekly meal prep" title="Meals" />

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-[16px]">🍲 Next week · {weekLabel}</div>
            <div className="text-3 text-xs mt-0.5">Prep {prepLabel} · {plural(planned.length, 'meal')} planned</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-bold">{isk(total)}</div>
            <div className="text-3 text-[10px]">estimated</div>
          </div>
        </div>

        {planned.length === 0 ? (
          <div className="text-2 text-sm mt-3">Nothing planned yet. Open a recipe below and press “Add to Plan”.</div>
        ) : (
          <div className="flex flex-col gap-1.5 mt-3">
            {planned.map(({ p, r }) => (
              <div key={p.id} className="flex items-center gap-2 py-1.5 border-b hairline last:border-b-0">
                <button onClick={() => updateMealPlan(p.id, { cooked: !p.cooked })} aria-label="Cooked"><CheckCircle checked={p.cooked} size={24} color="#22c55e" /></button>
                <button className="grow min-w-0 text-left" onClick={() => setOpenId(r.id)}>
                  <div className={`text-sm font-medium truncate ${p.cooked ? 'line-through text-3' : ''}`}>{r.title}</div>
                  <div className="text-3 text-xs">{p.servings} serv · {isk(costFor(r, p.servings))}{kcalNote(r, p.servings)}</div>
                </button>
                <select className="field !w-auto !py-1 !px-2 text-xs" value={p.day ?? ''} onChange={(e) => updateMealPlan(p.id, { day: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Day">
                  <option value="">Any</option>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
                <button onClick={() => unplanMeal(p.id)} className="text-3 p-1" aria-label="Remove"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}

        {shop.length > 0 && (
          <div className="mt-3 rounded-xl bg-line">
            <button className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-semibold" onClick={() => setShopOpen(!shopOpen)} aria-expanded={shopOpen}>
              <span>🛒 Shopping list · {plural(shop.length, 'item')}</span>
              <ChevronDown size={16} className="text-3 transition-transform" style={{ transform: shopOpen ? 'rotate(180deg)' : 'none' }} />
            </button>
            {shopOpen && (
              <div className="px-3 pb-2 flex flex-col">
                {shop.map((x) => (
                  <div key={x.key} className="flex items-center gap-2 text-sm py-1 border-t hairline">
                    <span className="grow min-w-0 truncate"><b>{x.label}</b> {x.name}</span>
                    <span className="text-2 shrink-0">{x.cost ? isk(x.cost) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-3">
          <button className="btn btn-sm btn-primary grow" onClick={() => setPrepOpen(true)} disabled={!recipes.length}><CalendarDays size={14} /> Schedule prep</button>
          {kronanToken && <button className="btn btn-sm grow" onClick={pushToKronan} disabled={!planned.length || pushing}><Wand2 size={14} /> {pushing ? 'Sending…' : 'Send to Krónan'}</button>}
        </div>
        {!kronanToken && <p className="text-3 text-[11px] mt-2">Connect Krónan in <button className="underline" onClick={() => setTab('settings')}>Settings</button> to browse their recipes with live prices and macros, and push shopping lists to your account.</p>}
      </Card>

      <SectionTitle right={<button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Recipe</button>}>Recipe library</SectionTitle>
      {recipes.length === 0 ? (
        <Empty icon="🍳" title="No recipes yet" hint="Add your own recipe from Krónan’s store, or browse Krónan’s recipes." />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {recipes.map((r) => {
            const cost = costFor(r)
            const kcal = kcalPerServing(r)
            return (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="glass press text-left overflow-hidden flex flex-col">
                <Thumb src={r.image} className="w-full h-24 text-3xl" />
                <div className="p-2.5">
                  <div className="font-semibold text-sm leading-tight line-clamp-2">{r.title}</div>
                  <div className="text-3 text-[11px] mt-1">{r.servings} serv · {cost ? isk(cost) : 'no price'}</div>
                  {kcal !== null && <div className="text-[11px] mt-0.5 font-medium" style={{ color: '#ea580c' }}>{kcal} kcal / serving</div>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Sheet open={!!openId} onClose={() => setOpenId(null)} title={(openId && byId.get(openId)?.title) || 'Recipe'} tall>
        {openId && <RecipeDetail key={openId} id={openId} week={week} weekLabel={weekLabel} onClose={() => setOpenId(null)} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add recipe" tall>
        {adding && <AddRecipe onDone={() => setAdding(false)} />}
      </Sheet>
      <Sheet open={prepOpen} onClose={() => setPrepOpen(false)} title="Sunday meal prep" tall scroll={false}>
        {prepOpen && <SundayPrep week={week} weekLabel={weekLabel} prepLabel={prepLabel} plans={plans} onDone={() => setPrepOpen(false)} />}
      </Sheet>
    </div>
  )
}

/* ------------------------------ Sunday prep picker ------------------------------ */

function SundayPrep({ week, weekLabel, prepLabel, plans, onDone }: { week: string; weekLabel: string; prepLabel: string; plans: MealPlan[]; onDone: () => void }) {
  const recipes = useStore((s) => s.recipes)
  const { planMeal, updateMealPlan, unplanMeal, scheduleMealPrep, showToast } = useStore()
  // Pre-select what is already planned for the week, with its servings.
  const [sel, setSel] = useState<Map<string, number>>(() => new Map(plans.map((p) => [p.recipe_id, p.servings])))
  const [time, setTime] = useState('14:00')
  const [filter, setFilter] = useState('')
  const compact = recipes.length > 5
  // Selected recipes stay on top so they never scroll out of sight while filtering the rest.
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q ? recipes.filter((r) => r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q))) : recipes
    return [...list].sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)) || a.title.localeCompare(b.title))
  }, [recipes, filter, sel])

  const chosen = recipes.filter((r) => sel.has(r.id))
  const servingsOf = (r: Recipe) => sel.get(r.id) ?? r.servings
  const total = chosen.reduce((a, r) => a + costFor(r, servingsOf(r)), 0)
  const portions = chosen.reduce((a, r) => a + servingsOf(r), 0)

  const confirm = () => {
    for (const p of plans) {
      const want = sel.get(p.recipe_id)
      if (want === undefined) unplanMeal(p.id)
      else if (want !== p.servings) updateMealPlan(p.id, { servings: want })
    }
    for (const r of chosen) if (!plans.some((p) => p.recipe_id === r.id)) planMeal(r.id, week, PREP_DAY, servingsOf(r))
    scheduleMealPrep(week, time)
    showToast(`Sunday prep set · ${plural(chosen.length, 'recipe')}`)
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 grow min-h-0">
      <p className="text-2 text-sm shrink-0">Pick what you’ll cook on <b>{prepLabel}</b> for next week (<b>{weekLabel}</b>). Confirming plans the meals, builds the shopping list, books the prep block on that Sunday and adds a “Shop for meal prep” to-do.</p>

      {compact && (
        <div className="relative shrink-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-3" />
          <input className="field !pl-9" placeholder={`Search ${recipes.length} recipes…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}

      {/* Only this list scrolls; the footer below is outside it, so rows can never appear under the button. */}
      <div className={`overflow-y-auto overscroll-contain grow min-h-0 -mx-4 px-4 py-0.5 flex flex-col ${compact ? 'gap-1' : 'gap-2'}`}>
        {visible.length === 0 && <div className="text-3 text-sm py-2 text-center">No recipe matches “{filter}”.</div>}
        {visible.map((r) => {
          const on = sel.has(r.id)
          const serv = servingsOf(r)
          return (
            <div key={r.id} className={`glass flex items-center gap-2 ${compact ? 'p-1.5' : 'p-2'}`} style={{ outline: on ? '2px solid #22c55e' : 'none' }}>
              <button onClick={() => setSel((cur) => toggled(cur, r.id, r.servings))} className="flex items-center gap-2 grow min-w-0 text-left">
                <CheckCircle checked={on} size={compact ? 22 : 24} color="#22c55e" />
                <Thumb src={r.image} className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-lg`} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <div className="text-3 text-[11px] truncate">{isk(costFor(r, serv))}{kcalNote(r, serv)}</div>
                </div>
              </button>
              {on && <Stepper value={serv} onChange={(n) => setSel((cur) => new Map(cur).set(r.id, n))} min={1} integer label={`${r.title} servings`} size="sm" />}
            </div>
          )
        })}
      </div>

      <div className="shrink-0 flex flex-col gap-3 pt-1 border-t hairline">
        <div className="glass p-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-2">Prep block on Sunday at</div>
            <input className="field mt-1 !w-auto !py-1" type="time" value={time} onChange={(e) => setTime(e.target.value || '14:00')} />
          </div>
          <div className="text-right">
            <div className="text-xl font-bold">{isk(total)}</div>
            <div className="text-3 text-[11px]">{plural(chosen.length, 'recipe')} · {plural(portions, 'portion')}</div>
          </div>
        </div>
        <button className="btn btn-primary py-3" onClick={confirm} disabled={chosen.length === 0}><Check size={18} /> Confirm Sunday prep</button>
      </div>
    </div>
  )
}

/* ------------------------------ recipe detail ------------------------------ */

function RecipeDetail({ id, week, weekLabel, onClose }: { id: string; week: string; weekLabel: string; onClose: () => void }) {
  const recipe = useStore((s) => s.recipes.find((r) => r.id === id))
  const kronanToken = useStore((s) => s.kronanToken)
  const mealPlans = useStore((s) => s.mealPlans)
  const { deleteRecipe, updateRecipe, planMeal, updateMealPlan, showToast } = useStore()
  const [servings, setServings] = useState(recipe?.servings ?? 4)
  const [editing, setEditing] = useState(false)
  const [cooking, setCooking] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [ingOpen, setIngOpen] = useState<number | null>(null)

  // Older Krónan recipes saved before macros existed: fetch nutrition once.
  useEffect(() => {
    if (!recipe || !kronanToken || enriching) return
    if (!recipe.ingredients.some((i) => i.sku && i.macros === undefined)) return
    setEnriching(true)
    kronan.enrichIngredients(kronanToken, recipe.ingredients)
      .then((ings) => updateRecipe(recipe.id, { ingredients: ings, est_cost: kronan.ingredientsCost(ings) }))
      .catch(() => { /* keep going without macros */ })
      .finally(() => setEnriching(false))
  }, [recipe?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!recipe) return null
  if (editing) return <RecipeForm initial={recipe} onDone={() => setEditing(false)} />
  if (cooking) return <CookMode recipe={recipe} servings={servings} onBack={() => setCooking(false)} />

  const ings = norm(recipe)
  const scale = scaleOf(recipe, servings)
  const cost = costFor(recipe, servings)
  const macros = recipeMacros(recipe, servings)

  /** Adds the recipe to next week's plan only; "Send to Krónan" on the week card does the shopping. */
  const addToPlan = () => {
    const existing = mealPlans.find((m) => m.week_start === week && m.recipe_id === recipe.id)
    if (!existing) {
      planMeal(recipe.id, week, PREP_DAY, servings)
      showToast(`Added to next week’s plan (${weekLabel})`)
    } else if (existing.servings !== servings) {
      updateMealPlan(existing.id, { servings })
      showToast(`Already planned · now ${servings} servings`)
    } else showToast('Already in next week’s plan')
    onClose()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Photos are changed in the recipe editor only. */}
      <RecipePhoto image={recipe.image} />

      <Card className="p-3" style={{ background: 'rgba(34,197,94,0.12)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-2">Cooking for</div>
            <div className="flex items-center gap-2 mt-1">
              <Stepper value={servings} onChange={setServings} min={1} integer label="Servings" />
              <span className="text-sm">servings</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{isk(cost)}</div>
            <div className="text-3 text-[11px]">{isk(cost / Math.max(1, servings))} / serving</div>
          </div>
        </div>
        {macros.known > 0 && (
          <div className="mt-3 pt-3 border-t hairline">
            <MacroPills m={perServing(macros.total, servings)} per="per serving" compact />
          </div>
        )}
        {enriching && <div className="text-3 text-[11px] mt-2">fetching macros…</div>}
      </Card>

      <div className="flex gap-2">
        <button className="btn btn-primary grow py-3" onClick={() => setCooking(true)}><ChefHat size={18} /> Make this</button>
        <button className="btn grow py-3" onClick={addToPlan}><CalendarPlus size={18} /> Add to Plan</button>
      </div>

      {/* Need to buy: used amount rounded up to whole packages */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-3 text-xs font-semibold uppercase tracking-wide">🛒 Need to buy</div>
          <div className="text-sm font-bold">{isk(cost)}</div>
        </div>
        <div className="flex flex-col">
          {ings.map((i, n) => (
            <button key={n} onClick={() => setIngOpen(n)} className="flex items-center gap-2 text-sm text-left w-full py-1.5 border-b hairline last:border-b-0">
              <Thumb src={i.thumbnail} product className="w-7 h-7 rounded-md text-[10px]" />
              <div className="grow min-w-0 truncate"><b>{kronan.buyLabel(i, scale)}</b> {i.name}</div>
              <div className="font-medium shrink-0 text-2">{i.price ? isk(kronan.lineCost(i, scale)) : '—'}</div>
            </button>
          ))}
          {ings.length === 0 && <div className="text-3 text-sm">No ingredients listed.</div>}
        </div>
      </div>

      {recipe.url && <LinkButton url={recipe.url} />}

      <div className="flex gap-2">
        <button className="btn btn-danger" onClick={() => { if (confirm(`Delete "${recipe.title}"?`)) { deleteRecipe(recipe.id); onClose() } }} aria-label="Delete recipe"><Trash2 size={16} /></button>
        <button className="btn grow" onClick={() => setEditing(true)}>Edit recipe</button>
      </div>

      <Sheet open={ingOpen !== null} onClose={() => setIngOpen(null)} title={ingOpen !== null ? ings[ingOpen]?.name ?? '' : ''}>
        {ingOpen !== null && ings[ingOpen] && <IngredientInfo i={ings[ingOpen]} scale={scale} servings={servings} inRecipe />}
      </Sheet>
    </div>
  )
}

/* ------------------------------ cook mode ------------------------------ */

/** "10 mín", "15-20 minutes", "1 klst", "30 sek" → seconds (first match). */
const minutesInText = (s: string): number | null => {
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(klst|klukkustund|hour|hrs?)\b/i)
  if (h) return Math.round(Number(h[1].replace(',', '.')) * 3600)
  const m = s.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(mín|min|mínút|minut)/i)
  if (m) return Number(m[2] ?? m[1]) * 60
  const sec = s.match(/(\d+)\s*(sek|sec)/i)
  if (sec) return Number(sec[1])
  return null
}

const fmtClock = (secs: number) => {
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    for (let n = 0; n < 3; n++) {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = 880
      o.connect(g); g.connect(ctx.destination)
      const t = ctx.currentTime + n * 0.35
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      o.start(t); o.stop(t + 0.32)
    }
  } catch { /* audio not available */ }
  try { navigator.vibrate?.([200, 100, 200, 100, 400]) } catch { /* ignore */ }
}

function Timer({ request }: { request: { secs: number; label: string; nonce: number } | null }) {
  const [total, setTotal] = useState(10 * 60)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(10 * 60)
  const [label, setLabel] = useState('Timer')
  const [done, setDone] = useState(false)
  const [custom, setCustom] = useState('')

  const start = (secs: number, name = 'Timer') => { setTotal(secs); setRemaining(secs); setEndAt(Date.now() + secs * 1000); setLabel(name); setDone(false) }
  useEffect(() => { if (request) start(request.secs, request.label) }, [request?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (endAt === null) return
    const id = setInterval(() => {
      const left = (endAt - Date.now()) / 1000
      if (left <= 0) { setRemaining(0); setEndAt(null); setDone(true); beep() }
      else setRemaining(left)
    }, 250)
    return () => clearInterval(id)
  }, [endAt])

  const running = endAt !== null
  const pause = () => { setEndAt(null) }
  const resume = () => { setEndAt(Date.now() + remaining * 1000); setDone(false) }
  const reset = () => { setEndAt(null); setRemaining(total); setDone(false) }
  const pct = total ? 1 - remaining / total : 0

  return (
    <Card className={`p-3 ${done ? 'animate-shake' : ''}`} style={{ background: done ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.12)' }}>
      <div className="flex items-center gap-3">
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--line)" strokeWidth="7" />
            <circle cx="40" cy="40" r="34" fill="none" stroke={done ? '#ef4444' : '#6366f1'} strokeWidth="7" strokeLinecap="round" strokeDasharray={2 * Math.PI * 34} strokeDashoffset={2 * Math.PI * 34 * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.25s linear' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center font-bold text-[15px] tabular-nums">{fmtClock(remaining)}</div>
        </div>
        <div className="grow min-w-0">
          <div className="text-xs text-2 truncate">{done ? '⏰ Time’s up!' : label}</div>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {running
              ? <button className="btn btn-sm" onClick={pause}>Pause</button>
              : <button className="btn btn-sm btn-primary" onClick={remaining > 0 ? resume : () => start(total, label)} disabled={total === 0}>{remaining > 0 && remaining < total ? 'Resume' : 'Start'}</button>}
            <button className="btn btn-sm" onClick={reset}>Reset</button>
            <button className="btn btn-sm" onClick={() => { const r = remaining + 60; setRemaining(r); setTotal(total + 60); if (running) setEndAt(Date.now() + r * 1000) }}>+1 min</button>
          </div>
          <div className="flex gap-1 mt-1.5 flex-wrap items-center">
            {[1, 5, 10, 15, 20, 30].map((m) => <button key={m} className="text-[11px] px-2 py-0.5 rounded-full bg-line press" onClick={() => start(m * 60)}>{m}m</button>)}
            <input className="field !w-14 !py-0.5 !px-2 text-[12px]" placeholder="min" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && Number(custom) > 0) { start(Number(custom) * 60); setCustom('') } }} />
          </div>
        </div>
      </div>
    </Card>
  )
}

function CookMode({ recipe, servings, onBack }: { recipe: Recipe; servings: number; onBack: () => void }) {
  const scale = scaleOf(recipe, servings)
  const ings = norm(recipe)
  const [doneIngs, setDoneIngs] = useState<Set<number>>(new Set())
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set())
  const [request, setRequest] = useState<{ secs: number; label: string; nonce: number } | null>(null)
  const steps = useMemo(() => recipe.directions.split(/\n+/).map((s) => s.trim()).filter(Boolean), [recipe.directions])

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => { /* not granted */ })
    return () => { void lock?.release() }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="btn btn-sm" onClick={onBack}>‹ Back</button>
        <div className="min-w-0">
          <div className="font-bold text-[17px] leading-tight truncate">{recipe.title}</div>
          <div className="text-3 text-xs">Cooking {servings} servings</div>
        </div>
      </div>

      <Timer request={request} />

      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-1.5">Ingredients</div>
        <div className="flex flex-col">
          {ings.map((i, n) => {
            const on = doneIngs.has(n)
            return (
              <button key={n} onClick={() => setDoneIngs((s) => toggledSet(s, n))} className="flex items-center gap-2 text-left text-[15px] py-2 border-b hairline last:border-b-0">
                <CheckCircle checked={on} size={22} color="#22c55e" />
                <span className={`grow min-w-0 ${on ? 'line-through text-3' : ''}`}><b>{qtyLabel(i, scale)}</b> {i.name}{i.note ? <span className="text-3 text-xs"> · {i.note}</span> : null}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-1.5">Directions</div>
        {steps.length === 0 && <div className="text-3 text-sm">No directions written for this recipe.</div>}
        <div className="flex flex-col gap-1.5">
          {(() => { let stepNo = 0; return steps.map((s, n) => {
            const on = doneSteps.has(n)
            const secs = minutesInText(s)
            const isHeading = !/^\d+[.)]/.test(s) && s.length < 40 && !/[.!?]$/.test(s)
            if (isHeading) return <div key={n} className="text-2 text-xs font-semibold mt-2">{s}</div>
            stepNo++
            const label = `Step ${stepNo}`
            return (
              <div key={n} className="glass p-3 flex items-start gap-2" style={{ opacity: on ? 0.55 : 1 }}>
                <button onClick={() => setDoneSteps((cur) => toggledSet(cur, n))} className="mt-0.5"><CheckCircle checked={on} size={22} /></button>
                <div className="grow min-w-0">
                  <div className={`text-[15px] leading-snug ${on ? 'line-through' : ''}`}><span className="text-3 text-xs mr-1">{stepNo}.</span>{s.replace(/^\d+[.)]\s*/, '')}</div>
                  {secs && <button className="btn btn-sm mt-2" onClick={() => setRequest({ secs, label, nonce: Date.now() })}>⏱ Start {fmtClock(secs)} timer</button>}
                </div>
              </div>
            )
          }) })()}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ ingredient details ------------------------------ */

/** Product details; with `inRecipe` it also shows this ingredient's share of the recipe. */
function IngredientInfo({ i, scale = 1, servings, inRecipe }: { i: RecipeIngredient; scale?: number; servings?: number; inRecipe?: boolean }) {
  const s = i.source
  const cost = kronan.lineCost(i, scale)
  const row = (label: string, value: string, last = false) => (
    <tr className={last ? '' : 'border-b hairline'}><td className="py-1 text-2">{label}</td><td className="py-1 text-right font-medium">{value}</td></tr>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Thumb src={i.thumbnail} product className="w-20 h-20 rounded-xl text-2xl" />
        <div>
          <div className="font-semibold">{i.name}</div>
          <div className="text-2 text-sm">{i.price ? `${isk(i.price)} per pack` : 'price unknown'}</div>
          <div className="text-3 text-xs">{i.pack_g ? `${i.pack_g} ${i.unit === 'ml' ? 'ml' : 'g'} per pack` : 'pack size unknown'}</div>
          {i.sku && <div className="text-3 text-xs">Krónan · vörunr. {i.sku}</div>}
        </div>
      </div>
      {inRecipe && (
        <div className="glass p-3 flex flex-col gap-2">
          <div className="text-3 text-xs font-semibold uppercase tracking-wide">In this recipe{servings ? ` · ${servings} serv` : ''}</div>
          <table className="text-sm w-full">
            <tbody>
              {row('Used', qtyLabel(i, scale))}
              {row('To buy', `${kronan.buyLabel(i, scale)}${i.price ? ` × ${isk(i.price)}` : ''}`)}
              {row('Line cost', isk(cost), !servings)}
              {servings ? row('Per serving', isk(cost / Math.max(1, servings)), true) : null}
            </tbody>
          </table>
          {i.note && <div className="text-2 text-sm">📝 {i.note}</div>}
        </div>
      )}
      {i.macros ? <div><div className="text-3 text-xs font-semibold uppercase tracking-wide mb-1">Per 100 g</div><MacroPills m={i.macros} /></div> : <div className="text-3 text-sm">No nutrition data.</div>}
      {i.nutrition && Object.keys(i.nutrition).length > 0 && (
        <table className="text-sm w-full">
          <tbody>{Object.entries(i.nutrition).map(([k, v]) => <tr key={k} className="border-b hairline"><td className="py-1 text-2">{k}</td><td className="py-1 text-right font-medium">{String(v)}</td></tr>)}</tbody>
        </table>
      )}
      {s && (
        <details>
          <summary className="text-3 text-xs cursor-pointer">Krónan data behind the pack size</summary>
          <table className="text-xs w-full mt-1">
            <tbody>
              {[
                ['price', isk(s.price)], ['pricePerKilo', s.pricePerKilo ?? '—'], ['baseComparisonUnit', s.baseComparisonUnit ?? '—'],
                ['qtyPerBaseCompUnit', s.qtyPerBaseCompUnit ?? '—'], ['qtyInSalesUnit', s.qtyInSalesUnit ?? '—'], ['chargedByWeight', String(s.chargedByWeight)],
                ['price ÷ pricePerKilo', s.pricePerKilo ? `${(s.price / s.pricePerKilo).toFixed(3)} ${s.baseComparisonUnit ?? ''}` : '—'],
              ].map(([k, v]) => <tr key={String(k)} className="border-b hairline"><td className="py-0.5 text-2">{k}</td><td className="py-0.5 text-right font-mono">{String(v)}</td></tr>)}
            </tbody>
          </table>
        </details>
      )}
      <a className="btn btn-sm" href={kronan.kronanSearchUrl(i.name)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> View at kronan.is</a>
    </div>
  )
}

/* ------------------------------ add recipe ------------------------------ */

function AddRecipe({ onDone }: { onDone: () => void }) {
  const kronanToken = useStore((s) => s.kronanToken)
  const [mode, setMode] = useState<'kronan' | 'custom'>(kronanToken ? 'kronan' : 'custom')
  return (
    <div className="flex flex-col gap-3">
      <Segment<'kronan' | 'custom'> value={mode} options={[{ value: 'kronan', label: '🔍 Krónan recipes' }, { value: 'custom', label: '✍️ My own' }]} onChange={setMode} />
      {mode === 'kronan' ? <KronanRecipeSearch onDone={onDone} /> : <RecipeForm onDone={onDone} />}
    </div>
  )
}

function KronanRecipeSearch({ onDone }: { onDone: () => void }) {
  const kronanToken = useStore((s) => s.kronanToken)
  const { addRecipe, showToast, setTab } = useStore()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<kronan.KRecipeListItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof kronan.toRecipe> | null>(null)
  const activeQuery = useRef('')

  const load = async (query: string, pageNo: number, replace: boolean) => {
    if (!kronanToken) return
    setBusy(true); setError(null)
    try {
      let items: kronan.KRecipeListItem[]; let more: boolean
      if (query) {
        const res = await kronan.searchRecipes(kronanToken, query, pageNo)
        items = res.recipes; more = res.hasNextPage
      } else {
        const res = await kronan.listRecipes(kronanToken, (pageNo - 1) * 20)
        items = res.results; more = pageNo * 20 < res.count
      }
      setResults((cur) => (replace ? items : [...cur, ...items.filter((x) => !cur.some((c) => c.token === x.token))]))
      setHasMore(more); setPage(pageNo)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load recipes') } finally { setBusy(false) }
  }

  useEffect(() => { void load('', 1, true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sentinel = useInfiniteScroll(hasMore && !busy && !preview, () => void load(activeQuery.current, page + 1, false))

  const search = () => { activeQuery.current = q.trim(); void load(activeQuery.current, 1, true) }

  const openPreview = async (slug: string) => {
    if (!kronanToken) return
    setBusy(true); setError(null)
    try {
      const base = kronan.toRecipe(await kronan.getRecipe(kronanToken, slug))
      const ingredients = await kronan.enrichIngredients(kronanToken, base.ingredients).catch(() => base.ingredients)
      setPreview({ ...base, ingredients, est_cost: kronan.ingredientsCost(ingredients) })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load recipe') } finally { setBusy(false) }
  }

  if (!kronanToken) {
    return (
      <div className="text-sm text-2">
        <p>Browsing Krónan’s recipes needs your personal Krónan API token.</p>
        <button className="btn btn-primary mt-3" onClick={() => { onDone(); setTab('settings') }}>Connect Krónan in Settings</button>
        <p className="text-3 text-xs mt-3">You can still browse recipes at <a className="underline" href="https://kronan.is/uppskriftir" target="_blank" rel="noreferrer">kronan.is/uppskriftir</a> and add them as your own.</p>
      </div>
    )
  }

  if (preview) {
    const m = ingsMacros(preview.ingredients)
    return (
      <div className="flex flex-col gap-3">
        {preview.image && <img src={preview.image} alt="" className="w-full h-36 object-cover rounded-2xl" />}
        <div className="font-bold text-lg">{preview.title}</div>
        <div className="text-2 text-sm">{preview.servings} servings · {plural(preview.ingredients.length, 'ingredient')} · est. <b>{isk(preview.est_cost)}</b></div>
        {m.known > 0 && <MacroPills m={perServing(m.total, preview.servings)} per="per serving" />}
        <div className="flex flex-col gap-1 text-sm max-h-48 overflow-y-auto">
          {preview.ingredients.map((i, n) => <div key={n} className="flex justify-between gap-2"><span className="truncate">{qtyLabel(i)} {i.name}</span><span className="shrink-0 text-2">{i.price ? isk(kronan.lineCost(i)) : '—'}</span></div>)}
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setPreview(null)}>Back</button>
          <button className="btn btn-primary grow" onClick={() => { addRecipe(preview); showToast('Recipe saved'); onDone() }}>Save to library</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className="field" placeholder="Search recipes…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn btn-primary" onClick={search} disabled={busy}><Search size={16} /></button>
      </div>
      <ErrorNote text={error} />
      <div className="grid grid-cols-2 gap-2">
        {results.map((r) => (
          <button key={r.token} onClick={() => openPreview(r.slug)} className="glass press text-left overflow-hidden flex flex-col">
            {r.mainImage?.image ? <img src={r.mainImage.image} alt="" className="w-full h-28 object-cover" loading="lazy" /> : <div className="w-full h-28 bg-line" />}
            <div className="p-2">
              <div className="font-semibold text-[13px] leading-tight line-clamp-2">{r.displayName || r.name}</div>
              <div className="text-3 text-[11px] mt-0.5">{r.totalMinutes ? `${r.totalMinutes} min` : ''}{r.servings ? ` · ${r.servings} serv` : ''}{r.cuisineTags?.[0] ? ` · ${r.cuisineTags[0].name}` : ''}</div>
            </div>
          </button>
        ))}
      </div>
      {busy && <div className="text-3 text-sm text-center py-2">Loading…</div>}
      {!busy && results.length === 0 && !error && <div className="text-3 text-sm">No recipes found.</div>}
      {!busy && !hasMore && results.length > 0 && <div className="text-3 text-xs text-center py-2">That’s all {results.length} recipes.</div>}
      <div ref={sentinel} className="h-2" />
    </div>
  )
}

/* ------------------------------ recipe form (new or edit) ------------------------------ */

const blankIng = (name = ''): RecipeIngredient => ({ name, qty: 1, unit: 'stk', price: 0, sku: null, thumbnail: null, note: '', used_qty: null, pack_g: null, nutrition: null, macros: null })

function RecipeForm({ initial, onDone }: { initial?: Recipe; onDone: () => void }) {
  const kronanToken = useStore((s) => s.kronanToken)
  const { addRecipe, updateRecipe, showToast } = useStore()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [servings, setServings] = useState(initial?.servings ?? 4)
  const [url, setUrl] = useState(initial?.url ?? '')
  const [directions, setDirections] = useState(initial?.directions ?? '')
  const [image, setImage] = useState<string | null>(initial?.image ?? null)
  const [ings, setIngs] = useState<RecipeIngredient[]>(initial ? norm(initial) : [])
  const [store, setStore] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [manualName, setManualName] = useState('')
  const [infoIdx, setInfoIdx] = useState<number | null>(null)
  const [nameMissing, setNameMissing] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  // A photo taken in this form and then replaced is deleted right away; the saved one only on save.
  const changeImage = (next: string | null) => { if (image !== (initial?.image ?? null)) removePhoto(image); setImage(next) }
  const setIng = (i: number, patch: Partial<RecipeIngredient>) => setIngs((a) => a.map((x, n) => (n === i ? { ...x, ...patch } : x)))
  const addManual = () => {
    const name = manualName.trim()
    if (!name) return
    setIngs((a) => [...a, blankIng(name)])
    setManualName('')
  }
  const cost = kronan.ingredientsCost(ings)
  const macros = ingsMacros(ings)

  // Fields are only checked here, so values can be cleared and retyped freely while editing.
  const save = () => {
    if (!title.trim()) {
      setNameMissing(true)
      showToast('Give the recipe a name')
      formRef.current?.querySelector<HTMLInputElement>('input[name="recipe-title"]')?.focus()
      return
    }
    const bad = invalidFields(formRef.current)
    if (bad.length) {
      showToast(bad.length === 1 ? 'One number is empty or not valid' : `${bad.length} numbers are empty or not valid`)
      bad[0].focus()
      return
    }
    const clean = ings.filter((i) => i.name.trim())
    const payload = { title: title.trim(), servings: Math.max(1, servings), url: url.trim() || null, directions, ingredients: clean, est_cost: kronan.ingredientsCost(clean), image }
    if (initial) {
      if (initial.image !== image) removePhoto(initial.image)
      updateRecipe(initial.id, payload)
    } else addRecipe({ ...payload, source: 'custom', kronan_slug: null, tags: [] })
    showToast(initial ? 'Recipe updated' : 'Recipe saved')
    onDone()
  }

  const addProducts = (picked: RecipeIngredient[]) => {
    setIngs((a) => [...a, ...picked.filter((p) => !a.some((x) => x.sku && x.sku === p.sku))])
    setStore(false)
  }

  /** A scanned barcode: look the product up in Krónan and add it (or one more pack of it). */
  const scanned = async (code: string): Promise<ScanResult> => {
    if (!kronanToken) return { ok: false, message: 'Connect Krónan in Settings to look up barcodes' }
    const p = await kronan.productByBarcode(kronanToken, code)
    if (!p) return { ok: false, message: `Krónan has no product with barcode ${code}` }
    // `ings` is current: the scanner always calls the latest render's handler, one code at a time.
    const again = ings.some((x) => x.sku === p.sku)
    setIngs((a) => (a.some((x) => x.sku === p.sku)
      ? a.map((x) => (x.sku === p.sku ? { ...x, qty: x.qty + qtyStep(x) } : x))
      : [...a, kronan.productToIngredient(p)]))
    return { ok: true, message: again ? `One more ${p.name}` : `Added ${p.name}` }
  }

  if (store) return <StorePicker onDone={addProducts} onBack={() => setStore(false)} />
  if (scanning) return <BarcodeScanner onCode={scanned} onDone={() => setScanning(false)} />

  return (
    <div ref={formRef} className="flex flex-col gap-3">
      {/* Krónan recipes keep Krónan's own photo. */}
      <RecipePhoto image={image} onChange={initial?.source === 'kronan' ? undefined : changeImage} />
      <input name="recipe-title" className="field font-semibold" placeholder="Recipe name" value={title}
        style={nameMissing && !title.trim() ? { outline: '2px solid #ef4444', outlineOffset: -2 } : undefined}
        onChange={(e) => setTitle(e.target.value)} />
      <div className="flex gap-2 items-end">
        <div className="shrink-0">
          <div className="text-xs text-2 font-medium mb-1">Servings</div>
          <Stepper value={servings} onChange={setServings} min={1} integer label="Servings" />
        </div>
        <label className="text-xs text-2 font-medium grow min-w-0">Link (optional)<input className="field mt-1 !py-2" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-3 text-xs font-semibold uppercase tracking-wide">Ingredients</span>
          <span className="text-sm font-semibold">{isk(cost)}</span>
        </div>
        {kronanToken
          ? <div className="flex gap-2">
              <button className="btn btn-primary grow py-3" onClick={() => setStore(true)}><Search size={18} /> Search Krónan</button>
              <button className="btn btn-primary grow py-3" onClick={() => setScanning(true)}><ScanBarcode size={18} /> Scan barcode</button>
            </div>
          : <div className="flex gap-2">
              <input className="field" placeholder="Ingredient name" value={manualName} onChange={(e) => setManualName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addManual()} />
              <button className="btn btn-primary" onClick={addManual} aria-label="Add ingredient"><Plus size={16} /></button>
            </div>}
        {macros.known > 0 && <div className="mt-2"><MacroPills m={perServing(macros.total, servings)} per="per serving" compact /></div>}

        <div className="flex flex-col mt-2">
          {ings.length === 0 && <div className="text-3 text-sm py-2">No ingredients yet.</div>}
          {ings.map((i, n) => (
            <div key={n} className="py-2 border-b hairline last:border-b-0">
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-2 grow min-w-0 text-left press" onClick={() => setInfoIdx(n)} aria-label={`Details for ${i.name}`}>
                  <Thumb src={i.thumbnail} product className="w-9 h-9 rounded-lg text-xs" />
                  <div className="grow min-w-0">
                    <div className="text-sm font-medium truncate">{i.name}</div>
                    <div className="text-3 text-[11px] truncate">
                      {i.price ? `${kronan.buyLabel(i)} · ${isk(kronan.lineCost(i))}` : 'no price'}
                      {i.pack_g ? ` · ${i.pack_g} ${i.unit === 'ml' ? 'ml' : 'g'}/pack` : ''}
                    </div>
                  </div>
                </button>
                <button className="text-3 p-1" onClick={() => setIngs((a) => a.filter((_, k) => k !== n))} aria-label="Remove"><Trash2 size={15} /></button>
              </div>
              <div className="flex items-center gap-2 mt-1.5 pl-11">
                <Stepper value={i.qty} onChange={(qty) => setIng(n, { qty })} step={qtyStep(i)} label={`${i.name} quantity`} size="sm" />
                <select className="field !w-auto shrink-0 !py-1 !px-1.5 text-sm" value={i.unit} onChange={(e) => setIng(n, { unit: e.target.value })} aria-label="Unit">
                  <option value="g">g</option><option value="ml">ml</option><option value="stk">stk</option>
                </select>
              </div>
            </div>
          ))}
        </div>
        {ings.some((i) => !i.sku) && (
          <details className="mt-2">
            <summary className="text-3 text-xs cursor-pointer">Prices & pack sizes for items not from Krónan</summary>
            <div className="flex flex-col gap-1.5 mt-2">
              {ings.map((i, n) => !i.sku && (
                <div key={n} className="grid grid-cols-[1fr_auto_auto] gap-1.5 items-center text-sm">
                  <span className="truncate">{i.name}</span>
                  <NumberField className="!w-24 !py-1 !px-2 text-sm" placeholder="kr/pack" aria-label={`${i.name} price per pack`} value={i.price || null} onChange={(price) => setIng(n, { price })} onClear={() => setIng(n, { price: 0 })} />
                  <NumberField className="!w-24 !py-1 !px-2 text-sm" placeholder="g/pack" aria-label={`${i.name} grams per pack`} value={i.pack_g ?? null} onChange={(pack_g) => setIng(n, { pack_g })} onClear={() => setIng(n, { pack_g: null })} />
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <label className="text-3 text-xs font-semibold uppercase tracking-wide">Directions
        <textarea className="field mt-1 text-sm font-normal normal-case tracking-normal" rows={4} placeholder="Steps, notes, prep tips…" value={directions} onChange={(e) => setDirections(e.target.value)} />
      </label>

      <button className="btn btn-primary" onClick={save}>{initial ? 'Save changes' : 'Save recipe'}</button>

      <Sheet open={infoIdx !== null} onClose={() => setInfoIdx(null)} title={infoIdx !== null ? ings[infoIdx]?.name ?? '' : ''}>
        {infoIdx !== null && ings[infoIdx] && <IngredientInfo i={ings[infoIdx]} servings={Math.max(1, servings)} inRecipe />}
      </Sheet>
    </div>
  )
}

/* ------------------------------ Krónan store picker (multi-select) ------------------------------ */

const PRESETS = ['Kjúklingur', 'Hakk', 'Lax', 'Egg', 'Hrísgrjón', 'Pasta', 'Kartöflur', 'Grænmeti', 'Ostur', 'Skyr', 'Mjólk', 'Brauð', 'Baunir', 'Krydd']

function StorePicker({ onDone, onBack }: { onDone: (picked: RecipeIngredient[]) => void; onBack: () => void }) {
  const kronanToken = useStore((s) => s.kronanToken)!
  const [q, setQ] = useState('')
  const [active, setActive] = useState('')
  const [hits, setHits] = useState<kronan.KSearchHit[]>([])
  const [details, setDetails] = useState<Map<string, kronan.KProductDetail>>(new Map())
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Map<string, kronan.KSearchHit>>(new Map())
  const [info, setInfo] = useState<kronan.KSearchHit | null>(null)

  /** Search hit + its details: details add nutrition and pack size; the hit keeps the authoritative name, price and sale info. */
  const asIngredient = (p: kronan.KSearchHit) => {
    const d = details.get(p.sku)
    return kronan.productToIngredient(d ? ({ ...d, name: p.name, price: p.price, thumbnail: p.thumbnail || d.thumbnail, detail: p.detail } as kronan.KProductDetail) : p, 1)
  }

  const run = async (term: string, pageNo: number, replace: boolean) => {
    setBusy(true); setError(null)
    try {
      let res: { hits: kronan.KSearchHit[]; hasNextPage: boolean }
      if (term.trim()) res = await kronan.searchProducts(kronanToken, term.trim(), pageNo)
      else {
        // "Store front": the user's favourite products, or a staple search when there are none.
        const favs = await kronan.favoriteProducts(kronanToken).catch(() => [] as kronan.KProduct[])
        res = favs.length ? { hits: favs as kronan.KSearchHit[], hasNextPage: false } : await kronan.searchProducts(kronanToken, PRESETS[0], pageNo)
      }
      setHits((cur) => (replace ? res.hits : [...cur, ...res.hits.filter((h) => !cur.some((c) => c.sku === h.sku))]))
      setHasMore(res.hasNextPage); setPage(pageNo)
      kronan.getProductDetails(kronanToken, res.hits.map((h) => h.sku)).then((m) => setDetails((cur) => new Map([...cur, ...m]))).catch(() => { /* optional */ })
    } catch (e) { setError(e instanceof Error ? e.message : 'Search failed') } finally { setBusy(false) }
  }

  useEffect(() => { void run('', 1, true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sentinel = useInfiniteScroll(hasMore && !busy, () => void run(active, page + 1, false))

  const search = (term: string) => { setActive(term); setQ(term); void run(term, 1, true) }
  const toggle = (p: kronan.KSearchHit) => setPicked((cur) => toggled(cur, p.sku, p))

  return (
    <div className="flex flex-col gap-3 -mb-6 pb-20">
      <div className="flex gap-2 items-center">
        <button className="btn btn-sm" onClick={onBack}>‹</button>
        <div className="relative grow">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-3" />
          <input className="field !pl-10 !py-3 text-[16px]" placeholder="Search Krónan…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(q)} />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4">
        {PRESETS.map((p) => <button key={p} className={`btn btn-sm shrink-0 ${active === p ? 'btn-primary' : ''}`} onClick={() => search(p)}>{p}</button>)}
      </div>
      <ErrorNote text={error} />

      <div className="grid grid-cols-3 gap-2">
        {hits.map((p) => {
          const d = details.get(p.sku)
          const m = kronan.parseMacros(d?.nutrition)
          const on = picked.has(p.sku)
          return (
            <div key={p.sku} className="glass overflow-hidden flex flex-col" style={{ outline: on ? '2px solid #22c55e' : 'none' }}>
              <div className="relative">
                <button onClick={() => toggle(p)} className="block w-full press" aria-pressed={on}>
                  <Thumb src={p.thumbnail} product className="w-full aspect-square text-2xl" />
                </button>
                {on && <span className="absolute top-1 right-1 w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center animate-pop pointer-events-none"><Check size={14} strokeWidth={3} /></span>}
                <button
                  onClick={() => setInfo(p)}
                  className="absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold italic press"
                  style={{ background: 'rgba(15,23,42,0.7)', color: 'white' }}
                  aria-label={`Details for ${p.name}`}
                >i</button>
              </div>
              <button onClick={() => toggle(p)} className="p-1.5 text-left w-full press">
                <div className="text-[11px] leading-tight line-clamp-2 min-h-[2.4em]">{p.name}</div>
                <div className="font-bold text-[13px] mt-0.5">{isk(kronan.effectivePrice(p))}</div>
                <div className="text-[10px]" style={{ color: m ? '#ea580c' : 'var(--text-3)' }}>{m ? `${r0(m.kcal)} kcal/100g` : d ? 'no macros' : '…'}</div>
              </button>
            </div>
          )
        })}
      </div>
      {busy && <div className="text-3 text-sm text-center py-2">Loading…</div>}
      {!busy && hits.length === 0 && !error && <div className="text-3 text-sm">No products found.</div>}
      <div ref={sentinel} className="h-2" />

      <div className="fixed left-1/2 -translate-x-1/2 w-full max-w-[400px] px-4 z-10" style={{ bottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
        <button className="btn btn-primary w-full py-3 shadow-xl" onClick={() => onDone([...picked.values()].map(asIngredient))} disabled={picked.size === 0}>
          <Check size={18} /> Add {picked.size || ''} item{picked.size === 1 ? '' : 's'}
        </button>
      </div>

      <Sheet open={!!info} onClose={() => setInfo(null)} title={info?.name ?? ''}>
        {info && (
          <div className="flex flex-col gap-3">
            <IngredientInfo i={asIngredient(info)} />
            <button className="btn btn-primary" onClick={() => { if (!picked.has(info.sku)) toggle(info); setInfo(null) }}>{picked.has(info.sku) ? 'Selected ✓' : 'Select this item'}</button>
          </div>
        )}
      </Sheet>
    </div>
  )
}

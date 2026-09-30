import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, ChefHat, ExternalLink, Plus, RefreshCw, Search, ShoppingCart, Trash2, Wand2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Macros, MealPlan, Recipe, RecipeIngredient } from '../lib/types'
import { addDays, format, weekStart, ymd } from '../lib/dates'
import * as kronan from '../lib/kronan'
import { isk } from '../lib/kronan'
import { Card, CheckCircle, Empty, Segment, SectionTitle } from '../components/ui/Bits'
import { Sheet } from '../components/ui/Sheet'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const planCost = (p: MealPlan, r: Recipe) => Math.round((r.est_cost * p.servings) / Math.max(1, r.servings))
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''))
const r0 = (n: number) => Math.round(n)
const norm = (r: Recipe) => r.ingredients.map(kronan.normalizeIngredient)

/** Total macros for a recipe at a given scale; `known` = ingredients with nutrition data. */
const recipeMacros = (r: Recipe, scale = 1) => kronan.sumMacros(norm(r).map((i) => kronan.ingredientMacros(i, scale)))
const qtyLabel = (i: RecipeIngredient, scale = 1) => `${fmtQty(i.qty * scale)} ${i.unit}`

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

export function Meals() {
  const recipes = useStore((s) => s.recipes)
  const mealPlans = useStore((s) => s.mealPlans)
  const kronanToken = useStore((s) => s.kronanToken)
  const { updateMealPlan, unplanMeal, showToast, setTab } = useStore()

  const thisMonday = ymd(weekStart(new Date()))
  const nextMonday = ymd(addDays(weekStart(new Date()), 7))
  const [week, setWeek] = useState<string>(new Date().getDay() === 0 ? nextMonday : thisMonday)
  const [open, setOpen] = useState<Recipe | null>(null)
  const [adding, setAdding] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [prepOpen, setPrepOpen] = useState(false)

  const plans = useMemo(() => mealPlans.filter((m) => m.week_start === week).sort((a, b) => (a.day ?? 9) - (b.day ?? 9)), [mealPlans, week])
  const total = plans.reduce((a, p) => { const r = recipes.find((x) => x.id === p.recipe_id); return r ? a + planCost(p, r) : a }, 0)
  const weekLabel = `${format(new Date(week + 'T00:00:00'), 'MMM d')} – ${format(addDays(new Date(week + 'T00:00:00'), 6), 'MMM d')}`

  const pushToKronan = async () => {
    if (!kronanToken) return
    const items = new Map<string, number>()
    for (const p of plans) {
      const r = recipes.find((x) => x.id === p.recipe_id)
      if (!r) continue
      const scale = p.servings / Math.max(1, r.servings)
      for (const i of norm(r)) if (i.sku) items.set(i.sku, (items.get(i.sku) ?? 0) + kronan.packsToBuy(i, scale))
    }
    if (!items.size) { showToast('No Krónan-linked ingredients in this plan'); return }
    setPushing(true)
    try {
      const list = await kronan.createProductList(kronanToken, `Meal prep ${weekLabel}`, [...items].map(([sku, quantity]) => ({ sku, quantity })))
      showToast(`Sent ${items.size} products to Krónan list “${list.name}”`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Krónan push failed')
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Segment<string> value={week} options={[{ value: thisMonday, label: 'This week' }, { value: nextMonday, label: 'Next week' }]} onChange={setWeek} />

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-[16px]">🍲 Meal prep · {weekLabel}</div>
            <div className="text-3 text-xs mt-0.5">{plans.length} meal{plans.length === 1 ? '' : 's'} planned</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-bold">{isk(total)}</div>
            <div className="text-3 text-[10px]">estimated</div>
          </div>
        </div>

        {plans.length === 0 ? (
          <div className="text-2 text-sm mt-3">Nothing planned yet. Open a recipe below and press “Make this”.</div>
        ) : (
          <div className="flex flex-col gap-1.5 mt-3">
            {plans.map((p) => {
              const r = recipes.find((x) => x.id === p.recipe_id)
              if (!r) return null
              const m = recipeMacros(r, p.servings / Math.max(1, r.servings))
              return (
                <div key={p.id} className="flex items-center gap-2 py-1.5 border-b hairline last:border-b-0">
                  <button onClick={() => updateMealPlan(p.id, { cooked: !p.cooked })} aria-label="Cooked"><CheckCircle checked={p.cooked} size={24} color="#22c55e" /></button>
                  <button className="grow min-w-0 text-left" onClick={() => setOpen(r)}>
                    <div className={`text-sm font-medium truncate ${p.cooked ? 'line-through text-3' : ''}`}>{r.title}</div>
                    <div className="text-3 text-xs">{p.servings} serv · {isk(planCost(p, r))}{m.known ? ` · ${r0(m.total.kcal / p.servings)} kcal/serv` : ''}</div>
                  </button>
                  <select className="field !w-auto !py-1 !px-2 text-xs" value={p.day ?? ''} onChange={(e) => updateMealPlan(p.id, { day: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Day">
                    <option value="">Any</option>
                    {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                  <button onClick={() => unplanMeal(p.id)} className="text-3 p-1" aria-label="Remove"><Trash2 size={15} /></button>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2 mt-3">
          <button className="btn btn-sm btn-primary" onClick={() => setPrepOpen(true)} disabled={!recipes.length}><CalendarDays size={14} /> Schedule Sunday prep</button>
          {kronanToken && <button className="btn btn-sm" onClick={pushToKronan} disabled={!plans.length || pushing}><Wand2 size={14} /> {pushing ? 'Sending…' : 'Send week to Krónan'}</button>}
        </div>
        {!kronanToken && <p className="text-3 text-[11px] mt-2">Connect Krónan in <button className="underline" onClick={() => setTab('settings')}>Settings</button> to browse their recipes with live prices and macros, and push shopping lists to your account.</p>}
      </Card>

      <SectionTitle right={<button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Recipe</button>}>Recipe library</SectionTitle>
      {recipes.length === 0 ? (
        <Empty icon="🍳" title="No recipes yet" hint="Add your own recipe from Krónan’s store, or browse Krónan’s recipes." />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {recipes.map((r) => {
            const m = recipeMacros(r)
            return (
              <button key={r.id} onClick={() => setOpen(r)} className="glass press text-left overflow-hidden flex flex-col">
                {r.image ? <img src={r.image} alt="" className="w-full h-24 object-cover" loading="lazy" /> : <div className="w-full h-24 flex items-center justify-center text-3xl" style={{ background: 'var(--line)' }}>🍽️</div>}
                <div className="p-2.5">
                  <div className="font-semibold text-sm leading-tight line-clamp-2">{r.title}</div>
                  <div className="text-3 text-[11px] mt-1">{r.servings} serv · {r.est_cost ? isk(r.est_cost) : 'no price'}</div>
                  {m.known > 0 && <div className="text-[11px] mt-0.5 font-medium" style={{ color: '#ea580c' }}>{r0(m.total.kcal / Math.max(1, r.servings))} kcal / serving</div>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title="Recipe" tall>
        {open && <RecipeDetail id={open.id} week={week} onClose={() => setOpen(null)} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add recipe" tall>
        {adding && <AddRecipe onDone={() => setAdding(false)} />}
      </Sheet>
      <Sheet open={prepOpen} onClose={() => setPrepOpen(false)} title="Sunday meal prep" tall>
        {prepOpen && <SundayPrep week={week} weekLabel={weekLabel} plans={plans} onDone={() => setPrepOpen(false)} />}
      </Sheet>
    </div>
  )
}

/* ------------------------------ Sunday prep picker ------------------------------ */

function SundayPrep({ week, weekLabel, plans, onDone }: { week: string; weekLabel: string; plans: MealPlan[]; onDone: () => void }) {
  const recipes = useStore((s) => s.recipes)
  const { planMeal, updateMealPlan, unplanMeal, scheduleMealPrep, addIngredientsToGroceries, showToast } = useStore()
  // Pre-select what is already planned for the week, with its servings.
  const [sel, setSel] = useState<Map<string, number>>(() => new Map(plans.map((p) => [p.recipe_id, p.servings])))
  const [time, setTime] = useState('14:00')

  const toggle = (r: Recipe) => setSel((cur) => { const m = new Map(cur); if (m.has(r.id)) m.delete(r.id); else m.set(r.id, r.servings); return m })
  const setServ = (id: string, n: number) => setSel((cur) => new Map(cur).set(id, Math.max(1, n)))

  const chosen = recipes.filter((r) => sel.has(r.id))
  const total = chosen.reduce((a, r) => a + Math.round((r.est_cost * (sel.get(r.id) ?? r.servings)) / Math.max(1, r.servings)), 0)
  const portions = chosen.reduce((a, r) => a + (sel.get(r.id) ?? 0), 0)

  const confirm = () => {
    for (const p of plans) {
      const want = sel.get(p.recipe_id)
      if (want === undefined) unplanMeal(p.id)
      else if (want !== p.servings) updateMealPlan(p.id, { servings: want })
    }
    for (const r of chosen) if (!plans.some((p) => p.recipe_id === r.id)) planMeal(r.id, week, 6, sel.get(r.id))
    scheduleMealPrep(week, time)
    const n = addIngredientsToGroceries(chosen.map((r) => ({ recipe_id: r.id, servings: sel.get(r.id) ?? r.servings })))
    showToast(`Sunday prep set · ${chosen.length} recipe${chosen.length === 1 ? '' : 's'}, ${n} item${n === 1 ? '' : 's'} added to Groceries`)
    onDone()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-2 text-sm">Pick what you’ll cook on Sunday for the week of <b>{weekLabel}</b>. Confirming plans the meals, books the prep block on Sunday and fills your Groceries list.</p>

      <div className="flex flex-col gap-2">
        {recipes.map((r) => {
          const on = sel.has(r.id)
          const serv = sel.get(r.id) ?? r.servings
          const cost = Math.round((r.est_cost * serv) / Math.max(1, r.servings))
          const m = recipeMacros(r, serv / Math.max(1, r.servings))
          return (
            <div key={r.id} className="glass p-2 flex items-center gap-2" style={{ outline: on ? '2px solid #22c55e' : 'none' }}>
              <button onClick={() => toggle(r)} className="flex items-center gap-2 grow min-w-0 text-left">
                <CheckCircle checked={on} size={24} color="#22c55e" />
                {r.image ? <img src={r.image} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" loading="lazy" /> : <span className="w-10 h-10 rounded-lg bg-line shrink-0 inline-flex items-center justify-center">🍽️</span>}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <div className="text-3 text-[11px]">{isk(cost)}{m.known ? ` · ${r0(m.total.kcal / Math.max(1, serv))} kcal/serv` : ''}</div>
                </div>
              </button>
              {on && (
                <div className="flex items-center gap-1 shrink-0">
                  <button className="btn btn-sm !px-2" onClick={() => setServ(r.id, serv - 1)}>−</button>
                  <span className="w-7 text-center text-sm font-bold tabular-nums">{serv}</span>
                  <button className="btn btn-sm !px-2" onClick={() => setServ(r.id, serv + 1)}>+</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="glass p-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-2">Prep block on Sunday at</div>
          <input className="field mt-1 !w-auto !py-1" type="time" value={time} onChange={(e) => setTime(e.target.value || '14:00')} />
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">{isk(total)}</div>
          <div className="text-3 text-[11px]">{chosen.length} recipe{chosen.length === 1 ? '' : 's'} · {portions} portion{portions === 1 ? '' : 's'}</div>
        </div>
      </div>

      <button className="btn btn-primary py-3" onClick={confirm} disabled={chosen.length === 0}><Check size={18} /> Confirm Sunday prep</button>
    </div>
  )
}

/* ------------------------------ recipe detail ------------------------------ */

function RecipeDetail({ id, week, onClose }: { id: string; week: string; onClose: () => void }) {
  const recipe = useStore((s) => s.recipes.find((r) => r.id === id))
  const kronanToken = useStore((s) => s.kronanToken)
  const { deleteRecipe, updateRecipe, planMeal, addIngredientsToGroceries, showToast } = useStore()
  const [servings, setServings] = useState(recipe?.servings ?? 4)
  const [day, setDay] = useState<number | null>(6)
  const [editing, setEditing] = useState(false)
  const [cooking, setCooking] = useState(false)
  const [making, setMaking] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [ingOpen, setIngOpen] = useState<RecipeIngredient | null>(null)

  // Older Krónan recipes saved before macros existed: fetch nutrition once.
  useEffect(() => {
    if (!recipe || !kronanToken || enriching) return
    const needs = recipe.ingredients.some((i) => i.sku && i.macros === undefined)
    if (!needs) return
    setEnriching(true)
    kronan.enrichIngredients(kronanToken, recipe.ingredients)
      .then((ings) => updateRecipe(recipe.id, { ingredients: ings, est_cost: kronan.ingredientsCost(ings) }))
      .catch(() => { /* keep going without macros */ })
      .finally(() => setEnriching(false))
  }, [recipe?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!recipe) return null
  const ings = norm(recipe)
  const scale = servings / Math.max(1, recipe.servings)
  const cost = Math.round(ings.reduce((a, i) => a + kronan.lineCost(i, scale), 0))
  const macros = recipeMacros(recipe, scale)
  const hasLinked = ings.some((i) => i.sku)

  const refresh = async () => {
    if (!kronanToken || enriching) return
    setEnriching(true)
    try {
      const ingredients = await kronan.enrichIngredients(kronanToken, recipe.ingredients)
      updateRecipe(recipe.id, { ingredients, est_cost: kronan.ingredientsCost(ingredients) })
      showToast('Prices, pack sizes and macros refreshed')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setEnriching(false)
    }
  }

  if (editing) return <RecipeForm initial={recipe} onDone={() => setEditing(false)} />
  if (cooking) return <CookMode recipe={recipe} servings={servings} onBack={() => setCooking(false)} />

  const planAndShop = async () => {
    setMaking(true)
    try {
      planMeal(recipe.id, week, day, servings)
      const n = addIngredientsToGroceries([{ recipe_id: recipe.id, servings }])
      let msg = `Planned · ${n} item${n === 1 ? '' : 's'} added to Groceries`
      if (kronanToken) {
        const items = ings.filter((i) => i.sku).map((i) => ({ sku: i.sku!, quantity: Math.max(1, kronan.packsToBuy(i, scale)) }))
        if (items.length) {
          const list = await kronan.createProductList(kronanToken, `${recipe.title} (${servings} serv)`, items)
          msg += ` · sent to Krónan list “${list.name}”`
        }
      }
      showToast(msg)
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not send to Krónan')
    } finally {
      setMaking(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {recipe.image && <img src={recipe.image} alt="" className="w-full h-40 object-cover rounded-2xl" />}
      <div>
        <div className="font-bold text-[20px] leading-tight">{recipe.title}</div>
        <div className="text-3 text-xs mt-1 flex gap-2 flex-wrap items-center">
          <span>{recipe.servings} servings</span>
          {recipe.tags.slice(0, 4).map((t) => <span key={t} className="px-2 rounded-full bg-line">{t}</span>)}
          {recipe.url && <a href={recipe.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">kronan.is <ExternalLink size={11} /></a>}
        </div>
      </div>

      <Card className="p-3" style={{ background: 'rgba(34,197,94,0.12)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-2">Cooking for</div>
            <div className="flex items-center gap-2 mt-1">
              <button className="btn btn-sm" onClick={() => setServings(Math.max(1, servings - 1))}>−</button>
              <b className="w-6 text-center">{servings}</b>
              <button className="btn btn-sm" onClick={() => setServings(servings + 1)}>+</button>
              <span className="text-sm text-2">servings</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{isk(cost)}</div>
            <div className="text-3 text-[11px]">{isk(cost / Math.max(1, servings))} / serving</div>
          </div>
        </div>
        {macros.known > 0 && (
          <div className="mt-3 pt-3 border-t hairline">
            <MacroPills m={{ kcal: macros.total.kcal / servings, protein: macros.total.protein / servings, carbs: macros.total.carbs / servings, fat: macros.total.fat / servings }} per="per serving" compact />
          </div>
        )}
        {enriching && <div className="text-3 text-[11px] mt-2">fetching macros…</div>}
      </Card>

      <button className="btn btn-primary text-[16px] py-3" onClick={() => setCooking(true)}><ChefHat size={18} /> Make this</button>

      {/* Need to buy: used amount rounded up to whole packages */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-3 text-xs font-semibold uppercase tracking-wide">🛒 Need to buy</div>
          <div className="text-sm font-bold">{isk(cost)}</div>
        </div>
        <div className="flex flex-col">
          {ings.map((i, n) => (
            <button key={n} onClick={() => setIngOpen(i)} className="flex items-center gap-2 text-sm text-left w-full py-1.5 border-b hairline last:border-b-0">
              {i.thumbnail ? <img src={i.thumbnail} alt="" className="w-7 h-7 rounded-md object-contain bg-white" loading="lazy" /> : <span className="w-7 h-7 rounded-md bg-line inline-flex items-center justify-center text-[10px]">🛒</span>}
              <div className="grow min-w-0 truncate"><b>{kronan.buyLabel(i, scale)}</b> {i.name}</div>
              <div className="font-medium shrink-0 text-2">{i.price ? isk(kronan.lineCost(i, scale)) : '—'}</div>
            </button>
          ))}
          {ings.length === 0 && <div className="text-3 text-sm">No ingredients listed.</div>}
        </div>
      </div>

      <div className="glass p-3 flex flex-col gap-2">
        <div className="text-sm font-semibold">Plan for week of {format(new Date(week + 'T00:00:00'), 'MMM d')}</div>
        <div className="flex gap-1 flex-wrap">
          <button className={`btn btn-sm ${day === null ? 'btn-primary' : ''}`} onClick={() => setDay(null)}>Any day</button>
          {DAYS.map((d, i) => <button key={d} className={`btn btn-sm ${day === i ? 'btn-primary' : ''}`} onClick={() => setDay(i)}>{d}</button>)}
        </div>
        <button className="btn" onClick={planAndShop} disabled={making}><ShoppingCart size={16} /> {making ? 'Sending…' : 'Plan & shop'}</button>
        <p className="text-3 text-[11px]">Adds it to the plan and puts the “need to buy” list into Groceries{kronanToken ? ' and a shopping list in your Krónan app' : ''}.</p>
      </div>

      <div className="flex gap-2">
        <button className="btn btn-danger" onClick={() => { if (confirm(`Delete "${recipe.title}"?`)) { deleteRecipe(recipe.id); onClose() } }}><Trash2 size={16} /></button>
        {kronanToken && hasLinked && <button className="btn" onClick={refresh} disabled={enriching}><RefreshCw size={16} className={enriching ? 'animate-spin' : ''} /> Refresh</button>}
        <button className="btn grow" onClick={() => setEditing(true)}>Edit recipe</button>
      </div>

      <Sheet open={!!ingOpen} onClose={() => setIngOpen(null)} title={ingOpen?.name ?? ''}>
        {ingOpen && <IngredientInfo i={ingOpen} />}
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
  const scale = servings / Math.max(1, recipe.servings)
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

  const toggle = (set: Set<number>, n: number, setter: (s: Set<number>) => void) => { const s = new Set(set); if (s.has(n)) s.delete(n); else s.add(n); setter(s) }

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
              <button key={n} onClick={() => toggle(doneIngs, n, setDoneIngs)} className="flex items-center gap-2 text-left text-[15px] py-2 border-b hairline last:border-b-0">
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
                <button onClick={() => toggle(doneSteps, n, setDoneSteps)} className="mt-0.5"><CheckCircle checked={on} size={22} /></button>
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

function IngredientInfo({ i }: { i: RecipeIngredient }) {
  const s = i.source
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {i.thumbnail ? <img src={i.thumbnail} alt="" className="w-20 h-20 rounded-xl object-contain bg-white" /> : <span className="w-20 h-20 rounded-xl bg-line inline-flex items-center justify-center text-2xl">🛒</span>}
        <div>
          <div className="font-semibold">{i.name}</div>
          <div className="text-2 text-sm">{i.price ? `${isk(i.price)} per pack` : 'price unknown'}</div>
          <div className="text-3 text-xs">{i.pack_g ? `${i.pack_g} ${i.unit === 'ml' ? 'ml' : 'g'} per pack` : 'pack size unknown'}</div>
        </div>
      </div>
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
  const sentinel = useRef<HTMLDivElement>(null)
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
  useEffect(() => {
    const el = sentinel.current
    if (!el || preview) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !busy) void load(activeQuery.current, page + 1, false)
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, busy, page, preview]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const m = kronan.sumMacros(preview.ingredients.map((i) => kronan.ingredientMacros(i)))
    return (
      <div className="flex flex-col gap-3">
        {preview.image && <img src={preview.image} alt="" className="w-full h-36 object-cover rounded-2xl" />}
        <div className="font-bold text-lg">{preview.title}</div>
        <div className="text-2 text-sm">{preview.servings} servings · {preview.ingredients.length} ingredients · est. <b>{isk(preview.est_cost)}</b></div>
        {m.known > 0 && <MacroPills m={{ kcal: m.total.kcal / preview.servings, protein: m.total.protein / preview.servings, carbs: m.total.carbs / preview.servings, fat: m.total.fat / preview.servings }} per="per serving" />}
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
        <input className="field" placeholder="Search recipes… (empty = browse all)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn btn-primary" onClick={search} disabled={busy}><Search size={16} /></button>
      </div>
      {error && <div className="text-xs p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{error}</div>}
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

/* ------------------------------ custom recipe form ------------------------------ */

const blankIng = (name = ''): RecipeIngredient => ({ name, qty: 1, unit: 'stk', price: 0, sku: null, thumbnail: null, note: '', used_qty: null, pack_g: null, nutrition: null, macros: null })

function RecipeForm({ initial, onDone }: { initial?: Recipe; onDone: () => void }) {
  const kronanToken = useStore((s) => s.kronanToken)
  const { addRecipe, updateRecipe, showToast } = useStore()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [servings, setServings] = useState(initial?.servings ?? 4)
  const [url, setUrl] = useState(initial?.url ?? '')
  const [directions, setDirections] = useState(initial?.directions ?? '')
  const [ings, setIngs] = useState<RecipeIngredient[]>(initial ? norm(initial) : [])
  const [store, setStore] = useState(false)
  const [manualName, setManualName] = useState('')

  const setIng = (i: number, patch: Partial<RecipeIngredient>) => setIngs((a) => a.map((x, n) => (n === i ? { ...x, ...patch } : x)))
  const cost = kronan.ingredientsCost(ings)
  const macros = kronan.sumMacros(ings.map((i) => kronan.ingredientMacros(i)))

  const save = () => {
    const clean = ings.filter((i) => i.name.trim())
    const payload = { title: title.trim(), servings: Math.max(1, servings), url: url.trim() || null, directions, ingredients: clean, est_cost: kronan.ingredientsCost(clean) }
    if (initial) updateRecipe(initial.id, payload)
    else addRecipe({ ...payload, source: 'custom', kronan_slug: null, image: null, tags: [] })
    showToast(initial ? 'Recipe updated' : 'Recipe saved')
    onDone()
  }

  const addProducts = (picked: RecipeIngredient[]) => {
    setIngs((a) => [...a, ...picked.filter((p) => !a.some((x) => x.sku && x.sku === p.sku))])
    setStore(false)
  }

  if (store) return <StorePicker onDone={addProducts} onBack={() => setStore(false)} />

  return (
    <div className="flex flex-col gap-3">
      <input className="field font-semibold" placeholder="Recipe name" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!initial} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-3">Servings<input className="field mt-1" type="number" min={1} value={servings} onChange={(e) => setServings(Number(e.target.value) || 1)} /></label>
        <label className="text-xs text-3">Link (optional)<input className="field mt-1" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-3 text-xs font-semibold uppercase tracking-wide">Ingredients</span>
          <span className="text-sm font-semibold">{isk(cost)}</span>
        </div>
        {kronanToken
          ? <button className="btn btn-primary w-full py-3" onClick={() => setStore(true)}><Plus size={18} /> Ingredient from Krónan</button>
          : <div className="flex gap-2">
              <input className="field" placeholder="Ingredient name" value={manualName} onChange={(e) => setManualName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && manualName.trim()) { setIngs((a) => [...a, blankIng(manualName.trim())]); setManualName('') } }} />
              <button className="btn btn-primary" onClick={() => { if (manualName.trim()) { setIngs((a) => [...a, blankIng(manualName.trim())]); setManualName('') } }}><Plus size={16} /></button>
            </div>}
        {macros.known > 0 && <div className="mt-2"><MacroPills m={{ kcal: macros.total.kcal / Math.max(1, servings), protein: macros.total.protein / Math.max(1, servings), carbs: macros.total.carbs / Math.max(1, servings), fat: macros.total.fat / Math.max(1, servings) }} per="per serving" compact /></div>}

        <div className="flex flex-col mt-2">
          {ings.length === 0 && <div className="text-3 text-sm py-2">No ingredients yet.</div>}
          {ings.map((i, n) => (
            <div key={n} className="flex items-center gap-2 py-2 border-b hairline last:border-b-0">
              {i.thumbnail ? <img src={i.thumbnail} alt="" className="w-9 h-9 rounded-lg object-contain bg-white shrink-0" /> : <span className="w-9 h-9 rounded-lg bg-line shrink-0 inline-flex items-center justify-center text-xs">🛒</span>}
              <div className="grow min-w-0">
                <div className="text-sm font-medium truncate">{i.name}</div>
                <div className="text-3 text-[11px] truncate">
                  {i.price ? `${kronan.buyLabel(i)} · ${isk(kronan.lineCost(i))}` : 'no price'}
                  {i.pack_g ? ` · ${i.pack_g} ${i.unit === 'ml' ? 'ml' : 'g'}/pack` : ''}
                </div>
              </div>
              <input className="field no-spin !w-[4.75rem] shrink-0 !py-1.5 !px-2 text-sm text-right tabular-nums" type="number" inputMode="decimal" min={0} step="any" value={i.qty} onChange={(e) => setIng(n, { qty: Number(e.target.value) || 0 })} aria-label="Quantity" />
              <select className="field !w-auto shrink-0 !py-1.5 !px-1.5 text-sm" value={i.unit} onChange={(e) => setIng(n, { unit: e.target.value })} aria-label="Unit">
                <option value="g">g</option><option value="ml">ml</option><option value="stk">stk</option>
              </select>
              <button className="text-3 p-1" onClick={() => setIngs((a) => a.filter((_, k) => k !== n))} aria-label="Remove"><Trash2 size={15} /></button>
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
                  <input className="field !w-24 !py-1 !px-2 text-sm" type="number" min={0} placeholder="kr/pack" value={i.price || ''} onChange={(e) => setIng(n, { price: Number(e.target.value) || 0 })} />
                  <input className="field !w-24 !py-1 !px-2 text-sm" type="number" min={0} placeholder="g/pack" value={i.pack_g ?? ''} onChange={(e) => setIng(n, { pack_g: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <label className="text-3 text-xs font-semibold uppercase tracking-wide">Directions
        <textarea className="field mt-1 text-sm font-normal normal-case tracking-normal" rows={4} placeholder="Steps, notes, prep tips…" value={directions} onChange={(e) => setDirections(e.target.value)} />
      </label>

      <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>{initial ? 'Save changes' : 'Save recipe'}</button>
    </div>
  )
}

/* ------------------------------ Krónan store picker (multi-select) ------------------------------ */

const PRESETS = ['Kjúklingur', 'Hakk', 'Lax', 'Egg', 'Hrísgrjón', 'Pasta', 'Kartöflur', 'Grænmeti', 'Ostur', 'Skyr', 'Mjólk', 'Brauð', 'Baunir', 'Krydd']

function StorePicker({ onDone, onBack }: { onDone: (picked: RecipeIngredient[]) => void; onBack: () => void }) {
  const kronanToken = useStore((s) => s.kronanToken)!
  const [q, setQ] = useState('')
  const [active, setActive] = useState<string>('')
  const [hits, setHits] = useState<kronan.KSearchHit[]>([])
  const [details, setDetails] = useState<Map<string, kronan.KProductDetail>>(new Map())
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Map<string, kronan.KSearchHit>>(new Map())
  const [info, setInfo] = useState<kronan.KSearchHit | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mergeDetail = (p: kronan.KSearchHit) => {
    const d = details.get(p.sku)
    // Details add nutrition + pack size; the search hit keeps the authoritative name, price and sale info.
    return d ? ({ ...d, name: p.name, price: p.price, thumbnail: p.thumbnail || d.thumbnail, detail: p.detail } as kronan.KProductDetail) : p
  }

  const fetchDetails = (skus: string[]) => {
    kronan.getProductDetails(kronanToken, skus).then((m) => setDetails((cur) => new Map([...cur, ...m]))).catch(() => { /* optional */ })
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
      fetchDetails(res.hits.map((h) => h.sku))
    } catch (e) { setError(e instanceof Error ? e.message : 'Search failed') } finally { setBusy(false) }
  }

  useEffect(() => { void run('', 1, true); inputRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting && hasMore && !busy) void run(active, page + 1, false) }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, busy, page, active]) // eslint-disable-line react-hooks/exhaustive-deps

  const search = (term: string) => { setActive(term); setQ(term); void run(term, 1, true) }
  const toggle = (p: kronan.KSearchHit) => setPicked((cur) => { const m = new Map(cur); if (m.has(p.sku)) m.delete(p.sku); else m.set(p.sku, p); return m })

  const finish = () => {
    const out = [...picked.values()].map((p) => kronan.productToIngredient(mergeDetail(p), 1))
    onDone(out)
  }

  return (
    <div className="flex flex-col gap-3 -mb-6 pb-20">
      <div className="flex gap-2 items-center">
        <button className="btn btn-sm" onClick={onBack}>‹</button>
        <div className="relative grow">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-3" />
          <input ref={inputRef} className="field !pl-10 !py-3 text-[16px]" placeholder="Search Krónan…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(q)} />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4">
        <button className={`btn btn-sm shrink-0 ${active === '' ? 'btn-primary' : ''}`} onClick={() => search('')}>⭐ Mine</button>
        {PRESETS.map((p) => <button key={p} className={`btn btn-sm shrink-0 ${active === p ? 'btn-primary' : ''}`} onClick={() => search(p)}>{p}</button>)}
      </div>
      {error && <div className="text-xs p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{error}</div>}

      <div className="grid grid-cols-3 gap-2">
        {hits.map((p) => {
          const d = details.get(p.sku)
          const m = kronan.parseMacros(d?.nutrition)
          const on = picked.has(p.sku)
          return (
            <div key={p.sku} className="glass overflow-hidden flex flex-col" style={{ outline: on ? '2px solid #22c55e' : 'none' }}>
              <div className="relative">
                <button onClick={() => toggle(p)} className="block w-full press" aria-pressed={on}>
                  <div className="w-full aspect-square bg-white flex items-center justify-center overflow-hidden">
                    {p.thumbnail ? <img src={p.thumbnail} alt="" className="w-full h-full object-contain" loading="lazy" /> : <span className="text-2xl">🛒</span>}
                  </div>
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
        <button className="btn btn-primary w-full py-3 shadow-xl" onClick={finish} disabled={picked.size === 0}>
          <Check size={18} /> Add {picked.size || ''} item{picked.size === 1 ? '' : 's'}
        </button>
      </div>

      <Sheet open={!!info} onClose={() => setInfo(null)} title={info?.name ?? ''}>
        {info && (
          <div className="flex flex-col gap-3">
            <IngredientInfo i={kronan.productToIngredient(mergeDetail(info), 1)} />
            <button className="btn btn-primary" onClick={() => { if (!picked.has(info.sku)) toggle(info); setInfo(null) }}>{picked.has(info.sku) ? 'Selected ✓' : 'Select this item'}</button>
          </div>
        )}
      </Sheet>
    </div>
  )
}

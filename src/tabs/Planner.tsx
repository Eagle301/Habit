import { useEffect, useMemo, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { CalendarPlus, ChevronLeft, ChevronRight, RotateCcw, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { useStore, useActiveHabits } from '../store/useStore'
import type { CalendarEvent, Habit, ScheduledBlock } from '../lib/types'
import { addDays, format, isSunday, minutesToTime, timeToMinutes, todayKey, weekDays, weekStart, ymd, combine, startOfMonth, endOfMonth } from '../lib/dates'
import { busyIntervals } from '../lib/google'
import { Card, Header, SectionTitle } from '../components/ui/Bits'
import { Sheet } from '../components/ui/Sheet'

const HOURS = Array.from({ length: 17 }, (_, i) => 6 + i) // 06:00 .. 22:00
const SETUP_DISMISS_KEY = 'habits-sunday-dismissed'

interface QueueCard { id: string; habit: Habit; remaining: number; scope: 'week' | 'month' }

export function Planner() {
  const habits = useActiveHabits()
  const blocks = useStore((s) => s.blocks)
  const events = useStore((s) => s.events)
  const googleConnected = useStore((s) => s.googleConnected)
  const eventsLoading = useStore((s) => s.eventsLoading)
  const { loadEvents, scheduleBlock, moveBlock, deleteBlock, clearBlocks, showToast, setTab, setListsMode, syncBlocksToGoogle } = useStore()
  const [savingCal, setSavingCal] = useState(false)
  const mealPlans = useStore((s) => s.mealPlans)
  const recipes = useStore((s) => s.recipes)

  const [anchor, setAnchor] = useState(() => weekStart(new Date()))
  const days = useMemo(() => weekDays(anchor), [anchor])
  const [selectedDay, setSelectedDay] = useState(() => (weekDays(anchor).some((d) => ymd(d) === todayKey()) ? todayKey() : ymd(anchor)))
  const [dragging, setDragging] = useState<{ type: 'queue'; card: QueueCard } | { type: 'block'; block: ScheduledBlock } | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(() => { try { return localStorage.getItem(SETUP_DISMISS_KEY) === format(new Date(), 'yyyy-ww') } catch { return false } })

  useEffect(() => { if (googleConnected) void loadEvents(days[0], days[6]) }, [googleConnected, anchor]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!days.some((d) => ymd(d) === selectedDay)) setSelectedDay(ymd(days[0])) }, [days, selectedDay])

  const weekKeys = days.map(ymd)
  const weekBlocks = blocks.filter((b) => weekKeys.includes(b.date))

  const queue = useMemo<QueueCard[]>(() => {
    const cards: QueueCard[] = []
    for (const h of habits) {
      if (h.frequency === 'weekly') {
        const n = weekBlocks.filter((b) => b.habit_id === h.id).length
        if (h.target_count - n > 0) cards.push({ id: `q-${h.id}`, habit: h, remaining: h.target_count - n, scope: 'week' })
      } else if (h.frequency === 'monthly') {
        const mStart = ymd(startOfMonth(days[0])), mEnd = ymd(endOfMonth(days[6]))
        const n = blocks.filter((b) => b.habit_id === h.id && b.date >= mStart && b.date <= mEnd).length
        if (h.target_count - n > 0) cards.push({ id: `q-${h.id}`, habit: h, remaining: h.target_count - n, scope: 'month' })
      }
    }
    return cards
  }, [habits, weekBlocks, blocks, days])

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>()
    const blockIds = new Set(blocks.map((b) => b.id))
    for (const e of events) {
      if (e.habitBlockId && blockIds.has(e.habitBlockId)) continue
      const k = format(new Date(e.start), 'yyyy-MM-dd')
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(e)
    }
    return m
  }, [events, blocks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  /** Find the first free start time (minutes) on a date for a habit, or null. */
  const findFreeSlot = (date: string, habit: Habit, preferMin?: number): number | null => {
    const dayBlocks = blocks.filter((b) => b.date === date)
    const busy = [
      ...busyIntervals(eventsByDay.get(date) ?? []).map(([s, e]) => [s, e] as [number, number]),
      ...dayBlocks.map((b) => { const s = combine(b.date, b.start_time).getTime(); return [s, s + b.duration_min * 60000] as [number, number] }),
    ]
    const dur = habit.duration_min * 60000
    const isFree = (min: number) => {
      const s = combine(date, minutesToTime(min)).getTime(), e = s + dur
      if (date === todayKey() && s < Date.now()) return false
      return !busy.some(([bs, be]) => s < be && e > bs)
    }
    const candidates: number[] = []
    if (preferMin !== undefined) candidates.push(preferMin)
    if (habit.default_time) candidates.push(timeToMinutes(habit.default_time))
    for (let m = 7 * 60; m <= 21 * 60; m += 30) candidates.push(m)
    for (const c of candidates) if (isFree(c)) return c
    return null
  }

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as typeof dragging
    setDragging(d ?? null)
  }

  const onDragEnd = (e: DragEndEvent) => {
    const d = dragging; setDragging(null)
    const over = e.over?.data.current as { date: string; hour?: number } | undefined
    if (!d || !over) return
    if (d.type === 'queue') {
      const h = d.card.habit
      const slot = findFreeSlot(over.date, h, over.hour !== undefined ? over.hour * 60 : undefined)
      if (slot === null) { showToast('No free slot that day'); return }
      if (over.hour !== undefined && slot !== over.hour * 60) showToast(`${minutesToTime(over.hour * 60)} is busy · placed at ${minutesToTime(slot)}`)
      scheduleBlock(h.id, over.date, minutesToTime(slot))
      setSelectedDay(over.date)
    } else {
      const b = d.block
      const time = over.hour !== undefined ? minutesToTime(over.hour * 60) : b.start_time
      moveBlock(b.id, over.date, time)
      setSelectedDay(over.date)
    }
  }

  const autoFill = () => {
    let placed = 0
    const order = [...days].sort((a, b) => blocks.filter((x) => x.date === ymd(a)).length - blocks.filter((x) => x.date === ymd(b)).length)
    for (const card of queue) {
      let left = card.remaining
      const usedDays = new Set(weekBlocks.filter((b) => b.habit_id === card.habit.id).map((b) => b.date))
      for (const d of order) {
        if (left <= 0) break
        const k = ymd(d)
        if (usedDays.has(k)) continue
        if (k < todayKey()) continue
        const slot = findFreeSlot(k, card.habit)
        if (slot === null) continue
        scheduleBlock(card.habit.id, k, minutesToTime(slot))
        usedDays.add(k); left--; placed++
      }
    }
    showToast(placed ? `Placed ${placed} session${placed > 1 ? 's' : ''}` : 'Nothing to place')
  }

  const showBanner = (isSunday() || queue.length > 0) && !bannerDismissed
  const dismissBanner = () => { try { localStorage.setItem(SETUP_DISMISS_KEY, format(new Date(), 'yyyy-ww')) } catch { /* ignore */ } setBannerDismissed(true) }
  const planNextWeek = () => { setAnchor(addDays(weekStart(new Date()), 7)); setSetupOpen(true) }

  const unsynced = weekBlocks.filter((b) => !b.google_event_id).length
  const resetWeek = () => {
    if (!weekBlocks.length) return
    if (!confirm(`Remove all ${weekBlocks.length} planned blocks for this week${googleConnected ? ' (and their calendar events)' : ''}? Habits go back to the queue so you can re-plan.`)) return
    const n = clearBlocks(weekKeys)
    showToast(`Week reset · ${n} block${n === 1 ? '' : 's'} removed`)
  }
  const saveWeekToCalendar = async () => {
    if (!weekBlocks.length) { showToast('Nothing planned this week yet'); return }
    setSavingCal(true)
    const { ok, failed } = await syncBlocksToGoogle(weekBlocks.map((b) => b.id))
    setSavingCal(false)
    showToast(failed ? `${ok} saved, ${failed} failed · see Settings` : `${ok} block${ok === 1 ? '' : 's'} saved to Google Calendar`)
  }

  const weekMeals = mealPlans.filter((m) => m.week_start === weekKeys[0])
  const weekMealCost = weekMeals.reduce((a, m) => { const r = recipes.find((x) => x.id === m.recipe_id); return r ? a + Math.round((r.est_cost * m.servings) / Math.max(1, r.servings)) : a }, 0)
  const goToMeals = () => { setListsMode('meals'); setTab('lists') }

  const selBlocks = blocks.filter((b) => b.date === selectedDay).sort((a, b) => a.start_time.localeCompare(b.start_time))
  const selEvents = (eventsByDay.get(selectedDay) ?? []).filter((e) => !e.allDay)

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div>
        <Header subtitle="Weekly plan" title="Planner" right={
          <button className="btn btn-sm" onClick={() => setSetupOpen(true)}><Sparkles size={14} /> Setup</button>
        } />

        {showBanner && (
          <div className="glass p-4 mb-3 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(168,85,247,0.35))' }}>
            <button className="absolute top-2 right-2 p-1 text-2" onClick={dismissBanner} aria-label="Dismiss"><X size={16} /></button>
            <div className="font-bold text-[16px]">{isSunday() ? '🗓️ Sunday setup ritual' : '🗓️ Plan your week'}</div>
            <div className="text-2 text-sm mt-1">{queue.length ? `${queue.reduce((a, c) => a + c.remaining, 0)} sessions still unscheduled.` : 'Take 5 minutes to set up the week ahead.'}</div>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-primary btn-sm" onClick={isSunday() ? planNextWeek : () => setSetupOpen(true)}>{isSunday() ? 'Plan next week' : 'Plan this week'}</button>
              {queue.length > 0 && <button className="btn btn-sm" onClick={autoFill}><Wand2 size={14} /> Auto-fill</button>}
            </div>
          </div>
        )}

        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <button className="btn btn-sm" onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Previous week"><ChevronLeft size={16} /></button>
            <div className="font-semibold text-[15px]">{format(days[0], 'MMM d')} – {format(days[6], 'MMM d')}{eventsLoading ? ' · syncing…' : ''}</div>
            <button className="btn btn-sm" onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Next week"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const k = ymd(d)
              return <DayColumn key={k} date={k} day={d} blocks={blocks.filter((b) => b.date === k)} habits={habits} eventCount={(eventsByDay.get(k) ?? []).length} selected={k === selectedDay} onSelect={() => setSelectedDay(k)} />
            })}
          </div>
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t hairline">
            <span className="text-3 text-[11px]">{weekBlocks.length} block{weekBlocks.length === 1 ? '' : 's'}{googleConnected && unsynced ? ` · ${unsynced} not in calendar` : ''}</span>
            <div className="flex gap-1.5">
              <button className="btn btn-sm" onClick={resetWeek} disabled={!weekBlocks.length} title="Remove all blocks this week"><RotateCcw size={14} /> Reset</button>
              {googleConnected
                ? <button className="btn btn-sm" onClick={saveWeekToCalendar} disabled={savingCal || !weekBlocks.length}><CalendarPlus size={14} /> {savingCal ? 'Saving…' : 'Save to calendar'}</button>
                : <button className="btn btn-sm btn-ghost text-3" onClick={() => setTab('settings')}><CalendarPlus size={14} /> Connect</button>}
            </div>
          </div>
        </Card>

        <SectionTitle right={queue.length > 0 ? <button className="btn btn-sm" onClick={autoFill}><Wand2 size={14} /> Auto-fill</button> : undefined}>Unscheduled queue</SectionTitle>
        {queue.length === 0 ? (
          <Card><div className="text-2 text-sm">🎉 Every “X per week” habit is planned for this week.</div></Card>
        ) : (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
            {queue.map((c) => <QueueCardView key={c.id} card={c} />)}
          </div>
        )}
        <p className="text-3 text-xs px-1 mt-1">Hold and drag a card onto a day, or onto a time slot below.</p>

        <SectionTitle>{format(new Date(selectedDay + 'T00:00:00'), 'EEEE, MMM d')}</SectionTitle>
        <Card className="p-2">
          {HOURS.map((h) => (
            <HourRow key={h} date={selectedDay} hour={h}
              blocks={selBlocks.filter((b) => Math.floor(timeToMinutes(b.start_time) / 60) === h)}
              events={selEvents.filter((e) => new Date(e.start).getHours() === h)}
              habits={habits} onDelete={deleteBlock} />
          ))}
        </Card>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging?.type === 'queue' && <div className="glass glass-strong px-3 py-2 font-semibold text-sm shadow-xl" style={{ borderLeft: `4px solid ${dragging.card.habit.color}` }}>{dragging.card.habit.icon} {dragging.card.habit.name}</div>}
        {dragging?.type === 'block' && (() => { const h = habits.find((x) => x.id === dragging.block.habit_id); return h ? <div className="glass glass-strong px-3 py-2 font-semibold text-sm shadow-xl" style={{ borderLeft: `4px solid ${h.color}` }}>{h.icon} {h.name}</div> : null })()}
      </DragOverlay>

      <Sheet open={setupOpen} onClose={() => setSetupOpen(false)} title="Weekly setup">
        <div className="flex flex-col gap-3">
          <p className="text-2 text-sm">Week of <b>{format(days[0], 'MMM d')}</b>. Review your unscheduled habits, place them on days that work, and push them to Google Calendar.</p>
          <ol className="text-sm flex flex-col gap-2">
            <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-line flex items-center justify-center text-xs font-bold shrink-0">1</span><span>{queue.length ? `${queue.reduce((a, c) => a + c.remaining, 0)} sessions waiting in the queue.` : 'Queue is empty. Nice.'}</span></li>
            <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-line flex items-center justify-center text-xs font-bold shrink-0">2</span><span>{googleConnected ? `${events.filter((e) => weekKeys.includes(format(new Date(e.start), 'yyyy-MM-dd'))).length} Google events found this week; free windows are used for suggestions.` : 'Connect Google Calendar in Settings so auto-fill can avoid your meetings.'}</span></li>
            <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-line flex items-center justify-center text-xs font-bold shrink-0">3</span><span>Drag cards manually or let auto-fill distribute them across the week.</span></li>
            <li className="flex gap-2 items-center"><span className="w-6 h-6 rounded-full bg-line flex items-center justify-center text-xs font-bold shrink-0">4</span><span className="grow">🍲 Meal prep: {weekMeals.length ? `${weekMeals.length} meal${weekMeals.length > 1 ? 's' : ''} planned (est. ${new Intl.NumberFormat('is-IS').format(weekMealCost)} kr.)` : 'no meals planned yet'}.</span><button className="btn btn-sm shrink-0" onClick={() => { setSetupOpen(false); goToMeals() }}>Plan meals</button></li>
          </ol>
          <div className="flex gap-2 mt-2">
            <button className="btn grow" onClick={() => setSetupOpen(false)}>I’ll drag manually</button>
            <button className="btn btn-primary grow" onClick={() => { autoFill(); setSetupOpen(false) }} disabled={!queue.length}><Wand2 size={16} /> Auto-fill week</button>
          </div>
        </div>
      </Sheet>
    </DndContext>
  )
}

function QueueCardView({ card }: { card: QueueCard }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, data: { type: 'queue', card } })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="glass px-3 py-2 shrink-0 touch-none cursor-grab select-none" style={{ borderLeft: `4px solid ${card.habit.color}`, opacity: isDragging ? 0.4 : 1, minWidth: 140 }}>
      <div className="font-semibold text-sm truncate">{card.habit.icon} {card.habit.name}</div>
      <div className="text-3 text-xs">{card.remaining} left this {card.scope} · {card.habit.duration_min} min</div>
    </div>
  )
}

function DayColumn({ date, day, blocks, habits, eventCount, selected, onSelect }: { date: string; day: Date; blocks: ScheduledBlock[]; habits: Habit[]; eventCount: number; selected: boolean; onSelect: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}`, data: { date } })
  const isToday = date === todayKey()
  return (
    <div ref={setNodeRef} onClick={onSelect} className="rounded-xl p-1 flex flex-col items-center gap-1 min-h-[86px] transition-colors cursor-pointer"
      style={{ background: isOver ? 'rgba(99,102,241,0.3)' : selected ? 'var(--line)' : 'transparent', outline: isToday ? '1.5px solid var(--color-accent)' : 'none', outlineOffset: -1 }}>
      <div className="text-[10px] font-semibold text-3">{format(day, 'EEE')}</div>
      <div className={`text-sm ${isToday ? 'font-bold' : 'font-medium'}`}>{day.getDate()}</div>
      <div className="flex flex-col gap-0.5 w-full">
        {blocks.slice(0, 4).map((b) => { const h = habits.find((x) => x.id === b.habit_id); return h ? <BlockChip key={b.id} block={b} habit={h} compact /> : null })}
        {blocks.length > 4 && <div className="text-[9px] text-3 text-center">+{blocks.length - 4}</div>}
        {eventCount > 0 && <div className="text-[9px] text-center rounded" style={{ background: 'rgba(66,133,244,0.25)' }}>{eventCount} evt</div>}
      </div>
    </div>
  )
}

function BlockChip({ block, habit, compact, onDelete }: { block: ScheduledBlock; habit: Habit; compact?: boolean; onDelete?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `b-${block.id}`, data: { type: 'block', block } })
  if (compact) {
    return <div ref={setNodeRef} {...attributes} {...listeners} className="text-[10px] leading-tight rounded px-0.5 truncate touch-none select-none" style={{ background: `${habit.color}33`, opacity: isDragging ? 0.4 : 1 }} title={habit.name}>{habit.icon}</div>
  }
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="flex items-center gap-2 rounded-lg px-2 py-1.5 touch-none select-none" style={{ background: `${habit.color}22`, borderLeft: `3px solid ${habit.color}`, opacity: isDragging ? 0.4 : 1 }}>
      <span className="text-sm font-medium grow truncate">{habit.icon} {habit.name}</span>
      <span className="text-3 text-[11px]">{block.start_time} · {block.duration_min}m{block.google_event_id ? ' · 📅' : ''}</span>
      {onDelete && <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onDelete(block.id)} className="text-3 p-0.5" aria-label="Remove"><Trash2 size={13} /></button>}
    </div>
  )
}

function HourRow({ date, hour, blocks, events, habits, onDelete }: { date: string; hour: number; blocks: ScheduledBlock[]; events: CalendarEvent[]; habits: Habit[]; onDelete: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${date}-${hour}`, data: { date, hour } })
  return (
    <div ref={setNodeRef} className="flex gap-2 min-h-[38px] border-b hairline last:border-b-0 rounded-lg transition-colors" style={{ background: isOver ? 'rgba(99,102,241,0.2)' : 'transparent' }}>
      <div className="w-12 shrink-0 text-[11px] text-3 pt-2 text-right pr-1">{String(hour).padStart(2, '0')}:00</div>
      <div className="grow flex flex-col gap-1 py-1 min-w-0">
        {events.map((e) => (
          <div key={e.id} className="text-xs rounded-lg px-2 py-1 truncate" style={{ background: 'rgba(66,133,244,0.18)', borderLeft: '3px solid #4285F4' }}>
            {format(new Date(e.start), 'HH:mm')} {e.title}
          </div>
        ))}
        {blocks.map((b) => { const h = habits.find((x) => x.id === b.habit_id); return h ? <BlockChip key={b.id} block={b} habit={h} onDelete={onDelete} /> : null })}
      </div>
    </div>
  )
}

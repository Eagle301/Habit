import { useEffect, useMemo, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { CalendarPlus, ChevronLeft, ChevronRight, RotateCcw, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { useStore, useActiveHabits } from '../store/useStore'
import type { CalendarEvent, Habit, Project, ScheduledBlock, Task } from '../lib/types'
import { addDays, format, isSunday, minutesToTime, timeToMinutes, todayKey, weekDays, weekStart, ymd, combine, startOfMonth, endOfMonth } from '../lib/dates'
import { busyIntervals } from '../lib/google'
import { PROJECT_ICON, blockLook, dueLabel, fmtHours, nextSessionMin, projectProgress, sessionsLeft, sortProjects, type BlockLook } from '../lib/projects'
import { TASK_COLOR, TASK_ICON, sortTasks, taskBlock, taskDueLabel } from '../lib/tasks'
import { Card, Header, SectionTitle } from '../components/ui/Bits'
import { Sheet } from '../components/ui/Sheet'

const HOURS = Array.from({ length: 17 }, (_, i) => 6 + i) // 06:00 .. 22:00
const SETUP_DISMISS_KEY = 'habits-sunday-dismissed'

type QueueCard =
  | { id: string; kind: 'habit'; habit: Habit; remaining: number; scope: 'week' | 'month' }
  | { id: string; kind: 'project'; project: Project; remainingH: number; sessions: number; sessionMin: number }
  | { id: string; kind: 'task'; task: Task }

const cardLook = (c: QueueCard): BlockLook =>
  c.kind === 'habit'
    ? { icon: c.habit.icon, name: c.habit.name, color: c.habit.color, kind: 'habit' }
    : c.kind === 'project'
      ? { icon: PROJECT_ICON, name: c.project.title, color: c.project.color, kind: 'project' }
      : { icon: TASK_ICON, name: c.task.title, color: TASK_COLOR, kind: 'task' }
const cardSessions = (c: QueueCard) => (c.kind === 'habit' ? c.remaining : c.kind === 'project' ? c.sessions : 1)

export function Planner() {
  const habits = useActiveHabits()
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const blocks = useStore((s) => s.blocks)
  const events = useStore((s) => s.events)
  const googleConnected = useStore((s) => s.googleConnected)
  const eventsLoading = useStore((s) => s.eventsLoading)
  const { loadEvents, scheduleBlock, scheduleProjectBlock, scheduleTaskBlock, moveBlock, deleteBlock, clearBlocks, showToast, setTab, setListsMode, syncBlocksToGoogle } = useStore()
  const workHours = useStore((s) => s.workHours)
  const lookFor = (b: ScheduledBlock) => blockLook(b, habits, projects, tasks)
  /** Work-hours interval (minutes from midnight) on a date, or null when the day is free. */
  const workOn = (date: string): [number, number] | null => {
    if (!workHours.enabled) return null
    const dow = (new Date(date + 'T00:00:00').getDay() + 6) % 7 // 0 = Monday
    if (!workHours.days.includes(dow)) return null
    const s = timeToMinutes(workHours.start), e = timeToMinutes(workHours.end)
    return e > s ? [s, e] : null
  }
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
      if (h.is_extra) continue
      if (h.frequency === 'weekly') {
        const n = weekBlocks.filter((b) => b.habit_id === h.id).length
        if (h.target_count - n > 0) cards.push({ id: `q-${h.id}`, kind: 'habit', habit: h, remaining: h.target_count - n, scope: 'week' })
      } else if (h.frequency === 'monthly') {
        const mStart = ymd(startOfMonth(days[0])), mEnd = ymd(endOfMonth(days[6]))
        const n = blocks.filter((b) => b.habit_id === h.id && b.date >= mStart && b.date <= mEnd).length
        if (h.target_count - n > 0) cards.push({ id: `q-${h.id}`, kind: 'habit', habit: h, remaining: h.target_count - n, scope: 'month' })
      }
    }
    // Project study sessions: every hour not yet on the calendar, soonest due date first.
    for (const p of sortProjects(projects)) {
      if (p.done) continue
      const pr = projectProgress(p, blocks)
      if (pr.remainingH <= 0) continue
      cards.push({ id: `p-${p.id}`, kind: 'project', project: p, remainingH: pr.remainingH, sessions: sessionsLeft(p, pr), sessionMin: nextSessionMin(p, pr) })
    }
    // One-time to-dos that are not done and not planned yet.
    for (const t of sortTasks(tasks)) {
      if (t.done || taskBlock(blocks, t.id)) continue
      cards.push({ id: `t-${t.id}`, kind: 'task', task: t })
    }
    return cards
  }, [habits, projects, tasks, weekBlocks, blocks, days])
  const pendingSessions = queue.reduce((a, c) => a + cardSessions(c), 0)

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>()
    const blockIds = new Set(blocks.map((b) => b.id))
    const push = (k: string, e: CalendarEvent) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(e) }
    for (const e of events) {
      if (e.habitBlockId && blockIds.has(e.habitBlockId)) continue
      if (e.allDay) {
        // All-day events span [start, end) — Google's end date is exclusive. Show on every day covered.
        const end = new Date(e.end)
        for (let d = new Date(e.start); d < end; d = addDays(d, 1)) push(ymd(d), e)
        if (new Date(e.start) >= end) push(ymd(new Date(e.start)), e)
      } else push(format(new Date(e.start), 'yyyy-MM-dd'), e)
    }
    return m
  }, [events, blocks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  /**
   * Find the first free start time (minutes) on a date for a block of `durationMin`, or null.
   * The generic scan never lands inside work hours; a slot the user dropped on explicitly
   * (`preferMin`) or the habit's own ideal time (`defaultTime`, e.g. gym at 12:00) is allowed there.
   */
  const findFreeSlot = (date: string, durationMin: number, preferMin?: number, defaultTime?: string | null): number | null => {
    const dayBlocks = blocks.filter((b) => b.date === date)
    const busy = [
      ...busyIntervals(eventsByDay.get(date) ?? []).map(([s, e]) => [s, e] as [number, number]),
      ...dayBlocks.map((b) => { const s = combine(b.date, b.start_time).getTime(); return [s, s + b.duration_min * 60000] as [number, number] }),
    ]
    const dur = durationMin * 60000
    const isFree = (min: number) => {
      const s = combine(date, minutesToTime(min)).getTime(), e = s + dur
      if (date === todayKey() && s < Date.now()) return false
      return !busy.some(([bs, be]) => s < be && e > bs)
    }
    const work = workOn(date)
    const inWork = (min: number) => !!work && min < work[1] && min + durationMin > work[0]
    const candidates: { min: number; allowWork: boolean }[] = []
    if (preferMin !== undefined) candidates.push({ min: preferMin, allowWork: true })
    if (defaultTime) candidates.push({ min: timeToMinutes(defaultTime), allowWork: true })
    for (let m = 7 * 60; m <= 21 * 60; m += 30) candidates.push({ min: m, allowWork: false })
    for (const c of candidates) if (isFree(c.min) && (c.allowWork || !inWork(c.min))) return c.min
    return null
  }

  /** Place one queue card on a date (optionally at a preferred hour). Returns false if nothing fit. */
  const placeCard = (card: QueueCard, date: string, preferMin?: number, quiet = false): boolean => {
    const dated = card.kind === 'project' ? card.project : card.kind === 'task' ? card.task : null
    // Not after the due date, except an already-overdue to-do, which can go on any day to catch up.
    const overdueTask = card.kind === 'task' && !!card.task.due_date && card.task.due_date < todayKey()
    if (dated?.due_date && date > dated.due_date && !overdueTask) {
      if (!quiet) showToast(`“${dated.title}” is due ${format(new Date(dated.due_date + 'T00:00:00'), 'MMM d')}`)
      return false
    }
    const dur = card.kind === 'habit' ? card.habit.duration_min : card.kind === 'project' ? card.sessionMin : card.task.duration_min
    const slot = findFreeSlot(date, dur, preferMin, card.kind === 'habit' ? card.habit.default_time : null)
    if (slot === null) { if (!quiet) showToast('No free slot that day'); return false }
    if (!quiet && preferMin !== undefined && slot !== preferMin) showToast(`${minutesToTime(preferMin)} is busy · placed at ${minutesToTime(slot)}`)
    if (card.kind === 'habit') scheduleBlock(card.habit.id, date, minutesToTime(slot))
    else if (card.kind === 'project') scheduleProjectBlock(card.project.id, date, minutesToTime(slot), card.sessionMin)
    else scheduleTaskBlock(card.task.id, date, minutesToTime(slot))
    return true
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
      if (placeCard(d.card, over.date, over.hour !== undefined ? over.hour * 60 : undefined)) setSelectedDay(over.date)
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
      // Undated to-dos wait for a manual drag so auto-fill doesn't scatter loose errands over the week.
      if (card.kind === 'task' && !card.task.due_date) continue
      let left = cardSessions(card)
      // One session per day per habit/project so the week stays balanced.
      const usedDays = new Set(weekBlocks.filter((b) => (card.kind === 'habit' ? b.habit_id === card.habit.id : card.kind === 'project' ? b.project_id === card.project.id : b.task_id === card.task.id)).map((b) => b.date))
      for (const d of order) {
        if (left <= 0) break
        const k = ymd(d)
        if (usedDays.has(k)) continue
        if (k < todayKey()) continue
        if (!placeCard(card, k, undefined, true)) continue
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
  const selAllDay = (eventsByDay.get(selectedDay) ?? []).filter((e) => e.allDay)

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
            <div className="text-2 text-sm mt-1">{queue.length ? `${pendingSessions} sessions still unscheduled.` : 'Take 5 minutes to set up the week ahead.'}</div>
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
              return <DayColumn key={k} date={k} day={d} blocks={blocks.filter((b) => b.date === k)} lookFor={lookFor} eventCount={(eventsByDay.get(k) ?? []).length} selected={k === selectedDay} onSelect={() => setSelectedDay(k)} />
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
          <Card><div className="text-2 text-sm">🎉 Every “X per week” habit, project session and to-do is planned.</div></Card>
        ) : (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
            {queue.map((c) => <QueueCardView key={c.id} card={c} />)}
          </div>
        )}
        <p className="text-3 text-xs px-1 mt-1">Hold and drag a card onto a day, or onto a time slot below.</p>

        <SectionTitle>{format(new Date(selectedDay + 'T00:00:00'), 'EEEE, MMM d')}</SectionTitle>
        <Card className="p-2">
          {selAllDay.length > 0 && (
            <div className="flex gap-2 border-b hairline pb-1 mb-1">
              <div className="w-12 shrink-0 text-[11px] text-3 pt-2 text-right pr-1">All day</div>
              <div className="grow flex flex-col gap-1 py-1 min-w-0">
                {selAllDay.map((e) => (
                  <div key={e.id} className="text-xs rounded-lg px-2 py-1 truncate" title={e.calendar} style={{ background: `${e.color ?? '#4285F4'}2e`, borderLeft: `3px solid ${e.color ?? '#4285F4'}` }}>{e.title}</div>
                ))}
              </div>
            </div>
          )}
          {HOURS.map((h) => {
            const w = workOn(selectedDay)
            return (
              <HourRow key={h} date={selectedDay} hour={h} work={!!w && h * 60 >= w[0] && h * 60 < w[1]}
                blocks={selBlocks.filter((b) => Math.floor(timeToMinutes(b.start_time) / 60) === h)}
                events={selEvents.filter((e) => new Date(e.start).getHours() === h)}
                lookFor={lookFor} onDelete={deleteBlock} />
            )
          })}
        </Card>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging?.type === 'queue' && (() => { const l = cardLook(dragging.card); return <div className="glass glass-strong px-3 py-2 font-semibold text-sm shadow-xl" style={{ borderLeft: `4px solid ${l.color}` }}>{l.icon} {l.name}</div> })()}
        {dragging?.type === 'block' && (() => { const l = lookFor(dragging.block); return l ? <div className="glass glass-strong px-3 py-2 font-semibold text-sm shadow-xl" style={{ borderLeft: `4px solid ${l.color}` }}>{l.icon} {l.name}</div> : null })()}
      </DragOverlay>

      <Sheet open={setupOpen} onClose={() => setSetupOpen(false)} title="Weekly setup">
        <div className="flex flex-col gap-3">
          <p className="text-2 text-sm">Week of <b>{format(days[0], 'MMM d')}</b>. Review your unscheduled habits, place them on days that work, and push them to Google Calendar.</p>
          <ol className="text-sm flex flex-col gap-2">
            <li className="flex gap-2"><span className="w-6 h-6 rounded-full bg-line flex items-center justify-center text-xs font-bold shrink-0">1</span><span>{queue.length ? `${pendingSessions} sessions waiting in the queue${queue.some((c) => c.kind === 'project') ? `, incl. ${queue.filter((c) => c.kind === 'project').length} project${queue.filter((c) => c.kind === 'project').length === 1 ? '' : 's'}` : ''}.` : 'Queue is empty. Nice.'}</span></li>
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
  const l = cardLook(card)
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="glass px-3 py-2 shrink-0 touch-none cursor-grab select-none" style={{ borderLeft: `4px solid ${l.color}`, opacity: isDragging ? 0.4 : 1, minWidth: 140, maxWidth: 200 }}>
      <div className="font-semibold text-sm truncate">{l.icon} {l.name}</div>
      {card.kind === 'habit'
        ? <div className="text-3 text-xs">{card.remaining} left this {card.scope} · {card.habit.duration_min} min</div>
        : card.kind === 'project'
          ? <div className="text-3 text-xs truncate">{fmtHours(card.remainingH)} to plan · {card.sessionMin} min · {dueLabel(card.project.due_date)}</div>
          : <div className="text-3 text-xs truncate">To-do · {card.task.duration_min} min{card.task.due_date ? ` · Due ${taskDueLabel(card.task.due_date)}` : ''}</div>}
    </div>
  )
}

type LookFor = (b: ScheduledBlock) => BlockLook | null

function DayColumn({ date, day, blocks, lookFor, eventCount, selected, onSelect }: { date: string; day: Date; blocks: ScheduledBlock[]; lookFor: LookFor; eventCount: number; selected: boolean; onSelect: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}`, data: { date } })
  const isToday = date === todayKey()
  return (
    <div ref={setNodeRef} onClick={onSelect} className="rounded-xl p-1 flex flex-col items-center gap-1 min-h-[86px] transition-colors cursor-pointer"
      style={{ background: isOver ? 'rgba(99,102,241,0.3)' : selected ? 'var(--line)' : 'transparent', outline: isToday ? '1.5px solid var(--color-accent)' : 'none', outlineOffset: -1 }}>
      <div className="text-[10px] font-semibold text-3">{format(day, 'EEE')}</div>
      <div className={`text-sm ${isToday ? 'font-bold' : 'font-medium'}`}>{day.getDate()}</div>
      <div className="flex flex-col gap-0.5 w-full">
        {blocks.slice(0, 4).map((b) => { const l = lookFor(b); return l ? <BlockChip key={b.id} block={b} look={l} compact /> : null })}
        {blocks.length > 4 && <div className="text-[9px] text-3 text-center">+{blocks.length - 4}</div>}
        {eventCount > 0 && <div className="text-[9px] text-center rounded" style={{ background: 'rgba(66,133,244,0.25)' }}>{eventCount} evt</div>}
      </div>
    </div>
  )
}

function BlockChip({ block, look, compact, onDelete }: { block: ScheduledBlock; look: BlockLook; compact?: boolean; onDelete?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `b-${block.id}`, data: { type: 'block', block } })
  if (compact) {
    return <div ref={setNodeRef} {...attributes} {...listeners} className="text-[10px] leading-tight rounded px-0.5 truncate touch-none select-none" style={{ background: `${look.color}33`, opacity: isDragging ? 0.4 : 1 }} title={look.name}>{look.icon}</div>
  }
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="flex items-center gap-2 rounded-lg px-2 py-1.5 touch-none select-none" style={{ background: `${look.color}22`, borderLeft: `3px solid ${look.color}`, opacity: isDragging ? 0.4 : 1 }}>
      <span className={`text-sm font-medium grow truncate ${block.done ? 'line-through text-3' : ''}`}>{look.icon} {look.name}</span>
      <span className="text-3 text-[11px]">{block.start_time} · {block.duration_min}m{block.google_event_id ? ' · 📅' : ''}</span>
      {onDelete && <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onDelete(block.id)} className="text-3 p-0.5" aria-label="Remove"><Trash2 size={13} /></button>}
    </div>
  )
}

function HourRow({ date, hour, work, blocks, events, lookFor, onDelete }: { date: string; hour: number; work: boolean; blocks: ScheduledBlock[]; events: CalendarEvent[]; lookFor: LookFor; onDelete: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${date}-${hour}`, data: { date, hour } })
  return (
    <div ref={setNodeRef} className="flex gap-2 min-h-[38px] border-b hairline last:border-b-0 rounded-lg transition-colors" title={work ? 'Work hours · auto-fill skips this' : undefined}
      style={{ background: isOver ? 'rgba(99,102,241,0.2)' : work ? 'repeating-linear-gradient(135deg, transparent 0 6px, var(--line) 6px 8px)' : 'transparent' }}>
      <div className="w-12 shrink-0 text-[11px] text-3 pt-2 text-right pr-1">{String(hour).padStart(2, '0')}:00</div>
      <div className="grow flex flex-col gap-1 py-1 min-w-0">
        {events.map((e) => (
          <div key={e.id} className="text-xs rounded-lg px-2 py-1 truncate" title={e.calendar} style={{ background: `${e.color ?? '#4285F4'}2e`, borderLeft: `3px solid ${e.color ?? '#4285F4'}` }}>
            {format(new Date(e.start), 'HH:mm')} {e.title}
          </div>
        ))}
        {blocks.map((b) => { const l = lookFor(b); return l ? <BlockChip key={b.id} block={b} look={l} onDelete={onDelete} /> : null })}
      </div>
    </div>
  )
}

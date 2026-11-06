import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Flame, Plus, Trash2, Wand2 } from 'lucide-react'
import { useStore, useActiveHabits } from '../store/useStore'
import type { CalendarEvent, Habit, Project, ScheduledBlock, Task } from '../lib/types'
import { addDays, addMonths, format, fromKey, minutesToTime, monthDays, startOfMonth, timeToMinutes, todayKey, weekDays, weekStart, ymd } from '../lib/dates'
import { dayRate, habitStreakInfo, indexLogs, isDone, monthCompletionRate, perfectDayInfo, rateColor, activeHabitsOn, type LogIndex } from '../lib/analytics'
import { blockLook, fmtHours, dueLabel } from '../lib/projects'
import { taskDueLabel } from '../lib/tasks'
import { autoFillWeek, dailyHabitSlots, eventsByDay, itemLook, placeItem, unplannedFor, workSegments, type PlanItem } from '../lib/planning'

/** Work shows as a quiet grey item. */
const WORK_STYLE = { background: 'rgba(148,163,184,0.14)', border: '1px solid rgba(148,163,184,0.35)', color: 'var(--text-2)' }
import { Card, CheckCircle, Header, SectionTitle } from '../components/ui/Bits'
import { Sheet } from '../components/ui/Sheet'

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
type View = 'month' | 'week'
const VIEW_KEY = 'habits-calendar-view'
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** Minutes from midnight that an event starts on `date` (0 when it began on an earlier day). */
const startMinOn = (e: CalendarEvent, date: string) => { const s = new Date(e.start); return ymd(s) < date ? 0 : s.getHours() * 60 + s.getMinutes() }

export function CalendarTab() {
  const habits = useActiveHabits()
  const logs = useStore((s) => s.logs)
  const blocks = useStore((s) => s.blocks)
  const events = useStore((s) => s.events)
  const googleConnected = useStore((s) => s.googleConnected)
  const eventsLoading = useStore((s) => s.eventsLoading)
  const { loadEvents, showToast } = useStore()

  const [view, setViewState] = useState<View>(() => { try { return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month' } catch { return 'month' } })
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ } }
  const [selected, setSelected] = useState(todayKey())
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [planOpen, setPlanOpen] = useState(false)
  const [filling, setFilling] = useState(false)

  const idx = useMemo(() => indexLogs(logs), [logs])
  const selDate = fromKey(selected)
  const monday = weekStart(selDate)
  const mondayKey = ymd(monday)
  const mDays = useMemo(() => monthDays(month), [month])
  const wDays = useMemo(() => weekDays(fromKey(mondayKey)), [mondayKey])
  const byDay = useMemo(() => eventsByDay(events, blocks), [events, blocks])

  // Google events for whatever is on screen.
  const [from, to] = view === 'month' ? [mDays[0], mDays[mDays.length - 1]] : [wDays[0], wDays[6]]
  useEffect(() => { if (googleConnected) void loadEvents(from, to) }, [googleConnected, ymd(from)]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Select a day and keep the month grid on it. */
  const pick = (k: string) => {
    setSelected(k)
    const d = fromKey(k)
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(startOfMonth(d))
  }
  const step = (dir: 1 | -1) => {
    if (view === 'month') { const m = addMonths(month, dir); setMonth(m); setSelected(ymd(m)) }
    else pick(ymd(addDays(selDate, 7 * dir)))
  }

  const fillWeek = async (start: Date) => {
    setFilling(true)
    try {
      // Load the week's Google events first so nothing lands on a meeting.
      if (googleConnected) await loadEvents(start, addDays(start, 6), true)
      const { placed, short } = autoFillWeek(start)
      const span = `${format(start, 'EEE MMM d')} – ${format(addDays(start, 6), 'EEE MMM d')}`
      showToast(placed
        ? `Planned ${plural(placed, 'session')} for ${span}${short.length ? ` · not all of ${short.join(', ')} fit` : ''}`
        : short.length ? `No free time found for ${short.join(', ')}` : `Nothing left to plan for ${span}`)
    } finally {
      setFilling(false)
    }
  }
  /** Plans next Monday to Sunday and shows that week. */
  const planNextWeek = async () => {
    const next = addDays(weekStart(new Date()), 7)
    setView('week')
    pick(ymd(next))
    await fillWeek(next)
  }

  const title = view === 'month'
    ? format(month, month.getFullYear() === new Date().getFullYear() ? 'MMMM' : 'MMM yyyy')
    : `${format(wDays[0], 'MMM d')} – ${format(wDays[6], wDays[0].getMonth() === wDays[6].getMonth() ? 'd' : 'MMM d')}`

  return (
    <div>
      <Header subtitle="Tap a day to plan it" title="Calendar" right={
        <button className="btn btn-sm btn-primary" onClick={planNextWeek} disabled={filling}><Wand2 size={14} /> {filling ? 'Planning…' : 'Plan next week'}</button>
      } />

      <Card>
        {/* One row: ‹ title › on the left, a small Month/Week switch on the right. */}
        <div className="flex items-center gap-1 mb-3">
          <button className="p-1.5 rounded-lg press text-2" onClick={() => step(-1)} aria-label={`Previous ${view}`}><ChevronLeft size={18} /></button>
          <div className="font-semibold text-[15px] min-w-0 truncate">{title}{eventsLoading ? ' · syncing…' : ''}</div>
          <button className="p-1.5 rounded-lg press text-2" onClick={() => step(1)} aria-label={`Next ${view}`}><ChevronRight size={18} /></button>
          <div className="ml-auto inline-flex rounded-full p-0.5 shrink-0" style={{ background: 'var(--line)' }} role="group" aria-label="Calendar view">
            {(['month', 'week'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize transition-colors"
                style={view === v ? { background: 'var(--glass-strong)', color: 'var(--text)', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' } : { color: 'var(--text-3)' }}>
                {v}
              </button>
            ))}
          </div>
        </div>
        {view === 'month'
          ? <MonthGrid days={mDays} selected={selected} onSelect={pick} habits={habits} idx={idx} blocks={blocks} byDay={byDay} googleConnected={googleConnected} />
          : <WeekGrid days={wDays} selected={selected} onSelect={pick} byDay={byDay} idx={idx} />}
      </Card>

      <SectionTitle right={selected >= todayKey() ? <button className="btn btn-sm btn-primary" onClick={() => setPlanOpen(true)}><Plus size={14} /> Plan</button> : undefined}>
        {format(selDate, 'EEEE, MMM d')}
      </SectionTitle>
      <DayPanel date={selected} idx={idx} byDay={byDay} />

      <Streaks habits={habits} idx={idx} month={month} />

      <Sheet open={planOpen} onClose={() => setPlanOpen(false)} title={`Plan ${format(selDate, 'EEE, MMM d')}`} tall>
        {planOpen && <PlanDay date={selected} onFillWeek={() => { setPlanOpen(false); void fillWeek(monday) }} />}
      </Sheet>
    </div>
  )
}

/* ------------------------------ month view ------------------------------ */

function MonthGrid({ days, selected, onSelect, habits, idx, blocks, byDay, googleConnected }: {
  days: Date[]; selected: string; onSelect: (k: string) => void; habits: Habit[]; idx: LogIndex
  blocks: ScheduledBlock[]; byDay: Map<string, CalendarEvent[]>; googleConnected: boolean
}) {
  const today = todayKey()
  const leading = (days[0].getDay() + 6) % 7 // Monday-first offset
  const planned = useMemo(() => new Set(blocks.map((b) => b.date)), [blocks])
  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-3 mb-1">{DOW.map((d) => <div key={d}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leading }).map((_, i) => <div key={`l${i}`} />)}
        {days.map((d) => {
          const k = ymd(d)
          const rate = k > today ? null : dayRate(habits, idx, k)
          const color = rateColor(rate)
          // One dot for planned items, then up to two of the day's calendar events in their own colour.
          const dots = [...(planned.has(k) ? ['var(--color-accent)'] : []), ...(byDay.get(k) ?? []).slice(0, 2).map((e) => e.color ?? '#4285F4')]
          return (
            <button key={k} onClick={() => onSelect(k)} className="aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 press"
              style={{
                background: rate !== null ? `${color}${Math.round(20 + rate * 60).toString(16).padStart(2, '0')}` : 'var(--line)',
                outline: k === selected ? '2px solid var(--color-accent)' : k === today ? '1.5px solid var(--text-3)' : 'none', outlineOffset: -1,
              }}>
              <span className={`text-[13px] ${k === today ? 'font-bold' : 'font-medium'}`}>{d.getDate()}</span>
              <span className="flex gap-0.5 h-1.5">{dots.map((c, i) => <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />)}</span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3 mt-3 text-[11px] text-3">
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} /> planned</span>
        {googleConnected && <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4285F4' }} /> calendar</span>}
        <span className="grow" />
        <span>Less</span>
        <div className="flex gap-0.5">{['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'].map((c) => <span key={c} className="w-2.5 h-2 rounded-sm" style={{ background: c }} />)}</div>
        <span>More</span>
      </div>
    </>
  )
}

/* ------------------------------ week view ------------------------------ */

interface DayItem { key: string; start: number; minutes: number; icon?: string; label: string; color: string; kind: 'event' | 'block' | 'habit' | 'work'; done?: boolean }

/** Card height grows with duration (30 min ≈ 42 px, 1 h ≈ 54 px, 2 h ≈ 78 px), so longer items stand out. */
const cardHeight = (minutes: number) => Math.min(140, 30 + Math.max(15, minutes) * 0.4)

/** Seven columns, one per day: that day's items in time order, each with its start time. */
function WeekGrid({ days, selected, onSelect, byDay, idx }: { days: Date[]; selected: string; onSelect: (k: string) => void; byDay: Map<string, CalendarEvent[]>; idx: LogIndex }) {
  const blocks = useStore((s) => s.blocks)
  const habits = useStore((s) => s.habits)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  useStore((s) => s.workHours) // re-render when work hours change; workSegments reads them from the store
  const today = todayKey()

  const columns = days.map((d, i) => {
    const k = ymd(d)
    const evts = byDay.get(k) ?? []
    const items: DayItem[] = [
      ...evts.filter((e) => !e.allDay).map((e) => {
        const start = startMinOn(e, k)
        const end = ymd(new Date(e.end)) > k ? 24 * 60 : new Date(e.end).getHours() * 60 + new Date(e.end).getMinutes()
        return { key: `e-${e.id}`, start, minutes: end - start, label: e.title, color: e.color ?? '#4285F4', kind: 'event' as const }
      }),
      ...blocks.filter((b) => b.date === k).flatMap((b) => {
        const l = blockLook(b, habits, projects, tasks)
        if (!l) return []
        const done = l.kind === 'habit' ? !!b.habit_id && isDone(idx, k, b.habit_id) : !!b.done
        return [{ key: b.id, start: timeToMinutes(b.start_time), minutes: b.duration_min, icon: l.icon, label: l.name, color: l.color, kind: 'block' as const, done }]
      }),
      ...dailyHabitSlots(k, habits, blocks).map((x) => ({ key: `h-${x.habit.id}`, start: x.start, minutes: x.end - x.start, icon: x.habit.icon, label: x.habit.name, color: x.habit.color, kind: 'habit' as const, done: isDone(idx, k, x.habit.id) })),
      ...workSegments(k).map(([ws, we], j) => ({ key: `w-${j}`, start: ws, minutes: we - ws, icon: '💼', label: 'Work', color: '#94a3b8', kind: 'work' as const })),
    ].sort((a, b) => a.start - b.start)
    return { k, d, dow: DOW[i], allDay: evts.filter((e) => e.allDay), items }
  })

  return (
    <div>
      <div className="grid grid-cols-7 gap-1">
        {columns.map(({ k, d, dow }) => {
          const sel = k === selected
          return (
            <button key={k} onClick={() => onSelect(k)} className="rounded-lg py-1 flex flex-col items-center press"
              style={{ background: sel ? 'linear-gradient(135deg,#6366f1,#a855f7)' : 'transparent', color: sel ? 'white' : undefined }}>
              <span className="text-[11px] font-semibold" style={{ color: sel ? 'rgba(255,255,255,0.85)' : 'var(--text-3)' }}>{dow}</span>
              <span className={`text-[14px] leading-tight ${k === today ? 'font-bold' : 'font-medium'}`} style={k === today && !sel ? { color: 'var(--color-accent)' } : undefined}>{d.getDate()}</span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-7 gap-1 mt-1">
        {columns.map(({ k, allDay, items }) => (
          <div key={k} onClick={() => onSelect(k)} className="rounded-lg p-0.5 flex flex-col gap-1 min-h-[120px] min-w-0 cursor-pointer"
            style={{ background: k === selected ? 'rgba(99,102,241,0.12)' : 'var(--line)' }}>
            {allDay.map((e) => (
              <div key={e.id} title={e.title} className="rounded px-1 py-0.5 text-[9px] leading-tight truncate" style={{ background: `${e.color ?? '#4285F4'}40` }}>{e.title}</div>
            ))}
            {items.map((it) => (
              <div key={it.key} title={`${minutesToTime(it.start)} ${it.icon ? `${it.icon} ` : ''}${it.label}`} className="rounded px-1 py-0.5 overflow-hidden flex flex-col"
                style={it.kind === 'work' ? { height: cardHeight(it.minutes), ...WORK_STYLE } : {
                  height: cardHeight(it.minutes),
                  background: it.kind === 'habit' ? 'transparent' : `${it.color}${it.kind === 'event' ? '40' : '55'}`,
                  ...(it.kind === 'habit' ? { border: `1px dashed ${it.color}` } : { borderLeft: `2px solid ${it.color}` }),
                  opacity: it.done ? 0.5 : 1,
                }}>
                <span className="text-[9px] font-bold tabular-nums leading-tight">{minutesToTime(it.start)}{it.kind === 'work' ? `–${minutesToTime(it.start + it.minutes)}` : ''}</span>
                <span className={`text-[9px] leading-tight hyphens-auto ${it.done ? 'line-through' : ''}`}>{it.icon ? `${it.icon} ` : ''}{it.label}</span>
              </div>
            ))}
            {!allDay.length && !items.length && <div className="text-3 text-[10px] text-center mt-2">–</div>}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-2 text-[10px] text-3 flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(99,102,241,0.4)', borderLeft: '2px solid #6366f1' }} /> planned</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(66,133,244,0.3)', borderLeft: '2px solid #4285F4' }} /> calendar</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ border: '1px dashed var(--text-3)' }} /> daily habit</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={WORK_STYLE} /> work</span>
        <span className="grow" />
        <span>taller = longer</span>
      </div>
    </div>
  )
}

/* ------------------------------ selected day ------------------------------ */

function DayPanel({ date, idx, byDay }: { date: string; idx: LogIndex; byDay: Map<string, CalendarEvent[]> }) {
  const allHabits = useStore((s) => s.habits)
  const habits = useActiveHabits()
  const blocks = useStore((s) => s.blocks)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const { moveBlock, deleteBlock, clearBlocks, toggleBlockDone, showToast } = useStore()
  useStore((s) => s.workHours) // re-render when work hours change
  const today = todayKey()
  const isPast = date < today
  const dayHabits = activeHabitsOn(allHabits, date)
  const completed = dayHabits.filter((h) => isDone(idx, date, h.id))
  const missed = dayHabits.filter((h) => h.frequency === 'daily' && !isDone(idx, date, h.id))
  const rate = dayRate(habits, idx, date)
  const dayBlocks = blocks.filter((b) => b.date === date)
  const evts = byDay.get(date) ?? []
  const allDay = evts.filter((e) => e.allDay)
  const schedule = [
    ...evts.filter((e) => !e.allDay).map((e) => ({ kind: 'event' as const, key: e.id, min: startMinOn(e, date), e })),
    ...dayBlocks.map((b) => ({ kind: 'block' as const, key: b.id, min: timeToMinutes(b.start_time), b })),
    ...workSegments(date).map(([ws, we], j) => ({ kind: 'work' as const, key: `w-${j}`, min: ws, end: we })),
  ].sort((a, b) => a.min - b.min)
  const hasPlans = schedule.some((it) => it.kind !== 'work')
  const clearDay = () => { if (confirm(`Remove all ${dayBlocks.length} planned items on this day?`)) showToast(`${plural(clearBlocks([date]), 'item')} removed`) }

  return (
    <Card>
      {date <= today && dayHabits.length > 0 && (
        <div className="mb-3 pb-3 border-b hairline">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-2">Habits done</div>
            <div className="font-bold" style={{ color: rateColor(rate) }}>{rate === null ? '—' : `${Math.round(rate * 100)}%`}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {completed.map((h) => <span key={h.id} className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: `${h.color}26` }}>✓ {h.icon} {h.name}</span>)}
            {missed.map((h) => <span key={h.id} className="text-xs px-2 py-1 rounded-full bg-line text-3 line-through">{h.icon} {h.name}</span>)}
          </div>
        </div>
      )}

      {allDay.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {allDay.map((e) => <div key={e.id} className="text-xs rounded-lg px-2 py-1 truncate" title={e.calendar} style={{ background: `${e.color ?? '#4285F4'}2e`, borderLeft: `3px solid ${e.color ?? '#4285F4'}` }}>All day · {e.title}</div>)}
        </div>
      )}

      {schedule.length > 0 && (
        <div className="flex flex-col">
          {schedule.map((it) => it.kind === 'work'
            ? <WorkRow key={it.key} start={it.min} end={it.end} />
            : it.kind === 'event'
            ? <EventRow key={it.key} e={it.e} date={date} />
            : <BlockRow key={it.key} b={it.b} done={blockDone(it.b, idx)} look={blockLook(it.b, allHabits, projects, tasks)} onMove={moveBlock} onDelete={deleteBlock} onToggle={toggleBlockDone} />)}
        </div>
      )}
      {!hasPlans && <div className={`text-3 text-sm ${schedule.length ? 'mt-2' : ''}`}>{isPast ? 'Nothing was planned.' : 'Nothing planned yet. Tap “Plan” to add habits, goal sessions and to-dos.'}</div>}
      {dayBlocks.length > 1 && !isPast && <button className="btn btn-sm btn-ghost text-3 w-full mt-2" onClick={clearDay}><Trash2 size={14} /> Clear day</button>}
    </Card>
  )
}

const blockDone = (b: ScheduledBlock, idx: LogIndex) => (b.habit_id ? isDone(idx, b.date, b.habit_id) : !!b.done)

/** Work hours for the day, in grey; a gap means something planned moved work later. */
function WorkRow({ start, end }: { start: number; end: number }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b hairline last:border-b-0 text-3">
      <span className="w-[6rem] shrink-0 text-xs font-semibold pl-2 tabular-nums">{minutesToTime(start)}</span>
      <span className="w-1 self-stretch rounded-full" style={{ background: 'rgba(148,163,184,0.5)' }} />
      <div className="grow min-w-0 text-sm">💼 Work <span className="text-[11px]">· until {minutesToTime(end)}</span></div>
    </div>
  )
}

function EventRow({ e, date }: { e: CalendarEvent; date: string }) {
  const color = e.color ?? '#4285F4'
  return (
    <div className="flex items-center gap-2 py-2 border-b hairline last:border-b-0">
      <span className="w-[6rem] shrink-0 text-xs font-semibold text-2 pl-2">{ymd(new Date(e.start)) < date ? '…' : format(new Date(e.start), 'HH:mm')}</span>
      <span className="w-1 self-stretch rounded-full" style={{ background: color }} />
      <div className="grow min-w-0">
        <div className="text-sm truncate">{e.title}</div>
        <div className="text-3 text-[11px] truncate">{e.calendar ?? 'Google Calendar'} · until {format(new Date(e.end), 'HH:mm')}</div>
      </div>
    </div>
  )
}

function BlockRow({ b, done, look, onMove, onDelete, onToggle }: {
  b: ScheduledBlock; done: boolean; look: ReturnType<typeof blockLook>
  onMove: (id: string, date: string, time: string) => void; onDelete: (id: string) => void; onToggle: (id: string) => void
}) {
  if (!look) return null
  return (
    <div className="flex items-center gap-2 py-1.5 border-b hairline last:border-b-0">
      <input type="time" className="field !w-[6rem] !px-2 !py-1 text-xs font-semibold shrink-0" value={b.start_time} aria-label="Start time"
        onChange={(e) => { if (e.target.value) onMove(b.id, b.date, e.target.value) }} />
      <span className="w-1 self-stretch rounded-full" style={{ background: look.color }} />
      <div className="grow min-w-0">
        <div className={`text-sm font-medium truncate ${done ? 'line-through text-3' : ''}`}>{look.icon} {look.name}</div>
        <div className="text-3 text-[11px]">{look.kind === 'project' ? 'Goal session' : look.kind === 'task' ? 'To-do' : 'Habit'} · {b.duration_min} min{b.google_event_id ? ' · 📅' : ''}</div>
      </div>
      {look.kind !== 'habit' && <button onClick={() => onToggle(b.id)} aria-label="Toggle done"><CheckCircle checked={done} color={look.color} size={24} /></button>}
      <button onClick={() => onDelete(b.id)} className="text-3 p-1" aria-label="Remove"><Trash2 size={15} /></button>
    </div>
  )
}

/* ------------------------------ streaks ------------------------------ */

/** 🧊 once a freeze saved the streak this week; nothing otherwise. */
function FreezeMark({ used }: { used: number }) {
  if (!used) return null
  const label = 'Missed day covered by this week’s freeze'
  return <span className="text-[12px] leading-none" title={label} aria-label={label}>🧊</span>
}

function Streaks({ habits, idx, month }: { habits: Habit[]; idx: LogIndex; month: Date }) {
  const perfect = perfectDayInfo(habits, idx)
  const monthRate = monthCompletionRate(habits, idx, monthDays(month))
  const streaks = habits.map((h) => ({ h, info: habitStreakInfo(idx, h) })).sort((a, b) => b.info.streak - a.info.streak)
  return (
    <>
      <SectionTitle>Streaks</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <div className="text-3xl font-bold inline-flex items-center gap-1"><Flame className="text-orange-500" size={26} />{perfect.streak}</div>
          <div className="text-3 text-xs mt-1">perfect-day streak</div>
          {perfect.freezesThisWeek > 0 && <div className="mt-1"><FreezeMark used={perfect.freezesThisWeek} /></div>}
        </Card>
        <Card className="text-center">
          <div className="text-3xl font-bold">{Math.round(monthRate * 100)}%</div>
          <div className="text-3 text-xs mt-1">{format(month, 'MMM')} completion rate</div>
        </Card>
      </div>
      {streaks.length > 0 && (
        <Card className="mt-3">
          <div className="flex flex-col gap-2">
            {streaks.slice(0, 6).map(({ h, info }) => (
              <div key={h.id} className="flex items-center gap-2 text-sm">
                <span>{h.icon}</span>
                <span className="grow truncate">{h.name}</span>
                {h.frequency === 'daily' && <FreezeMark used={info.freezesThisWeek} />}
                <span className="font-semibold inline-flex items-center gap-1 w-14 justify-end" style={{ color: info.streak > 0 ? h.color : 'var(--text-3)' }}>
                  <Flame size={14} />{info.streak} {h.frequency === 'daily' ? 'd' : h.frequency === 'weekly' ? 'w' : 'mo'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-3 text-[11px] mt-3 pt-2 border-t hairline">🧊 One missed day a week won’t break a daily streak.</p>
        </Card>
      )}
    </>
  )
}

/* ------------------------------ plan one day ------------------------------ */

/** Pick what to put on one day: tap an item to book it at the chosen time, or the best free time. */
function PlanDay({ date, onFillWeek }: { date: string; onFillWeek: () => void }) {
  // Subscribed so the list refreshes after each placement.
  const blocks = useStore((s) => s.blocks)
  const habits = useStore((s) => s.habits)
  const projects: Project[] = useStore((s) => s.projects)
  const tasks: Task[] = useStore((s) => s.tasks)
  const showToast = useStore((s) => s.showToast)
  const [time, setTime] = useState('')
  const items = useMemo(() => unplannedFor(date), [date, blocks, habits, projects, tasks]) // eslint-disable-line react-hooks/exhaustive-deps
  const dayCount = blocks.filter((b) => b.date === date).length

  const add = (item: PlanItem) => {
    const prefer = time ? timeToMinutes(time) : undefined
    const r = placeItem(item, date, prefer)
    if ('error' in r) { showToast(r.error); return }
    showToast(prefer !== undefined && r.time !== time ? `${time} is taken · placed at ${r.time}` : `Placed at ${r.time}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="glass p-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Start time</div>
          <div className="text-3 text-[11px]">{time ? 'Next item goes here, or the closest free time.' : 'Empty = best free time: after work, around your events.'}</div>
        </div>
        <div className="flex items-center gap-1">
          <input type="time" className="field !w-auto !py-1" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Preferred start time" />
          {time && <button className="btn btn-sm btn-ghost text-3" onClick={() => setTime('')}>Auto</button>}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-2 text-sm text-center py-4">🎉 Everything is planned: habits, goal sessions and to-dos.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((c) => {
            const l = itemLook(c)
            const sub = c.kind === 'habit'
              ? `${c.remaining} left this ${c.scope} · ${c.habit.duration_min} min`
              : c.kind === 'project'
                ? `Goal · ${fmtHours(c.remainingH)} to plan · ${dueLabel(c.project.due_date)}`
                : `To-do · ${c.task.duration_min} min${c.task.due_date ? ` · Due ${taskDueLabel(c.task.due_date)}` : ''}`
            return (
              <button key={c.id} onClick={() => add(c)} className="glass press flex items-center gap-3 p-3 text-left" style={{ borderLeft: `4px solid ${l.color}` }}>
                <div className="grow min-w-0">
                  <div className="font-semibold text-sm truncate">{l.icon} {l.name}</div>
                  <div className="text-3 text-xs truncate">{sub}</div>
                </div>
                <Plus size={18} className="text-2 shrink-0" />
              </button>
            )
          })}
        </div>
      )}

      <div className="text-3 text-xs text-center">{plural(dayCount, 'item')} on this day</div>
      {items.length > 0 && <button className="btn" onClick={onFillWeek}><Wand2 size={16} /> Auto-fill this week</button>}
    </div>
  )
}

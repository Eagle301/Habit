import type { CalendarEvent, Habit, Project, ScheduledBlock, Task } from './types'
import { useStore } from '../store/useStore'
import { addDays, endOfMonth, format, minutesToTime, startOfMonth, timeToMinutes, todayKey, weekDays, weekStart, ymd } from './dates'
import { PROJECT_ICON, nextSessionMin, projectProgress, sessionsLeft, sortProjects, type BlockLook } from './projects'
import { TASK_COLOR, TASK_ICON, sortTasks, taskBlock } from './tasks'

/* ------------------------------ what needs planning ------------------------------ */

/** Something that still needs time on the calendar. */
export type PlanItem =
  | { id: string; kind: 'habit'; habit: Habit; remaining: number; scope: 'week' | 'month' }
  | { id: string; kind: 'project'; project: Project; remainingH: number; sessions: number; sessionMin: number }
  | { id: string; kind: 'task'; task: Task }

export const itemLook = (c: PlanItem): BlockLook =>
  c.kind === 'habit'
    ? { icon: c.habit.icon, name: c.habit.name, color: c.habit.color, kind: 'habit' }
    : c.kind === 'project'
      ? { icon: PROJECT_ICON, name: c.project.title, color: c.project.color, kind: 'project' }
      : { icon: TASK_ICON, name: c.task.title, color: TASK_COLOR, kind: 'task' }

export const itemSessions = (c: PlanItem) => (c.kind === 'habit' ? c.remaining : c.kind === 'project' ? c.sessions : 1)

const itemOwns = (c: PlanItem, b: ScheduledBlock) =>
  c.kind === 'habit' ? b.habit_id === c.habit.id : c.kind === 'project' ? b.project_id === c.project.id : b.task_id === c.task.id

const itemMinutes = (c: PlanItem) => (c.kind === 'habit' ? c.habit.duration_min : c.kind === 'project' ? c.sessionMin : c.task.duration_min)
const itemDue = (c: PlanItem) => (c.kind === 'project' ? c.project.due_date : c.kind === 'task' ? c.task.due_date : null)

/**
 * What is still unplanned for the week containing `date`: weekly/monthly habits under target,
 * goals with hours left to book, and open to-dos without a block.
 */
export function unplannedFor(date: string): PlanItem[] {
  const { habits, projects, tasks, blocks } = useStore.getState()
  const weekKeys = new Set(weekDays(weekStart(new Date(date + 'T00:00:00'))).map(ymd))
  const items: PlanItem[] = []
  for (const h of habits) {
    if (h.archived) continue
    if (h.frequency === 'weekly') {
      const n = blocks.filter((b) => b.habit_id === h.id && weekKeys.has(b.date)).length
      if (h.target_count - n > 0) items.push({ id: `q-${h.id}`, kind: 'habit', habit: h, remaining: h.target_count - n, scope: 'week' })
    } else if (h.frequency === 'monthly') {
      const d = new Date(date + 'T00:00:00')
      const mStart = ymd(startOfMonth(d)), mEnd = ymd(endOfMonth(d))
      const n = blocks.filter((b) => b.habit_id === h.id && b.date >= mStart && b.date <= mEnd).length
      if (h.target_count - n > 0) items.push({ id: `q-${h.id}`, kind: 'habit', habit: h, remaining: h.target_count - n, scope: 'month' })
    }
  }
  for (const p of sortProjects(projects)) {
    if (p.done || p.hours_est <= 0) continue
    const pr = projectProgress(p, blocks)
    if (pr.remainingH <= 0) continue
    items.push({ id: `p-${p.id}`, kind: 'project', project: p, remainingH: pr.remainingH, sessions: sessionsLeft(p, pr), sessionMin: nextSessionMin(p, pr) })
  }
  for (const t of sortTasks(tasks)) {
    if (t.done || taskBlock(blocks, t.id)) continue
    items.push({ id: `t-${t.id}`, kind: 'task', task: t })
  }
  return items
}

/* ------------------------------ what is already on a day ------------------------------ */

/** Google events per day (all-day events on every day they cover), excluding mirrors of our own blocks. */
export function eventsByDay(events: CalendarEvent[], blocks: ScheduledBlock[]) {
  const m = new Map<string, CalendarEvent[]>()
  const blockIds = new Set(blocks.map((b) => b.id))
  const push = (k: string, e: CalendarEvent) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(e) }
  for (const e of events) {
    if (e.habitBlockId && blockIds.has(e.habitBlockId)) continue
    if (e.allDay) {
      // Google's all-day end date is exclusive.
      const end = new Date(e.end)
      for (let d = new Date(e.start); d < end; d = addDays(d, 1)) push(ymd(d), e)
      if (new Date(e.start) >= end) push(ymd(new Date(e.start)), e)
    } else {
      // Timed events that run past midnight show on every day they touch.
      const end = new Date(e.end)
      for (let d = new Date(new Date(e.start).toDateString()); d < end; d = addDays(d, 1)) push(ymd(d), e)
    }
  }
  return m
}

/** A habit's preferred days (0 = Monday … 6 = Sunday); empty = any day. */
export const preferredDays = (h: Habit) => h.preferred_days ?? []
/** True when `date` is one of the habit's preferred days, or it has none. */
export const prefersDay = (h: Habit, date: string) => {
  const days = preferredDays(h)
  return !days.length || days.includes((new Date(date + 'T00:00:00').getDay() + 6) % 7)
}

/** Daily habits with a preferred time (on a preferred day) and no block on `date`: they still occupy that time. */
export function dailyHabitSlots(date: string, habits: Habit[], blocks: ScheduledBlock[]) {
  const blocked = new Set(blocks.filter((b) => b.date === date).map((b) => b.habit_id))
  return habits
    .filter((h) => !h.archived && h.frequency === 'daily' && h.default_time && prefersDay(h, date) && h.created_at.slice(0, 10) <= date && !blocked.has(h.id))
    .map((h) => ({ habit: h, start: timeToMinutes(h.default_time!), end: timeToMinutes(h.default_time!) + h.duration_min }))
}

/** Work-hours interval (minutes from midnight) on a date, or null when the day is free. */
export function workOn(date: string): [number, number] | null {
  const { workHours } = useStore.getState()
  if (!workHours.enabled) return null
  const dow = (new Date(date + 'T00:00:00').getDay() + 6) % 7 // 0 = Monday
  if (!workHours.days.includes(dow)) return null
  const s = timeToMinutes(workHours.start), e = timeToMinutes(workHours.end)
  return e > s ? [s, e] : null
}

/**
 * The day's work as it actually falls: the usual length (e.g. 8 h) from the usual start, stepping
 * around anything you planned inside the usual hours, so the time is made up at the end.
 * Gym 12:00–13:00 on an 08:00–16:00 day gives 08:00–12:00 and 13:00–17:00. Planned blocks and timed
 * daily habits move work; Google events don't (meetings are part of the work day).
 */
export function workSegments(date: string, ignoreBlockId?: string): [number, number][] {
  const w = workOn(date)
  if (!w) return []
  const { blocks, habits } = useStore.getState()
  const breaks = [
    ...blocks.filter((b) => b.date === date && b.id !== ignoreBlockId).map((b) => { const s = timeToMinutes(b.start_time); return [s, s + b.duration_min] as [number, number] }),
    ...dailyHabitSlots(date, habits, blocks).map((x) => [x.start, x.end] as [number, number]),
  ].filter(([s, e]) => s < w[1] && e > w[0]).sort((a, b) => a[0] - b[0])
  const segments: [number, number][] = []
  let cursor = w[0]
  let left = w[1] - w[0]
  for (const [s, e] of breaks) {
    if (e <= cursor) continue
    if (s > cursor) { segments.push([cursor, s]); left -= s - cursor }
    cursor = Math.max(cursor, e)
  }
  if (left > 0) segments.push([cursor, Math.min(24 * 60, cursor + left)])
  return segments
}

/** Minutes from midnight of a time on `date` (clamped to the day). */
const minuteOfDay = (t: Date, date: string) => {
  const k = ymd(t)
  if (k < date) return 0
  if (k > date) return 24 * 60
  return t.getHours() * 60 + t.getMinutes()
}

/** Busy intervals (minutes from midnight) on a date: timed events, planned blocks and timed daily habits. */
export function busyOn(date: string, ignoreBlockId?: string): [number, number][] {
  const { blocks, events, habits } = useStore.getState()
  const evts = (eventsByDay(events, blocks).get(date) ?? []).filter((e) => !e.allDay)
  return [
    ...evts.map((e) => [minuteOfDay(new Date(e.start), date), minuteOfDay(new Date(e.end), date)] as [number, number]),
    ...blocks.filter((b) => b.date === date && b.id !== ignoreBlockId).map((b) => { const s = timeToMinutes(b.start_time); return [s, s + b.duration_min] as [number, number] }),
    ...dailyHabitSlots(date, habits, blocks).map((x) => [x.start, x.end] as [number, number]),
  ].sort((a, b) => a[0] - b[0])
}

/* ------------------------------ choosing a time ------------------------------ */

/** Auto-planning only uses this part of the day. */
export const PLAN_DAY = { start: 7 * 60, end: 22 * 60 }
/** Start times snap to this grid (minutes). */
const STEP = 15
/** Kept free between a planned item and anything around it (minutes). */
const BUFFER = 10

/**
 * The time a session would ideally start on a date when nothing else is asked for: half an hour
 * after work ends (as shifted by anything planned during it) on work days, 10:00 on free days.
 */
const naturalStart = (date: string, ignoreBlockId?: string) => {
  const segs = workSegments(date, ignoreBlockId)
  return segs.length ? segs[segs.length - 1][1] + 30 : 10 * 60
}

/**
 * Best start time (minutes) on a date for something lasting `durationMin`, or null when it doesn't
 * fit. Candidates are 15-minute steps inside 07:00–22:00 that clear every event, block and timed
 * habit by BUFFER minutes, are not in the past, and stay out of work (as shifted by workSegments). The one closest to the
 * target wins: the requested time, else the habit's own time, else the natural time of day.
 * A requested or habit time may fall inside work hours (gym at 12:00): work then moves later to make up for it.
 */
export function findFreeSlot(date: string, durationMin: number, preferMin?: number, defaultTime?: string | null, ignoreBlockId?: string): number | null {
  const busy = busyOn(date, ignoreBlockId)
  const work = workSegments(date, ignoreBlockId)
  const own = defaultTime ? timeToMinutes(defaultTime) : undefined
  const target = preferMin ?? own ?? naturalStart(date, ignoreBlockId)
  const now = new Date()
  const earliest = date === todayKey() ? Math.ceil((now.getHours() * 60 + now.getMinutes() + 5) / STEP) * STEP : 0
  const clear = (s: number) => !busy.some(([bs, be]) => s < be + BUFFER && s + durationMin > bs - BUFFER)
  const allowedInWork = (s: number) => s === preferMin || s === own
  const inWork = (s: number) => work.some(([ws, we]) => s < we && s + durationMin > ws)

  const candidates = new Set<number>()
  for (let s = PLAN_DAY.start; s + durationMin <= PLAN_DAY.end; s += STEP) candidates.add(s)
  if (preferMin !== undefined) candidates.add(preferMin)
  if (own !== undefined) candidates.add(own)

  let best: number | null = null
  let bestScore = Infinity
  for (const s of candidates) {
    if (s < earliest || s + durationMin > 24 * 60 || !clear(s)) continue
    if (inWork(s) && !allowedInWork(s)) continue
    // Distance from the target, with a nudge away from very early or very late starts.
    const score = Math.abs(s - target) + (s < 8 * 60 ? 30 : 0) + (s + durationMin > 21 * 60 ? 30 : 0)
    if (score < bestScore || (score === bestScore && best !== null && s < best)) { best = s; bestScore = score }
  }
  return best
}

/** Book one session of an item on a date. Returns the start time, or an error message. */
export function placeItem(item: PlanItem, date: string, preferMin?: number): { time: string } | { error: string } {
  const s = useStore.getState()
  const due = itemDue(item)
  // Not after the due date, except an already-overdue to-do, which can go on any day to catch up.
  const overdueTask = item.kind === 'task' && !!due && due < todayKey()
  if (due && date > due && !overdueTask) {
    const title = item.kind === 'project' ? item.project.title : item.kind === 'task' ? item.task.title : ''
    return { error: `“${title}” is due ${format(new Date(due + 'T00:00:00'), 'MMM d')}` }
  }
  const slot = findFreeSlot(date, itemMinutes(item), preferMin, item.kind === 'habit' ? item.habit.default_time : null)
  if (slot === null) return { error: 'No free time that day' }
  const time = minutesToTime(slot)
  if (item.kind === 'habit') s.scheduleBlock(item.habit.id, date, time)
  else if (item.kind === 'project') s.scheduleProjectBlock(item.project.id, date, time, item.sessionMin)
  else s.scheduleTaskBlock(item.task.id, date, time)
  return { time }
}

/* ------------------------------ filling a week ------------------------------ */

/**
 * How many sessions of an item belong in the week starting `monday`. Weekly habits: all that are
 * left. Monthly habits and goals: what is left, shared evenly over the weeks until the month ends
 * or the goal is due, so a 6-hour goal due in three weeks gets 2 sessions this week.
 */
function sessionsThisWeek(item: PlanItem, monday: Date): number {
  const left = itemSessions(item)
  const weeksUntil = (end: Date) => Math.max(1, Math.ceil((end.getTime() - monday.getTime() + 1) / (7 * 86400000)))
  if (item.kind === 'habit' && item.scope === 'month') return Math.ceil(left / weeksUntil(endOfMonth(addDays(monday, 6))))
  if (item.kind === 'project') return item.project.due_date ? Math.ceil(left / weeksUntil(new Date(item.project.due_date + 'T23:59:59'))) : Math.min(left, 3)
  return left
}

/**
 * Planning order: habits with a fixed time first (they can move work, which changes what is free
 * after it), then anything with a due date (soonest first), then other habits, then undated goals.
 */
const priority = (c: PlanItem) => {
  if (c.kind === 'habit' && c.habit.default_time) return '0'
  const due = itemDue(c)
  return due ? `1${due}` : c.kind === 'habit' ? '2' : '3'
}

export interface FillResult {
  placed: number
  /** Items that could not get all the sessions they needed this week. */
  short: string[]
}

/**
 * Plans the week starting `monday`, Monday to Sunday. Each item's sessions are spread evenly over
 * the days it may use (today or later, not after its due date), at most one per day, preferring the
 * lighter day over a busier one nearby (events, blocks and timed habits all count). Times come from findFreeSlot. Undated to-dos are
 * left for manual planning.
 */
export function autoFillWeek(monday: Date): FillResult {
  const keys = weekDays(monday).map(ymd)
  const today = todayKey()
  // How full a day already is: events, planned blocks and timed habits inside the planning hours.
  const minutesOn = (k: string) => busyOn(k).reduce((a, [s, e]) => a + Math.max(0, Math.min(e, PLAN_DAY.end) - Math.max(s, PLAN_DAY.start)), 0)
  const result: FillResult = { placed: 0, short: [] }

  const items = unplannedFor(keys[0]).filter((c) => !(c.kind === 'task' && !c.task.due_date)).sort((a, b) => priority(a).localeCompare(priority(b)))
  for (const item of items) {
    const due = itemDue(item)
    const overdue = !!due && due < today
    const days = keys.filter((k) => k >= today && (!due || overdue || k <= due))
    const used = new Set(useStore.getState().blocks.filter((b) => keys.includes(b.date) && itemOwns(item, b)).map((b) => b.date))
    const free = days.filter((k) => !used.has(k))
    const want = Math.min(sessionsThisWeek(item, monday), free.length)
    // A habit's preferred days come first; sessions are spaced over those, and only spill onto
    // other days when there are more sessions than free preferred days.
    const preferred = item.kind === 'habit' ? free.filter((k) => prefersDay(item.habit, k)) : free
    const pool = preferred.length ? preferred : free
    const spread = Math.min(want, pool.length)
    let placed = 0
    for (let i = 0; i < want; i++) {
      // Ideal position of session i when the sessions share the pool evenly. Each day away from it
      // costs as much as 40 busy minutes, so a lighter day nearby wins over a full one.
      const ideal = ((Math.min(i, spread - 1) + 0.5) * pool.length) / spread - 0.5
      const order = free
        .map((k) => { const at = pool.indexOf(k); return { k, score: (at < 0 ? 100_000 : Math.abs(at - ideal) * 60) + minutesOn(k) * 1.5 } })
        .filter(({ k }) => !used.has(k))
        .sort((a, b) => a.score - b.score)
      for (const { k } of order) {
        if ('error' in placeItem(item, k)) continue
        used.add(k); placed++; break
      }
    }
    result.placed += placed
    if (placed < sessionsThisWeek(item, monday)) result.short.push(itemLook(item).name)
  }
  return result
}

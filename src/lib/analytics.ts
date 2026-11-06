import type { Habit, HabitLog } from './types'
import { addDays, fromKey, subDays, ymd, weekStart, weekEnd, startOfMonth, endOfMonth } from './dates'

export type LogIndex = Map<string, Map<string, HabitLog>> // date -> habitId -> log

export const indexLogs = (logs: HabitLog[]): LogIndex => {
  const idx: LogIndex = new Map()
  for (const l of logs) {
    if (!l.completed) continue
    let m = idx.get(l.date)
    if (!m) { m = new Map(); idx.set(l.date, m) }
    m.set(l.habit_id, l)
  }
  return idx
}

export const isDone = (idx: LogIndex, date: string, habitId: string) => !!idx.get(date)?.get(habitId)

/** Habits that existed (and weren't archived) on a date. */
export const activeHabitsOn = (habits: Habit[], date: string) =>
  habits.filter((h) => !h.archived && h.created_at.slice(0, 10) <= date)

/** Count of completions for a weekly/monthly habit within its current period containing `date`. */
export const periodCompletions = (idx: LogIndex, habit: Habit, date: string) => {
  const d = fromKey(date)
  const [start, end] =
    habit.frequency === 'weekly' ? [weekStart(d), weekEnd(d)] : [startOfMonth(d), endOfMonth(d)]
  let n = 0
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) if (isDone(idx, ymd(cur), habit.id)) n++
  return n
}

/**
 * Daily success rate 0..1 for a date. Every daily habit counts; a weekly/monthly habit counts on the
 * days it was completed.
 */
export const dayRate = (habits: Habit[], idx: LogIndex, date: string): number | null => {
  const active = activeHabitsOn(habits, date)
  const daily = active.filter((h) => h.frequency === 'daily')
  const doneDaily = daily.filter((h) => isDone(idx, date, h.id)).length
  const otherDone = active.filter((h) => h.frequency !== 'daily' && isDone(idx, date, h.id)).length
  const total = daily.length + otherDone
  if (total === 0) return active.length === 0 ? null : 0
  return (doneDaily + otherDone) / total
}

/** Streak freezes: missed days per calendar week (Mon–Sun) that don't break a daily streak. */
export const MAX_FREEZES_PER_WEEK = 1

export interface StreakInfo {
  /** Days (or weeks/months) completed in the current run. Frozen days don't add to it. */
  streak: number
  /** Missed days inside the run that were covered by a freeze (most recent first). */
  frozen: string[]
  /** Freezes used in the current calendar week (Mon–Sun). */
  freezesThisWeek: number
}

/**
 * Walks back from today counting completed days. A missed day is "frozen" (the streak survives
 * but doesn't grow) while its week still has a freeze left; once a week has used
 * MAX_FREEZES_PER_WEEK, its next miss ends the run. Today only counts once it is done.
 */
const dailyRun = (done: (key: string) => boolean, since: string): StreakInfo => {
  let d = new Date()
  if (!done(ymd(d))) d = subDays(d, 1)
  let streak = 0
  let lastWasMiss = false
  const frozen: string[] = []
  const perWeek = new Map<string, number>()
  for (let guard = 0; guard < 3660; guard++, d = subDays(d, 1)) {
    const k = ymd(d)
    if (k < since) break
    if (done(k)) { streak++; lastWasMiss = false; continue }
    const wk = ymd(weekStart(d))
    if ((perWeek.get(wk) ?? 0) >= MAX_FREEZES_PER_WEEK) break
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1)
    frozen.push(k)
    lastWasMiss = true
  }
  // The run ended right after a miss: that miss is the edge of the run, so no freeze was spent on it.
  if (lastWasMiss) frozen.pop()
  if (streak === 0) frozen.length = 0
  const thisWeek = ymd(weekStart(new Date()))
  return { streak, frozen, freezesThisWeek: frozen.filter((k) => k >= thisWeek).length }
}

/** Current streak with freeze details. Weekly/monthly habits count whole periods and have no freezes. */
export const habitStreakInfo = (idx: LogIndex, habit: Habit): StreakInfo => {
  if (habit.frequency === 'daily') return dailyRun((k) => isDone(idx, k, habit.id), habit.created_at.slice(0, 10))
  // weekly/monthly: count consecutive periods where target was met
  const stepBack = (d: Date) => (habit.frequency === 'weekly' ? subDays(weekStart(d), 1) : subDays(startOfMonth(d), 1))
  let d = new Date()
  let streak = 0
  if (periodCompletions(idx, habit, ymd(d)) < habit.target_count) d = stepBack(d)
  while (periodCompletions(idx, habit, ymd(d)) >= habit.target_count) { streak++; d = stepBack(d) }
  return { streak, frozen: [], freezesThisWeek: 0 }
}

/** Current streak (with freezes) for a habit. */
export const habitStreak = (idx: LogIndex, habit: Habit): number => habitStreakInfo(idx, habit).streak

/** "Perfect day" streak (with freezes): days with every daily habit completed. */
export const perfectDayInfo = (habits: Habit[], idx: LogIndex): StreakInfo => {
  const since = habits.filter((h) => !h.archived).map((h) => h.created_at.slice(0, 10)).sort()[0]
  if (!since) return { streak: 0, frozen: [], freezesThisWeek: 0 }
  return dailyRun((k) => (dayRate(habits, idx, k) ?? 0) >= 1, since)
}
export const perfectDayStreak = (habits: Habit[], idx: LogIndex): number => perfectDayInfo(habits, idx).streak

export const monthCompletionRate = (habits: Habit[], idx: LogIndex, days: Date[]): number => {
  const today = ymd(new Date())
  const rates = days.map((d) => ymd(d)).filter((k) => k <= today).map((k) => dayRate(habits, idx, k)).filter((r): r is number => r !== null)
  if (!rates.length) return 0
  return rates.reduce((a, b) => a + b, 0) / rates.length
}

export const rateColor = (rate: number | null) => {
  if (rate === null) return 'transparent'
  if (rate >= 1) return '#22c55e'
  if (rate >= 0.75) return '#84cc16'
  if (rate >= 0.5) return '#eab308'
  if (rate > 0) return '#f97316'
  return '#ef4444'
}


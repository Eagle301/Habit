import type { Habit, HabitLog, Reflection } from './types'
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

/** Habits considered "due" on a date: daily always; weekly/monthly only if they have a schedule/log that day or are still under target. */
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
 * days it was completed. Completing extra habits therefore never pushes a day past what was actually done.
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

/** Current streak (consecutive days ending today or yesterday) for a habit. */
export const habitStreak = (idx: LogIndex, habit: Habit): number => {
  let cur = new Date()
  let streak = 0
  if (habit.frequency === 'daily') {
    if (!isDone(idx, ymd(cur), habit.id)) cur = subDays(cur, 1)
    while (isDone(idx, ymd(cur), habit.id)) { streak++; cur = subDays(cur, 1) }
    return streak
  }
  // weekly/monthly: count consecutive periods where target was met
  const stepBack = (d: Date) => (habit.frequency === 'weekly' ? subDays(weekStart(d), 1) : subDays(startOfMonth(d), 1))
  let d = cur
  if (periodCompletions(idx, habit, ymd(d)) < habit.target_count) d = stepBack(d)
  while (periodCompletions(idx, habit, ymd(d)) >= habit.target_count) { streak++; d = stepBack(d) }
  return streak
}

/** "Perfect day" streak: consecutive days with all daily habits completed. */
export const perfectDayStreak = (habits: Habit[], idx: LogIndex): number => {
  let cur = new Date()
  let streak = 0
  const perfect = (d: Date) => (dayRate(habits, idx, ymd(d)) ?? 0) >= 1
  if (!perfect(cur)) cur = subDays(cur, 1)
  while (perfect(cur)) { streak++; cur = subDays(cur, 1) }
  return streak
}

export const monthCompletionRate = (habits: Habit[], idx: LogIndex, days: Date[]): number => {
  const today = ymd(new Date())
  const rates = days.map((d) => ymd(d)).filter((k) => k <= today).map((k) => dayRate(habits, idx, k)).filter((r): r is number => r !== null)
  if (!rates.length) return 0
  return rates.reduce((a, b) => a + b, 0) / rates.length
}

/** Pearson correlation between daily mood and daily completion rate. */
export const moodCorrelation = (habits: Habit[], idx: LogIndex, reflections: Reflection[]) => {
  const pairs = reflections
    .map((r) => [r.score, dayRate(habits, idx, r.date)] as const)
    .filter((p): p is readonly [number, number] => p[1] !== null)
  if (pairs.length < 3) return { r: null as number | null, n: pairs.length, avgMoodGood: null as number | null, avgMoodBad: null as number | null }
  const mx = pairs.reduce((a, p) => a + p[0], 0) / pairs.length
  const my = pairs.reduce((a, p) => a + p[1], 0) / pairs.length
  let num = 0, dx = 0, dy = 0
  for (const [x, y] of pairs) { num += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2 }
  const r = dx && dy ? num / Math.sqrt(dx * dy) : 0
  const good = pairs.filter((p) => p[1] >= 0.75).map((p) => p[0])
  const bad = pairs.filter((p) => p[1] < 0.5).map((p) => p[0])
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  return { r, n: pairs.length, avgMoodGood: avg(good), avgMoodBad: avg(bad) }
}

export const rateColor = (rate: number | null) => {
  if (rate === null) return 'transparent'
  if (rate >= 1) return '#22c55e'
  if (rate >= 0.75) return '#84cc16'
  if (rate >= 0.5) return '#eab308'
  if (rate > 0) return '#f97316'
  return '#ef4444'
}

export const MOODS = [
  { score: 1, emoji: '😞', label: 'Very bad' },
  { score: 2, emoji: '😕', label: 'Bad' },
  { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '🙂', label: 'Good' },
  { score: 5, emoji: '🤩', label: 'Great' },
]

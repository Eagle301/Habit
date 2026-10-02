import { differenceInCalendarDays } from 'date-fns'
import type { Difficulty, Habit, Project, ScheduledBlock, Task } from './types'
import { fromKey, todayKey } from './dates'
import { TASK_COLOR, TASK_ICON } from './tasks'

/** Difficulty → total hours of study, booked as one-hour sessions. */
export const DIFFICULTY: Record<Difficulty, { label: string; hours: number }> = {
  easy: { label: 'Easy', hours: 2 },
  medium: { label: 'Medium', hours: 4 },
  hard: { label: 'Hard', hours: 6 },
}
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
/** Every study session is one hour. */
export const SESSION_MIN = 60
export const PROJECT_ICON = '🎓'
export const PROJECT_COLORS = ['#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#f97316', '#eab308', '#22c55e', '#14b8a6']

export const projectBlocks = (blocks: ScheduledBlock[], projectId: string) => blocks.filter((b) => b.project_id === projectId)

export interface ProjectProgress {
  /** Hours planned (done or not). */
  scheduledH: number
  /** Hours of sessions ticked off. */
  doneH: number
  /** Hours still to be put on the calendar. */
  remainingH: number
  /** 0..1 of estimated hours completed. */
  pct: number
}

export const projectProgress = (p: Project, blocks: ScheduledBlock[]): ProjectProgress => {
  const mine = projectBlocks(blocks, p.id)
  const scheduledH = mine.reduce((a, b) => a + b.duration_min, 0) / 60
  const doneH = mine.filter((b) => b.done).reduce((a, b) => a + b.duration_min, 0) / 60
  const remainingH = Math.max(0, p.hours_est - scheduledH)
  const pct = p.done ? 1 : p.hours_est > 0 ? Math.min(1, doneH / p.hours_est) : 0
  return { scheduledH, doneH, remainingH, pct }
}

/** Whole days until the due date (negative = overdue), or null without a due date. */
export const daysUntil = (due: string | null, from = todayKey()): number | null =>
  due ? differenceInCalendarDays(fromKey(due), fromKey(from)) : null

export const dueLabel = (due: string | null): string => {
  const d = daysUntil(due)
  if (d === null) return 'No due date'
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue`
  if (d === 0) return 'Due today'
  if (d === 1) return 'Due tomorrow'
  return `Due in ${d} days`
}

export const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1).replace(/\.0$/, '')} h`

/** Sessions still needed to cover the remaining hours. */
export const sessionsLeft = (p: Project, prog: ProjectProgress) => Math.ceil((prog.remainingH * 60) / Math.max(15, p.session_min))

/** Length of the next session: the configured length, or whatever is left if that is shorter (min 30). */
export const nextSessionMin = (p: Project, prog: ProjectProgress) => {
  const leftMin = Math.round(prog.remainingH * 60)
  return Math.max(30, Math.min(p.session_min, Math.ceil(leftMin / 15) * 15))
}

/** How a block is displayed, resolved from its habit, project or task. */
export interface BlockLook { icon: string; name: string; color: string; kind: 'habit' | 'project' | 'task' }

export const blockLook = (b: ScheduledBlock, habits: Habit[], projects: Project[], tasks: Task[] = []): BlockLook | null => {
  if (b.task_id) {
    const t = tasks.find((x) => x.id === b.task_id)
    return t ? { icon: TASK_ICON, name: t.title, color: TASK_COLOR, kind: 'task' } : null
  }
  if (b.project_id) {
    const p = projects.find((x) => x.id === b.project_id)
    return p ? { icon: PROJECT_ICON, name: p.title, color: p.color, kind: 'project' } : null
  }
  const h = habits.find((x) => x.id === b.habit_id)
  return h ? { icon: h.icon, name: h.name, color: h.color, kind: 'habit' } : null
}

/** Open projects sorted by due date (soonest first, undated last). */
export const sortProjects = (projects: Project[]) =>
  [...projects].sort((a, b) => Number(a.done) - Number(b.done) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.sort_order - b.sort_order)

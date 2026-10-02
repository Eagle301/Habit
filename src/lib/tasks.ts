import { differenceInCalendarDays } from 'date-fns'
import type { ScheduledBlock, Task } from './types'
import { format, fromKey, todayKey } from './dates'

export const TASK_ICON = '☑️'
export const TASK_COLOR = '#14b8a6'
/** Time choices when a task is placed in the Planner. */
export const TASK_DURATIONS = [15, 30, 60] as const
export const DEFAULT_TASK_MIN = 30

export const taskBlock = (blocks: ScheduledBlock[], taskId: string) => blocks.find((b) => b.task_id === taskId)

/** Short due label: "Overdue", "Today", "Tomorrow", "Fri", or "Oct 12". */
export const taskDueLabel = (due: string | null): string | null => {
  if (!due) return null
  const d = differenceInCalendarDays(fromKey(due), fromKey(todayKey()))
  if (d < 0) return 'Overdue'
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d < 7) return format(fromKey(due), 'EEE')
  return format(fromKey(due), 'MMM d')
}

/** Open tasks first (soonest due, undated last), then done ones (most recent first). */
export const sortTasks = (tasks: Task[]) =>
  [...tasks].sort((a, b) =>
    Number(a.done) - Number(b.done)
    || (a.done ? (b.done_at ?? '').localeCompare(a.done_at ?? '') : 0)
    || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
    || a.sort_order - b.sort_order)

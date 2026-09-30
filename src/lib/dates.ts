import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay,
  parseISO, startOfMonth, startOfWeek, subDays,
} from 'date-fns'

export const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
export const todayKey = () => ymd(new Date())
export const fromKey = (k: string) => parseISO(k)
export const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })
export const weekEnd = (d: Date) => endOfWeek(d, { weekStartsOn: 1 })
export const weekDays = (d: Date) => eachDayOfInterval({ start: weekStart(d), end: weekEnd(d) })
export const monthDays = (d: Date) => eachDayOfInterval({ start: startOfMonth(d), end: endOfMonth(d) })
export const monthKey = (d: Date) => format(d, 'yyyy-MM')
export const isSunday = (d: Date = new Date()) => d.getDay() === 0
export { addDays, addMonths, subDays, isSameDay, format, startOfMonth, endOfMonth }

export const hhmm = (d: Date) => format(d, 'HH:mm')
export const timeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}
export const minutesToTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return format(d, 'h:mm a')
}

export const combine = (date: string, time: string) => {
  const d = fromKey(date)
  const [h, m] = time.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

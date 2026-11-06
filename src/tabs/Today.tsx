import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Flame, Plus } from 'lucide-react'
import { useStore, useActiveHabits } from '../store/useStore'
import type { Habit } from '../lib/types'
import { todayKey, format, fmtTime, fromKey, addDays, subDays, ymd } from '../lib/dates'
import { indexLogs, isDone, habitStreak, periodCompletions, dayRate, rateColor, activeHabitsOn } from '../lib/analytics'
import { ProgressRing } from '../components/ui/ProgressRing'
import { Sheet } from '../components/ui/Sheet'
import { Card, CheckCircle, Empty, Header, SectionTitle } from '../components/ui/Bits'
import { HabitEditor } from '../components/HabitEditor'
import { Todos } from '../components/Todos'

const STRIP_DAYS = 21
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

export function Today() {
  const allHabits = useActiveHabits()
  const logs = useStore((s) => s.logs)
  const blocks = useStore((s) => s.blocks)
  const toggleHabit = useStore((s) => s.toggleHabit)

  const user = useStore((s) => s.user)
  const todayK = todayKey()
  const [date, setDate] = useState(todayK)
  const isToday = date === todayK
  const dateObj = fromKey(date)
  const [subFor, setSubFor] = useState<Habit | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const idx = useMemo(() => indexLogs(logs), [logs])
  // Only habits that existed on the selected day.
  const habits = useMemo(() => activeHabitsOn(allHabits, date), [allHabits, date])
  const dayBlocks = useMemo(() => blocks.filter((b) => b.date === date), [blocks, date])
  const blockHabitIds = new Set(dayBlocks.map((b) => b.habit_id))

  const scheduled = habits.filter((h) => h.frequency === 'daily' || blockHabitIds.has(h.id))
  const flexible = habits.filter((h) => h.frequency !== 'daily' && !blockHabitIds.has(h.id))
  // Every habit listed counts towards the ring. A flexible habit whose weekly/monthly target is
  // already met (and wasn't done that day) is left out so it doesn't drag the day down.
  const counted = [
    ...scheduled,
    ...flexible.filter((h) => isDone(idx, date, h.id) || periodCompletions(idx, h, date) < h.target_count),
  ]
  const doneCount = counted.filter((h) => isDone(idx, date, h.id)).length
  const progress = counted.length ? doneCount / counted.length : 0

  const onTap = (h: Habit) => {
    if (h.sub_habits.length && !isDone(idx, date, h.id)) setSubFor(h)
    else toggleHabit(h.id, date)
  }

  return (
    <div>
      <Header
        subtitle={isToday && user?.name ? `${greeting()}, ${user.name.split(' ')[0]} · ${format(dateObj, 'EEE, MMM d')}` : format(dateObj, 'EEEE, MMM d')}
        title={isToday ? 'Today' : format(dateObj, 'MMM d')}
        right={
          isToday
            ? <button className="btn btn-sm" onClick={() => setEditorOpen(true)}><Plus size={16} /> Habit</button>
            : <button className="btn btn-sm btn-primary" onClick={() => setDate(todayK)}>Back to today</button>
        }
      />

      <DayStrip date={date} todayK={todayK} onChange={setDate} rateFor={(k) => dayRate(allHabits, idx, k)} />

      <Card className="flex items-center gap-4 mt-2">
        <ProgressRing value={progress} size={112}>
          <div className="text-2xl font-bold">{Math.round(progress * 100)}%</div>
          <div className="text-3 text-[11px]">complete</div>
        </ProgressRing>
        <div className="grow">
          <div className="text-lg font-semibold">
            {progress >= 1 && counted.length > 0 ? 'All done! 🎉' : doneCount === 0 ? (isToday ? 'Let’s get started' : 'Nothing logged') : 'Keep it going'}
          </div>
          <div className="text-2 text-sm mt-1">{doneCount} of {counted.length} habits done</div>
          {habits.length > 0 && (
            <div className="text-3 text-xs mt-2 inline-flex items-center gap-1"><Flame size={14} className="text-orange-500" /> Best streak {Math.max(0, ...habits.map((h) => habitStreak(idx, h)))} days</div>
          )}
        </div>
      </Card>

      {!isToday && (
        <p className="text-3 text-xs px-1 mt-2">Editing a past day. Tap habits to log what you did on {format(dateObj, 'EEEE')}.</p>
      )}


      {allHabits.length === 0 && (
        <div className="mt-4">
          <Empty icon="🌱" title="No habits yet" hint="Tap “+ Habit” to create your first one." />
        </div>
      )}
      {allHabits.length > 0 && habits.length === 0 && (
        <div className="mt-4">
          <Empty icon="🕰️" title="No habits existed yet" hint="Your habits were created after this day." />
        </div>
      )}

      {scheduled.length > 0 && (
        <>
          <SectionTitle>{isToday ? 'Today’s habits' : 'Habits'}</SectionTitle>
          <div className="flex flex-col gap-2">
            {scheduled.map((h) => <HabitRow key={h.id} habit={h} done={isDone(idx, date, h.id)} sub={idx.get(date)?.get(h.id)?.sub_habit ?? null} streak={habitStreak(idx, h)} onTap={() => onTap(h)} periodInfo={h.frequency !== 'daily' ? `${periodCompletions(idx, h, date)}/${h.target_count} this ${h.frequency === 'weekly' ? 'week' : 'month'}` : undefined} />)}
          </div>
        </>
      )}

      {flexible.length > 0 && (
        <>
          <SectionTitle>{isToday ? 'Anytime this week' : 'Flexible habits'}</SectionTitle>
          <div className="flex flex-col gap-2">
            {flexible.map((h) => <HabitRow key={h.id} habit={h} done={isDone(idx, date, h.id)} sub={idx.get(date)?.get(h.id)?.sub_habit ?? null} streak={habitStreak(idx, h)} onTap={() => onTap(h)} periodInfo={`${periodCompletions(idx, h, date)}/${h.target_count} this ${h.frequency === 'weekly' ? 'week' : 'month'}`} />)}
          </div>
        </>
      )}

      {isToday && <Todos />}

      <Sheet open={!!subFor} onClose={() => setSubFor(null)} title={subFor ? `${subFor.icon} ${subFor.name}` : ''}>
        <p className="text-2 text-sm mb-3">What did you do{isToday ? '' : ` on ${format(dateObj, 'EEEE')}`}?</p>
        <div className="flex flex-col gap-2">
          {subFor?.sub_habits.map((s) => (
            <button key={s} className="btn justify-start text-[16px] py-3 press" onClick={() => { toggleHabit(subFor.id, date, s); setSubFor(null) }}>
              <span className="w-2.5 h-2.5 rounded-full mr-1" style={{ background: subFor.color }} /> {s}
            </button>
          ))}
          <button className="btn btn-ghost text-2" onClick={() => { if (subFor) toggleHabit(subFor.id, date); setSubFor(null) }}>Just mark as done</button>
        </div>
      </Sheet>

      <HabitEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  )
}

/** Horizontal strip of the last few weeks; tap a day to view/edit it. Future days are not selectable. */
function DayStrip({ date, todayK, onChange, rateFor }: { date: string; todayK: string; onChange: (k: string) => void; rateFor: (k: string) => number | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const days = useMemo(() => {
    const t = fromKey(todayK)
    return Array.from({ length: STRIP_DAYS }, (_, i) => subDays(t, STRIP_DAYS - 1 - i))
  }, [todayK])

  // Start scrolled to the end (today) without animation, then keep the selected day in view.
  const mounted = useRef(false)
  useEffect(() => {
    const box = ref.current
    if (!box) return
    if (!mounted.current) { mounted.current = true; box.scrollLeft = box.scrollWidth; return }
    const el = box.querySelector<HTMLElement>(`[data-day="${date}"]`)
    if (!el) return
    const target = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2
    box.scrollTo({ left: target, behavior: 'smooth' })
  }, [date])

  const prev = () => onChange(ymd(subDays(fromKey(date), 1)))
  const next = () => { const n = ymd(addDays(fromKey(date), 1)); if (n <= todayK) onChange(n) }

  return (
    <div className="flex items-center gap-0.5 -mx-4 px-2">
      <button className="btn btn-ghost btn-sm px-1" onClick={prev} aria-label="Previous day"><ChevronLeft size={16} /></button>
      <div ref={ref} className="flex gap-1 overflow-x-auto no-scrollbar grow py-0.5 px-0.5">
        {days.map((d) => {
          const k = ymd(d)
          const sel = k === date
          const rate = rateFor(k)
          return (
            <button
              key={k} data-day={k} onClick={() => onChange(k)}
              className="shrink-0 w-8 flex flex-col items-center rounded-xl py-1 press transition-colors"
              style={{
                background: sel ? 'linear-gradient(135deg,#6366f1,#a855f7)' : 'transparent',
                color: sel ? 'white' : 'var(--text)',
              }}
            >
              <span className="text-[9px] font-semibold uppercase leading-none" style={{ opacity: 0.7 }}>{format(d, 'EEEEE')}</span>
              <span className={`text-[13px] leading-tight ${k === todayK ? 'font-bold' : 'font-medium'}`}>{d.getDate()}</span>
              <span className="w-1 h-1 rounded-full mt-0.5" style={{ background: sel ? 'rgba(255,255,255,0.9)' : rateColor(rate) }} />
            </button>
          )
        })}
      </div>
      <button className="btn btn-ghost btn-sm px-1" onClick={next} disabled={date >= todayK} aria-label="Next day"><ChevronRight size={16} /></button>
    </div>
  )
}

function HabitRow({ habit, done, sub, streak, onTap, periodInfo }: { habit: Habit; done: boolean; sub: string | null; streak: number; onTap: () => void; periodInfo?: string }) {
  return (
    <button onClick={onTap} className="glass press w-full flex items-center gap-3 p-3 text-left" style={{ borderLeft: `4px solid ${habit.color}` }}>
      <span className="text-2xl w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${habit.color}22` }}>{habit.icon}</span>
      <div className="grow min-w-0">
        <div className={`font-semibold truncate ${done ? 'line-through text-3' : ''}`}>{habit.name}</div>
        <div className="text-3 text-xs flex items-center gap-2 flex-wrap">
          {sub && <span className="font-medium" style={{ color: habit.color }}>{sub}</span>}
          {periodInfo && <span>{periodInfo}</span>}
          {habit.sub_habits.length > 0 && !done && <span>{habit.sub_habits.length} options</span>}
          {streak > 0 && <span className="inline-flex items-center gap-0.5"><Flame size={12} className="text-orange-500" />{streak}</span>}
          {habit.default_time && habit.frequency === 'daily' && <span>{fmtTime(habit.default_time)}</span>}
        </div>
      </div>
      <CheckCircle checked={done} color={habit.color} />
    </button>
  )
}

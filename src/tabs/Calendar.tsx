import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react'
import { useStore, useActiveHabits } from '../store/useStore'
import { addMonths, format, monthDays, todayKey, ymd, startOfMonth } from '../lib/dates'
import { dayRate, habitStreak, indexLogs, isDone, monthCompletionRate, moodCorrelation, perfectDayStreak, rateColor, MOODS, activeHabitsOn } from '../lib/analytics'
import { Card, Header, SectionTitle } from '../components/ui/Bits'

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export function CalendarTab() {
  const habits = useActiveHabits()
  const allHabits = useStore((s) => s.habits)
  const logs = useStore((s) => s.logs)
  const reflections = useStore((s) => s.reflections)
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(todayKey())

  const idx = useMemo(() => indexLogs(logs), [logs])
  const days = useMemo(() => monthDays(month), [month])
  const today = todayKey()
  const leading = (days[0].getDay() + 6) % 7 // Monday-first offset

  const rates = useMemo(() => new Map(days.map((d) => [ymd(d), dayRate(habits, idx, ymd(d))])), [days, habits, idx])
  const moods = useMemo(() => new Map(reflections.map((r) => [r.date, r])), [reflections])
  const monthRate = monthCompletionRate(habits, idx, days)
  const corr = useMemo(() => moodCorrelation(habits, idx, reflections), [habits, idx, reflections])
  const perfect = perfectDayStreak(habits, idx)
  const streaks = habits.map((h) => ({ h, s: habitStreak(idx, h) })).sort((a, b) => b.s - a.s)

  // Day inspector
  const selHabits = activeHabitsOn(allHabits, selected)
  const completed = selHabits.filter((h) => isDone(idx, selected, h.id))
  const missed = selHabits.filter((h) => h.frequency === 'daily' && !isDone(idx, selected, h.id))
  const selMood = moods.get(selected)
  const selRate = dayRate(habits, idx, selected)

  return (
    <div>
      <Header subtitle="Overview" title="Calendar" />

      <Card>
        <div className="flex items-center justify-between mb-3">
          <button className="btn btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <div className="font-semibold text-[16px]">{format(month, 'MMMM yyyy')}</div>
          <button className="btn btn-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-3 mb-1">
          {DOW.map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leading }).map((_, i) => <div key={`l${i}`} />)}
          {days.map((d) => {
            const k = ymd(d)
            const rate = rates.get(k) ?? null
            const future = k > today
            const isSel = k === selected
            const color = rateColor(future ? null : rate)
            const mood = moods.get(k)
            return (
              <button
                key={k}
                onClick={() => setSelected(k)}
                className="aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 press relative"
                style={{
                  background: !future && rate !== null ? `${color}${Math.round(20 + rate * 60).toString(16).padStart(2, '0')}` : 'var(--line)',
                  outline: isSel ? '2px solid var(--color-accent)' : k === today ? '1.5px solid var(--text-3)' : 'none',
                  outlineOffset: -1,
                  opacity: future ? 0.5 : 1,
                }}
              >
                <span className={`text-[13px] ${k === today ? 'font-bold' : 'font-medium'}`}>{d.getDate()}</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: !future && rate !== null ? color : 'transparent' }} />
                {mood && <span className="absolute -top-1 -right-1 text-[10px] leading-none">{MOODS[mood.score - 1].emoji}</span>}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between mt-3 text-[11px] text-3">
          <span>Less</span>
          <div className="flex gap-1">{['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'].map((c) => <span key={c} className="w-4 h-2 rounded-sm" style={{ background: c }} />)}</div>
          <span>More</span>
        </div>
      </Card>

      <SectionTitle>{format(new Date(selected + 'T00:00:00'), 'EEEE, MMM d')}</SectionTitle>
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-2">Daily success</div>
          <div className="font-bold" style={{ color: rateColor(selRate) }}>{selRate === null ? '—' : `${Math.round(selRate * 100)}%`}</div>
        </div>
        {selMood && (
          <div className="flex items-center gap-3 mb-3 p-3 rounded-xl bg-line">
            <span className="text-3xl">{MOODS[selMood.score - 1].emoji}</span>
            <div className="min-w-0">
              <div className="font-semibold text-sm">Felt {MOODS[selMood.score - 1].label.toLowerCase()} ({selMood.score}/5)</div>
              {selMood.note && <div className="text-2 text-sm truncate">{selMood.note}</div>}
            </div>
          </div>
        )}
        {selHabits.length === 0 ? (
          <div className="text-3 text-sm">No habits existed on this day.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {completed.map((h) => {
              const log = idx.get(selected)?.get(h.id)
              return (
                <div key={h.id} className="flex items-center gap-2 text-sm">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px]" style={{ background: h.color }}>✓</span>
                  <span>{h.icon} {h.name}</span>
                  {log?.sub_habit && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${h.color}22`, color: h.color }}>{log.sub_habit}</span>}
                </div>
              )
            })}
            {missed.map((h) => (
              <div key={h.id} className="flex items-center gap-2 text-sm text-3">
                <span className="w-5 h-5 rounded-full border-2 border-current inline-block" />
                <span className="line-through">{h.icon} {h.name}</span>
                <span className="text-xs">missed</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <SectionTitle>Streaks &amp; analytics</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <div className="text-3xl font-bold inline-flex items-center gap-1"><Flame className="text-orange-500" size={26} />{perfect}</div>
          <div className="text-3 text-xs mt-1">perfect-day streak</div>
        </Card>
        <Card className="text-center">
          <div className="text-3xl font-bold">{Math.round(monthRate * 100)}%</div>
          <div className="text-3 text-xs mt-1">{format(month, 'MMM')} completion rate</div>
        </Card>
      </div>

      {streaks.length > 0 && (
        <Card className="mt-3">
          <div className="text-sm font-semibold mb-2">Active streaks</div>
          <div className="flex flex-col gap-2">
            {streaks.slice(0, 6).map(({ h, s }) => (
              <div key={h.id} className="flex items-center gap-2 text-sm">
                <span>{h.icon}</span>
                <span className="grow truncate">{h.name}</span>
                <span className="font-semibold inline-flex items-center gap-1" style={{ color: s > 0 ? h.color : 'var(--text-3)' }}>
                  <Flame size={14} />{s} {h.frequency === 'daily' ? 'd' : h.frequency === 'weekly' ? 'w' : 'mo'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-3">
        <div className="text-sm font-semibold mb-1">Mood × habits</div>
        {corr.r === null ? (
          <div className="text-3 text-sm">Log “How was today?” for a few more days ({corr.n}/3) to unlock insights.</div>
        ) : (
          <div className="text-sm text-2">
            <p>
              {Math.abs(corr.r) < 0.2 ? 'No clear link yet between finishing your habits and how you feel.' :
                corr.r > 0 ? `On days you complete your habits, you tend to feel ${corr.r > 0.5 ? 'noticeably' : 'a bit'} better.` :
                  'Interestingly, your mood is higher on days with fewer completed habits.'}
            </p>
            {corr.avgMoodGood !== null && corr.avgMoodBad !== null && (
              <p className="mt-2 flex gap-4">
                <span>Good days: <b>{corr.avgMoodGood.toFixed(1)}</b>/5</span>
                <span>Off days: <b>{corr.avgMoodBad.toFixed(1)}</b>/5</span>
              </p>
            )}
            <p className="text-3 text-xs mt-2">Correlation r = {corr.r.toFixed(2)} over {corr.n} days</p>
          </div>
        )}
      </Card>
    </div>
  )
}

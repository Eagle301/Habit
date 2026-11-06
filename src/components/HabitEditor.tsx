import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Plus, X } from 'lucide-react'
import type { Frequency, Habit } from '../lib/types'
import { useStore } from '../store/useStore'
import { Sheet } from './ui/Sheet'
import { HABIT_COLORS, HABIT_ICONS, NumberField, Segment, invalidFields } from './ui/Bits'
import { preferredDays } from '../lib/planning'

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const WEEKDAYS = [0, 1, 2, 3, 4]
const WEEKEND = [5, 6]
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x))

/** "Any day", "Every day", "Weekdays", "Weekends" or "Mo, We, Fr", plus " · 17:00" when a time is set. */
export const whenLabel = (days: number[], time: string | null) => {
  const d = !days.length ? 'Any day' : days.length === 7 ? 'Every day' : same(days, WEEKDAYS) ? 'Weekdays' : same(days, WEEKEND) ? 'Weekends' : [...days].sort().map((i) => DOW[i]).join(', ')
  return time ? `${d} · ${time}` : d
}

interface Props {
  open: boolean
  onClose: () => void
  habit?: Habit | null
}

const blank = (): Omit<Habit, 'id' | 'user_id' | 'created_at' | 'sort_order'> => ({
  name: '', icon: '✅', color: '#6366f1', frequency: 'daily', target_count: 3, sub_habits: [],
  default_time: null, preferred_days: [], duration_min: 30, archived: false,
})

export function HabitEditor({ open, onClose, habit }: Props) {
  // A fresh key per opening guarantees the form never carries state over from a previous session,
  // even when the sheet is reopened while its close animation is still running.
  const [session, setSession] = useState(0)
  useEffect(() => { if (open) setSession((n) => n + 1) }, [open])
  return (
    <Sheet open={open} onClose={onClose} title={habit ? 'Edit habit' : 'New habit'} tall>
      {open && <EditorBody key={`${session}-${habit?.id ?? 'new'}`} habit={habit ?? null} onClose={onClose} />}
    </Sheet>
  )
}

function EditorBody({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const { addHabit, updateHabit, deleteHabit, showToast } = useStore()
  const [form, setForm] = useState(() => (habit ? { ...habit } : blank()))
  const [sub, setSub] = useState('')
  const [whenOpen, setWhenOpen] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const bodyRef = useRef<HTMLDivElement>(null)
  const save = () => {
    const name = form.name.trim()
    if (!name) return
    const bad = invalidFields(bodyRef.current)
    if (bad.length) { showToast('A number is empty or not valid'); bad[0].focus(); return }
    const payload = { ...form, name, target_count: form.frequency === 'daily' ? 1 : Math.max(1, form.target_count) }
    if (habit) updateHabit(habit.id, payload)
    else addHabit(payload)
    showToast(habit ? 'Habit updated' : 'Habit created')
    onClose()
  }

  const addSub = () => {
    const s = sub.trim()
    if (!s || form.sub_habits.includes(s)) return
    set('sub_habits', [...form.sub_habits, s]); setSub('')
  }

  return (
    <div ref={bodyRef} className="flex flex-col gap-4 pt-1">
      <div className="flex gap-3 items-center">
        <div className="text-4xl w-16 h-16 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${form.color}33` }}>{form.icon}</div>
        <input className="field" placeholder="Habit name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </div>

      <div>
        <label className="text-3 text-xs font-semibold uppercase tracking-wide">Icon</label>
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
          {HABIT_ICONS.map((i) => (
            <button key={i} type="button" onClick={() => set('icon', i)} className="text-2xl w-11 h-11 rounded-xl shrink-0 press" style={{ background: form.icon === i ? `${form.color}44` : 'var(--line)', outline: form.icon === i ? `2px solid ${form.color}` : 'none' }}>{i}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-3 text-xs font-semibold uppercase tracking-wide">Color</label>
        <div className="flex gap-2 py-2 flex-wrap">
          {HABIT_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => set('color', c)} className="w-8 h-8 rounded-full press" style={{ background: c, outline: form.color === c ? '3px solid var(--text)' : 'none', outlineOffset: 2 }} aria-label={c} />
          ))}
        </div>
      </div>

      <div>
        <label className="text-3 text-xs font-semibold uppercase tracking-wide">Frequency</label>
        <div className="mt-2">
          <Segment<Frequency>
            value={form.frequency}
            options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'X / week' }, { value: 'monthly', label: 'X / month' }]}
            onChange={(v) => set('frequency', v)}
          />
        </div>
        {form.frequency !== 'daily' && (
          // Three columns with equal sides, so the number sits in the exact middle of the sheet.
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mt-3">
            <span className="text-sm text-2 text-right">Target</span>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-sm" onClick={() => set('target_count', Math.max(1, form.target_count - 1))}>−</button>
              <span className="font-bold w-8 text-center">{form.target_count}</span>
              <button type="button" className="btn btn-sm" onClick={() => set('target_count', Math.min(form.frequency === 'weekly' ? 7 : 31, form.target_count + 1))}>+</button>
            </div>
            <span className="text-sm text-2">Times per {form.frequency === 'weekly' ? 'week' : 'month'}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="text-3 text-xs font-semibold uppercase tracking-wide">Preferred days</label>
          <button type="button" className="field mt-1 !h-12 !py-1 flex items-center justify-between gap-1 text-left" onClick={() => setWhenOpen(true)} aria-label="Choose preferred days and time">
            <span className="min-w-0 flex flex-col leading-tight">
              <span className="truncate">{whenLabel(preferredDays(form as Habit), null)}</span>
              <span className="text-3 text-[11px]">{form.default_time ?? 'Any time'}</span>
            </span>
            <ChevronRight size={16} className="text-3 shrink-0" />
          </button>
        </div>
        <div>
          <label className="text-3 text-xs font-semibold uppercase tracking-wide">Duration (min)</label>
          <NumberField className="mt-1 !h-12" integer min={5} aria-label="Duration in minutes" value={form.duration_min} onChange={(v) => set('duration_min', v)} />
        </div>
      </div>

      <div>
        <label className="text-3 text-xs font-semibold uppercase tracking-wide">Sub-habits (optional)</label>
        <p className="text-3 text-xs mt-0.5">e.g. Exercise → Gym, Golf, Walk. Completing any one completes the habit.</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {form.sub_habits.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium" style={{ background: `${form.color}22` }}>
              {s}
              <button type="button" onClick={() => set('sub_habits', form.sub_habits.filter((x) => x !== s))} aria-label={`Remove ${s}`}><X size={14} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input className="field" placeholder="Add option" value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub() } }} />
          <button type="button" className="btn" onClick={addSub}><Plus size={16} /></button>
        </div>
      </div>

      <Sheet open={whenOpen} onClose={() => setWhenOpen(false)} title="Preferred days & time">
        {whenOpen && (
          <WhenPicker days={preferredDays(form as Habit)} time={form.default_time}
            onDone={(days, time) => { setForm((f) => ({ ...f, preferred_days: days, default_time: time })); setWhenOpen(false) }} />
        )}
      </Sheet>

      <div className="flex gap-2 mt-2">
        {habit && (
          <button type="button" className="btn btn-danger" onClick={() => { if (confirm(`Delete "${habit.name}" and all its history?`)) { deleteHabit(habit.id); onClose() } }}>Delete</button>
        )}
        <button type="button" className="btn btn-primary grow" onClick={save} disabled={!form.name.trim()}>{habit ? 'Save changes' : 'Create habit'}</button>
      </div>
    </div>
  )
}


/** Day toggles plus one time that applies to every chosen day. */
function WhenPicker({ days: initialDays, time: initialTime, onDone }: { days: number[]; time: string | null; onDone: (days: number[], time: string | null) => void }) {
  const [days, setDays] = useState<number[]>(initialDays)
  const [time, setTime] = useState(initialTime ?? '')
  const toggle = (i: number) => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()))
  const preset = (label: string, value: number[]) => (
    <button type="button" className={`btn btn-sm ${same(days, value) ? 'btn-primary' : ''}`} onClick={() => setDays(value)}>{label}</button>
  )
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-2">Days</div>
        <div className="grid grid-cols-7 gap-1.5">
          {DOW.map((d, i) => {
            const on = days.includes(i)
            return (
              <button key={d} type="button" onClick={() => toggle(i)} aria-pressed={on}
                className="aspect-square rounded-xl text-sm font-semibold press"
                style={on ? { background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: 'white' } : { background: 'var(--line)', color: 'var(--text-2)' }}>
                {d}
              </button>
            )
          })}
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {preset('Weekdays', WEEKDAYS)}
          {preset('Weekends', WEEKEND)}
          {preset('Every day', [0, 1, 2, 3, 4, 5, 6])}
          {preset('Any day', [])}
        </div>
      </div>

      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-2">Time</div>
        <div className="flex items-center gap-2">
          <input className="field !w-auto" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Preferred time" />
          {time && <button type="button" className="btn btn-sm btn-ghost text-3" onClick={() => setTime('')}>No set time</button>}
        </div>
        <p className="text-3 text-[11px] mt-1.5">One time for every chosen day. Planning books the habit then when it’s free.</p>
      </div>

      <div className="glass p-3 text-sm text-center font-medium">{whenLabel(days, time || null)}</div>
      <button type="button" className="btn btn-primary py-3" onClick={() => onDone(days, time || null)}>Done</button>
    </div>
  )
}

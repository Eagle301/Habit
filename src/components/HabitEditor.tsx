import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Frequency, Habit } from '../lib/types'
import { useStore } from '../store/useStore'
import { Sheet } from './ui/Sheet'
import { HABIT_COLORS, HABIT_ICONS, Segment, Toggle } from './ui/Bits'

interface Props {
  open: boolean
  onClose: () => void
  habit?: Habit | null
}

const blank = (): Omit<Habit, 'id' | 'user_id' | 'created_at' | 'sort_order'> => ({
  name: '', icon: '✅', color: '#6366f1', frequency: 'daily', target_count: 3, sub_habits: [],
  default_time: null, duration_min: 30, archived: false, is_extra: false,
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
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = () => {
    const name = form.name.trim()
    if (!name) return
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
    <div className="flex flex-col gap-4 pt-1">
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
          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm text-2">Target</span>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-sm" onClick={() => set('target_count', Math.max(1, form.target_count - 1))}>−</button>
              <span className="font-bold w-8 text-center">{form.target_count}</span>
              <button type="button" className="btn btn-sm" onClick={() => set('target_count', Math.min(form.frequency === 'weekly' ? 7 : 31, form.target_count + 1))}>+</button>
            </div>
            <span className="text-sm text-2">times per {form.frequency === 'weekly' ? 'week' : 'month'}</span>
          </div>
        )}
      </div>

      <div className="glass p-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">🎈 Extra tracker</div>
          <div className="text-3 text-xs">Just for fun: gets its own streak but never counts toward your daily goal or stats.</div>
        </div>
        <Toggle on={!!form.is_extra} onChange={(v) => set('is_extra', v)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-3 text-xs font-semibold uppercase tracking-wide">Preferred time</label>
          <input className="field mt-1" type="time" value={form.default_time ?? ''} onChange={(e) => set('default_time', e.target.value || null)} />
        </div>
        <div>
          <label className="text-3 text-xs font-semibold uppercase tracking-wide">Duration (min)</label>
          <input className="field mt-1" type="number" min={5} step={5} value={form.duration_min} onChange={(e) => set('duration_min', Math.max(5, Number(e.target.value) || 30))} />
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

      <div className="flex gap-2 mt-2">
        {habit && (
          <button type="button" className="btn btn-danger" onClick={() => { if (confirm(`Delete "${habit.name}" and all its history?`)) { deleteHabit(habit.id); onClose() } }}>Delete</button>
        )}
        <button type="button" className="btn btn-primary grow" onClick={save} disabled={!form.name.trim()}>{habit ? 'Save changes' : 'Create habit'}</button>
      </div>
    </div>
  )
}


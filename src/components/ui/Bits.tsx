import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between px-1 pb-3">
      <div>
        {subtitle && <div className="text-3 text-[13px] font-medium uppercase tracking-wide">{subtitle}</div>}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
      </div>
      {right}
    </div>
  )
}

export function Card({ children, className = '', onClick, style }: { children: React.ReactNode; className?: string; onClick?: () => void; style?: React.CSSProperties }) {
  return (
    <div className={`glass p-4 ${onClick ? 'press cursor-pointer' : ''} ${className}`} onClick={onClick} style={style}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 mb-2 mt-5">
      <h2 className="text-[15px] font-semibold text-2">{children}</h2>
      {right}
    </div>
  )
}

export function CheckCircle({ checked, color = '#6366f1', size = 30 }: { checked: boolean; color?: string; size?: number }) {
  const [pop, setPop] = useState(false)
  useEffect(() => { if (checked) { setPop(true); const t = setTimeout(() => setPop(false), 350); return () => clearTimeout(t) } }, [checked])
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full shrink-0 transition-all duration-200 ${pop ? 'animate-pop animate-glow' : ''}`}
      style={{
        width: size, height: size,
        background: checked ? color : 'transparent',
        border: `2px solid ${checked ? color : 'var(--text-3)'}`,
        boxShadow: checked ? `0 4px 12px ${color}55` : 'none',
      }}
    >
      {checked && <Check size={size * 0.55} color="white" strokeWidth={3.5} />}
    </span>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-3" aria-pressed={on}>
      {label && <span className="text-[15px]">{label}</span>}
      <span
        className="relative inline-block w-[50px] h-[30px] rounded-full transition-colors duration-200"
        style={{ background: on ? '#34c759' : 'var(--line)' }}
      >
        <span
          className="absolute top-[3px] left-0 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: on ? 'translateX(23px)' : 'translateX(3px)' }}
        />
      </span>
    </button>
  )
}

/**
 * Numeric input you can clear and retype freely. Every valid entry is passed on as you type; an empty
 * or invalid entry is simply left in the box (the last valid value is kept) and, once you leave the
 * field, marked with aria-invalid so a form can refuse to save. Use `invalidFields()` on save.
 */
export function NumberField({ value, onChange, onClear, min = 0, integer, className = '', style, ...rest }: {
  /** null shows an empty box (only meaningful together with onClear). */
  value: number | null; onChange: (v: number) => void
  /** Makes the field optional: clearing it is valid and calls this. */
  onClear?: () => void
  min?: number; integer?: boolean; className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const parse = (t: string): number | null => {
    const str = t.trim().replace(',', '.')
    if (str === '') return null
    const n = Number(str)
    if (!Number.isFinite(n) || n < min) return null
    return integer ? Math.round(n) : n
  }
  // A change from outside (e.g. the − / + buttons) replaces a leftover draft.
  useEffect(() => { if (!focused) setDraft(null) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const empty = (t: string) => t.trim() === ''
  const invalid = draft !== null && parse(draft) === null && !(onClear && empty(draft))
  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      className={`field tabular-nums ${className}`}
      style={invalid && !focused ? { ...style, outline: '2px solid #ef4444', outlineOffset: -2 } : style}
      aria-invalid={invalid && !focused ? true : undefined}
      data-invalid={invalid ? true : undefined}
      value={draft ?? (value === null ? '' : String(Math.round(value * 100) / 100))}
      onFocus={(e) => { setFocused(true); setDraft(e.target.value); e.target.select() }}
      onChange={(e) => {
        const t = e.target.value
        setDraft(t)
        const v = parse(t)
        if (v !== null && v !== value) onChange(v)
        else if (onClear && empty(t) && value !== null) onClear()
      }}
      onBlur={() => { setFocused(false); if (draft !== null && !invalid) setDraft(null) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

/** Number fields inside `root` that hold an empty or invalid entry (see NumberField). */
export const invalidFields = (root: HTMLElement | null) => [...(root?.querySelectorAll<HTMLInputElement>('input[data-invalid="true"]') ?? [])]

/** − [number] + control. `step` snaps to the next/previous multiple, so 150 g with a 400 g step goes to 400 / 0. */
export function Stepper({ value, onChange, step = 1, min = 0, integer, label, size = 'md' }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; integer?: boolean; label: string; size?: 'sm' | 'md'
}) {
  const up = () => onChange(Math.max(min, (Math.floor(value / step + 1e-9) + 1) * step))
  const down = () => onChange(Math.max(min, (Math.ceil(value / step - 1e-9) - 1) * step))
  const h = size === 'sm' ? 'h-8' : 'h-10'
  return (
    <div className={`inline-flex items-stretch ${h} rounded-xl overflow-hidden shrink-0`} style={{ border: '1.5px solid var(--text-3)', background: 'var(--glass-strong)' }}>
      <button type="button" className="w-8 font-bold text-lg press disabled:opacity-30" onClick={down} disabled={value <= min} aria-label={`Decrease ${label}`}>−</button>
      <NumberField
        value={value} onChange={onChange} min={min} integer={integer} aria-label={label}
        className="!w-14 !px-1 !py-0 text-center font-bold"
        style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none' }}
      />
      <button type="button" className="w-8 font-bold text-lg press" onClick={up} aria-label={`Increase ${label}`}>+</button>
    </div>
  )
}

export function Empty({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="glass p-6 text-center">
      <div className="text-4xl mb-2">{icon}</div>
      <div className="font-semibold">{title}</div>
      {hint && <div className="text-3 text-sm mt-1">{hint}</div>}
    </div>
  )
}

export function Segment<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segment">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const HABIT_COLORS = ['#6366f1', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#64748b']
export const HABIT_ICONS = ['✅', '🏃', '🏋️', '🧘', '📚', '💧', '🥗', '😴', '🧹', '✍️', '🎸', '🧠', '🚶', '🚴', '🏊', '⛳', '🙏', '💊', '🌱', '💼', '🎯', '📵', '☀️', '🌙']

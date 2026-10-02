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

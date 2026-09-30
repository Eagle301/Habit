import type { Tab } from '../lib/types'
import { useStore } from '../store/useStore'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '☀️' },
  { id: 'calendar', label: 'Calendar', icon: '📅' },
  { id: 'lists', label: 'Lists', icon: '📝' },
  { id: 'planner', label: 'Planner', icon: '🎯' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

export function BottomNav() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 mx-auto w-full max-w-[430px]"
      style={{
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderTop: '1px solid var(--line)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="flex justify-around px-2 pt-2 pb-1.5">
        {TABS.map((t) => {
          const active = t.id === tab
          return (
            <li key={t.id} className="flex-1">
              <button
                onClick={() => setTab(t.id)}
                className="w-full flex flex-col items-center gap-0.5 press"
                aria-current={active ? 'page' : undefined}
              >
                <span
                  className="text-[22px] leading-none rounded-2xl px-3 py-1 transition-all duration-200"
                  style={{
                    background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(168,85,247,0.25))' : 'transparent',
                    transform: active ? 'translateY(-2px) scale(1.08)' : 'none',
                    filter: active ? 'none' : 'grayscale(0.6) opacity(0.75)',
                  }}
                >
                  {t.icon}
                </span>
                <span className="text-[10px] font-semibold" style={{ color: active ? 'var(--text)' : 'var(--text-3)' }}>
                  {t.label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

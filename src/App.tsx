import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from './store/useStore'
import { supabase, hasSupabase } from './lib/supabase'
import { seedProviderToken } from './lib/google'
import { BottomNav } from './components/BottomNav'
import { AuthScreen } from './components/AuthScreen'
import { Today } from './tabs/Today'
import { CalendarTab } from './tabs/Calendar'
import { Lists } from './tabs/Lists'
import { Planner } from './tabs/Planner'
import { Settings } from './tabs/Settings'

const LOCAL_KEY = 'habits-local-mode'

export default function App() {
  const { user, authReady, tab, toast, setUser, loadCloud, setGoogleConnected } = useStore()
  const [localMode, setLocalMode] = useState(() => { try { return localStorage.getItem(LOCAL_KEY) === '1' } catch { return false } })

  useEffect(() => {
    if (!supabase) return
    const sb = supabase
    const handle = async (session: import('@supabase/supabase-js').Session | null, event?: string) => {
      if (!session) { setUser(null); return }
      setUser({ id: session.user.id, email: session.user.email ?? null })
      seedProviderToken(session.provider_token)
      // On a fresh Google OAuth sign-in Supabase exposes the refresh token exactly once: persist it.
      if (session.provider_refresh_token) {
        const { error } = await sb.from('google_tokens').upsert({
          user_id: session.user.id,
          refresh_token: session.provider_refresh_token,
          access_token: session.provider_token ?? null,
          expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        if (!error) setGoogleConnected(true)
      }
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        await loadCloud()
        const { data } = await sb.rpc('has_google_token')
        if (typeof data === 'boolean') setGoogleConnected(data)
      }
    }
    sb.auth.getSession().then(({ data }) => handle(data.session, 'INITIAL_SESSION'))
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return
      void handle(session, event)
    })
    return () => sub.subscription.unsubscribe()
  }, [setUser, loadCloud, setGoogleConnected])

  if (!authReady) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="app-bg" />
        <div className="text-4xl animate-pulse">✅</div>
      </div>
    )
  }

  if (hasSupabase && !user && !localMode) {
    return <AuthScreen onSkip={() => { try { localStorage.setItem(LOCAL_KEY, '1') } catch { /* ignore */ } setLocalMode(true) }} />
  }

  return (
    <div className="mx-auto w-full max-w-[430px] min-h-dvh relative">
      <div className="app-bg" />
      <main className="px-4 safe-top pb-28">
        {/* Enter-only animation: an exit/wait transition would block tab switches whenever the page is throttled. */}
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          {tab === 'today' && <Today />}
          {tab === 'calendar' && <CalendarTab />}
          {tab === 'lists' && <Lists />}
          {tab === 'planner' && <Planner />}
          {tab === 'settings' && <Settings onLeaveLocalMode={() => { try { localStorage.removeItem(LOCAL_KEY) } catch { /* ignore */ } setLocalMode(false) }} />}
        </motion.div>
      </main>
      <BottomNav />
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed left-1/2 -translate-x-1/2 z-50 glass glass-strong px-4 py-2 text-sm font-medium"
            style={{ bottom: 'calc(96px + env(safe-area-inset-bottom))' }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

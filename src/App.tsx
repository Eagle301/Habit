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
      const meta = (session.user.user_metadata ?? {}) as Record<string, string | undefined>
      setUser({
        id: session.user.id,
        email: session.user.email ?? null,
        name: meta.full_name || meta.name || null,
        avatar: meta.avatar_url || meta.picture || null,
        providers: (session.user.app_metadata?.providers as string[] | undefined) ?? [],
      })
      // Right after a Google OAuth round-trip (SIGNED_IN) Supabase exposes the Google tokens: persist them
      // server-side. The refresh token only arrives when Google re-consents (prompt=consent), so a
      // missing one keeps whatever is already stored.
      // Supabase keeps provider_token in the persisted session, so on a later reload (INITIAL_SESSION)
      // it is still present but long expired. Saving it again would overwrite the server's valid cached
      // token with a dead one and force a "reconnect", so only fresh sign-ins count.
      const freshOAuth = event === 'SIGNED_IN' && !!(session.provider_token || session.provider_refresh_token)
      if (freshOAuth) {
        seedProviderToken(session.provider_token)
        const { error } = await sb.rpc('save_google_token', {
          p_refresh: session.provider_refresh_token ?? null,
          p_access: session.provider_token ?? null,
          p_expires: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
        })
        if (error) {
          console.error('[google] could not save token', error)
          useStore.setState({ googleError: `Could not save Google token: ${error.message}` })
        } else {
          setGoogleConnected(true)
        }
      }
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        await loadCloud()
        const { data, error } = await sb.rpc('has_google_token')
        if (error) console.error('[google] has_google_token failed', error)
        else if (typeof data === 'boolean') setGoogleConnected(data)
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

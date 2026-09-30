import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CALENDAR_SCOPE } from '../lib/google'

type Mode = 'signin' | 'signup' | 'magic'

export function AuthScreen({ onSkip }: { onSkip: () => void }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true); setMsg(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
        if (error) throw error
        setMsg('Check your inbox to confirm your email.')
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } })
        if (error) throw error
        setMsg('Magic link sent. Check your inbox.')
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    if (!supabase) return
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin,
        scopes: CALENDAR_SCOPE,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-5 safe-top safe-bottom">
      <div className="app-bg" />
      <div className="text-6xl mb-3">✅</div>
      <h1 className="text-3xl font-bold tracking-tight">Habits</h1>
      <p className="text-2 mt-1 mb-6 text-center">Track daily habits, reflect, and plan your week.</p>

      <div className="glass w-full max-w-[360px] p-5">
        <div className="segment mb-4">
          {(['signin', 'signup', 'magic'] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'signin' ? 'Sign in' : m === 'signup' ? 'Sign up' : 'Magic link'}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          {mode !== 'magic' && (
            <input className="field" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          )}
          <button className="btn btn-primary" disabled={busy}>
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send magic link'}
          </button>
        </form>
        <div className="flex items-center gap-3 my-4 text-3 text-xs">
          <div className="h-px grow bg-line" /> or <div className="h-px grow bg-line" />
        </div>
        <button className="btn w-full" onClick={google}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.1C12.3 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z"/><path fill="#FBBC05" d="M10.4 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-8 2.3-6.3 0-11.7-4-13.6-9.6l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
          Continue with Google
        </button>
        {msg && <p className="text-sm mt-3 text-center text-2">{msg}</p>}
      </div>

      <button className="btn btn-ghost mt-5 text-2 text-sm" onClick={onSkip}>Use without an account (local only)</button>
    </div>
  )
}

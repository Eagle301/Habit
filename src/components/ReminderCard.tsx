import { useEffect, useRef, useState } from 'react'
import { Bell, Send } from 'lucide-react'
import { useStore } from '../store/useStore'
import { hasSupabase } from '../lib/supabase'
import * as push from '../lib/push'
import { Card, Toggle } from './ui/Bits'

const SUPPORT_HELP: Record<Exclude<push.PushSupport, 'ok'>, string> = {
  unconfigured: 'Notifications are not set up on this site yet (missing VITE_VAPID_PUBLIC_KEY).',
  unsupported: 'This browser cannot receive push notifications.',
  'needs-install': 'On iPhone, reminders only work from the Home Screen app: Share → “Add to Home Screen”, then open it from there.',
  denied: 'Notifications are blocked for this app. Allow them in your browser or device settings, then come back.',
}

export function ReminderCard({ onLeaveLocalMode }: { onLeaveLocalMode: () => void }) {
  const user = useStore((s) => s.user)
  const showToast = useStore((s) => s.showToast)
  const [support, setSupport] = useState<push.PushSupport>(() => push.pushSupport())
  const [loaded, setLoaded] = useState(false)
  const [on, setOn] = useState(false)
  const [time, setTime] = useState('21:00')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const savedTime = useRef(time)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    push.loadReminder()
      .then(({ settings, thisDevice }) => {
        if (cancelled) return
        if (settings) { setTime(settings.time); savedTime.current = settings.time }
        setOn(!!settings?.enabled && thisDevice)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [user])

  // Save time changes shortly after the picker settles.
  useEffect(() => {
    if (!user || !on || time === savedTime.current) return
    const t = setTimeout(() => {
      push.setReminderTime(user.id, time)
        .then(() => { savedTime.current = time; showToast(`Reminder set for ${time}`) })
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not save time'))
    }, 600)
    return () => clearTimeout(t)
  }, [time, on, user, showToast])

  const toggle = async (v: boolean) => {
    if (!user) return
    setBusy(true); setErr(null)
    try {
      if (v) {
        await push.enableReminder(user.id, time)
        savedTime.current = time
        showToast(`Daily reminder at ${time}`)
      } else {
        await push.disableReminder(user.id)
        showToast('Daily reminder off')
      }
      setOn(v)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSupport(push.pushSupport())
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true); setErr(null)
    try {
      await push.sendTestReminder()
      showToast('Test sent')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setBusy(false)
    }
  }

  const ready = hasSupabase && !!user && support === 'ok'

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bell size={20} />
          <div>
            <div className="font-semibold">Daily reminder</div>
            <div className="text-3 text-xs">A notification at your chosen time listing the daily habits you haven’t done yet. Skipped when you’re all done.</div>
          </div>
        </div>
        {ready && <Toggle on={on} onChange={(v) => { if (!busy && loaded) void toggle(v) }} />}
      </div>

      {!hasSupabase ? (
        <p className="text-3 text-xs mt-3">Configure Supabase to enable reminders.</p>
      ) : !user ? (
        <button className="btn btn-primary btn-sm mt-3" onClick={onLeaveLocalMode}>Sign in to get reminders</button>
      ) : support !== 'ok' ? (
        <div className="text-xs mt-3 p-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.14)', color: '#d97706' }}>{SUPPORT_HELP[support]}</div>
      ) : on ? (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-2">Remind me at</span>
          <input className="field w-auto" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
          <button className="btn btn-sm ml-auto" onClick={test} disabled={busy}><Send size={14} /> Send test</button>
        </div>
      ) : null}

      {err && <div className="text-xs mt-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{err}</div>}
      {ready && on && <p className="text-3 text-[11px] mt-2">Turn it on on each device you want reminders on. Arrives within ~5 minutes of the set time.</p>}
    </Card>
  )
}

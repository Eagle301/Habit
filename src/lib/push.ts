/**
 * Daily reminder via Web Push. The browser subscribes with the VAPID public key and stores the
 * subscription in Supabase; netlify/functions/daily-reminder.ts sends the push at the chosen time.
 */
import { supabase } from './supabase'
import { todayKey } from './dates'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export interface ReminderSettings {
  enabled: boolean
  time: string // HH:mm, local
}

/**
 * - `unconfigured`: the site has no VAPID key
 * - `unsupported`: this browser has no Web Push
 * - `needs-install`: iPhone/iPad Safari tab; push only works from the Home Screen app
 * - `denied`: the user blocked notifications for this site
 */
export type PushSupport = 'ok' | 'unconfigured' | 'unsupported' | 'needs-install' | 'denied'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return 'ok'
}

function keyToBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/** Account-wide reminder settings plus whether *this* device will receive them. */
export async function loadReminder(): Promise<{ settings: ReminderSettings | null; thisDevice: boolean }> {
  if (!supabase) return { settings: null, thisDevice: false }
  const { data } = await supabase.from('reminder_settings').select('enabled, time').maybeSingle()
  const sub = pushSupport() === 'ok' ? await currentSubscription() : null
  let thisDevice = false
  if (sub) {
    const { data: row } = await supabase.from('push_subscriptions').select('endpoint').eq('endpoint', sub.endpoint).maybeSingle()
    thisDevice = !!row
  }
  return { settings: data as ReminderSettings | null, thisDevice }
}

async function saveSettings(userId: string, patch: Partial<ReminderSettings> & { last_sent_date?: null }) {
  if (!supabase) return
  const { error } = await supabase.from('reminder_settings').upsert({
    user_id: userId,
    ...patch,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

/** Must be called from a tap (iOS only shows the permission prompt for a user gesture). */
export async function enableReminder(userId: string, time: string): Promise<void> {
  if (!supabase || !VAPID_PUBLIC_KEY) throw new Error('Notifications are not configured on this site')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications were not allowed. Enable them for this app in your device settings.')

  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) as BufferSource }))
  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    user_id: userId,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    user_agent: navigator.userAgent.slice(0, 200),
  })
  if (error) throw new Error(error.message)
  await saveSettings(userId, { enabled: true, time })
}

/** Turns the reminder off for the account and forgets this device's subscription. */
export async function disableReminder(userId: string): Promise<void> {
  if (!supabase) return
  const sub = await currentSubscription().catch(() => null)
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe().catch(() => {})
  }
  await saveSettings(userId, { enabled: false })
}

export async function setReminderTime(userId: string, time: string): Promise<void> {
  // A new time may be later today, so allow it to fire again today.
  await saveSettings(userId, { time, last_sent_date: null })
}

export async function sendTestReminder(): Promise<void> {
  if (!supabase) throw new Error('Not signed in')
  const { data } = await supabase.auth.getSession()
  const jwt = data.session?.access_token
  if (!jwt) throw new Error('Not signed in')
  const res = await fetch('/api/push-test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: todayKey() }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `Test failed (${res.status})`)
  }
}

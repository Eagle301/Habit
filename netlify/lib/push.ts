/**
 * Server-side Web Push helpers shared by daily-reminder.ts and push-test.ts.
 *
 * Env (Netlify): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PRIVATE_KEY,
 *   VAPID_PUBLIC_KEY (falls back to VITE_VAPID_PUBLIC_KEY), VAPID_SUBJECT (e.g. mailto:you@example.com)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export function adminClient(): SupabaseClient | null {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Returns false when the VAPID keys are missing. */
export function configureVapid(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv)
  return true
}

/** Wall-clock date (YYYY-MM-DD) and minutes since midnight in an IANA time zone. */
export function localNow(timeZone: string, at = new Date()): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

/**
 * The reminder for `date`, or null when every daily habit is already done (or there are none).
 * Counts the same habits as the Today tab's daily goal: daily, not archived, not "extra".
 */
export async function buildReminder(admin: SupabaseClient, userId: string, date: string): Promise<PushPayload | null> {
  const { data: habits, error } = await admin
    .from('habits')
    .select('id, name, icon')
    .eq('user_id', userId)
    .eq('frequency', 'daily')
    .eq('archived', false)
    .eq('is_extra', false)
    .order('sort_order')
  if (error) throw error
  if (!habits?.length) return null

  const { data: logs, error: logErr } = await admin
    .from('habit_logs')
    .select('habit_id')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('completed', true)
  if (logErr) throw logErr
  const done = new Set((logs ?? []).map((l) => l.habit_id as string))
  const left = habits.filter((h) => !done.has(h.id as string))
  if (!left.length) return null

  const names = left.slice(0, 3).map((h) => `${h.icon} ${h.name}`).join(', ')
  const more = left.length > 3 ? ` and ${left.length - 3} more` : ''
  return {
    title: left.length === 1 ? '1 habit left today' : `${left.length} habits left today`,
    body: `${names}${more}`,
    url: '/',
    tag: 'daily-reminder',
  }
}

/** Sends to every device of the user. Drops subscriptions the push service says are gone. */
export async function sendToUser(admin: SupabaseClient, userId: string, payload: PushPayload): Promise<number> {
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (error) throw error

  let sent = 0
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 3, urgency: 'normal' },
      )
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      } else {
        console.error('push failed', status, (e as Error).message)
      }
    }
  }))
  return sent
}

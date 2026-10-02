/**
 * Scheduled every 5 minutes: sends each user's daily habit reminder once their local time passes the
 * time they picked in Settings. Skipped (but still marked sent) when all daily habits are done.
 * Scheduled functions only run on the published deploy, not in `npm run dev` or deploy previews.
 */
import type { Config } from '@netlify/functions'
import { adminClient, buildReminder, configureVapid, localNow, sendToUser } from '../lib/push'

/** Don't fire a reminder that is more than this late, e.g. right after it was switched on at night. */
const MAX_LATE_MIN = 120

export default async () => {
  const admin = adminClient()
  if (!admin || !configureVapid()) {
    console.error('daily-reminder: missing Supabase or VAPID configuration')
    return new Response('misconfigured', { status: 500 })
  }

  const { data: rows, error } = await admin
    .from('reminder_settings')
    .select('user_id, time, timezone, last_sent_date')
    .eq('enabled', true)
  if (error) {
    console.error('daily-reminder: load settings failed', error.message)
    return new Response('error', { status: 500 })
  }

  let sent = 0
  for (const r of rows ?? []) {
    let now: { date: string; minutes: number }
    try { now = localNow(r.timezone) } catch { continue } // invalid time zone
    if (r.last_sent_date === now.date) continue
    const [h, m] = (r.time as string).split(':').map(Number)
    const late = now.minutes - (h * 60 + m)
    if (late < 0 || late > MAX_LATE_MIN) continue

    try {
      // Stamp first so a slow or overlapping run can't send twice.
      await admin.from('reminder_settings').update({ last_sent_date: now.date }).eq('user_id', r.user_id)
      const payload = await buildReminder(admin, r.user_id, now.date)
      if (payload) sent += await sendToUser(admin, r.user_id, payload)
    } catch (e) {
      console.error('daily-reminder: user failed', r.user_id, (e as Error).message)
    }
  }

  console.log(`daily-reminder: ${rows?.length ?? 0} enabled, ${sent} pushes sent`)
  return new Response('ok')
}

export const config: Config = { schedule: '*/5 * * * *' }

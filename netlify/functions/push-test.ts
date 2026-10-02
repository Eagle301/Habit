/**
 * Sends the signed-in user a notification right now, to check that push works on their devices.
 *
 * POST /api/push-test   { "date": "YYYY-MM-DD" }  (the client's local date)
 *   Authorization: Bearer <supabase access token>
 */
import type { Handler } from '@netlify/functions'
import { adminClient, buildReminder, configureVapid, sendToUser } from '../lib/push'

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
})

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  const admin = adminClient()
  if (!admin || !configureVapid()) return json(500, { error: 'Server is missing Supabase/VAPID configuration' })

  const auth = event.headers.authorization || event.headers.Authorization || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return json(401, { error: 'Missing bearer token' })
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData.user) return json(401, { error: 'Invalid session' })
  const userId = userData.user.id

  let date = new Date().toISOString().slice(0, 10)
  try {
    const body = JSON.parse(event.body || '{}') as { date?: string }
    if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) date = body.date
  } catch { /* use today (UTC) */ }

  const payload = (await buildReminder(admin, userId, date))
    ?? { title: 'All done today 🎉', body: 'This is how your daily reminder will look.', url: '/', tag: 'daily-reminder' }
  const sent = await sendToUser(admin, userId, payload)
  if (!sent) return json(404, { error: 'No device is subscribed. Turn the reminder off and on again.' })
  return json(200, { sent })
}

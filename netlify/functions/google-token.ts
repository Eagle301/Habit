/**
 * Exchanges the user's stored Google refresh token for a fresh access token.
 *
 * POST /api/google-token
 *   Authorization: Bearer <supabase access token>
 *
 * Env (Netlify): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
})

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return json(500, { error: 'Server is missing Google/Supabase configuration' })
  }

  const auth = event.headers.authorization || event.headers.Authorization || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return json(401, { error: 'Missing bearer token' })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData.user) return json(401, { error: 'Invalid session' })
  const userId = userData.user.id

  const { data: row } = await admin
    .from('google_tokens')
    .select('refresh_token, access_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!row) return json(404, { error: 'Google Calendar is not connected', reconnect: true })

  // Reuse a cached access token if it has more than 2 minutes left.
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() - Date.now() > 120_000) {
    return json(200, { access_token: row.access_token, expires_at: row.expires_at })
  }
  if (!row.refresh_token) {
    return json(401, { error: 'Google session expired. Reconnect Google Calendar in Settings.', reconnect: true })
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const tok = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !tok.access_token) {
    if (tok.error === 'invalid_grant') {
      // Refresh token revoked: clear it so the client prompts to reconnect.
      await admin.from('google_tokens').delete().eq('user_id', userId)
    }
    return json(401, { error: tok.error || 'Token refresh failed', reconnect: true })
  }

  const expires_at = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString()
  await admin
    .from('google_tokens')
    .update({ access_token: tok.access_token, expires_at, updated_at: new Date().toISOString() })
    .eq('user_id', userId)

  return json(200, { access_token: tok.access_token, expires_at })
}

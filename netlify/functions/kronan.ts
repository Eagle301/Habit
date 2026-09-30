/**
 * Thin proxy for the Krónan public API (https://api.kronan.is/api/v1/), which does not send CORS
 * headers, so browsers cannot call it directly.
 *
 * The client calls /api/kronan/<path> with its own `Authorization: AccessToken <token>` header
 * (the token is created by the user in their kronan.is account settings). Nothing is stored here.
 */
import type { Handler } from '@netlify/functions'

const UPSTREAM = 'https://api.kronan.is/api/v1/'
const ALLOWED_PREFIXES = ['products/', 'recipes/', 'product-lists/', 'me/', 'categories/']

export const handler: Handler = async (event) => {
  const idx = event.path.indexOf('/kronan/')
  const sub = idx >= 0 ? event.path.slice(idx + '/kronan/'.length) : ''
  if (!sub || !ALLOWED_PREFIXES.some((p) => sub.startsWith(p))) {
    return { statusCode: 404, body: JSON.stringify({ detail: 'Unknown Krónan endpoint' }) }
  }
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth) return { statusCode: 401, body: JSON.stringify({ detail: 'Missing Krónan access token' }) }

  const qs = event.rawQuery ? `?${event.rawQuery}` : ''
  const url = `${UPSTREAM}${sub}${qs}`
  const res = await fetch(url, {
    method: event.httpMethod,
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: event.httpMethod === 'GET' || event.httpMethod === 'HEAD' ? undefined : event.body ?? undefined,
  })
  const text = await res.text()
  return {
    statusCode: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' },
    body: text,
  }
}

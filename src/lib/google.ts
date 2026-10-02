import { supabase } from './supabase'
import type { CalendarEvent, ScheduledBlock } from './types'
import { combine } from './dates'

const API = 'https://www.googleapis.com/calendar/v3'
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'
/** Marker stored in extendedProperties so we can recognise our own events on re-import. */
const APP_TAG = 'habit-tracker'

let cached: { token: string; exp: number } | null = null

export class GoogleAuthError extends Error {
  reconnect = true
}

/** Seed the cache with the short-lived provider token Supabase hands back right after OAuth. */
export const seedProviderToken = (token: string | null | undefined) => {
  if (token) cached = { token, exp: Date.now() + 50 * 60 * 1000 }
}

export const clearGoogleCache = () => { cached = null }

/**
 * Get a Google access token. `force` skips every cache (ours and the server's) and goes straight to
 * the refresh token — used after Google answered 401 to a token we believed was still valid.
 */
export async function getAccessToken(force = false): Promise<string> {
  if (!force && cached && cached.exp - Date.now() > 60_000) return cached.token
  if (!supabase) throw new GoogleAuthError('Sign in with Supabase to use Google Calendar')
  const { data } = await supabase.auth.getSession()
  const jwt = data.session?.access_token
  if (!jwt) throw new GoogleAuthError('Not signed in')
  const res = await fetch(`/api/google-token${force ? '?force=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } })
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('json')) {
    // `npm run dev` has no Netlify functions: the SPA fallback returned index.html.
    throw new GoogleAuthError('Google token endpoint unavailable. Run `netlify dev`, or set DEV_API_ORIGIN in .env to your deployed site so Vite can proxy it.')
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_at?: string; error?: string }
  if (!res.ok || !body.access_token) throw new GoogleAuthError(body.error || 'Could not get Google token')
  cached = { token: body.access_token, exp: body.expires_at ? new Date(body.expires_at).getTime() : Date.now() + 3600_000 }
  return cached.token
}

async function gfetch<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await getAccessToken(retried)
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (res.status === 401) {
    cached = null
    // A stale cached access token (ours or the server's) is the common cause; refresh once before
    // declaring the connection dead.
    if (!retried) return gfetch<T>(path, init, true)
    throw new GoogleAuthError('Google session expired')
  }
  if (res.status === 204) return undefined as T
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message || `Google API error ${res.status}`)
  return json as T
}

interface GEvent {
  id: string
  summary?: string
  status?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  extendedProperties?: { private?: Record<string, string> }
}

interface GCalendar { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; selected?: boolean; primary?: boolean; deleted?: boolean }

/** Calendars the user has ticked in Google Calendar, incl. subscribed ones such as a work ICS feed. */
export async function listCalendars(): Promise<GCalendar[]> {
  const data = await gfetch<{ items?: GCalendar[] }>('/users/me/calendarList?minAccessRole=freeBusyReader&showHidden=false')
  // Primary is always included (even if unticked) so our own habit blocks are recognised.
  const cals = (data.items ?? []).filter((c) => !c.deleted && (c.selected || c.primary))
  return cals.length ? cals : [{ id: 'primary', primary: true }]
}

async function listCalendarEvents(cal: GCalendar, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const q = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })
  const data = await gfetch<{ items?: GEvent[] }>(`/calendars/${encodeURIComponent(cal.id)}/events?${q}`)
  const name = cal.primary ? 'Google Calendar' : cal.summaryOverride || cal.summary || 'Calendar'
  return (data.items ?? [])
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      id: cal.primary ? e.id : `${cal.id}:${e.id}`,
      title: e.summary || '(No title)',
      start: e.start.dateTime || `${e.start.date}T00:00:00`,
      end: e.end.dateTime || `${e.end.date}T00:00:00`,
      allDay: !e.start.dateTime,
      calendar: name,
      color: cal.primary ? undefined : cal.backgroundColor,
      habitBlockId: e.extendedProperties?.private?.app === APP_TAG ? e.extendedProperties.private.blockId : undefined,
    }))
}

/** Events from every selected calendar, merged and sorted. A calendar that fails to load is skipped. */
export async function listEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const cals = await listCalendars()
  const results = await Promise.allSettled(cals.map((c) => listCalendarEvents(c, timeMin, timeMax)))
  const out: CalendarEvent[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value)
    else if (r.reason instanceof GoogleAuthError) throw r.reason
    else console.warn('Calendar failed to load', r.reason)
  }
  return out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

/** What the mirrored event is called; a Habit satisfies this, and so does a project look. */
export interface EventLook { icon: string; name: string; kind?: 'habit' | 'project' | 'task' }

const blockBody = (block: ScheduledBlock, look: EventLook) => {
  const start = combine(block.date, block.start_time)
  const end = new Date(start.getTime() + block.duration_min * 60_000)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    summary: `${look.icon} ${look.name}`,
    description: look.kind === 'project' ? 'Study session · scheduled from Habits' : look.kind === 'task' ? 'To-do · scheduled from Habits' : 'Scheduled from Habits',
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    extendedProperties: { private: { app: APP_TAG, blockId: block.id, habitId: block.habit_id ?? '', projectId: block.project_id ?? '' } },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
  }
}

/** Create or update the Google event that mirrors a scheduled block. Returns the event id. */
export async function upsertBlockEvent(block: ScheduledBlock, look: EventLook): Promise<string> {
  const body = JSON.stringify(blockBody(block, look))
  if (block.google_event_id) {
    try {
      const e = await gfetch<GEvent>(`/calendars/primary/events/${block.google_event_id}`, { method: 'PATCH', body })
      return e.id
    } catch (err) {
      if (err instanceof GoogleAuthError) throw err
      // event was deleted on Google's side: fall through and recreate
    }
  }
  const e = await gfetch<GEvent>(`/calendars/primary/events`, { method: 'POST', body })
  return e.id
}

export async function deleteBlockEvent(eventId: string) {
  try {
    await gfetch(`/calendars/primary/events/${eventId}`, { method: 'DELETE' })
  } catch (err) {
    if (err instanceof GoogleAuthError) throw err
    // already gone: ignore
  }
}

/** Busy intervals (ms) derived from a set of events. All-day events are treated as free. */
export const busyIntervals = (events: CalendarEvent[]) =>
  events
    .filter((e) => !e.allDay)
    .map((e) => [new Date(e.start).getTime(), new Date(e.end).getTime()] as [number, number])
    .sort((a, b) => a[0] - b[0])

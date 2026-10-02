import { useEffect, useRef, useState } from 'react'
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, ArchiveRestore, Download, GripVertical, LogOut, Moon, Plus, RefreshCw, Sun, Trash2, Upload } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Habit } from '../lib/types'
import { supabase, hasSupabase } from '../lib/supabase'
import { CALENDAR_SCOPE, clearGoogleCache } from '../lib/google'
import * as kronan from '../lib/kronan'
import { db, type CloudData } from '../lib/db'
import { Card, Header, SectionTitle, Toggle } from '../components/ui/Bits'
import { HabitEditor } from '../components/HabitEditor'

export function Settings({ onLeaveLocalMode }: { onLeaveLocalMode: () => void }) {
  const s = useStore()
  const [editing, setEditing] = useState<Habit | null | 'new'>(null)
  const [showArchived, setShowArchived] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [kronanInput, setKronanInput] = useState('')
  const [kronanBusy, setKronanBusy] = useState(false)
  const [kronanName, setKronanName] = useState<string | null>(null)
  const [kronanErr, setKronanErr] = useState<string | null>(null)
  /** Show the token field while connected, e.g. after Krónan expired the old token. */
  const [kronanReplace, setKronanReplace] = useState(false)

  // Verify the stored token when Settings opens so an expired one is flagged here, not mid meal-prep.
  useEffect(() => {
    const token = s.kronanToken
    if (!token) return
    let cancelled = false
    kronan.me(token)
      .then((who) => { if (!cancelled) setKronanName(who.name) })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof kronan.KronanError && e.status === 401) { setKronanErr(e.message); setKronanReplace(true) }
      })
    return () => { cancelled = true }
  }, [s.kronanToken])

  const connectKronan = async () => {
    const token = kronanInput.trim()
    if (!token) return
    setKronanBusy(true); setKronanErr(null)
    try {
      const who = await kronan.me(token)
      s.setKronanToken(token)
      setKronanName(who.name)
      setKronanInput('')
      setKronanReplace(false)
      s.showToast('Krónan connected')
    } catch (e) {
      setKronanErr(e instanceof Error ? e.message : 'Could not verify token')
    } finally {
      setKronanBusy(false)
    }
  }

  const active = s.habits.filter((h) => !h.archived).sort((a, b) => a.sort_order - b.sort_order)
  const archived = s.habits.filter((h) => h.archived)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    const { active: a, over } = e
    if (!over || a.id === over.id) return
    const ids = active.map((h) => h.id)
    s.reorderHabits(arrayMove(ids, ids.indexOf(String(a.id)), ids.indexOf(String(over.id))))
  }

  // ---------- Google ----------
  const connectGoogle = async () => {
    if (!supabase) return
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin, scopes: CALENDAR_SCOPE, queryParams: { access_type: 'offline', prompt: 'consent' } },
    })
  }
  const disconnectGoogle = async () => {
    if (!supabase || !s.user) return
    await supabase.rpc('delete_google_token')
    clearGoogleCache()
    s.setGoogleConnected(false)
    useStore.setState({ events: [], eventsRange: null })
    s.showToast('Google Calendar disconnected')
  }
  const resync = async () => {
    const now = new Date()
    await s.loadEvents(now, now, true)
    s.showToast(useStore.getState().googleError ? 'Sync failed' : 'Calendar synced')
  }

  // ---------- Data ----------
  const exportData = () => {
    const data: CloudData & { exported_at: string; version: number } = {
      version: 1, exported_at: new Date().toISOString(),
      habits: s.habits, logs: s.logs, reflections: s.reflections, goals: s.goals, goalTasks: s.goalTasks,
      lists: s.lists, listItems: s.listItems, blocks: s.blocks, recipes: s.recipes, mealPlans: s.mealPlans,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `habits-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importData = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as Partial<CloudData>
      const uid = s.user?.id ?? null
      const stamp = <T extends { user_id: string | null }>(rows?: T[]) => (rows ?? []).map((r) => ({ ...r, user_id: uid }))
      const data: CloudData = {
        habits: stamp(raw.habits), logs: stamp(raw.logs), reflections: stamp(raw.reflections), goals: stamp(raw.goals),
        goalTasks: stamp(raw.goalTasks), lists: stamp(raw.lists), listItems: stamp(raw.listItems), blocks: stamp(raw.blocks),
        recipes: stamp(raw.recipes), mealPlans: stamp(raw.mealPlans),
      }
      if (!confirm(`Import ${data.habits.length} habits, ${data.logs.length} logs, ${data.lists.length} lists? This merges into your current data.`)) return
      // merge by id
      const merge = <T extends { id: string }>(cur: T[], inc: T[]) => { const m = new Map(cur.map((x) => [x.id, x])); for (const x of inc) m.set(x.id, x); return [...m.values()] }
      const merged: CloudData = {
        habits: merge(s.habits, data.habits), logs: merge(s.logs, data.logs), reflections: merge(s.reflections, data.reflections),
        goals: merge(s.goals, data.goals), goalTasks: merge(s.goalTasks, data.goalTasks), lists: merge(s.lists, data.lists),
        listItems: merge(s.listItems, data.listItems), blocks: merge(s.blocks, data.blocks),
        recipes: merge(s.recipes, data.recipes), mealPlans: merge(s.mealPlans, data.mealPlans),
      }
      s.replaceAll(merged)
      if (s.user) await db.pushAll(data)
      s.showToast('Import complete')
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : e}`)
    }
  }
  const wipe = async () => {
    if (!confirm('Delete ALL habits, logs, goals and lists? This cannot be undone.')) return
    if (!confirm('Really delete everything?')) return
    s.replaceAll({ habits: [], logs: [], reflections: [], goals: [], goalTasks: [], lists: [], listItems: [], blocks: [], recipes: [], mealPlans: [] })
    if (s.user) await db.wipeAll()
    s.showToast('All data deleted')
  }

  return (
    <div>
      <Header subtitle="Preferences" title="Settings" />

      {/* Appearance */}
      <Card className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {s.theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
          <div><div className="font-semibold">Dark mode</div><div className="text-3 text-xs">Glass looks great either way</div></div>
        </div>
        <Toggle on={s.theme === 'dark'} onChange={(v) => s.setTheme(v ? 'dark' : 'light')} />
      </Card>

      {/* Google Calendar */}
      <SectionTitle>Google Calendar</SectionTitle>
      <Card>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'rgba(66,133,244,0.18)' }}>📅</div>
          <div className="grow">
            <div className="font-semibold">{s.googleConnected ? 'Connected' : 'Not connected'}</div>
            <div className="text-3 text-xs">2-way sync: events show in Today &amp; Planner, planned habits are pushed to your primary calendar.</div>
          </div>
        </div>
        {s.googleError && <div className="text-xs mt-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{s.googleError}</div>}
        <div className="flex gap-2 mt-3 flex-wrap">
          {!hasSupabase ? (
            <div className="text-3 text-xs">Configure Supabase (VITE_SUPABASE_URL / ANON_KEY) to enable Google sign-in.</div>
          ) : !s.user ? (
            <button className="btn btn-primary btn-sm" onClick={onLeaveLocalMode}>Sign in to connect</button>
          ) : s.googleConnected ? (
            <>
              <button className="btn btn-sm" onClick={resync} disabled={s.eventsLoading}><RefreshCw size={14} className={s.eventsLoading ? 'animate-spin' : ''} /> Sync now</button>
              <button className="btn btn-sm btn-danger" onClick={disconnectGoogle}>Disconnect</button>
            </>
          ) : (
            <>
              <button className="btn btn-primary btn-sm" onClick={connectGoogle}>Connect Google Calendar</button>
              {s.user.providers.includes('google') && !s.googleError && (
                <p className="text-3 text-[11px] w-full">You signed in with Google but no calendar token was stored. Press Connect and approve the calendar permission on Google’s screen.</p>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Krónan */}
      <SectionTitle>Krónan (meal prep)</SectionTitle>
      <Card>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'rgba(34,197,94,0.18)' }}>🛒</div>
          <div className="grow">
            <div className="font-semibold">{s.kronanToken ? `Connected${kronanName ? ` · ${kronanName}` : ''}` : 'Not connected'}</div>
            <div className="text-3 text-xs">Search Krónan recipes, pull live ingredient prices and push meal-prep shopping lists to your account.</div>
          </div>
        </div>
        {kronanErr && <div className="text-xs mt-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{kronanErr}</div>}
        {s.kronanSyncError && <div className="text-xs mt-3 p-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.14)', color: '#d97706' }}>{s.kronanSyncError}</div>}
        {s.kronanToken && !kronanReplace ? (
          <div className="flex gap-2 mt-3">
            <button className="btn btn-sm" onClick={() => setKronanReplace(true)}>Replace token</button>
            <button className="btn btn-sm btn-danger" onClick={() => { s.setKronanToken(null); setKronanName(null); s.showToast('Krónan disconnected') }}>Disconnect</button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <input className="field" type="password" placeholder="Paste your Krónan API access token" value={kronanInput} onChange={(e) => setKronanInput(e.target.value)} autoComplete="off" />
            <div className="flex items-center gap-2">
              <button className="btn btn-primary btn-sm" onClick={connectKronan} disabled={!kronanInput.trim() || kronanBusy}>{kronanBusy ? 'Checking…' : s.kronanToken ? 'Save new token' : 'Connect'}</button>
              {s.kronanToken && <button className="btn btn-sm" onClick={() => { setKronanReplace(false); setKronanInput('') }}>Cancel</button>}
              <a className="text-3 text-xs underline" href="https://kronan.is/kronan-public-api" target="_blank" rel="noreferrer">How to get a token</a>
            </div>
            <p className="text-3 text-[11px]">{kronan.KRONAN_TOKEN_HELP}. {s.user ? 'The token is saved to your account so it is there when you sign in again, and' : 'The token stays on this device and'} is only sent to Krónan through the app’s proxy.</p>
          </div>
        )}
      </Card>

      {/* Habits */}
      <SectionTitle right={<button className="btn btn-sm" onClick={() => setEditing('new')}><Plus size={14} /> New</button>}>Habits</SectionTitle>
      <Card className="p-2">
        {active.length === 0 && <div className="text-3 text-sm p-2">No habits yet. Create one with “New”.</div>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={active.map((h) => h.id)} strategy={verticalListSortingStrategy}>
            {active.map((h) => <HabitRowSortable key={h.id} habit={h} onEdit={() => setEditing(h)} onArchive={() => s.updateHabit(h.id, { archived: true })} />)}
          </SortableContext>
        </DndContext>
        {archived.length > 0 && (
          <div className="mt-2 border-t hairline pt-2">
            <button className="text-3 text-xs px-2" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide' : 'Show'} {archived.length} archived</button>
            {showArchived && archived.map((h) => (
              <div key={h.id} className="flex items-center gap-2 px-2 py-2 opacity-70">
                <span className="text-xl">{h.icon}</span>
                <span className="grow text-sm line-through">{h.name}</span>
                <button className="btn btn-sm" onClick={() => s.updateHabit(h.id, { archived: false })}><ArchiveRestore size={14} /></button>
                <button className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete "${h.name}" permanently?`)) s.deleteHabit(h.id) }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Account & data */}
      <SectionTitle>Account &amp; data</SectionTitle>
      <Card className="flex flex-col gap-3">
        {hasSupabase ? (
          s.user ? (
            <div className="flex items-center gap-3">
              {s.user.avatar
                ? <img src={s.user.avatar} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                : <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center font-bold text-white" style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>{(s.user.name || s.user.email || '?').slice(0, 1).toUpperCase()}</div>}
              <div className="grow min-w-0">
                <div className="font-semibold text-[15px] truncate">{s.user.name ?? 'Signed in'}</div>
                <div className="text-2 text-xs truncate">{s.user.email}</div>
                <div className="text-3 text-[11px]">Synced · signed in with {s.user.providers.length ? s.user.providers.join(', ') : 'email'}</div>
              </div>
              <button className="btn btn-sm shrink-0" onClick={() => s.signOut()}><LogOut size={14} /> Sign out</button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div><div className="font-semibold text-sm">Local mode</div><div className="text-3 text-xs">Data lives only in this browser</div></div>
              <button className="btn btn-primary btn-sm" onClick={onLeaveLocalMode}>Sign in / sync</button>
            </div>
          )
        ) : (
          <div className="text-3 text-xs">Running without Supabase. Data is stored in this browser only.</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-sm" onClick={exportData}><Download size={14} /> Export JSON</button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import JSON</button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = '' }} />
        </div>
        <button className="btn btn-sm btn-danger" onClick={wipe}><Trash2 size={14} /> Delete all data</button>
      </Card>

      <SectionTitle>Install</SectionTitle>
      <Card className="text-sm text-2">
        <b>iPhone:</b> open in Safari → Share → “Add to Home Screen” for a full-screen app experience with offline support.
      </Card>

      <p className="text-3 text-[11px] text-center mt-6">Habits · v{__APP_VERSION__}</p>

      <HabitEditor open={editing !== null} onClose={() => setEditing(null)} habit={editing === 'new' ? null : editing} />
    </div>
  )
}

function HabitRowSortable({ habit, onEdit, onArchive }: { habit: Habit; onEdit: () => void; onArchive: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: habit.id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }} className="flex items-center gap-2 px-2 py-2 border-b hairline last:border-b-0">
      <button {...attributes} {...listeners} className="text-3 p-1 touch-none cursor-grab" aria-label="Reorder"><GripVertical size={16} /></button>
      <button onClick={onEdit} className="flex items-center gap-2 grow min-w-0 text-left">
        <span className="text-xl w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${habit.color}22` }}>{habit.icon}</span>
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{habit.name}</div>
          <div className="text-3 text-xs">{habit.is_extra ? '🎈 Extra · ' : ''}{habit.frequency === 'daily' ? 'Daily' : `${habit.target_count}× / ${habit.frequency === 'weekly' ? 'week' : 'month'}`}{habit.sub_habits.length ? ` · ${habit.sub_habits.length} options` : ''}</div>
        </div>
      </button>
      <button className="btn btn-sm" onClick={onArchive} aria-label="Archive"><Archive size={14} /></button>
    </div>
  )
}

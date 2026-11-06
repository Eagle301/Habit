import { supabase } from './supabase'
import type { Habit, HabitLog, MealPlan, Project, Recipe, ScheduledBlock, Task } from './types'

export type Table = 'habits' | 'habit_logs' | 'scheduled_blocks' | 'recipes' | 'meal_plans' | 'projects' | 'tasks'

export interface CloudData {
  habits: Habit[]
  logs: HabitLog[]
  blocks: ScheduledBlock[]
  recipes: Recipe[]
  mealPlans: MealPlan[]
  /** Goals (stored in the `projects` table). */
  projects: Project[]
  tasks: Task[]
}

const report = (op: string, table: string) => (res: { error: unknown }) => {
  if (res.error) console.error(`[db] ${op} ${table} failed`, res.error)
}

const kronanSyncMessage = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST205'
    ? 'Krónan token is not synced to your account: the kronan_tokens table is missing. Run supabase/migrations/0005_kronan_tokens.sql in the Supabase SQL editor.'
    : `Krónan token sync failed: ${error.message ?? 'unknown error'}`

/** Fills fields that older goal rows may not have. */
export const normalizeProject = (p: Project): Project => ({
  ...p,
  hours_est: Number(p.hours_est) || 0,
  steps: Array.isArray(p.steps) ? p.steps : [],
})

/** Fire-and-forget writes; the local store is the source of truth for the UI. */
export const db = {
  upsert<T extends object>(table: Table, rows: T | T[]) {
    if (!supabase) return
    const arr = Array.isArray(rows) ? rows : [rows]
    if (!arr.length) return
    void supabase.from(table).upsert(arr).then(report('upsert', table))
  },
  remove(table: Table, ids: string | string[]) {
    if (!supabase) return
    const arr = Array.isArray(ids) ? ids : [ids]
    if (!arr.length) return
    void supabase.from(table).delete().in('id', arr).then(report('delete', table))
  },
  async loadAll(): Promise<CloudData | null> {
    if (!supabase) return null
    const [h, l, b, rc, mp, pj, tk] = await Promise.all([
      supabase.from('habits').select('*').order('sort_order'),
      supabase.from('habit_logs').select('*'),
      supabase.from('scheduled_blocks').select('*'),
      supabase.from('recipes').select('*').order('created_at'),
      supabase.from('meal_plans').select('*'),
      supabase.from('projects').select('*').order('sort_order'),
      supabase.from('tasks').select('*').order('sort_order'),
    ])
    const err = [h, l, b, rc, mp].find((x) => x.error)?.error
    if (err) { console.error('[db] loadAll failed', err); return null }
    // Projects arrived in migration 0006: a missing table must not block everything else.
    if (pj.error) console.error('[db] loadAll projects failed (run supabase/migrations/0006_projects.sql)', pj.error)
    if (tk.error) console.error('[db] loadAll tasks failed (run supabase/migrations/0007_tasks.sql)', tk.error)
    return {
      habits: ((h.data ?? []) as Habit[]).map((x) => ({ ...x, preferred_days: x.preferred_days ?? [] })),
      logs: (l.data ?? []) as HabitLog[],
      blocks: (b.data ?? []) as ScheduledBlock[],
      recipes: (rc.data ?? []) as Recipe[],
      mealPlans: (mp.data ?? []) as MealPlan[],
      projects: ((pj.data ?? []) as Project[]).map(normalizeProject),
      tasks: (tk.data ?? []) as Task[],
    }
  },
  /** Push an entire local dataset (used on first sign-in to migrate local-only data). */
  async pushAll(d: CloudData) {
    if (!supabase) return
    const step = async (table: Table, rows: object[]) => {
      if (!rows.length) return
      const { error } = await supabase!.from(table).upsert(rows)
      if (error) console.error('[db] pushAll', table, error)
    }
    await step('habits', d.habits)
    await step('habit_logs', d.logs)
    await step('projects', d.projects)
    await step('tasks', d.tasks)
    await step('scheduled_blocks', d.blocks)
    await step('recipes', d.recipes)
    await step('meal_plans', d.mealPlans)
  },
  /** Krónan access token for the signed-in user (null when none is stored or in local-only mode). */
  /** `error` is set when the account copy could not be read (e.g. migration 0005 not applied). */
  async loadKronanToken(): Promise<{ token: string | null; error: string | null }> {
    if (!supabase) return { token: null, error: null }
    const { data, error } = await supabase.from('kronan_tokens').select('token').maybeSingle()
    if (error) { console.error('[db] loadKronanToken failed', error); return { token: null, error: kronanSyncMessage(error) } }
    return { token: data?.token ?? null, error: null }
  },
  async saveKronanToken(token: string | null): Promise<string | null> {
    if (!supabase) return null
    const { data } = await supabase.auth.getUser()
    const uid = data.user?.id
    if (!uid) return null
    const res = token
      ? await supabase.from('kronan_tokens').upsert({ user_id: uid, token, updated_at: new Date().toISOString() })
      : await supabase.from('kronan_tokens').delete().eq('user_id', uid)
    if (res.error) { console.error('[db] saveKronanToken failed', res.error); return kronanSyncMessage(res.error) }
    return null
  },
  async wipeAll() {
    if (!supabase) return
    const { data } = await supabase.auth.getUser()
    const uid = data.user?.id
    if (!uid) return
    // The tables of removed features (lists, old goals, day reflections) are cleared too while they still exist.
    for (const t of ['meal_plans', 'recipes', 'scheduled_blocks', 'tasks', 'projects', 'list_items', 'lists', 'goal_tasks', 'goals', 'reflections', 'habit_logs', 'habits']) {
      await supabase.from(t).delete().eq('user_id', uid)
    }
  },
}

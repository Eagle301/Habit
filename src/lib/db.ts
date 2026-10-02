import { supabase } from './supabase'
import type { Goal, GoalTask, Habit, HabitLog, List, ListItem, MealPlan, Recipe, Reflection, ScheduledBlock } from './types'

export type Table =
  | 'habits' | 'habit_logs' | 'reflections' | 'goals' | 'goal_tasks' | 'lists' | 'list_items' | 'scheduled_blocks'
  | 'recipes' | 'meal_plans'

export interface CloudData {
  habits: Habit[]
  logs: HabitLog[]
  reflections: Reflection[]
  goals: Goal[]
  goalTasks: GoalTask[]
  lists: List[]
  listItems: ListItem[]
  blocks: ScheduledBlock[]
  recipes: Recipe[]
  mealPlans: MealPlan[]
}

const report = (op: string, table: string) => (res: { error: unknown }) => {
  if (res.error) console.error(`[db] ${op} ${table} failed`, res.error)
}

const kronanSyncMessage = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST205'
    ? 'Krónan token is not synced to your account: the kronan_tokens table is missing. Run supabase/migrations/0005_kronan_tokens.sql in the Supabase SQL editor.'
    : `Krónan token sync failed: ${error.message ?? 'unknown error'}`

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
    const [h, l, r, g, gt, li, lit, b, rc, mp] = await Promise.all([
      supabase.from('habits').select('*').order('sort_order'),
      supabase.from('habit_logs').select('*'),
      supabase.from('reflections').select('*'),
      supabase.from('goals').select('*').order('sort_order'),
      supabase.from('goal_tasks').select('*').order('sort_order'),
      supabase.from('lists').select('*').order('sort_order'),
      supabase.from('list_items').select('*').order('sort_order'),
      supabase.from('scheduled_blocks').select('*'),
      supabase.from('recipes').select('*').order('created_at'),
      supabase.from('meal_plans').select('*'),
    ])
    const err = [h, l, r, g, gt, li, lit, b, rc, mp].find((x) => x.error)?.error
    if (err) { console.error('[db] loadAll failed', err); return null }
    return {
      habits: (h.data ?? []) as Habit[],
      logs: (l.data ?? []) as HabitLog[],
      reflections: (r.data ?? []) as Reflection[],
      goals: (g.data ?? []) as Goal[],
      goalTasks: (gt.data ?? []) as GoalTask[],
      lists: (li.data ?? []) as List[],
      listItems: (lit.data ?? []) as ListItem[],
      blocks: (b.data ?? []) as ScheduledBlock[],
      recipes: (rc.data ?? []) as Recipe[],
      mealPlans: (mp.data ?? []) as MealPlan[],
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
    await step('reflections', d.reflections)
    await step('goals', d.goals)
    await step('goal_tasks', d.goalTasks)
    await step('lists', d.lists)
    await step('list_items', d.listItems)
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
    for (const t of ['meal_plans', 'recipes', 'scheduled_blocks', 'list_items', 'lists', 'goal_tasks', 'goals', 'reflections', 'habit_logs', 'habits'] as Table[]) {
      await supabase.from(t).delete().eq('user_id', uid)
    }
  },
}

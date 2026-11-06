import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  CalendarEvent, GoalStep, Habit, HabitLog, MealPlan, Project, Recipe, ScheduledBlock, Tab, Task, Theme, WorkHours,
} from '../lib/types'
import { blockLook } from '../lib/projects'
import { DEFAULT_TASK_MIN } from '../lib/tasks'
import { uid } from '../lib/id'
import { removePhoto } from '../lib/photos'
import { db, normalizeProject, type CloudData } from '../lib/db'
import { supabase } from '../lib/supabase'
import * as google from '../lib/google'
import { todayKey, weekStart, weekEnd, addDays, ymd } from '../lib/dates'

export interface User {
  id: string
  email: string | null
  name: string | null
  avatar: string | null
  /** Linked identity providers, e.g. ['email', 'google']. */
  providers: string[]
}

interface DataState extends CloudData {}

interface UIState {
  user: User | null
  authReady: boolean
  theme: Theme
  tab: Tab
  /** Auto-planning keeps out of these hours (stored on this device). */
  workHours: WorkHours
  /** Krónan API access token; cached locally and saved to the user's account when signed in. */
  kronanToken: string | null
  /** Why the token could not be synced to the account (null when fine or in local-only mode). */
  kronanSyncError: string | null
  googleConnected: boolean
  googleError: string | null
  events: CalendarEvent[]
  eventsRange: { from: string; to: string } | null
  eventsLoading: boolean
  toast: string | null
}

interface Actions {
  setTab: (t: Tab) => void
  setTheme: (t: Theme) => void
  setWorkHours: (patch: Partial<WorkHours>) => void
  showToast: (msg: string) => void
  setUser: (u: User | null) => void
  loadCloud: () => Promise<void>
  replaceAll: (d: CloudData) => void
  signOut: () => Promise<void>

  // habits
  addHabit: (h: Omit<Habit, 'id' | 'user_id' | 'created_at' | 'sort_order'>) => void
  updateHabit: (id: string, patch: Partial<Habit>) => void
  reorderHabits: (ids: string[]) => void
  deleteHabit: (id: string) => void
  toggleHabit: (habitId: string, date: string, subHabit?: string | null) => void

  // goals (stored as projects)
  addProject: (p: Omit<Project, 'id' | 'user_id' | 'created_at' | 'sort_order'>) => string
  updateProject: (id: string, patch: Partial<Project>) => void
  /** Removes the goal and all of its sessions (and their calendar events). */
  deleteProject: (id: string) => void
  scheduleProjectBlock: (project_id: string, date: string, start_time: string, duration_min: number) => ScheduledBlock
  /** Tick a goal session or a planned task off (or back on). */
  toggleBlockDone: (id: string) => void

  // one-time tasks
  addTask: (title: string, due_date?: string | null, opts?: { duration_min?: number; ref?: string | null }) => string
  updateTask: (id: string, patch: Partial<Task>) => void
  toggleTask: (id: string) => void
  /** Removes the task and its planned block (and calendar event). */
  deleteTask: (id: string) => void
  /** Plans the task on the calendar. A task has at most one block, so an existing one is moved. */
  scheduleTaskBlock: (task_id: string, date: string, start_time: string) => void

  // planning
  scheduleBlock: (habit_id: string, date: string, start_time: string, duration_min?: number) => ScheduledBlock
  moveBlock: (id: string, date: string, start_time: string) => void
  deleteBlock: (id: string) => void
  /** Remove every planned block in the given dates (and their Google events). Returns how many were removed. */
  clearBlocks: (dates: string[]) => number

  // meals
  setKronanToken: (t: string | null) => void
  addRecipe: (r: Omit<Recipe, 'id' | 'user_id' | 'created_at'>) => string
  updateRecipe: (id: string, patch: Partial<Recipe>) => void
  deleteRecipe: (id: string) => void
  planMeal: (recipe_id: string, week_start: string, day: number | null, servings?: number) => void
  updateMealPlan: (id: string, patch: Partial<MealPlan>) => void
  unplanMeal: (id: string) => void
  /** Ensures a weekly "Meal prep" habit exists and schedules it on the Sunday of the given week. */
  scheduleMealPrep: (week_start: string, time?: string) => void

  // google
  setGoogleConnected: (v: boolean) => void
  loadEvents: (from: Date, to: Date, force?: boolean) => Promise<void>
  syncBlockToGoogle: (block: ScheduledBlock) => Promise<void>
  /** Push (create or update) the Google events for the given blocks. Returns how many succeeded. */
  syncBlocksToGoogle: (blockIds: string[]) => Promise<{ ok: number; failed: number }>
}

export type Store = DataState & UIState & Actions

const now = () => new Date().toISOString()

const emptyData: CloudData = {
  habits: [], logs: [], blocks: [], recipes: [], mealPlans: [], projects: [], tasks: [],
}

export const DEFAULT_WORK_HOURS: WorkHours = { enabled: true, days: [0, 1, 2, 3, 4], start: '08:00', end: '16:00' }

const applyTheme = (t: Theme) => {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try { localStorage.setItem('habits-theme', t) } catch { /* ignore */ }
}

const initialTheme = (): Theme => {
  try {
    const t = localStorage.getItem('habits-theme')
    if (t === 'dark' || t === 'light') return t
  } catch { /* ignore */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const uidOf = () => get().user?.id ?? null

      return {
        ...emptyData,
        user: null,
        authReady: !supabase,
        theme: initialTheme(),
        tab: 'today',
        workHours: DEFAULT_WORK_HOURS,
        kronanToken: null,
        kronanSyncError: null,
        googleConnected: false,
        googleError: null,
        events: [],
        eventsRange: null,
        eventsLoading: false,
        toast: null,

        setTab: (tab) => set({ tab }),
        setTheme: (theme) => { applyTheme(theme); set({ theme }) },
        setWorkHours: (patch) => set({ workHours: { ...get().workHours, ...patch } }),
        showToast: (toast) => {
          set({ toast })
          setTimeout(() => { if (get().toast === toast) set({ toast: null }) }, 2200)
        },
        setUser: (user) => set({ user, authReady: true }),

        replaceAll: (d) => set({ ...d }),

        loadCloud: async () => {
          const cloud = await db.loadAll()
          if (!cloud) return
          const local = get()
          // Krónan token: the account copy wins; a token entered before signing in is pushed up.
          const saved = await db.loadKronanToken()
          set({ kronanSyncError: saved.error })
          if (saved.token) set({ kronanToken: saved.token })
          else if (!saved.error && local.kronanToken) void db.saveKronanToken(local.kronanToken).then((err) => set({ kronanSyncError: err }))
          const cloudEmpty = Object.values(cloud).every((arr) => arr.length === 0)
          const localHasData = local.habits.length > 0 || local.projects.length > 0 || local.tasks.length > 0
          if (cloudEmpty && localHasData) {
            // First sign-in on a device that already has local data: migrate it up.
            const u = uidOf()
            const stamp = <T extends { user_id: string | null }>(rows: T[]) => rows.map((r) => ({ ...r, user_id: u }))
            const migrated: CloudData = {
              habits: stamp(local.habits), logs: stamp(local.logs), blocks: stamp(local.blocks),
              recipes: stamp(local.recipes), mealPlans: stamp(local.mealPlans), projects: stamp(local.projects), tasks: stamp(local.tasks),
            }
            set({ ...migrated })
            await db.pushAll(migrated)
            get().showToast('Local data synced to your account')
            return
          }
          set({ ...cloud })
        },

        signOut: async () => {
          await supabase?.auth.signOut()
          google.clearGoogleCache()
          set({ ...emptyData, user: null, googleConnected: false, events: [], eventsRange: null, kronanToken: null, kronanSyncError: null })
        },

        // ---------------- habits ----------------
        addHabit: (h) => {
          const habit: Habit = {
            ...h, id: uid(), user_id: uidOf(), created_at: now(),
            sort_order: get().habits.length,
          }
          set({ habits: [...get().habits, habit] })
          db.upsert('habits', habit)
        },
        updateHabit: (id, patch) => {
          const before = get().habits.find((h) => h.id === id)
          const habits = get().habits.map((h) => (h.id === id ? { ...h, ...patch } : h))
          set({ habits })
          const row = habits.find((h) => h.id === id)
          if (!row) return
          db.upsert('habits', row)
          // A new name or icon should reach the Google events of its upcoming planned sessions.
          if (get().googleConnected && before && (before.name !== row.name || before.icon !== row.icon)) {
            const today = todayKey()
            for (const b of get().blocks) if (b.habit_id === id && b.date >= today) void get().syncBlockToGoogle(b).catch(() => { /* surfaced via googleError */ })
          }
        },
        reorderHabits: (ids) => {
          const byId = new Map(get().habits.map((h) => [h.id, h]))
          const ordered = ids.map((id, i) => ({ ...byId.get(id)!, sort_order: i }))
          const rest = get().habits.filter((h) => !ids.includes(h.id))
          set({ habits: [...ordered, ...rest] })
          db.upsert('habits', ordered)
        },
        deleteHabit: (id) => {
          set({
            habits: get().habits.filter((h) => h.id !== id),
            logs: get().logs.filter((l) => l.habit_id !== id),
            blocks: get().blocks.filter((b) => b.habit_id !== id),
          })
          db.remove('habits', id) // cascades in Postgres
        },
        toggleHabit: (habitId, date, subHabit = null) => {
          const existing = get().logs.find((l) => l.habit_id === habitId && l.date === date)
          if (existing && existing.completed && subHabit === null) {
            set({ logs: get().logs.filter((l) => l.id !== existing.id) })
            db.remove('habit_logs', existing.id)
            return
          }
          if (existing && existing.completed && subHabit !== null && existing.sub_habit === subHabit) {
            // tapping the same sub-habit again un-completes
            set({ logs: get().logs.filter((l) => l.id !== existing.id) })
            db.remove('habit_logs', existing.id)
            return
          }
          const log: HabitLog = {
            id: existing?.id ?? uid(), user_id: uidOf(), habit_id: habitId, date,
            completed: true, sub_habit: subHabit, created_at: existing?.created_at ?? now(),
          }
          set({ logs: [...get().logs.filter((l) => l.id !== log.id), log] })
          db.upsert('habit_logs', log)
        },

        // ---------------- goals (projects) ----------------
        addProject: (p) => {
          const project: Project = { ...p, id: uid(), user_id: uidOf(), created_at: now(), sort_order: get().projects.length }
          set({ projects: [...get().projects, project] })
          db.upsert('projects', project)
          return project.id
        },
        updateProject: (id, patch) => {
          const projects = get().projects.map((p) => (p.id === id ? { ...p, ...patch } : p))
          set({ projects })
          const row = projects.find((p) => p.id === id)
          if (row) {
            db.upsert('projects', row)
            // Title/colour changes should reach the mirrored calendar events too.
            if (get().googleConnected && (patch.title !== undefined)) {
              for (const b of get().blocks) if (b.project_id === id) void get().syncBlockToGoogle(b).catch(() => { /* surfaced via googleError */ })
            }
          }
        },
        deleteProject: (id) => {
          const gone = get().blocks.filter((b) => b.project_id === id)
          set({ projects: get().projects.filter((p) => p.id !== id), blocks: get().blocks.filter((b) => b.project_id !== id) })
          db.remove('projects', id) // cascades to scheduled_blocks in Postgres
          if (get().googleConnected) for (const b of gone) if (b.google_event_id) void google.deleteBlockEvent(b.google_event_id).catch((e) => console.warn(e))
        },
        scheduleProjectBlock: (project_id, date, start_time, duration_min) => {
          const b: ScheduledBlock = {
            id: uid(), user_id: uidOf(), habit_id: null, project_id, date, start_time, duration_min, google_event_id: null, done: false,
          }
          set({ blocks: [...get().blocks, b] })
          db.upsert('scheduled_blocks', b)
          if (get().googleConnected) void get().syncBlockToGoogle(b).catch(() => { /* surfaced via googleError */ })
          return b
        },
        toggleBlockDone: (id) => {
          const cur = get().blocks.find((b) => b.id === id)
          if (cur?.task_id) { get().toggleTask(cur.task_id); return }
          const blocks = get().blocks.map((b) => (b.id === id ? { ...b, done: !b.done } : b))
          set({ blocks })
          const row = blocks.find((b) => b.id === id)
          if (row) db.upsert('scheduled_blocks', row)
        },

        // ---------------- tasks ----------------
        addTask: (title, due_date = null, opts = {}) => {
          const t: Task = {
            id: uid(), user_id: uidOf(), title, due_date, duration_min: opts.duration_min ?? DEFAULT_TASK_MIN,
            done: false, done_at: null, ref: opts.ref ?? null, sort_order: get().tasks.length, created_at: now(),
          }
          set({ tasks: [...get().tasks, t] })
          db.upsert('tasks', t)
          return t.id
        },
        updateTask: (id, patch) => {
          const tasks = get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
          set({ tasks })
          const row = tasks.find((t) => t.id === id)
          if (!row) return
          db.upsert('tasks', row)
          const b = get().blocks.find((x) => x.task_id === id)
          if (b && patch.duration_min !== undefined && patch.duration_min !== b.duration_min) {
            const blocks = get().blocks.map((x) => (x.id === b.id ? { ...x, duration_min: patch.duration_min! } : x))
            set({ blocks })
            db.upsert('scheduled_blocks', blocks.find((x) => x.id === b.id)!)
          }
          const nb = get().blocks.find((x) => x.task_id === id)
          if (nb && get().googleConnected && (patch.title !== undefined || patch.duration_min !== undefined)) {
            void get().syncBlockToGoogle(nb).catch(() => { /* surfaced via googleError */ })
          }
        },
        toggleTask: (id) => {
          const cur = get().tasks.find((t) => t.id === id)
          if (!cur) return
          const done = !cur.done
          const tasks = get().tasks.map((t) => (t.id === id ? { ...t, done, done_at: done ? now() : null } : t))
          // A planned block mirrors its task so the calendar shows it struck through.
          const blocks = get().blocks.map((b) => (b.task_id === id ? { ...b, done } : b))
          set({ tasks, blocks })
          db.upsert('tasks', tasks.find((t) => t.id === id)!)
          const b = blocks.find((x) => x.task_id === id)
          if (b) db.upsert('scheduled_blocks', b)
        },
        deleteTask: (id) => {
          const gone = get().blocks.filter((b) => b.task_id === id)
          set({ tasks: get().tasks.filter((t) => t.id !== id), blocks: get().blocks.filter((b) => b.task_id !== id) })
          db.remove('tasks', id) // cascades to scheduled_blocks in Postgres
          if (get().googleConnected) for (const b of gone) if (b.google_event_id) void google.deleteBlockEvent(b.google_event_id).catch((e) => console.warn(e))
        },
        scheduleTaskBlock: (task_id, date, start_time) => {
          const task = get().tasks.find((t) => t.id === task_id)
          if (!task) return
          const existing = get().blocks.find((b) => b.task_id === task_id)
          if (existing) { get().moveBlock(existing.id, date, start_time); return }
          const b: ScheduledBlock = {
            id: uid(), user_id: uidOf(), habit_id: null, project_id: null, task_id, date, start_time,
            duration_min: task.duration_min, google_event_id: null, done: task.done,
          }
          set({ blocks: [...get().blocks, b] })
          db.upsert('scheduled_blocks', b)
          if (get().googleConnected) void get().syncBlockToGoogle(b).catch(() => { /* surfaced via googleError */ })
        },

        // ---------------- planning ----------------
        scheduleBlock: (habit_id, date, start_time, duration_min) => {
          const habit = get().habits.find((h) => h.id === habit_id)
          const b: ScheduledBlock = {
            id: uid(), user_id: uidOf(), habit_id, project_id: null, date, start_time,
            duration_min: duration_min ?? habit?.duration_min ?? 30, google_event_id: null, done: false,
          }
          set({ blocks: [...get().blocks, b] })
          db.upsert('scheduled_blocks', b)
          if (get().googleConnected) void get().syncBlockToGoogle(b).catch(() => { /* surfaced via googleError */ })
          return b
        },
        moveBlock: (id, date, start_time) => {
          const blocks = get().blocks.map((b) => (b.id === id ? { ...b, date, start_time } : b))
          set({ blocks })
          const row = blocks.find((b) => b.id === id)
          if (row) {
            db.upsert('scheduled_blocks', row)
            if (get().googleConnected) void get().syncBlockToGoogle(row).catch(() => { /* surfaced via googleError */ })
          }
        },
        deleteBlock: (id) => {
          const b = get().blocks.find((x) => x.id === id)
          set({ blocks: get().blocks.filter((x) => x.id !== id), events: get().events.filter((e) => e.habitBlockId !== id) })
          db.remove('scheduled_blocks', id)
          if (b?.google_event_id && get().googleConnected) {
            void google.deleteBlockEvent(b.google_event_id).catch((e) => console.warn(e))
          }
        },

        clearBlocks: (dates) => {
          const gone = get().blocks.filter((b) => dates.includes(b.date))
          if (!gone.length) return 0
          const ids = new Set(gone.map((b) => b.id))
          set({ blocks: get().blocks.filter((b) => !ids.has(b.id)), events: get().events.filter((e) => !e.habitBlockId || !ids.has(e.habitBlockId)) })
          db.remove('scheduled_blocks', [...ids])
          if (get().googleConnected) {
            for (const b of gone) if (b.google_event_id) void google.deleteBlockEvent(b.google_event_id).catch((e) => console.warn(e))
          }
          return gone.length
        },

        // ---------------- meals ----------------
        setKronanToken: (kronanToken) => {
          set({ kronanToken })
          if (get().user) void db.saveKronanToken(kronanToken).then((err) => set({ kronanSyncError: err }))
        },
        addRecipe: (r) => {
          const recipe: Recipe = { ...r, id: uid(), user_id: uidOf(), created_at: now() }
          set({ recipes: [...get().recipes, recipe] })
          db.upsert('recipes', recipe)
          return recipe.id
        },
        updateRecipe: (id, patch) => {
          const recipes = get().recipes.map((r) => (r.id === id ? { ...r, ...patch } : r))
          set({ recipes })
          const row = recipes.find((r) => r.id === id)
          if (row) db.upsert('recipes', row)
        },
        deleteRecipe: (id) => {
          removePhoto(get().recipes.find((r) => r.id === id)?.image)
          set({ recipes: get().recipes.filter((r) => r.id !== id), mealPlans: get().mealPlans.filter((m) => m.recipe_id !== id) })
          db.remove('recipes', id)
        },
        planMeal: (recipe_id, week_start, day, servings) => {
          const recipe = get().recipes.find((r) => r.id === recipe_id)
          const m: MealPlan = { id: uid(), user_id: uidOf(), recipe_id, week_start, day, servings: servings ?? recipe?.servings ?? 4, cooked: false }
          set({ mealPlans: [...get().mealPlans, m] })
          db.upsert('meal_plans', m)
        },
        updateMealPlan: (id, patch) => {
          const mealPlans = get().mealPlans.map((m) => (m.id === id ? { ...m, ...patch } : m))
          set({ mealPlans })
          const row = mealPlans.find((m) => m.id === id)
          if (row) db.upsert('meal_plans', row)
        },
        unplanMeal: (id) => {
          set({ mealPlans: get().mealPlans.filter((m) => m.id !== id) })
          db.remove('meal_plans', id)
        },
        scheduleMealPrep: (week_start, time = '14:00') => {
          let habit = get().habits.find((h) => h.name.toLowerCase() === 'meal prep')
          if (!habit) {
            get().addHabit({ name: 'Meal prep', icon: '🥗', color: '#22c55e', frequency: 'weekly', target_count: 1, sub_habits: [], default_time: time, preferred_days: [6], duration_min: 90, archived: false })
            habit = get().habits.find((h) => h.name.toLowerCase() === 'meal prep')
          }
          if (!habit) return
          if (habit.archived) get().updateHabit(habit.id, { archived: false })
          const sunday = ymd(addDays(new Date(week_start + 'T00:00:00'), 6))
          const already = get().blocks.some((b) => b.habit_id === habit!.id && b.date === sunday)
          if (!already) get().scheduleBlock(habit.id, sunday, time, habit.duration_min)
          // One "Shop for meal prep" to-do per prep week, due on prep day. Re-confirming never duplicates it.
          const ref = `meal-prep:${week_start}`
          if (!get().tasks.some((t) => t.ref === ref)) get().addTask('Shop for meal prep', sunday, { duration_min: 60, ref })
        },

        // ---------------- google ----------------
        setGoogleConnected: (googleConnected) => set({ googleConnected, googleError: null }),
        loadEvents: async (from, to, force = false) => {
          if (!get().googleConnected) return
          const range = { from: ymd(from), to: ymd(to) }
          const cur = get().eventsRange
          if (!force && cur && cur.from <= range.from && cur.to >= range.to) return
          // Always fetch a generous window: this week - 1 .. + 5 weeks so Today/Calendar share the cache.
          const wFrom = addDays(weekStart(from), -7)
          const wTo = addDays(weekEnd(to), 35)
          set({ eventsLoading: true })
          try {
            const events = await google.listEvents(wFrom, wTo)
            set({ events, eventsRange: { from: ymd(wFrom), to: ymd(wTo) }, googleError: null })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            set({ googleError: msg })
            if (e instanceof google.GoogleAuthError) set({ googleConnected: false })
          } finally {
            set({ eventsLoading: false })
          }
        },
        syncBlockToGoogle: async (block) => {
          const look = blockLook(block, get().habits, get().projects, get().tasks)
          if (!look) return
          try {
            const eventId = await google.upsertBlockEvent(block, look)
            if (eventId !== block.google_event_id) {
              const blocks = get().blocks.map((b) => (b.id === block.id ? { ...b, google_event_id: eventId } : b))
              set({ blocks })
              const row = blocks.find((b) => b.id === block.id)
              if (row) db.upsert('scheduled_blocks', row)
            }
            // refresh cache so the Today stream shows the mirrored event
            const r = get().eventsRange
            if (r) void get().loadEvents(new Date(r.from), new Date(r.to), true)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            set({ googleError: msg })
            if (e instanceof google.GoogleAuthError) set({ googleConnected: false })
            throw e
          }
        },
        syncBlocksToGoogle: async (blockIds) => {
          let ok = 0, failed = 0
          for (const id of blockIds) {
            const block = get().blocks.find((b) => b.id === id)
            if (!block) continue
            try { await get().syncBlockToGoogle(block); ok++ } catch { failed++; if (!get().googleConnected) break }
          }
          return { ok, failed }
        },
      }
    },
    {
      name: 'habits-store',
      version: 2,
      migrate: (persisted, version) => (version < 2 ? migrateToV2(persisted as Record<string, unknown>) : persisted) as Store,
      partialize: (s) => ({
        habits: s.habits, logs: s.logs, blocks: s.blocks, recipes: s.recipes, mealPlans: s.mealPlans, projects: s.projects, tasks: s.tasks,
        theme: s.theme, tab: s.tab, kronanToken: s.kronanToken, workHours: s.workHours,
        googleConnected: s.googleConnected,
      }),
      onRehydrateStorage: () => (state) => { if (state) applyTheme(state.theme) },
    },
  ),
)

/**
 * v1 → v2 (app simplification): old goals and their sub-tasks become goals with steps, "extra"
 * trackers are archived, and lists / day reflections are dropped. Mirrors migration 0009 for
 * local-only data; signed-in users get their data from the cloud anyway.
 */
function migrateToV2(s: Record<string, unknown>) {
  type OldGoal = { id: string; user_id: string | null; title: string; target_date: string | null; done: boolean; sort_order: number; created_at: string }
  type OldGoalTask = { id: string; goal_id: string; title: string; done: boolean; sort_order: number }
  const goals = (s.goals as OldGoal[] | undefined) ?? []
  const goalTasks = (s.goalTasks as OldGoalTask[] | undefined) ?? []
  const projects = ((s.projects as Project[] | undefined) ?? []).map(normalizeProject)
  const known = new Set(projects.map((p) => p.id))
  const converted: Project[] = goals.filter((g) => !known.has(g.id)).map((g, i) => ({
    id: g.id, user_id: g.user_id, title: g.title, course: '', due_date: g.target_date, difficulty: 'medium', hours_est: 0,
    session_min: 60, color: '#6366f1', done: g.done, notes: '', sort_order: projects.length + i, created_at: g.created_at,
    steps: goalTasks.filter((t) => t.goal_id === g.id).sort((a, b) => a.sort_order - b.sort_order).map((t): GoalStep => ({ id: t.id, title: t.title, done: t.done })),
  }))
  const habits = ((s.habits as (Habit & { is_extra?: boolean })[] | undefined) ?? []).map(({ is_extra, ...h }) => (is_extra ? { ...h, archived: true } : h))
  const tab = s.tab === 'lists' ? 'goals' : s.tab === 'planner' ? 'calendar' : s.tab
  const { goals: _g, goalTasks: _gt, lists: _l, listItems: _li, reflections: _r, listsMode: _m, ...rest } = s
  return { ...rest, habits, projects: [...projects, ...converted], tab }
}

// ---------- selectors / helpers ----------
/** Active habits sorted by order. Memoised so the selector never returns a fresh array reference. */
export const useActiveHabits = () => {
  const habits = useStore((s) => s.habits)
  return useMemo(() => habits.filter((h) => !h.archived).sort((a, b) => a.sort_order - b.sort_order), [habits])
}

export const useTodayLogs = () => {
  const logs = useStore((s) => s.logs)
  const t = todayKey()
  return useMemo(() => logs.filter((l) => l.date === t && l.completed), [logs, t])
}

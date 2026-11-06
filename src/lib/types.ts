export type Frequency = 'daily' | 'weekly' | 'monthly'

export interface Habit {
  id: string
  user_id: string | null
  name: string
  icon: string
  color: string
  frequency: Frequency
  /** Target completions per week (weekly) or per month (monthly). Daily habits use 1. */
  target_count: number
  sub_habits: string[]
  /** Preferred time of day (HH:mm): one time for every preferred day. */
  default_time: string | null
  /**
   * Preferred days, 0 = Monday … 6 = Sunday; empty = any day. A planning preference only: the
   * planner books weekly/monthly habits on these days first, and a daily habit's time is only
   * reserved on them. Older habits may lack the field, so read it with preferredDays().
   */
  preferred_days?: number[]
  duration_min: number
  sort_order: number
  archived: boolean
  created_at: string
}

export interface HabitLog {
  id: string
  user_id: string | null
  habit_id: string
  date: string // YYYY-MM-DD
  completed: boolean
  sub_habit: string | null
  created_at: string
}

export type Difficulty = 'easy' | 'medium' | 'hard'

/** One checklist step of a goal. */
export interface GoalStep {
  id: string
  title: string
  done: boolean
}

/**
 * A goal (stored in the `projects` table): an optional due date, optional hours that are booked as
 * one-hour sessions on the calendar, and optional steps to tick off.
 */
export interface Project {
  id: string
  user_id: string | null
  title: string
  /** Course or module name (unused in the UI, kept for old rows). */
  course: string
  due_date: string | null // YYYY-MM-DD
  difficulty: Difficulty
  /** Total hours to book on the calendar; 0 = nothing to schedule. */
  hours_est: number
  /** Length of one session in minutes. */
  session_min: number
  color: string
  done: boolean
  notes: string
  steps: GoalStep[]
  sort_order: number
  created_at: string
}

/** One-time to-do: checked off once, optionally due on a date and planned on the calendar. */
export interface Task {
  id: string
  user_id: string | null
  title: string
  due_date: string | null // YYYY-MM-DD
  /** Time to book when the task is planned on the calendar. */
  duration_min: number
  done: boolean
  done_at: string | null // ISO
  /** Set on tasks the app creates itself (e.g. 'meal-prep:2026-10-05') so they are not duplicated. */
  ref: string | null
  sort_order: number
  created_at: string
}

/** A planned block: a habit session (habit_id), a project study session (project_id) or a task (task_id). */
export interface ScheduledBlock {
  id: string
  user_id: string | null
  habit_id: string | null
  project_id?: string | null
  task_id?: string | null
  date: string
  start_time: string // HH:mm
  duration_min: number
  google_event_id: string | null
  /** Project sessions are ticked off directly (habits use habit_logs). */
  done?: boolean
}

export interface CalendarEvent {
  id: string
  title: string
  start: string // ISO
  end: string // ISO
  allDay: boolean
  /** Display name of the calendar the event came from (e.g. "Work"). */
  calendar?: string
  /** Calendar colour from Google (subscribed calendars only). */
  color?: string
  /** Set when this Google event mirrors one of our scheduled blocks. */
  habitBlockId?: string
}

/** Macros per 100 g (or 100 ml). */
export interface Macros {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export interface RecipeIngredient {
  name: string
  /** Packages / units to BUY (the "need to buy" quantity). */
  qty: number
  unit: string
  /** Price per unit in ISK (whole króna). 0 = unknown. */
  price: number
  /** Krónan product number when the ingredient is linked to a product. */
  sku: string | null
  thumbnail: string | null
  note: string
  /** Amount actually USED in the dish (null = whole packages). */
  used_qty?: number | null
  /** Unit of used_qty: 'g' | 'ml' | 'stk'. */
  used_unit?: string
  /** Grams (or ml) per package/unit, when known. */
  pack_g?: number | null
  /** Raw nutrition table from Krónan (label → value, per 100 g). */
  nutrition?: Record<string, string> | null
  /** Parsed macros per 100 g. */
  macros?: Macros | null
  /** Raw Krónan pricing/size fields the pack size was derived from (for inspection). */
  source?: { price: number; pricePerKilo: number | null; baseComparisonUnit: string | null; qtyPerBaseCompUnit: number | null; qtyInSalesUnit: number | null; chargedByWeight: boolean } | null
}

export interface Recipe {
  id: string
  user_id: string | null
  title: string
  source: 'custom' | 'kronan'
  kronan_slug: string | null
  url: string | null
  image: string | null
  servings: number
  ingredients: RecipeIngredient[]
  directions: string
  tags: string[]
  /** Estimated cost in ISK for `servings` portions. */
  est_cost: number
  created_at: string
}

export interface MealPlan {
  id: string
  user_id: string | null
  recipe_id: string
  /** Monday of the week whose Sunday is prep day (week_start + 6); the meals are eaten the week after. */
  week_start: string // YYYY-MM-DD
  /** 0 = Monday … 6 = Sunday; null = anytime / prep day. */
  day: number | null
  servings: number
  cooked: boolean
}

/** Hours auto-planning must not fill. A habit's own ideal time (e.g. gym at 12:00) is still allowed. */
export interface WorkHours {
  enabled: boolean
  /** 0 = Monday … 6 = Sunday */
  days: number[]
  start: string // HH:mm
  end: string // HH:mm
}

export type Tab = 'today' | 'calendar' | 'meals' | 'goals' | 'settings'
export type Theme = 'light' | 'dark'

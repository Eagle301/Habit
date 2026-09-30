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
  /** Preferred time of day (HH:mm); used in the schedule stream for daily habits. */
  default_time: string | null
  duration_min: number
  sort_order: number
  archived: boolean
  /** "Just for fun" tracker: logged and streaked, but never counted toward the daily goal. */
  is_extra?: boolean
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

export interface Reflection {
  id: string
  user_id: string | null
  date: string
  score: number // 1..5
  note: string
}

export interface Goal {
  id: string
  user_id: string | null
  title: string
  target_date: string | null
  done: boolean
  linked_habit_ids: string[]
  sort_order: number
  created_at: string
}

export interface GoalTask {
  id: string
  user_id: string | null
  goal_id: string
  title: string
  done: boolean
  sort_order: number
}

export interface List {
  id: string
  user_id: string | null
  name: string
  sort_order: number
  created_at: string
}

export interface ListItem {
  id: string
  user_id: string | null
  list_id: string
  text: string
  done: boolean
  sort_order: number
}

export interface ScheduledBlock {
  id: string
  user_id: string | null
  habit_id: string
  date: string
  start_time: string // HH:mm
  duration_min: number
  google_event_id: string | null
}

export interface CalendarEvent {
  id: string
  title: string
  start: string // ISO
  end: string // ISO
  allDay: boolean
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
  week_start: string // YYYY-MM-DD (Monday)
  /** 0 = Monday … 6 = Sunday; null = anytime / prep day. */
  day: number | null
  servings: number
  cooked: boolean
}

export type Tab = 'today' | 'calendar' | 'lists' | 'planner' | 'settings'
export type Theme = 'light' | 'dark'

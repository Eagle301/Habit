-- Habits: full schema (0001_init + 0002_meals). Safe to re-run.

-- Habit Tracker schema. Every table is owned by a user and protected by RLS.
create extension if not exists "pgcrypto";

-- ---------- habits ----------
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null default '✅',
  color text not null default '#6366f1',
  frequency text not null default 'daily' check (frequency in ('daily','weekly','monthly')),
  target_count int not null default 1 check (target_count >= 1),
  sub_habits jsonb not null default '[]'::jsonb,
  default_time text,
  duration_min int not null default 30,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists habits_user_idx on public.habits(user_id);

-- ---------- habit_logs ----------
create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  completed boolean not null default true,
  sub_habit text,
  created_at timestamptz not null default now(),
  unique (habit_id, date)
);
create index if not exists habit_logs_user_date_idx on public.habit_logs(user_id, date);

-- ---------- reflections ----------
create table if not exists public.reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  score int not null check (score between 1 and 5),
  note text not null default '',
  unique (user_id, date)
);

-- ---------- goals ----------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  target_date date,
  done boolean not null default false,
  linked_habit_ids uuid[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals(user_id);

create table if not exists public.goal_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_order int not null default 0
);
create index if not exists goal_tasks_goal_idx on public.goal_tasks(goal_id);

-- ---------- lists ----------
create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists lists_user_idx on public.lists(user_id);

create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  sort_order int not null default 0
);
create index if not exists list_items_list_idx on public.list_items(list_id);

-- ---------- scheduled_blocks (planner) ----------
create table if not exists public.scheduled_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  start_time text not null,
  duration_min int not null default 30,
  google_event_id text
);
create index if not exists scheduled_blocks_user_date_idx on public.scheduled_blocks(user_id, date);

-- ---------- google_tokens (refresh token storage; read only by the server) ----------
create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.reflections enable row level security;
alter table public.goals enable row level security;
alter table public.goal_tasks enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.scheduled_blocks enable row level security;
alter table public.google_tokens enable row level security;

do $$
declare t text;
begin
  foreach t in array array['habits','habit_logs','reflections','goals','goal_tasks','lists','list_items','scheduled_blocks']
  loop
    execute format('drop policy if exists "%1$s_owner" on public.%1$I', t);
    execute format(
      'create policy "%1$s_owner" on public.%1$I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

-- Users may write their own refresh token (from the OAuth callback) but never read it back.
drop policy if exists "google_tokens_insert" on public.google_tokens;
create policy "google_tokens_insert" on public.google_tokens
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "google_tokens_update" on public.google_tokens;
create policy "google_tokens_update" on public.google_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "google_tokens_delete" on public.google_tokens;
create policy "google_tokens_delete" on public.google_tokens
  for delete to authenticated using (auth.uid() = user_id);

-- Lightweight existence check the client can call without exposing the token.
create or replace function public.has_google_token()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.google_tokens where user_id = auth.uid());
$$;
grant execute on function public.has_google_token() to authenticated;

-- Meal prep: recipe library + weekly meal plans.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source text not null default 'custom' check (source in ('custom','kronan')),
  kronan_slug text,
  url text,
  image text,
  servings int not null default 4,
  ingredients jsonb not null default '[]'::jsonb,
  directions text not null default '',
  tags text[] not null default '{}',
  est_cost int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists recipes_user_idx on public.recipes(user_id);

create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  week_start date not null,
  day int check (day between 0 and 6),
  servings int not null default 4,
  cooked boolean not null default false
);
create index if not exists meal_plans_user_week_idx on public.meal_plans(user_id, week_start);

alter table public.recipes enable row level security;
alter table public.meal_plans enable row level security;

drop policy if exists "recipes_owner" on public.recipes;
create policy "recipes_owner" on public.recipes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "meal_plans_owner" on public.meal_plans;
create policy "meal_plans_owner" on public.meal_plans for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

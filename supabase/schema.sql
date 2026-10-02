-- Habits: full schema (0001_init … 0007_tasks). Safe to re-run.

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

-- Save Google tokens through a definer function so the client never needs SELECT/UPSERT rights
-- on google_tokens (the refresh token must stay unreadable from the browser).

alter table public.google_tokens alter column refresh_token drop not null;

create or replace function public.save_google_token(p_refresh text, p_access text, p_expires timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.google_tokens (user_id, refresh_token, access_token, expires_at, updated_at)
  values (auth.uid(), p_refresh, p_access, p_expires, now())
  on conflict (user_id) do update set
    -- keep an existing refresh token if Google did not return a new one this time
    refresh_token = coalesce(excluded.refresh_token, public.google_tokens.refresh_token),
    access_token = excluded.access_token,
    expires_at = excluded.expires_at,
    updated_at = now();
end $$;
grant execute on function public.save_google_token(text, text, timestamptz) to authenticated;

create or replace function public.delete_google_token()
returns void language sql security definer set search_path = public as $$
  delete from public.google_tokens where user_id = auth.uid();
$$;
grant execute on function public.delete_google_token() to authenticated;

-- "Connected" means we hold either a refresh token or a still-valid access token.
create or replace function public.has_google_token()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.google_tokens
    where user_id = auth.uid()
      and (refresh_token is not null or (expires_at is not null and expires_at > now()))
  );
$$;

-- "Extra" trackers: logged for fun, excluded from the daily goal and analytics.
alter table public.habits add column if not exists is_extra boolean not null default false;

-- Krónan API access token, stored per user so it survives sign-out / new devices.
-- Unlike google_tokens, the browser must read it back (it calls the Krónan API directly through the
-- proxy), so it is a plain RLS-owned table: each user can only see and change their own row.
create table if not exists public.kronan_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);
alter table public.kronan_tokens enable row level security;
drop policy if exists "kronan_tokens_owner" on public.kronan_tokens;
create policy "kronan_tokens_owner" on public.kronan_tokens for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- projects (0006) ----------
-- School / work projects whose estimated hours are scheduled as study sessions in the Planner.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  course text not null default '',
  due_date date,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  hours_est numeric not null default 4,
  session_min int not null default 60,
  color text not null default '#0ea5e9',
  done boolean not null default false,
  notes text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects(user_id);
alter table public.projects enable row level security;
drop policy if exists "projects_owner" on public.projects;
create policy "projects_owner" on public.projects for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A scheduled block now belongs to either a habit or a project, and project sessions are ticked off directly.
alter table public.scheduled_blocks alter column habit_id drop not null;
alter table public.scheduled_blocks add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.scheduled_blocks add column if not exists done boolean not null default false;
alter table public.scheduled_blocks drop constraint if exists scheduled_blocks_target_chk;
alter table public.scheduled_blocks add constraint scheduled_blocks_target_chk check (habit_id is not null or project_id is not null);

-- One-time tasks: checked off once, optionally due on a date and placed in the Planner.
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  due_date date,
  duration_min int not null default 30,
  done boolean not null default false,
  done_at timestamptz,
  ref text, -- set on app-created tasks (e.g. 'meal-prep:2026-10-05') to avoid duplicates
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tasks_user_idx on public.tasks(user_id);
alter table public.tasks enable row level security;
drop policy if exists "tasks_owner" on public.tasks;
create policy "tasks_owner" on public.tasks for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A scheduled block can now also be a task placed in the Planner.
alter table public.scheduled_blocks add column if not exists task_id uuid references public.tasks(id) on delete cascade;
alter table public.scheduled_blocks drop constraint if exists scheduled_blocks_target_chk;
alter table public.scheduled_blocks add constraint scheduled_blocks_target_chk
  check (habit_id is not null or project_id is not null or task_id is not null);

-- Daily reminder push notifications.
-- One row per device that allowed notifications (a user can have several: phone, laptop, ...).
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_owner" on public.push_subscriptions;
create policy "push_subscriptions_owner" on public.push_subscriptions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- When to remind. `time` is local wall-clock time (HH:mm) in `timezone` (IANA, e.g. Atlantic/Reykjavik).
-- The scheduled function netlify/functions/daily-reminder.ts reads this with the service role and
-- stamps last_sent_date so each user gets at most one reminder per local day.
create table if not exists public.reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  time text not null default '21:00' check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'UTC',
  last_sent_date date,
  updated_at timestamptz not null default now()
);
alter table public.reminder_settings enable row level security;
drop policy if exists "reminder_settings_owner" on public.reminder_settings;
create policy "reminder_settings_owner" on public.reminder_settings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

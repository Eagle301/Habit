-- =====================================================================================
-- Habits app: every database change from the November 2026 rework, in one script.
--
--   1. Goals + projects merged     (projects table, steps checklist, old goals copied in)
--   2. To-dos on the calendar      (tasks table, scheduled_blocks.task_id)
--   3. "Extra" trackers retired    (archived, history kept)
--   4. Recipe photos               (recipe-photos storage bucket + owner-only policies)
--   5. Preferred days for habits   (habits.preferred_days)
--
-- Paste it all into Supabase → SQL editor → Run. It is safe to run more than once:
-- everything is "if not exists" / "on conflict do nothing", and it runs as one transaction,
-- so either all of it applies or none of it does.
--
-- Nothing is deleted. The old goals, goal_tasks, lists, list_items and reflections tables are
-- left in place; the optional clean-up at the very end (commented out) removes them.
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1a. Projects table (goals live here). Already there if migration 0006 was run.
-- -------------------------------------------------------------------------------------
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

-- Goal sessions are planned blocks that belong to a project and can be ticked off.
alter table public.scheduled_blocks alter column habit_id drop not null;
alter table public.scheduled_blocks add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.scheduled_blocks add column if not exists done boolean not null default false;

-- -------------------------------------------------------------------------------------
-- 1b. Goals get a checklist of steps: [{ "id": "...", "title": "...", "done": false }, ...]
-- -------------------------------------------------------------------------------------
alter table public.projects add column if not exists steps jsonb not null default '[]'::jsonb;

-- -------------------------------------------------------------------------------------
-- 1c. Copy every old goal (with its sub-tasks as steps) into projects. The goal keeps its id,
--     so re-running never duplicates. hours_est = 0 means "nothing to schedule".
--     Skipped automatically if the old goals tables don't exist.
-- -------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.goals') is not null and to_regclass('public.goal_tasks') is not null then
    insert into public.projects (id, user_id, title, due_date, hours_est, color, done, sort_order, created_at, steps)
    select
      g.id, g.user_id, g.title, g.target_date, 0, '#6366f1', g.done,
      coalesce((select max(p.sort_order) + 1 from public.projects p where p.user_id = g.user_id), 0) + g.sort_order,
      g.created_at,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'done', t.done) order by t.sort_order)
        from public.goal_tasks t where t.goal_id = g.id
      ), '[]'::jsonb)
    from public.goals g
    on conflict (id) do nothing;
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 2. To-dos (one-time tasks) that can be planned on the calendar. Already there if 0007 ran.
-- -------------------------------------------------------------------------------------
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

alter table public.scheduled_blocks add column if not exists task_id uuid references public.tasks(id) on delete cascade;
-- A planned block is a habit, a goal session or a to-do.
alter table public.scheduled_blocks drop constraint if exists scheduled_blocks_target_chk;
alter table public.scheduled_blocks add constraint scheduled_blocks_target_chk
  check (habit_id is not null or project_id is not null or task_id is not null);

-- -------------------------------------------------------------------------------------
-- 3. "Extra" trackers are gone from the app: archive them (history kept, restorable in Settings).
--    Skipped if the is_extra column was never added.
-- -------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'habits' and column_name = 'is_extra') then
    update public.habits set archived = true, is_extra = false where is_extra;
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 4. Recipe photos. Files live at recipe-photos/<user id>/<random id>.jpg.
--    Public-read so <img> tags can load them (links contain a random id); only the owner can
--    add, replace or delete files. Until this exists the app stores a small copy in the recipe.
-- -------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "recipe_photos_insert_own" on storage.objects;
create policy "recipe_photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recipe_photos_update_own" on storage.objects;
create policy "recipe_photos_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recipe_photos_delete_own" on storage.objects;
create policy "recipe_photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- -------------------------------------------------------------------------------------
-- 5. Preferred days for habits (0 = Monday … 6 = Sunday; empty = any day), used together with
--    the habit's single preferred time when planning.
-- -------------------------------------------------------------------------------------
alter table public.habits add column if not exists preferred_days smallint[] not null default '{}';

-- The automatic "Meal prep" habit is a Sunday thing.
update public.habits set preferred_days = '{6}' where lower(name) = 'meal prep' and preferred_days = '{}';

-- -------------------------------------------------------------------------------------
-- Ask the API to pick up the new columns right away (otherwise it can take a minute).
-- -------------------------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;

-- =====================================================================================
-- Quick check (optional): run on its own afterwards. Every row should say "ok".
-- =====================================================================================
-- select 'projects.steps' as item, case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='steps') then 'ok' else 'MISSING' end as status
-- union all select 'tasks table', case when to_regclass('public.tasks') is not null then 'ok' else 'MISSING' end
-- union all select 'scheduled_blocks.task_id', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='scheduled_blocks' and column_name='task_id') then 'ok' else 'MISSING' end
-- union all select 'habits.preferred_days', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='habits' and column_name='preferred_days') then 'ok' else 'MISSING' end
-- union all select 'recipe-photos bucket', case when exists (select 1 from storage.buckets where id='recipe-photos') then 'ok' else 'MISSING' end;

-- =====================================================================================
-- Optional clean-up, ONLY once you're happy everything carried over (this deletes data for good):
-- =====================================================================================
-- drop table if exists public.goal_tasks, public.goals, public.list_items, public.lists, public.reflections;

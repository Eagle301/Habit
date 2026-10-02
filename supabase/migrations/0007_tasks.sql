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

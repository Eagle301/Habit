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

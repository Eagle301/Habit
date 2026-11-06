-- App simplification: goals and projects become one "goal" (stored in public.projects), "extra"
-- trackers go away, and lists and day reflections are no longer used.
-- Run this once in the Supabase SQL editor BEFORE deploying the app version that needs it:
-- the app writes projects.steps, which fails until the column exists.

-- 1. Goals get a checklist of steps: [{ "id": "...", "title": "...", "done": false }, ...]
alter table public.projects add column if not exists steps jsonb not null default '[]'::jsonb;

-- 2. Copy every old goal (with its sub-tasks as steps) into projects. The goal keeps its id, so
--    running this twice never duplicates anything. hours_est = 0: nothing to schedule.
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

-- 3. "Extra" trackers are archived (their history is kept and they can be restored in Settings).
update public.habits set archived = true, is_extra = false where is_extra;

-- The goals, goal_tasks, lists, list_items and reflections tables are left in place so nothing is
-- lost. Once you are happy with the new app you can remove them:
--   drop table public.goal_tasks, public.goals, public.list_items, public.lists, public.reflections;

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

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

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

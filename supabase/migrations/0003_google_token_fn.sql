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

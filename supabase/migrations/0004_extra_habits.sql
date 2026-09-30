-- "Extra" trackers: logged for fun, excluded from the daily goal and analytics.
alter table public.habits add column if not exists is_extra boolean not null default false;

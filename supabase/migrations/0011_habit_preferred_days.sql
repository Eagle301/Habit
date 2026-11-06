-- Preferred days for a habit (0 = Monday … 6 = Sunday; empty = any day), used with its one
-- preferred time when planning. Run this before deploying the app version that saves it: until the
-- column exists, saving a habit fails.
alter table public.habits add column if not exists preferred_days smallint[] not null default '{}';

-- The automatic "Meal prep" habit is a Sunday thing.
update public.habits set preferred_days = '{6}' where lower(name) = 'meal prep' and preferred_days = '{}';

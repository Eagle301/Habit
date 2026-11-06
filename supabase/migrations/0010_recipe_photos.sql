-- Photos taken for recipes. Files live at recipe-photos/<user id>/<random id>.jpg.
-- The bucket is public-read so <img> tags can load photos directly; paths contain a random UUID,
-- so a photo can only be seen by someone who has its link. Only the owner can add or delete files.
-- Until this runs, the app keeps a smaller copy of each photo inside the recipe row instead.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "recipe_photos_insert_own" on storage.objects;
create policy "recipe_photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recipe_photos_update_own" on storage.objects;
create policy "recipe_photos_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recipe_photos_delete_own" on storage.objects;
create policy "recipe_photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

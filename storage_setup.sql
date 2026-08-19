-- STLP Training Material Storage
-- Run this once in Supabase SQL Editor.

insert into storage.buckets (id, name, public)
values ('training-materials', 'training-materials', false)
on conflict (id) do nothing;

create policy "training_materials_admin_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'training-materials'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

create policy "training_materials_authenticated_read"
on storage.objects for select
to authenticated
using (bucket_id = 'training-materials');

create policy "training_materials_admin_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'training-materials'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
)
with check (
  bucket_id = 'training-materials'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

create policy "training_materials_admin_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'training-materials'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

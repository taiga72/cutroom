-- Cutroom database setup. Paste this whole file into Supabase > SQL Editor and click Run.
-- Safe to run again.

-- Every job, client, task and the settings record is one row, owned by the person who made it.
create table if not exists public.docs (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  col        text not null check (col in ('jobs', 'clients', 'tasks', 'settings')),
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id)
);
alter table public.docs enable row level security;

drop policy if exists "Read own docs" on public.docs;
drop policy if exists "Add own docs" on public.docs;
drop policy if exists "Change own docs" on public.docs;
drop policy if exists "Delete own docs" on public.docs;
create policy "Read own docs"   on public.docs for select to authenticated using (auth.uid() = user_id);
create policy "Add own docs"    on public.docs for insert to authenticated with check (auth.uid() = user_id);
create policy "Change own docs" on public.docs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own docs" on public.docs for delete to authenticated using (auth.uid() = user_id);

-- Google Calendar connections. No policies on purpose: only the Vercel functions
-- (using the service role key) can read these, never the browser.
create table if not exists public.gcal_links (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  calendar_id   text,
  email         text,
  last_sync     timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);
alter table public.gcal_links enable row level security;

-- Pictures (job/client/app logos) and brand guide PDFs. Files live in a folder named
-- after the owner's user id. The bucket is public so pictures load by their
-- (random, unguessable) address; only the owner can add, replace or delete them.
-- Also holds brand guide PDFs (up to 20 MB each).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pictures', 'pictures', true, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Cutroom pictures read own"   on storage.objects;
drop policy if exists "Cutroom pictures add own"    on storage.objects;
drop policy if exists "Cutroom pictures change own" on storage.objects;
drop policy if exists "Cutroom pictures delete own" on storage.objects;
create policy "Cutroom pictures read own"   on storage.objects for select to authenticated
  using (bucket_id = 'pictures' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Cutroom pictures add own"    on storage.objects for insert to authenticated
  with check (bucket_id = 'pictures' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Cutroom pictures change own" on storage.objects for update to authenticated
  using (bucket_id = 'pictures' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Cutroom pictures delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'pictures' and (storage.foldername(name))[1] = auth.uid()::text);

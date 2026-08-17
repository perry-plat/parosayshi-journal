create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.folders (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  note text not null default '',
  material text not null default 'kraft' check (material in ('kraft', 'moss', 'clay', 'charcoal')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.papers (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id text not null references public.folders(id) on delete cascade,
  text text not null default '',
  prompt text not null default '',
  desk_x double precision,
  desk_y double precision,
  desk_order integer,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.ink_strokes (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  paper_id text not null references public.papers(id) on delete cascade,
  points jsonb not null check (jsonb_typeof(points) = 'array'),
  color text not null,
  width double precision not null,
  angle double precision not null,
  seed double precision not null,
  brush_version integer not null default 1,
  committed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.paper_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  paper_id text not null references public.papers(id) on delete cascade,
  text text not null,
  revision bigint not null,
  source_device text,
  created_at timestamptz not null default now(),
  unique (paper_id, revision)
);

create index if not exists folders_owner_order_idx on public.folders(owner_id, sort_order) where deleted_at is null;
create index if not exists papers_owner_folder_idx on public.papers(owner_id, folder_id) where deleted_at is null;
create index if not exists ink_strokes_owner_paper_idx on public.ink_strokes(owner_id, paper_id);
create index if not exists paper_versions_owner_paper_idx on public.paper_versions(owner_id, paper_id, revision desc);

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.papers enable row level security;
alter table public.ink_strokes enable row level security;
alter table public.paper_versions enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "folders_select_own" on public.folders for select to authenticated using ((select auth.uid()) = owner_id);
create policy "folders_insert_own" on public.folders for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "folders_update_own" on public.folders for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "folders_delete_own" on public.folders for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "papers_select_own" on public.papers for select to authenticated using ((select auth.uid()) = owner_id);
create policy "papers_insert_own" on public.papers for insert to authenticated with check (
  (select auth.uid()) = owner_id and exists (
    select 1 from public.folders where folders.id = folder_id and folders.owner_id = (select auth.uid())
  )
);
create policy "papers_update_own" on public.papers for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "papers_delete_own" on public.papers for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "ink_select_own" on public.ink_strokes for select to authenticated using ((select auth.uid()) = owner_id);
create policy "ink_insert_own" on public.ink_strokes for insert to authenticated with check (
  (select auth.uid()) = owner_id and exists (
    select 1 from public.papers where papers.id = paper_id and papers.owner_id = (select auth.uid())
  )
);
create policy "ink_delete_own" on public.ink_strokes for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "versions_select_own" on public.paper_versions for select to authenticated using ((select auth.uid()) = owner_id);
create policy "versions_insert_own" on public.paper_versions for insert to authenticated with check (
  (select auth.uid()) = owner_id and exists (
    select 1 from public.papers where papers.id = paper_id and papers.owner_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.folders to authenticated;
grant select, insert, update, delete on public.papers to authenticated;
grant select, insert, delete on public.ink_strokes to authenticated;
grant select, insert on public.paper_versions to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

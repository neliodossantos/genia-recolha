create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  role text not null default 'signer' check (role in ('signer', 'admin')),
  created_at timestamptz not null default now()
);

create table public.vocabulary (
  id serial primary key,
  word text unique not null,
  position int not null,
  active boolean not null default true
);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  word_id int not null references public.vocabulary (id),
  video_key text not null,
  landmarks_key text not null,
  duration_ms int not null check (duration_ms > 0),
  width int,
  height int,
  mime text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index recordings_user_word_idx on public.recordings (user_id, word_id);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.vocabulary enable row level security;
alter table public.recordings enable row level security;

create policy "own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "admin reads profiles" on public.profiles
  for select to authenticated using (public.is_admin());

create policy "authenticated reads vocabulary" on public.vocabulary
  for select to authenticated using (true);
create policy "admin writes vocabulary" on public.vocabulary
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "signer inserts own recordings" on public.recordings
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.vocabulary v where v.id = word_id and v.active)
  );
create policy "signer reads own recordings" on public.recordings
  for select to authenticated using (user_id = auth.uid());
create policy "admin reads recordings" on public.recordings
  for select to authenticated using (public.is_admin());

create view public.recording_counts with (security_invoker = true) as
  select user_id, word_id, count(*)::int as count
  from public.recordings
  group by user_id, word_id;

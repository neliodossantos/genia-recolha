-- Recordings are inserted by the client (RLS) as well as by the upload route, so the
-- database itself must constrain what a row may contain.
alter table public.recordings
  add constraint recordings_video_key_prefix
    check (video_key like user_id::text || '/%'),
  add constraint recordings_landmarks_key_prefix
    check (landmarks_key like user_id::text || '/%'),
  add constraint recordings_mime_allowed
    check (mime is null or mime ~ '^video/(webm|mp4)($|;)'),
  add constraint recordings_dims_sane
    check ((width is null or width between 0 and 8192)
       and (height is null or height between 0 and 8192));

-- A username collision must not abort signup: fall back to a suffixed username.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := split_part(new.email, '@', 1);
  chosen text := base;
begin
  if exists (select 1 from public.profiles where username = base) then
    chosen := base || '_' || substr(new.id::text, 1, 8);
  end if;
  insert into public.profiles (id, username) values (new.id, chosen);
  return new;
end;
$$;

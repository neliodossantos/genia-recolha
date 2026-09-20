begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ana@lga.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'bruno@lga.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'admin@lga.local');

update public.profiles set role = 'admin'
  where id = '00000000-0000-0000-0000-0000000000c3';

insert into public.vocabulary (id, word, position, active) values
  (900, 'teste-ativa', 900, true),
  (901, 'teste-inativa', 901, false);

insert into public.recordings (user_id, word_id, video_key, landmarks_key, duration_ms)
values ('00000000-0000-0000-0000-0000000000b2', 900,
        '00000000-0000-0000-0000-0000000000b2/1.webm',
        '00000000-0000-0000-0000-0000000000b2/1.json', 1500);

create function pg_temp.try_update() returns int language plpgsql as $$
declare n int;
begin
  update public.recordings set duration_ms = 1
    where user_id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  return n;
end $$;

create function pg_temp.try_delete() returns int language plpgsql as $$
declare n int;
begin
  delete from public.recordings
    where user_id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  return n;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$insert into public.recordings (user_id, word_id, video_key, landmarks_key, duration_ms)
    values ('00000000-0000-0000-0000-0000000000a1', 900,
            '00000000-0000-0000-0000-0000000000a1/1.webm',
            '00000000-0000-0000-0000-0000000000a1/1.json', 2000)$$,
  'signer inserts own recording'
);

select throws_ok(
  $$insert into public.recordings (user_id, word_id, video_key, landmarks_key, duration_ms)
    values ('00000000-0000-0000-0000-0000000000b2', 900,
            '00000000-0000-0000-0000-0000000000b2/2.webm',
            '00000000-0000-0000-0000-0000000000b2/2.json', 2000)$$,
  '42501', null, 'signer cannot insert for another user'
);

select throws_ok(
  $$insert into public.recordings (user_id, word_id, video_key, landmarks_key, duration_ms)
    values ('00000000-0000-0000-0000-0000000000a1', 901,
            '00000000-0000-0000-0000-0000000000a1/2.webm',
            '00000000-0000-0000-0000-0000000000a1/2.json', 2000)$$,
  '42501', null, 'signer cannot insert for an inactive word'
);

select throws_ok(
  $$insert into public.recordings (user_id, word_id, video_key, landmarks_key, duration_ms)
    values ('00000000-0000-0000-0000-0000000000a1', 900,
            'evil/1.webm',
            '00000000-0000-0000-0000-0000000000a1/3.json', 2000)$$,
  '23514', null, 'video_key must start with the user id'
);

select is(
  (select count(*)::int from public.recordings), 1,
  'signer only sees own recordings'
);

select is(
  pg_temp.try_update(), 0,
  'signer cannot update recordings'
);

select is(
  pg_temp.try_delete(), 0,
  'signer cannot delete recordings'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is(
  (select count(*)::int from public.recordings), 2,
  'admin sees all recordings'
);

select * from finish();
rollback;

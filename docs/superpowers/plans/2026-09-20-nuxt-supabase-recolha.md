# Recolha LGA em Nuxt + Supabase + R2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Nuxt web app where signers log in with a username, record LGA gestures (video + MediaPipe hand landmarks) and have them stored in Supabase (metadata) and Cloudflare R2 (files).

**Architecture:** A client-only Nuxt 3 app (`ssr: false`) deployed on Cloudflare Pages. The browser runs MediaPipe and MediaRecorder, then posts video + landmarks to one Nitro route (`POST /api/recordings`), which validates the Supabase JWT, writes both files to R2 through a binding, and inserts the metadata row under the user's own JWT so Postgres RLS applies. Authentication, vocabulary and progress use Supabase directly from the browser.

**Tech Stack:** Nuxt 3, TypeScript, Nuxt UI v3 (Tailwind 4), `@supabase/supabase-js`, `@mediapipe/tasks-vision` (vendored, no CDN), Cloudflare Pages + R2 (Nitro preset `cloudflare-pages`), Supabase CLI (migrations + pgTAP), Vitest, Node.js 20+.

**Spec:** [docs/superpowers/specs/2026-09-19-nuxt-supabase-recolha-design.md](../specs/2026-09-19-nuxt-supabase-recolha-design.md)

## Global Constraints

- The new app lives in `web/`; the existing `backend/` and `frontend/` directories are not modified or deleted by this plan.
- Nuxt runs with `ssr: false`; server code exists only as Nitro routes.
- Files in R2 are named by the server: `<user_id>/<recording_id>.<webm|mp4>` and `<user_id>/<recording_id>.json`; the client never chooses paths (spec: "o cliente nunca escolhe caminhos").
- Recording limits: video max 10 MB, landmarks max 2 MB, `duration_ms` max 15 000 (spec, "Validação na rota de upload").
- Target per word is 20 recordings (spec: "meta").
- The word only changes when the user clicks "Próxima palavra" (spec, fluxo passo 7).
- Landmark frame format: `{ t, hands: [{ handedness, points: [{x,y,z}] }] }` with `t` in ms relative to the recording start (spec, fluxo passo 4).
- Auth is Supabase Auth with username + password; the email is synthetic `<username-slug>@<domain>` and no email verification is used.
- Bucket R2 is private; Supabase service-role keys are never sent to the client and are not used at all in this plan.
- UI text is in European Portuguese.
- The spec allows only `video/webm`; this plan also accepts `video/mp4` because the spec's error-handling section requires Safari support through `MediaRecorder.isTypeSupported`.
- MediaPipe wasm and model are served from `web/public/mediapipe/` (no CDN), because the spec flags limited connectivity in Angola.

---

## File Structure

```
web/
  package.json, nuxt.config.ts, vitest.config.ts, wrangler.toml
  .gitignore, .env.example, README.md
  app.vue
  assets/css/main.css
  scripts/copy-mediapipe.mjs
  public/mediapipe/                    (wasm copied by script, hand_landmarker.task downloaded)
  supabase/
    config.toml                        (created by `supabase init`)
    migrations/0001_init.sql           tables, trigger, RLS, view
    seed.sql                           starter vocabulary
    tests/rls.test.sql                 pgTAP policy tests
  utils/
    username.ts                        slug + synthetic email
    mime.ts                            MediaRecorder mime choice
    words.ts                           pickNextWord
    landmarks.ts                       landmark buffer
    camera.ts                          camera error messages
    uploadClient.ts                    POST /api/recordings from the browser
    csv.ts                             CSV export for admin
  server/
    utils/recordingUpload.ts           upload validation + orchestration (pure, DI)
    api/recordings.post.ts             Nitro glue: JWT, R2 binding, Supabase client
  plugins/supabase.client.ts           supabase-js client
  composables/
    useAuth.ts                         session, signUp, signIn, signOut
    useHandTracker.ts                  MediaPipe HandLandmarker wrapper
    useRecorder.ts                     camera + MediaRecorder
  middleware/auth.global.ts            redirect to /login when signed out
  pages/
    login.vue, index.vue (recording), progress.vue, admin.vue
  tests/
    username.test.ts, mime.test.ts, words.test.ts, landmarks.test.ts,
    camera.test.ts, recordingUpload.test.ts, uploadClient.test.ts, csv.test.ts
```

---

### Task 1: Scaffold the Nuxt project

**Files:**
- Create: `web/` (via `nuxi init`), `web/nuxt.config.ts`, `web/app.vue`, `web/assets/css/main.css`, `web/vitest.config.ts`, `web/wrangler.toml`, `web/.env.example`, `web/.gitignore`, `web/scripts/copy-mediapipe.mjs`
- Modify: `web/package.json`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm test` (Vitest, `tests/**/*.test.ts`); runtime config keys `public.supabaseUrl`, `public.supabaseAnonKey`, `public.emailDomain`; R2 binding name `RECORDINGS_BUCKET`; MediaPipe assets under `/mediapipe/`.

- [ ] **Step 1: Create the project and install dependencies**

From the repository root:

```bash
npx nuxi@latest init web --packageManager npm --gitInit false
cd web
npm install @nuxt/ui tailwindcss @supabase/supabase-js @mediapipe/tasks-vision nitro-cloudflare-dev
npm install -D vitest wrangler @types/node
```

If `nuxi init` asks whether to install official modules, answer no.

- [ ] **Step 2: Write the configuration files**

`web/nuxt.config.ts`:
```ts
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@nuxt/ui', 'nitro-cloudflare-dev'],
  css: ['~/assets/css/main.css'],
  nitro: { preset: 'cloudflare-pages' },
  runtimeConfig: {
    public: {
      supabaseUrl: '',
      supabaseAnonKey: '',
      emailDomain: 'lga.local',
    },
  },
})
```

`web/assets/css/main.css`:
```css
@import "tailwindcss";
@import "@nuxt/ui";
```

`web/app.vue`:
```vue
<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
```

`web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

`web/wrangler.toml`:
```toml
name = "lga-recolha"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist"

[[r2_buckets]]
binding = "RECORDINGS_BUCKET"
bucket_name = "lga-recordings"
```

`web/.env.example`:
```
NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NUXT_PUBLIC_SUPABASE_ANON_KEY=
NUXT_PUBLIC_EMAIL_DOMAIN=lga.local
```

`web/.gitignore`:
```
node_modules
.nuxt
.output
dist
.env
.wrangler
```

- [ ] **Step 3: Vendor the MediaPipe assets**

`web/scripts/copy-mediapipe.mjs`:
```js
import { cpSync, mkdirSync } from 'node:fs'

const from = 'node_modules/@mediapipe/tasks-vision/wasm'
const to = 'public/mediapipe/wasm'
mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })
console.log(`MediaPipe wasm copied to ${to}`)
```

In `web/package.json`, set these scripts (keep the ones `nuxi init` created for `dev`, `build`, `generate`, `preview`):
```json
{
  "scripts": {
    "postinstall": "nuxt prepare && node scripts/copy-mediapipe.mjs",
    "test": "vitest run"
  }
}
```

Then run:
```bash
npm run postinstall
curl -L -o public/mediapipe/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
ls public/mediapipe
```
Expected: `hand_landmarker.task` (about 7 MB) and a `wasm` directory. Both are committed to the repository.

- [ ] **Step 4: Verify the build and the test runner**

Run: `npm run build`
Expected: build completes and creates `dist/`.

Run: `npm test -- --passWithNoTests`
Expected: exit code 0.

- [ ] **Step 5: Commit**

From the repository root:
```bash
git add web
git commit -m "feat: scaffold Nuxt app with Nuxt UI, Cloudflare preset and vendored MediaPipe"
```

---

### Task 2: Supabase schema, RLS and policy tests

**Files:**
- Create: `web/supabase/config.toml` (via CLI), `web/supabase/migrations/0001_init.sql`, `web/supabase/seed.sql`, `web/supabase/tests/rls.test.sql`

**Interfaces:**
- Produces: tables `profiles(id, username, role, created_at)`, `vocabulary(id, word, position, active)`, `recordings(id, user_id, word_id, video_key, landmarks_key, duration_ms, width, height, mime, user_agent, created_at)`; view `recording_counts(user_id, word_id, count)` (security invoker, so RLS applies); function `public.is_admin()`. Later tasks query these exact names.

Requires Docker and the Supabase CLI (`npm install -D supabase` inside `web/`, then `npx supabase ...`).

- [ ] **Step 1: Initialise Supabase**

```bash
cd web
npm install -D supabase
npx supabase init
```
When asked about VS Code/IntelliJ settings, answer no.

- [ ] **Step 2: Write the pgTAP test first**

`web/supabase/tests/rls.test.sql`:
```sql
begin;
select plan(6);

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
values ('00000000-0000-0000-0000-0000000000b2', 900, 'b/1.webm', 'b/1.json', 1500);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$insert into public.recordings (user_id, word_id, video_key, landmarks_key, duration_ms)
    values ('00000000-0000-0000-0000-0000000000a1', 900, 'a/1.webm', 'a/1.json', 2000)$$,
  'signer inserts own recording'
);

select throws_ok(
  $$insert into public.recordings (user_id, word_id, video_key, landmarks_key, duration_ms)
    values ('00000000-0000-0000-0000-0000000000b2', 900, 'x/1.webm', 'x/1.json', 2000)$$,
  '42501', null, 'signer cannot insert for another user'
);

select throws_ok(
  $$insert into public.recordings (user_id, word_id, video_key, landmarks_key, duration_ms)
    values ('00000000-0000-0000-0000-0000000000a1', 901, 'a/2.webm', 'a/2.json', 2000)$$,
  '42501', null, 'signer cannot insert for an inactive word'
);

select is(
  (select count(*)::int from public.recordings), 1,
  'signer only sees own recordings'
);

select is(
  (with u as (
     update public.recordings set duration_ms = 1
     where user_id = '00000000-0000-0000-0000-0000000000a1' returning 1
   ) select count(*)::int from u),
  0, 'signer cannot update recordings'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is(
  (select count(*)::int from public.recordings), 2,
  'admin sees all recordings'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Start the local stack and confirm the test fails**

```bash
npx supabase start
npx supabase test db
```
Expected: FAIL (the tables do not exist yet).

- [ ] **Step 4: Write the migration**

`web/supabase/migrations/0001_init.sql`:
```sql
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
```

`web/supabase/seed.sql`:
```sql
insert into public.vocabulary (word, position) values
  ('olá', 1), ('obrigado', 2), ('por favor', 3), ('sim', 4), ('não', 5),
  ('água', 6), ('comida', 7), ('ajuda', 8), ('casa', 9), ('bom dia', 10),
  ('boa noite', 11), ('desculpa', 12), ('1', 13), ('2', 14), ('3', 15),
  ('4', 16), ('5', 17);
```

- [ ] **Step 5: Apply and run the policy tests**

```bash
npx supabase db reset
npx supabase test db
```
Expected: PASS (6 tests). If a pgTAP call is not found after `set local role authenticated`, prefix the pgTAP functions with `extensions.` in the test file and re-run.

- [ ] **Step 6: Commit**

```bash
cd ..
git add web/supabase web/package.json web/package-lock.json
git commit -m "feat: add Supabase schema with RLS, vocabulary seed and pgTAP tests"
```

---

### Task 3: Username and MIME utilities

**Files:**
- Create: `web/utils/username.ts`, `web/utils/mime.ts`
- Test: `web/tests/username.test.ts`, `web/tests/mime.test.ts`

**Interfaces:**
- Produces:
  - `toUsernameSlug(input: string): string`
  - `isValidUsername(slug: string): boolean` (3 to 32 chars)
  - `toAuthEmail(input: string, domain: string): string`
  - `pickMimeType(isSupported: (type: string) => boolean): string | null`
  - `fileExtensionFor(mime: string): 'webm' | 'mp4'`

- [ ] **Step 1: Write the failing tests**

`web/tests/username.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { isValidUsername, toAuthEmail, toUsernameSlug } from '../utils/username'

describe('toUsernameSlug', () => {
  it('strips accents and replaces spaces', () => {
    expect(toUsernameSlug('Nélio Santos')).toBe('nelio_santos')
  })
  it('trims and removes punctuation', () => {
    expect(toUsernameSlug('  Ana!! ')).toBe('ana')
  })
  it('collapses repeated separators', () => {
    expect(toUsernameSlug('a - - b')).toBe('a_b')
  })
  it('returns an empty string for only symbols', () => {
    expect(toUsernameSlug('!!!')).toBe('')
  })
})

describe('isValidUsername', () => {
  it('requires 3 to 32 characters', () => {
    expect(isValidUsername('ab')).toBe(false)
    expect(isValidUsername('abc')).toBe(true)
    expect(isValidUsername('a'.repeat(33))).toBe(false)
  })
})

describe('toAuthEmail', () => {
  it('builds a synthetic email from the slug', () => {
    expect(toAuthEmail('Nélio Santos', 'lga.local')).toBe('nelio_santos@lga.local')
  })
})
```

`web/tests/mime.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fileExtensionFor, pickMimeType } from '../utils/mime'

describe('pickMimeType', () => {
  it('picks the first supported candidate', () => {
    expect(pickMimeType(() => true)).toBe('video/webm;codecs=vp9')
  })
  it('falls through to mp4 when only mp4 is supported', () => {
    expect(pickMimeType((t) => t === 'video/mp4')).toBe('video/mp4')
  })
  it('returns null when nothing is supported', () => {
    expect(pickMimeType(() => false)).toBeNull()
  })
})

describe('fileExtensionFor', () => {
  it('maps mime types to extensions', () => {
    expect(fileExtensionFor('video/mp4')).toBe('mp4')
    expect(fileExtensionFor('video/webm;codecs=vp9')).toBe('webm')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run tests/username.test.ts tests/mime.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`web/utils/username.ts`:
```ts
export const USERNAME_MIN = 3
export const USERNAME_MAX = 32

export function toUsernameSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function isValidUsername(slug: string): boolean {
  return slug.length >= USERNAME_MIN && slug.length <= USERNAME_MAX
}

export function toAuthEmail(input: string, domain: string): string {
  return `${toUsernameSlug(input)}@${domain}`
}
```

`web/utils/mime.ts`:
```ts
const CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
]

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return CANDIDATES.find(isSupported) ?? null
}

export function fileExtensionFor(mime: string): 'webm' | 'mp4' {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run tests/username.test.ts tests/mime.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add web/utils web/tests
git commit -m "feat: add username slug and MIME selection utilities"
```

---

### Task 4: Word selection and landmark buffer

**Files:**
- Create: `web/utils/words.ts`, `web/utils/landmarks.ts`
- Test: `web/tests/words.test.ts`, `web/tests/landmarks.test.ts`

**Interfaces:**
- Produces:
  - `interface VocabWord { id: number; word: string; position: number }`
  - `pickNextWord(words: VocabWord[], counts: Record<number, number>, target: number, skipped: ReadonlySet<number>): VocabWord | null` (null only when every word reached the target; when every remaining word was skipped it falls back to the skipped ones)
  - `interface HandPoint { x: number; y: number; z: number }`
  - `interface HandFrame { handedness: 'Left' | 'Right' | null; points: HandPoint[] }`
  - `interface LandmarkFrame { t: number; hands: HandFrame[] }`
  - `interface RawHandResult { landmarks: HandPoint[][]; handedness?: { categoryName: string }[][] }`
  - `interface LandmarkBuffer { startMs: number; frames: LandmarkFrame[] }`
  - `createLandmarkBuffer(startMs: number): LandmarkBuffer`
  - `addFrame(buffer: LandmarkBuffer, nowMs: number, result: RawHandResult | null): LandmarkBuffer`
  - `serializeBuffer(buffer: LandmarkBuffer): string`

- [ ] **Step 1: Write the failing tests**

`web/tests/words.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { pickNextWord, type VocabWord } from '../utils/words'

const words: VocabWord[] = [
  { id: 1, word: 'olá', position: 1 },
  { id: 2, word: 'obrigado', position: 2 },
  { id: 3, word: 'sim', position: 3 },
]
const none = new Set<number>()

describe('pickNextWord', () => {
  it('returns the first word when nothing was recorded', () => {
    expect(pickNextWord(words, {}, 20, none)?.id).toBe(1)
  })
  it('prefers the word with the fewest recordings', () => {
    expect(pickNextWord(words, { 1: 10, 2: 3, 3: 8 }, 20, none)?.id).toBe(2)
  })
  it('skips words in the skipped set', () => {
    expect(pickNextWord(words, {}, 20, new Set([1]))?.id).toBe(2)
  })
  it('falls back to skipped words when every remaining word was skipped', () => {
    expect(pickNextWord(words, { 1: 20 }, 20, new Set([2, 3]))?.id).toBe(2)
  })
  it('never returns words that reached the target', () => {
    expect(pickNextWord(words, { 1: 20, 2: 20 }, 20, new Set([3]))?.id).toBe(3)
  })
  it('returns null when every word reached the target', () => {
    expect(pickNextWord(words, { 1: 20, 2: 20, 3: 20 }, 20, none)).toBeNull()
  })
})
```

`web/tests/landmarks.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { addFrame, createLandmarkBuffer, serializeBuffer } from '../utils/landmarks'

const point = { x: 0.1, y: 0.2, z: 0.3 }

describe('landmark buffer', () => {
  it('starts empty', () => {
    expect(createLandmarkBuffer(1000).frames).toEqual([])
  })

  it('stores timestamps relative to the start and the handedness', () => {
    const buffer = createLandmarkBuffer(1000)
    addFrame(buffer, 1250.4, {
      landmarks: [[point]],
      handedness: [[{ categoryName: 'Left' }]],
    })
    expect(buffer.frames).toEqual([
      { t: 250, hands: [{ handedness: 'Left', points: [point] }] },
    ])
  })

  it('records no hands when the result is null', () => {
    const buffer = createLandmarkBuffer(0)
    addFrame(buffer, 100, null)
    expect(buffer.frames[0].hands).toEqual([])
  })

  it('uses null handedness when it is missing or unknown', () => {
    const buffer = createLandmarkBuffer(0)
    addFrame(buffer, 100, { landmarks: [[point]] })
    addFrame(buffer, 200, {
      landmarks: [[point]],
      handedness: [[{ categoryName: 'Other' }]],
    })
    expect(buffer.frames[0].hands[0].handedness).toBeNull()
    expect(buffer.frames[1].hands[0].handedness).toBeNull()
  })

  it('serializes the frames as JSON', () => {
    const buffer = createLandmarkBuffer(0)
    addFrame(buffer, 50, { landmarks: [[point]] })
    expect(JSON.parse(serializeBuffer(buffer))).toEqual(buffer.frames)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run tests/words.test.ts tests/landmarks.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`web/utils/words.ts`:
```ts
export interface VocabWord {
  id: number
  word: string
  position: number
}

export function pickNextWord(
  words: VocabWord[],
  counts: Record<number, number>,
  target: number,
  skipped: ReadonlySet<number>,
): VocabWord | null {
  const ordered = [...words].sort((a, b) => a.position - b.position)
  const below = ordered.filter((w) => (counts[w.id] ?? 0) < target)
  const notSkipped = below.filter((w) => !skipped.has(w.id))
  const candidates = notSkipped.length > 0 ? notSkipped : below

  let best: VocabWord | null = null
  for (const w of candidates) {
    if (best === null || (counts[w.id] ?? 0) < (counts[best.id] ?? 0)) {
      best = w
    }
  }
  return best
}
```

`web/utils/landmarks.ts`:
```ts
export interface HandPoint {
  x: number
  y: number
  z: number
}

export interface HandFrame {
  handedness: 'Left' | 'Right' | null
  points: HandPoint[]
}

export interface LandmarkFrame {
  t: number
  hands: HandFrame[]
}

export interface RawHandResult {
  landmarks: HandPoint[][]
  handedness?: { categoryName: string }[][]
}

export interface LandmarkBuffer {
  startMs: number
  frames: LandmarkFrame[]
}

export function createLandmarkBuffer(startMs: number): LandmarkBuffer {
  return { startMs, frames: [] }
}

function toHandedness(name: string | undefined): 'Left' | 'Right' | null {
  return name === 'Left' || name === 'Right' ? name : null
}

export function addFrame(
  buffer: LandmarkBuffer,
  nowMs: number,
  result: RawHandResult | null,
): LandmarkBuffer {
  const hands: HandFrame[] = (result?.landmarks ?? []).map((points, i) => ({
    handedness: toHandedness(result?.handedness?.[i]?.[0]?.categoryName),
    points: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  }))
  buffer.frames.push({ t: Math.round(nowMs - buffer.startMs), hands })
  return buffer
}

export function serializeBuffer(buffer: LandmarkBuffer): string {
  return JSON.stringify(buffer.frames)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run tests/words.test.ts tests/landmarks.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add web/utils web/tests
git commit -m "feat: add word selection and landmark buffer utilities"
```

---

### Task 5: Upload handler and Nitro route

**Files:**
- Create: `web/server/utils/recordingUpload.ts`, `web/server/api/recordings.post.ts`
- Test: `web/tests/recordingUpload.test.ts`

**Interfaces:**
- Consumes: `fileExtensionFor(mime: string)` from `web/utils/mime.ts` (Task 3).
- Produces:
  - `class UploadError extends Error { status: number }`
  - `interface NewRecording { id: string; user_id: string; word_id: number; video_key: string; landmarks_key: string; duration_ms: number; width: number | null; height: number | null; mime: string; user_agent: string | null }`
  - `interface UploadDeps { authenticate(token: string): Promise<{ id: string } | null>; wordIsActive(wordId: number): Promise<boolean>; putObject(key: string, body: Uint8Array, contentType: string): Promise<void>; deleteObjects(keys: string[]): Promise<void>; insertRecording(row: NewRecording): Promise<{ error: string | null }>; newId(): string }`
  - `interface UploadInput { token: string | null; wordId: number; durationMs: number; width: number | null; height: number | null; userAgent: string | null; video: { type: string; size: number; bytes: Uint8Array }; landmarks: { size: number; text: string } }`
  - `handleRecordingUpload(deps: UploadDeps, input: UploadInput): Promise<{ id: string }>`
  - HTTP: `POST /api/recordings`, header `Authorization: Bearer <jwt>`, multipart fields `word_id`, `duration_ms`, `width`, `height`, `video` (file), `landmarks` (file or text with the JSON); response `{ id }`; errors carry `statusMessage`.

- [ ] **Step 1: Write the failing tests**

`web/tests/recordingUpload.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import {
  handleRecordingUpload,
  UploadError,
  type UploadDeps,
  type UploadInput,
} from '../server/utils/recordingUpload'

function makeDeps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    authenticate: vi.fn(async () => ({ id: 'user-1' })),
    wordIsActive: vi.fn(async () => true),
    putObject: vi.fn(async () => {}),
    deleteObjects: vi.fn(async () => {}),
    insertRecording: vi.fn(async () => ({ error: null })),
    newId: () => 'rec-1',
    ...overrides,
  }
}

function makeInput(overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    token: 'jwt',
    wordId: 1,
    durationMs: 2000,
    width: 640,
    height: 480,
    userAgent: 'test-agent',
    video: { type: 'video/webm;codecs=vp9', size: 1000, bytes: new Uint8Array(1000) },
    landmarks: { size: 2, text: '[]' },
    ...overrides,
  }
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise
  } catch (err) {
    if (err instanceof UploadError) return err.status
    throw err
  }
  return 200
}

describe('handleRecordingUpload', () => {
  it('rejects a missing token with 401', async () => {
    expect(await statusOf(handleRecordingUpload(makeDeps(), makeInput({ token: null })))).toBe(401)
  })

  it('rejects an invalid token with 401', async () => {
    const deps = makeDeps({ authenticate: vi.fn(async () => null) })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(401)
  })

  it('rejects an unknown or inactive word with 400', async () => {
    const deps = makeDeps({ wordIsActive: vi.fn(async () => false) })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(400)
  })

  it('rejects an invalid duration with 400', async () => {
    expect(await statusOf(handleRecordingUpload(makeDeps(), makeInput({ durationMs: 0 })))).toBe(400)
    expect(await statusOf(handleRecordingUpload(makeDeps(), makeInput({ durationMs: 15001 })))).toBe(400)
  })

  it('rejects an unsupported video type with 400', async () => {
    const input = makeInput({ video: { type: 'image/png', size: 10, bytes: new Uint8Array(10) } })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('rejects a video over 10 MB with 400', async () => {
    const input = makeInput({
      video: { type: 'video/webm', size: 10 * 1024 * 1024 + 1, bytes: new Uint8Array(1) },
    })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('rejects landmarks that are not valid JSON with 400', async () => {
    const input = makeInput({ landmarks: { size: 8, text: 'not-json' } })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('rejects landmarks that are not an array with 400', async () => {
    const input = makeInput({ landmarks: { size: 2, text: '{}' } })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('stores both files under server-generated keys and inserts the row', async () => {
    const deps = makeDeps()
    const result = await handleRecordingUpload(deps, makeInput())

    expect(result).toEqual({ id: 'rec-1' })
    expect(deps.putObject).toHaveBeenCalledWith(
      'user-1/rec-1.webm',
      expect.any(Uint8Array),
      'video/webm;codecs=vp9',
    )
    expect(deps.putObject).toHaveBeenCalledWith(
      'user-1/rec-1.json',
      expect.any(Uint8Array),
      'application/json',
    )
    expect(deps.insertRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'rec-1',
        user_id: 'user-1',
        word_id: 1,
        video_key: 'user-1/rec-1.webm',
        landmarks_key: 'user-1/rec-1.json',
        duration_ms: 2000,
        mime: 'video/webm;codecs=vp9',
      }),
    )
  })

  it('deletes both objects and returns 500 when the insert fails', async () => {
    const deps = makeDeps({ insertRecording: vi.fn(async () => ({ error: 'boom' })) })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(500)
    expect(deps.deleteObjects).toHaveBeenCalledWith(['user-1/rec-1.webm', 'user-1/rec-1.json'])
  })

  it('deletes both objects and returns 500 when a storage write fails', async () => {
    const putObject = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('r2 down'))
    const deps = makeDeps({ putObject })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(500)
    expect(deps.deleteObjects).toHaveBeenCalledWith(['user-1/rec-1.webm', 'user-1/rec-1.json'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run tests/recordingUpload.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the handler**

`web/server/utils/recordingUpload.ts`:
```ts
import { fileExtensionFor } from '../../utils/mime'

export const MAX_VIDEO_BYTES = 10 * 1024 * 1024
export const MAX_LANDMARKS_BYTES = 2 * 1024 * 1024
export const MAX_DURATION_MS = 15_000

export class UploadError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface NewRecording {
  id: string
  user_id: string
  word_id: number
  video_key: string
  landmarks_key: string
  duration_ms: number
  width: number | null
  height: number | null
  mime: string
  user_agent: string | null
}

export interface UploadDeps {
  authenticate(token: string): Promise<{ id: string } | null>
  wordIsActive(wordId: number): Promise<boolean>
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>
  deleteObjects(keys: string[]): Promise<void>
  insertRecording(row: NewRecording): Promise<{ error: string | null }>
  newId(): string
}

export interface UploadInput {
  token: string | null
  wordId: number
  durationMs: number
  width: number | null
  height: number | null
  userAgent: string | null
  video: { type: string; size: number; bytes: Uint8Array }
  landmarks: { size: number; text: string }
}

export async function handleRecordingUpload(
  deps: UploadDeps,
  input: UploadInput,
): Promise<{ id: string }> {
  if (!input.token) throw new UploadError(401, 'missing token')
  const user = await deps.authenticate(input.token)
  if (!user) throw new UploadError(401, 'invalid token')

  if (!Number.isInteger(input.wordId) || !(await deps.wordIsActive(input.wordId))) {
    throw new UploadError(400, 'unknown word')
  }
  if (
    !Number.isInteger(input.durationMs) ||
    input.durationMs <= 0 ||
    input.durationMs > MAX_DURATION_MS
  ) {
    throw new UploadError(400, 'invalid duration')
  }
  if (!/^video\/(webm|mp4)/.test(input.video.type)) {
    throw new UploadError(400, 'unsupported video type')
  }
  if (input.video.size <= 0 || input.video.size > MAX_VIDEO_BYTES) {
    throw new UploadError(400, 'video too large')
  }
  if (input.landmarks.size > MAX_LANDMARKS_BYTES) {
    throw new UploadError(400, 'landmarks too large')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input.landmarks.text)
  } catch {
    throw new UploadError(400, 'landmarks must be valid JSON')
  }
  if (!Array.isArray(parsed)) throw new UploadError(400, 'landmarks must be a JSON array')

  const id = deps.newId()
  const videoKey = `${user.id}/${id}.${fileExtensionFor(input.video.type)}`
  const landmarksKey = `${user.id}/${id}.json`

  try {
    await deps.putObject(videoKey, input.video.bytes, input.video.type)
    await deps.putObject(
      landmarksKey,
      new TextEncoder().encode(input.landmarks.text),
      'application/json',
    )
  } catch {
    await deps.deleteObjects([videoKey, landmarksKey])
    throw new UploadError(500, 'could not store files')
  }

  const { error } = await deps.insertRecording({
    id,
    user_id: user.id,
    word_id: input.wordId,
    video_key: videoKey,
    landmarks_key: landmarksKey,
    duration_ms: input.durationMs,
    width: input.width,
    height: input.height,
    mime: input.video.type,
    user_agent: input.userAgent,
  })
  if (error) {
    await deps.deleteObjects([videoKey, landmarksKey])
    throw new UploadError(500, 'could not save recording')
  }

  return { id }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run tests/recordingUpload.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Write the Nitro route**

This glue is verified by the manual end-to-end check in Task 10, not by unit tests.

`web/server/api/recordings.post.ts`:
```ts
import { createClient } from '@supabase/supabase-js'
import { handleRecordingUpload, UploadError } from '../utils/recordingUpload'

interface R2Bucket {
  put(key: string, body: Uint8Array, options?: { httpMetadata?: { contentType: string } }): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const authorization = getHeader(event, 'authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null

  const parts = await readMultipartFormData(event)
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: 'multipart body required' })
  }
  const part = (name: string) => parts.find((p) => p.name === name)
  const text = (name: string) => part(name)?.data.toString('utf-8') ?? ''
  const optionalNumber = (name: string) => {
    const value = text(name)
    return value === '' ? null : Number(value)
  }

  const videoPart = part('video')
  const landmarksPart = part('landmarks')
  if (!videoPart || !landmarksPart) {
    throw createError({ statusCode: 400, statusMessage: 'video and landmarks are required' })
  }

  const bucket = (event.context.cloudflare?.env?.RECORDINGS_BUCKET ?? null) as R2Bucket | null
  if (!bucket) {
    throw createError({ statusCode: 500, statusMessage: 'storage not configured' })
  }

  const client = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })

  try {
    return await handleRecordingUpload(
      {
        async authenticate(jwt) {
          const { data, error } = await client.auth.getUser(jwt)
          return error || !data.user ? null : { id: data.user.id }
        },
        async wordIsActive(wordId) {
          const { data } = await client
            .from('vocabulary')
            .select('id')
            .eq('id', wordId)
            .eq('active', true)
            .maybeSingle()
          return data !== null
        },
        async putObject(key, body, contentType) {
          await bucket.put(key, body, { httpMetadata: { contentType } })
        },
        async deleteObjects(keys) {
          await bucket.delete(keys)
        },
        async insertRecording(row) {
          const { error } = await client.from('recordings').insert(row)
          return { error: error ? error.message : null }
        },
        newId: () => crypto.randomUUID(),
      },
      {
        token,
        wordId: Number(text('word_id')),
        durationMs: Number(text('duration_ms')),
        width: optionalNumber('width'),
        height: optionalNumber('height'),
        userAgent: getHeader(event, 'user-agent') ?? null,
        video: {
          type: videoPart.type ?? '',
          size: videoPart.data.byteLength,
          bytes: new Uint8Array(videoPart.data),
        },
        landmarks: {
          size: landmarksPart.data.byteLength,
          text: landmarksPart.data.toString('utf-8'),
        },
      },
    )
  } catch (err) {
    if (err instanceof UploadError) {
      throw createError({ statusCode: err.status, statusMessage: err.message })
    }
    throw err
  }
})
```

- [ ] **Step 6: Verify the build and commit**

Run: `cd web && npm run build && npm test`
Expected: build succeeds, all tests pass (32 so far).

```bash
git add web/server web/tests
git commit -m "feat: add recording upload handler and Nitro route with R2 storage"
```

---

### Task 6: Authentication (plugin, composable, middleware, login page)

**Files:**
- Create: `web/plugins/supabase.client.ts`, `web/composables/useAuth.ts`, `web/middleware/auth.global.ts`, `web/pages/login.vue`

**Interfaces:**
- Consumes: `toUsernameSlug`, `isValidUsername`, `toAuthEmail` from `web/utils/username.ts` (Task 3).
- Produces: `useNuxtApp().$supabase` (a `SupabaseClient`); `useAuth()` returning `{ session: Ref<Session | null>, ready: Ref<boolean>, init(): Promise<void>, signUp(username: string, password: string): Promise<void>, signIn(username: string, password: string): Promise<void>, signOut(): Promise<void> }`; all errors are thrown as `Error` with a Portuguese message; pages other than `/login` require a session.

This task has no automated tests (it depends on a live Supabase); its test cycle is the manual check in Step 5.

- [ ] **Step 1: Write the Supabase plugin**

`web/plugins/supabase.client.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const supabase = createClient(
    config.public.supabaseUrl as string,
    config.public.supabaseAnonKey as string,
  )
  return { provide: { supabase } }
})
```

- [ ] **Step 2: Write the auth composable**

`web/composables/useAuth.ts`:
```ts
import type { Session } from '@supabase/supabase-js'
import { isValidUsername, toAuthEmail, toUsernameSlug } from '~/utils/username'

function friendlyError(message: string): string {
  if (/already registered/i.test(message)) return 'Este nome já existe. Escolhe outro ou entra.'
  if (/invalid login credentials/i.test(message)) return 'Nome ou palavra-passe incorretos.'
  if (/password should be at least/i.test(message)) return 'A palavra-passe tem de ter pelo menos 6 caracteres.'
  return message
}

export function useAuth() {
  const { $supabase } = useNuxtApp()
  const config = useRuntimeConfig()
  const session = useState<Session | null>('auth-session', () => null)
  const ready = useState<boolean>('auth-ready', () => false)

  async function init() {
    if (ready.value) return
    const { data } = await $supabase.auth.getSession()
    session.value = data.session
    $supabase.auth.onAuthStateChange((_event, next) => {
      session.value = next
    })
    ready.value = true
  }

  function credentials(username: string) {
    const slug = toUsernameSlug(username)
    if (!isValidUsername(slug)) {
      throw new Error('O nome tem de ter entre 3 e 32 letras ou números.')
    }
    return toAuthEmail(username, config.public.emailDomain as string)
  }

  async function signUp(username: string, password: string) {
    const email = credentials(username)
    const { error } = await $supabase.auth.signUp({ email, password })
    if (error) throw new Error(friendlyError(error.message))
  }

  async function signIn(username: string, password: string) {
    const email = credentials(username)
    const { error } = await $supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(friendlyError(error.message))
  }

  async function signOut() {
    await $supabase.auth.signOut()
  }

  return { session, ready, init, signUp, signIn, signOut }
}
```

- [ ] **Step 3: Write the route middleware**

`web/middleware/auth.global.ts`:
```ts
export default defineNuxtRouteMiddleware(async (to) => {
  const { init, session } = useAuth()
  await init()

  if (!session.value && to.path !== '/login') return navigateTo('/login')
  if (session.value && to.path === '/login') return navigateTo('/')
})
```

- [ ] **Step 4: Write the login page**

`web/pages/login.vue`:
```vue
<script setup lang="ts">
const { signIn, signUp } = useAuth()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    if (mode.value === 'register') await signUp(username.value, password.value)
    else await signIn(username.value, password.value)
    await navigateTo('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ocorreu um erro.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-xl font-semibold">Recolha de gestos LGA</h1>
        <p class="text-sm text-muted">
          {{ mode === 'login' ? 'Entra para continuar.' : 'Cria uma conta simples.' }}
        </p>
      </template>

      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="Nome">
          <UInput v-model="username" class="w-full" autocomplete="username" />
        </UFormField>
        <UFormField label="Palavra-passe (mínimo 6 caracteres)">
          <UInput
            v-model="password"
            type="password"
            class="w-full"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          />
        </UFormField>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UButton type="submit" block :loading="loading">
          {{ mode === 'login' ? 'Entrar' : 'Criar conta' }}
        </UButton>
      </form>

      <template #footer>
        <UButton
          variant="link"
          size="sm"
          @click="mode = mode === 'login' ? 'register' : 'login'"
        >
          {{ mode === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta' }}
        </UButton>
      </template>
    </UCard>
  </div>
</template>
```

- [ ] **Step 5: Manual verification against local Supabase**

1. In `web/`, run `npx supabase status` and copy the `anon key` into a new `web/.env` (copy `.env.example`, fill `NUXT_PUBLIC_SUPABASE_ANON_KEY`).
2. Run `npm run dev` and open the printed URL.
3. Expected: you are redirected to `/login`.
4. Click "Ainda não tenho conta", register `Nélio Santos` with password `segredo123`. Expected: redirect to `/` (a 404 or blank page is fine until Task 8).
5. Check the profile: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select username, role from public.profiles"` (or use Studio at the URL printed by `supabase status`). Expected: one row with username `nelio_santos`, role `signer`.
6. Open the browser dev tools, clear site data and reload: Expected: redirect to `/login`; signing in again with `nelio santos` / `segredo123` works (the slug maps both spellings to the same account).
7. Try a wrong password. Expected: "Nome ou palavra-passe incorretos."

- [ ] **Step 6: Commit**

```bash
git add web/plugins web/composables web/middleware web/pages
git commit -m "feat: add Supabase auth with username login and route guard"
```

---

### Task 7: Camera, MediaPipe and recorder composables

**Files:**
- Create: `web/utils/camera.ts`, `web/composables/useHandTracker.ts`, `web/composables/useRecorder.ts`
- Test: `web/tests/camera.test.ts`

**Interfaces:**
- Consumes: `RawHandResult` from `web/utils/landmarks.ts` (Task 4); `pickMimeType` from `web/utils/mime.ts` (Task 3); assets under `/mediapipe/` (Task 1).
- Produces:
  - `cameraErrorMessage(error: unknown): string`
  - `createHandTracker(): Promise<{ detect(video: HTMLVideoElement, nowMs: number): RawHandResult; close(): void }>`
  - `interface RecordedClip { blob: Blob; mime: string; durationMs: number; width: number; height: number }`
  - `openCamera(): Promise<MediaStream>` (throws `Error` with a Portuguese message)
  - `createRecorder(stream: MediaStream): { start(): number; stop(): Promise<RecordedClip> }` (`start()` returns the `performance.now()` value at which recording began)

- [ ] **Step 1: Write the failing test for camera errors**

`web/tests/camera.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cameraErrorMessage } from '../utils/camera'

function domError(name: string) {
  return Object.assign(new Error(name), { name })
}

describe('cameraErrorMessage', () => {
  it('explains a denied permission', () => {
    expect(cameraErrorMessage(domError('NotAllowedError'))).toContain('permissão')
  })
  it('explains a missing camera', () => {
    expect(cameraErrorMessage(domError('NotFoundError'))).toContain('Nenhuma câmara')
  })
  it('explains a camera in use', () => {
    expect(cameraErrorMessage(domError('NotReadableError'))).toContain('outra aplicação')
  })
  it('falls back to a generic message', () => {
    expect(cameraErrorMessage(new Error('x'))).toContain('Não foi possível')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run tests/camera.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the camera utility**

`web/utils/camera.ts`:
```ts
export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError') {
    return 'Sem permissão para usar a câmara. Autoriza a câmara nas definições do browser e recarrega a página.'
  }
  if (name === 'NotFoundError') {
    return 'Nenhuma câmara encontrada neste dispositivo.'
  }
  if (name === 'NotReadableError') {
    return 'A câmara está a ser usada por outra aplicação. Fecha-a e tenta de novo.'
  }
  return 'Não foi possível abrir a câmara.'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run tests/camera.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the hand tracker and recorder**

These wrap browser APIs (camera, WebAssembly, MediaRecorder) and are verified manually in Task 8.

`web/composables/useHandTracker.ts`:
```ts
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { RawHandResult } from '~/utils/landmarks'

export async function createHandTracker() {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task' },
    runningMode: 'VIDEO',
    numHands: 2,
  })

  return {
    detect(video: HTMLVideoElement, nowMs: number): RawHandResult {
      const result = landmarker.detectForVideo(video, nowMs)
      return { landmarks: result.landmarks, handedness: result.handedness }
    },
    close() {
      landmarker.close()
    },
  }
}
```

`web/composables/useRecorder.ts`:
```ts
import { cameraErrorMessage } from '~/utils/camera'
import { pickMimeType } from '~/utils/mime'

export interface RecordedClip {
  blob: Blob
  mime: string
  durationMs: number
  width: number
  height: number
}

export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('A câmara só funciona em ligações seguras (HTTPS) ou em localhost.')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    })
  } catch (error) {
    throw new Error(cameraErrorMessage(error))
  }
}

export function createRecorder(stream: MediaStream) {
  const mime = pickMimeType((type) => MediaRecorder.isTypeSupported(type))
  if (!mime) {
    throw new Error('Este browser não suporta gravação de vídeo. Experimenta o Chrome ou o Firefox.')
  }

  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let startedAt = 0

  return {
    start(): number {
      chunks = []
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 600_000 })
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      startedAt = performance.now()
      recorder.start()
      return startedAt
    },

    stop(): Promise<RecordedClip> {
      return new Promise((resolve, reject) => {
        if (!recorder) {
          reject(new Error('A gravação não foi iniciada.'))
          return
        }
        const settings = stream.getVideoTracks()[0]?.getSettings() ?? {}
        recorder.onstop = () => {
          resolve({
            blob: new Blob(chunks, { type: mime }),
            mime,
            durationMs: Math.round(performance.now() - startedAt),
            width: settings.width ?? 0,
            height: settings.height ?? 0,
          })
        }
        recorder.stop()
      })
    },
  }
}
```

- [ ] **Step 6: Verify the build and commit**

Run: `cd web && npm run build && npm test`
Expected: build succeeds, all tests pass (36 so far).

```bash
git add web/utils web/composables web/tests
git commit -m "feat: add camera, MediaPipe hand tracker and recorder composables"
```

---

### Task 8: Recording page with upload and retry

**Files:**
- Create: `web/utils/uploadClient.ts`, `web/pages/index.vue`
- Test: `web/tests/uploadClient.test.ts`

**Interfaces:**
- Consumes: `pickNextWord`, `VocabWord` (Task 4); `createLandmarkBuffer`, `addFrame`, `serializeBuffer` (Task 4); `createHandTracker` (Task 7); `openCamera`, `createRecorder`, `RecordedClip` (Task 7); `useAuth` (Task 6); `$supabase` (Task 6); views/tables from Task 2; `POST /api/recordings` (Task 5).
- Produces: `interface UploadPayload { wordId: number; durationMs: number; width: number; height: number; video: Blob; landmarksJson: string }` and `uploadRecording(fetchFn: typeof fetch, token: string, payload: UploadPayload): Promise<{ id: string }>` (throws `Error` with a Portuguese-friendly message on failure).

- [ ] **Step 1: Write the failing tests for the upload client**

`web/tests/uploadClient.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { uploadRecording, type UploadPayload } from '../utils/uploadClient'

const payload: UploadPayload = {
  wordId: 3,
  durationMs: 2100,
  width: 640,
  height: 480,
  video: new Blob(['video'], { type: 'video/webm' }),
  landmarksJson: '[]',
}

describe('uploadRecording', () => {
  it('posts a multipart body with the bearer token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: 'rec-9' }), { status: 200 }))

    const result = await uploadRecording(fetchFn as unknown as typeof fetch, 'jwt-1', payload)

    expect(result).toEqual({ id: 'rec-9' })
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/recordings')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1')
    const form = init.body as FormData
    expect(form.get('word_id')).toBe('3')
    expect(form.get('duration_ms')).toBe('2100')
    expect(form.get('width')).toBe('640')
    expect(form.get('height')).toBe('480')
    expect(form.get('video')).toBeInstanceOf(Blob)
    expect(form.get('landmarks')).toBeInstanceOf(Blob)
  })

  it('throws the server message when the upload fails', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ statusMessage: 'unknown word' }), { status: 400 }),
    )
    await expect(
      uploadRecording(fetchFn as unknown as typeof fetch, 'jwt-1', payload),
    ).rejects.toThrow('unknown word')
  })

  it('throws a generic message when the server sends no body', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 502 }))
    await expect(
      uploadRecording(fetchFn as unknown as typeof fetch, 'jwt-1', payload),
    ).rejects.toThrow('Erro 502')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run tests/uploadClient.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the upload client**

`web/utils/uploadClient.ts`:
```ts
export interface UploadPayload {
  wordId: number
  durationMs: number
  width: number
  height: number
  video: Blob
  landmarksJson: string
}

export async function uploadRecording(
  fetchFn: typeof fetch,
  token: string,
  payload: UploadPayload,
): Promise<{ id: string }> {
  const form = new FormData()
  form.append('word_id', String(payload.wordId))
  form.append('duration_ms', String(payload.durationMs))
  form.append('width', String(payload.width))
  form.append('height', String(payload.height))
  form.append('video', payload.video, 'clip')
  form.append('landmarks', new Blob([payload.landmarksJson], { type: 'application/json' }), 'landmarks.json')

  const response = await fetchFn('/api/recordings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.statusMessage ?? `Erro ${response.status}`)
  }
  return response.json()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run tests/uploadClient.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the recording page**

`web/pages/index.vue`:
```vue
<script setup lang="ts">
import { createHandTracker } from '~/composables/useHandTracker'
import { createRecorder, openCamera, type RecordedClip } from '~/composables/useRecorder'
import { addFrame, createLandmarkBuffer, serializeBuffer, type LandmarkBuffer } from '~/utils/landmarks'
import { uploadRecording } from '~/utils/uploadClient'
import { pickNextWord, type VocabWord } from '~/utils/words'

const TARGET_PER_WORD = 20
const COUNTDOWN_SECONDS = 3
const MAX_RECORDING_MS = 14_000

type Phase = 'loading' | 'ready' | 'countdown' | 'recording' | 'uploading' | 'retry' | 'fatal'

const { $supabase } = useNuxtApp()
const { session, signOut } = useAuth()

const phase = ref<Phase>('loading')
const fatalError = ref('')
const message = ref('')
const countdown = ref(COUNTDOWN_SECONDS)

const words = ref<VocabWord[]>([])
const counts = ref<Record<number, number>>({})
const skipped = ref(new Set<number>())
const currentWord = ref<VocabWord | null>(null)

const videoEl = ref<HTMLVideoElement | null>(null)
const overlayEl = ref<HTMLCanvasElement | null>(null)

let stream: MediaStream | null = null
let tracker: Awaited<ReturnType<typeof createHandTracker>> | null = null
let recorder: ReturnType<typeof createRecorder> | null = null
let buffer: LandmarkBuffer | null = null
let frameHandle = 0
let stopTimer: ReturnType<typeof setTimeout> | null = null
let pending: { clip: RecordedClip; landmarksJson: string; wordId: number } | null = null

const totalDone = computed(() =>
  words.value.reduce((sum, w) => sum + Math.min(counts.value[w.id] ?? 0, TARGET_PER_WORD), 0),
)
const totalTarget = computed(() => words.value.length * TARGET_PER_WORD)
const wordCount = computed(() => (currentWord.value ? counts.value[currentWord.value.id] ?? 0 : 0))
const busy = computed(() => ['countdown', 'recording', 'uploading'].includes(phase.value))

function chooseWord() {
  currentWord.value = pickNextWord(words.value, counts.value, TARGET_PER_WORD, skipped.value)
}

function nextWord() {
  if (currentWord.value) skipped.value.add(currentWord.value.id)
  chooseWord()
}

function drawOverlay(landmarks: { x: number; y: number }[][]) {
  const canvas = overlayEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#22c55e'
  for (const hand of landmarks) {
    for (const p of hand) {
      ctx.beginPath()
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
}

function detectionLoop() {
  const video = videoEl.value
  if (tracker && video && video.readyState >= 2) {
    const now = performance.now()
    const result = tracker.detect(video, now)
    drawOverlay(result.landmarks)
    if (phase.value === 'recording' && buffer) addFrame(buffer, now, result)
  }
  frameHandle = requestAnimationFrame(detectionLoop)
}

async function loadData() {
  const userId = session.value!.user.id
  const [vocab, progress] = await Promise.all([
    $supabase.from('vocabulary').select('id, word, position').eq('active', true).order('position'),
    $supabase.from('recording_counts').select('word_id, count').eq('user_id', userId),
  ])
  if (vocab.error) throw new Error(vocab.error.message)
  if (progress.error) throw new Error(progress.error.message)
  words.value = vocab.data as VocabWord[]
  counts.value = Object.fromEntries(progress.data.map((row) => [row.word_id, row.count]))
}

async function start() {
  try {
    await loadData()
    stream = await openCamera()
    const video = videoEl.value!
    video.srcObject = stream
    await video.play()
    overlayEl.value!.width = video.videoWidth
    overlayEl.value!.height = video.videoHeight
    tracker = await createHandTracker()
    recorder = createRecorder(stream)
    chooseWord()
    phase.value = 'ready'
    detectionLoop()
  } catch (error) {
    fatalError.value = error instanceof Error ? error.message : 'Erro ao iniciar a sessão.'
    phase.value = 'fatal'
  }
}

function beginCountdown() {
  message.value = ''
  phase.value = 'countdown'
  countdown.value = COUNTDOWN_SECONDS
  const timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      clearInterval(timer)
      beginRecording()
    }
  }, 1000)
}

function beginRecording() {
  const startMs = recorder!.start()
  buffer = createLandmarkBuffer(startMs)
  phase.value = 'recording'
  stopTimer = setTimeout(finishRecording, MAX_RECORDING_MS)
}

async function finishRecording() {
  if (phase.value !== 'recording') return
  if (stopTimer) clearTimeout(stopTimer)
  const word = currentWord.value!
  const clip = await recorder!.stop()
  pending = { clip, landmarksJson: serializeBuffer(buffer!), wordId: word.id }
  await sendPending()
}

async function sendPending() {
  if (!pending) return
  phase.value = 'uploading'
  message.value = 'A enviar…'
  try {
    await uploadRecording(fetch, session.value!.access_token, {
      wordId: pending.wordId,
      durationMs: pending.clip.durationMs,
      width: pending.clip.width,
      height: pending.clip.height,
      video: pending.clip.blob,
      landmarksJson: pending.landmarksJson,
    })
    counts.value = { ...counts.value, [pending.wordId]: (counts.value[pending.wordId] ?? 0) + 1 }
    skipped.value.delete(pending.wordId)
    pending = null
    message.value = 'Gravação guardada.'
    phase.value = 'ready'
  } catch (error) {
    message.value = `Não foi possível enviar: ${error instanceof Error ? error.message : 'erro desconhecido'}`
    phase.value = 'retry'
  }
}

function discardPending() {
  pending = null
  message.value = ''
  phase.value = 'ready'
}

onMounted(start)

onBeforeUnmount(() => {
  cancelAnimationFrame(frameHandle)
  if (stopTimer) clearTimeout(stopTimer)
  stream?.getTracks().forEach((track) => track.stop())
  tracker?.close()
})
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 space-y-4">
    <header class="flex items-center justify-between">
      <div class="flex gap-2">
        <UButton to="/progress" variant="ghost" size="sm">Progresso</UButton>
        <UButton to="/admin" variant="ghost" size="sm">Admin</UButton>
      </div>
      <UButton variant="ghost" size="sm" @click="signOut">Sair</UButton>
    </header>

    <UAlert
      v-if="phase === 'fatal'"
      color="error"
      variant="subtle"
      title="Não foi possível iniciar"
      :description="fatalError"
    >
      <template #actions>
        <UButton size="sm" @click="reloadNuxtApp()">Tentar de novo</UButton>
      </template>
    </UAlert>

    <template v-if="phase !== 'fatal'">
      <div v-if="currentWord" class="text-center space-y-1">
        <p class="text-sm text-muted">Faz o gesto para:</p>
        <h1 class="text-5xl font-bold">{{ currentWord.word }}</h1>
        <p class="text-sm">{{ wordCount }}/{{ TARGET_PER_WORD }} gravações desta palavra</p>
        <UProgress :model-value="Math.min(wordCount, TARGET_PER_WORD)" :max="TARGET_PER_WORD" />
      </div>
      <div v-else-if="phase !== 'loading'" class="text-center space-y-1">
        <h1 class="text-4xl font-bold">Concluído!</h1>
        <p class="text-muted">Todas as palavras atingiram {{ TARGET_PER_WORD }} gravações.</p>
      </div>

      <div class="relative w-full overflow-hidden rounded-xl bg-black">
        <video ref="videoEl" class="w-full -scale-x-100" autoplay muted playsinline />
        <canvas ref="overlayEl" class="absolute inset-0 w-full h-full -scale-x-100" />
        <div
          v-if="phase === 'countdown'"
          class="absolute inset-0 flex items-center justify-center bg-black/40 text-8xl font-bold text-white"
        >
          {{ countdown }}
        </div>
        <div
          v-if="phase === 'recording'"
          class="absolute top-3 left-3 rounded-full bg-red-600 px-3 py-1 text-sm font-medium text-white"
        >
          A gravar
        </div>
        <div
          v-if="phase === 'loading'"
          class="absolute inset-0 flex items-center justify-center text-white"
        >
          A preparar a câmara e o detetor de mãos…
        </div>
      </div>

      <div class="flex gap-2">
        <UButton
          v-if="phase !== 'recording'"
          size="xl"
          class="flex-1 justify-center"
          :disabled="!currentWord || busy || phase === 'loading' || phase === 'retry'"
          @click="beginCountdown"
        >
          Gravar
        </UButton>
        <UButton
          v-else
          size="xl"
          color="error"
          class="flex-1 justify-center"
          @click="finishRecording"
        >
          Parar
        </UButton>
        <UButton
          size="xl"
          variant="outline"
          :disabled="!currentWord || busy || phase === 'loading' || phase === 'retry'"
          @click="nextWord"
        >
          Próxima palavra
        </UButton>
      </div>

      <UAlert
        v-if="phase === 'retry'"
        color="warning"
        variant="subtle"
        :title="message"
      >
        <template #actions>
          <UButton size="sm" @click="sendPending">Tentar de novo</UButton>
          <UButton size="sm" variant="outline" @click="discardPending">Descartar</UButton>
        </template>
      </UAlert>
      <p v-else-if="message" class="text-center text-sm">{{ message }}</p>

      <div class="space-y-1">
        <p class="text-sm text-muted">Progresso total: {{ totalDone }}/{{ totalTarget }}</p>
        <UProgress :model-value="totalDone" :max="totalTarget || 1" />
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 6: Manual verification (local Supabase + Wrangler bindings)**

1. Ensure `web/.env` is filled (Task 6, Step 5) and `npx supabase start` is running with the seed applied (`npx supabase db reset`).
2. Run `npm run dev` and sign in.
3. Expected: camera preview appears mirrored, green dots follow your hand, the first word is `olá` with `0/20`.
4. Click "Gravar": a 3-2-1 countdown, then "A gravar". Sign, then click "Parar". Expected: "Gravação guardada." and the count for the same word becomes `1/20`; the word does not change.
5. Record twice more. Expected: `2/20`, `3/20`, still the same word.
6. Click "Próxima palavra". Expected: a different word appears; clicking it repeatedly cycles through words instead of staying still.
7. Verify storage and database:
   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select word_id, video_key, landmarks_key, duration_ms, mime from public.recordings order by created_at"
   ls .wrangler/state/v3/r2 2>/dev/null
   ```
   Expected: rows with keys `<user_id>/<uuid>.webm|.json`; R2 objects exist in the local Wrangler state.
8. Deny camera access (browser site settings) and reload. Expected: an error card with the permission message and a "Tentar de novo" button, not an endless loading state.
9. Stop the dev server, then start it again and, while recording, block the network (dev tools offline mode) before clicking "Parar". Expected: "Não foi possível enviar…" with "Tentar de novo"; going back online and retrying succeeds and the count rises.

- [ ] **Step 7: Commit**

```bash
git add web/utils web/pages web/tests
git commit -m "feat: add recording page with countdown, upload retry and progress"
```

---

### Task 9: Progress and admin pages

**Files:**
- Create: `web/utils/csv.ts`, `web/pages/progress.vue`, `web/pages/admin.vue`
- Test: `web/tests/csv.test.ts`

**Interfaces:**
- Consumes: `$supabase` (Task 6), `useAuth` (Task 6), tables/view from Task 2.
- Produces: `toCsv(rows: Record<string, string | number | null>[], columns: string[]): string`.

- [ ] **Step 1: Write the failing CSV tests**

`web/tests/csv.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { toCsv } from '../utils/csv'

describe('toCsv', () => {
  it('writes a header and one line per row', () => {
    const csv = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }], ['a', 'b'])
    expect(csv).toBe('a,b\n1,x\n2,y')
  })

  it('quotes values with commas, quotes and newlines', () => {
    const csv = toCsv([{ a: 'x,y', b: 'say "hi"' }], ['a', 'b'])
    expect(csv).toBe('a,b\n"x,y","say ""hi"""')
  })

  it('writes null as an empty cell', () => {
    expect(toCsv([{ a: null, b: 1 }], ['a', 'b'])).toBe('a,b\n,1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run tests/csv.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the CSV utility**

`web/utils/csv.ts`:
```ts
type Cell = string | number | null

function escapeCell(value: Cell | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Record<string, Cell>[], columns: string[]): string {
  const lines = rows.map((row) => columns.map((column) => escapeCell(row[column])).join(','))
  return [columns.join(','), ...lines].join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run tests/csv.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the progress page**

`web/pages/progress.vue`:
```vue
<script setup lang="ts">
const TARGET_PER_WORD = 20
const { $supabase } = useNuxtApp()
const { session } = useAuth()

interface Row {
  id: number
  word: string
  done: number
}

const rows = ref<Row[]>([])
const error = ref('')

onMounted(async () => {
  const userId = session.value!.user.id
  const [vocab, progress] = await Promise.all([
    $supabase.from('vocabulary').select('id, word').eq('active', true).order('position'),
    $supabase.from('recording_counts').select('word_id, count').eq('user_id', userId),
  ])
  if (vocab.error || progress.error) {
    error.value = (vocab.error ?? progress.error)!.message
    return
  }
  const counts = Object.fromEntries(progress.data.map((r) => [r.word_id, r.count]))
  rows.value = vocab.data.map((w) => ({ id: w.id, word: w.word, done: counts[w.id] ?? 0 }))
})
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 space-y-4">
    <UButton to="/" variant="ghost" size="sm">← Voltar a gravar</UButton>
    <h1 class="text-2xl font-semibold">O meu progresso</h1>
    <UAlert v-if="error" color="error" variant="subtle" :title="error" />
    <div v-for="row in rows" :key="row.id" class="space-y-1">
      <div class="flex justify-between text-sm">
        <span>{{ row.word }}</span>
        <span>{{ row.done }}/{{ TARGET_PER_WORD }}</span>
      </div>
      <UProgress :model-value="Math.min(row.done, TARGET_PER_WORD)" :max="TARGET_PER_WORD" />
    </div>
  </div>
</template>
```

- [ ] **Step 6: Write the admin page**

`web/pages/admin.vue`:
```vue
<script setup lang="ts">
import { toCsv } from '~/utils/csv'

const { $supabase } = useNuxtApp()
const { session } = useAuth()

const isAdmin = ref<boolean | null>(null)
const error = ref('')
const perSigner = ref<{ username: string; total: number }[]>([])
const perWord = ref<{ word: string; total: number }[]>([])

const PAGE = 1000

async function fetchAllRecordings() {
  const all: Record<string, string | number | null>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error: err } = await $supabase
      .from('recordings')
      .select('id, user_id, word_id, video_key, landmarks_key, duration_ms, width, height, mime, created_at')
      .order('created_at')
      .range(from, from + PAGE - 1)
    if (err) throw new Error(err.message)
    all.push(...(data as Record<string, string | number | null>[]))
    if (data.length < PAGE) return all
  }
}

onMounted(async () => {
  const me = await $supabase.from('profiles').select('role').eq('id', session.value!.user.id).single()
  isAdmin.value = me.data?.role === 'admin'
  if (!isAdmin.value) return

  const [counts, profiles, vocab] = await Promise.all([
    $supabase.from('recording_counts').select('user_id, word_id, count'),
    $supabase.from('profiles').select('id, username'),
    $supabase.from('vocabulary').select('id, word').order('position'),
  ])
  if (counts.error || profiles.error || vocab.error) {
    error.value = (counts.error ?? profiles.error ?? vocab.error)!.message
    return
  }

  const usernames = Object.fromEntries(profiles.data.map((p) => [p.id, p.username]))
  const words = Object.fromEntries(vocab.data.map((w) => [w.id, w.word]))
  const signerTotals: Record<string, number> = {}
  const wordTotals: Record<number, number> = {}
  for (const row of counts.data) {
    signerTotals[row.user_id] = (signerTotals[row.user_id] ?? 0) + row.count
    wordTotals[row.word_id] = (wordTotals[row.word_id] ?? 0) + row.count
  }
  perSigner.value = Object.entries(signerTotals).map(([id, total]) => ({
    username: usernames[id] ?? id,
    total,
  }))
  perWord.value = vocab.data.map((w) => ({ word: words[w.id], total: wordTotals[w.id] ?? 0 }))
})

async function exportCsv() {
  try {
    const rows = await fetchAllRecordings()
    const csv = toCsv(rows, [
      'id', 'user_id', 'word_id', 'video_key', 'landmarks_key',
      'duration_ms', 'width', 'height', 'mime', 'created_at',
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'recordings.csv'
    link.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Erro ao exportar.'
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 space-y-6">
    <UButton to="/" variant="ghost" size="sm">← Voltar a gravar</UButton>
    <h1 class="text-2xl font-semibold">Administração</h1>

    <UAlert v-if="isAdmin === false" color="warning" variant="subtle" title="Esta página é só para administradores." />
    <UAlert v-if="error" color="error" variant="subtle" :title="error" />

    <template v-if="isAdmin">
      <UButton @click="exportCsv">Exportar metadados (CSV)</UButton>

      <section>
        <h2 class="font-medium mb-2">Gravações por sinalizante</h2>
        <ul class="text-sm space-y-1">
          <li v-for="s in perSigner" :key="s.username" class="flex justify-between">
            <span>{{ s.username }}</span><span>{{ s.total }}</span>
          </li>
        </ul>
      </section>

      <section>
        <h2 class="font-medium mb-2">Gravações por palavra</h2>
        <ul class="text-sm space-y-1">
          <li v-for="w in perWord" :key="w.word" class="flex justify-between">
            <span>{{ w.word }}</span><span>{{ w.total }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
```

- [ ] **Step 7: Manual verification**

1. Open `/progress` after recording a few clips. Expected: every word listed with its count and a bar; the recorded words match the counts shown on `/`.
2. Open `/admin` as a normal user. Expected: "Esta página é só para administradores."
3. Promote yourself: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "update public.profiles set role = 'admin' where username = 'nelio_santos'"`, reload `/admin`. Expected: totals per signer and per word; "Exportar metadados (CSV)" downloads `recordings.csv` with one line per recording.

- [ ] **Step 8: Verify and commit**

Run: `cd web && npm run build && npm test`
Expected: build succeeds, all tests pass (42 so far).

```bash
git add web/utils web/pages web/tests
git commit -m "feat: add progress page and admin dashboard with CSV export"
```

---

### Task 10: Deploy to Cloudflare and end-to-end verification

**Files:**
- Create: `web/README.md`

**Interfaces:**
- Consumes: everything above. No new code interfaces.

- [ ] **Step 1: Write the README**

`web/README.md`:
````markdown
# Recolha LGA (Nuxt + Supabase + R2)

Web app for collecting LGA gesture recordings. Spec:
`../docs/superpowers/specs/2026-09-19-nuxt-supabase-recolha-design.md`.

## Local development

```bash
cd web
npm install
npx supabase start          # needs Docker
npx supabase db reset       # applies migrations and seeds the vocabulary
cp .env.example .env        # fill NUXT_PUBLIC_SUPABASE_ANON_KEY from `npx supabase status`
npm run dev
```

## Tests

```bash
npm test                    # Vitest (utilities and upload handler)
npx supabase test db        # RLS policy tests (pgTAP)
```

## Deploy (Cloudflare Pages)

1. Supabase (hosted): create a project, run `npx supabase link` then `npx supabase db push`,
   run the contents of `supabase/seed.sql` in the SQL editor, and in Authentication →
   Providers → Email turn **off** "Confirm email".
2. R2: `npx wrangler r2 bucket create lga-recordings` (keep it private, no public access).
3. Build and deploy:
   ```bash
   npm run build
   npx wrangler pages deploy dist --project-name lga-recolha
   ```
4. In the Pages project settings add the environment variables
   `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`, `NUXT_PUBLIC_EMAIL_DOMAIN`,
   and confirm the R2 binding `RECORDINGS_BUCKET` → `lga-recordings` (Settings → Functions).
5. Make yourself admin (SQL editor):
   `update public.profiles set role = 'admin' where username = '<your-slug>';`

## Notes

- Signup uses a synthetic email `<username>@<NUXT_PUBLIC_EMAIL_DOMAIN>`. If hosted Supabase
  rejects the domain, set `NUXT_PUBLIC_EMAIL_DOMAIN` to a domain you control (it does not need
  to receive mail) and redeploy.
- Vocabulary lives in the `vocabulary` table: add or deactivate words in the Supabase table editor.
- Recordings are private in R2; download them with `wrangler r2 object get` or the S3-compatible API.
````

- [ ] **Step 2: Deploy following the README**

Follow steps 1 to 5 of "Deploy (Cloudflare Pages)". Expected: a `https://lga-recolha.pages.dev` URL (or the URL Wrangler prints).

- [ ] **Step 3: Verify the synthetic email domain against hosted Supabase**

Register a new user on the deployed site. Expected: account created and redirect to `/`. If Supabase answers that the email address is invalid, change `NUXT_PUBLIC_EMAIL_DOMAIN` in the Pages settings to a domain you control, redeploy, and register again.

- [ ] **Step 4: End-to-end manual verification on the deployed site**

Repeat Task 8 Steps 3 to 9 on the deployed URL, on a desktop browser **and on a phone**:
1. Register, then sign in again from a second device with the same name and password. Expected: same progress.
2. Record 3 clips of the same word. Expected: `3/20`, word unchanged.
3. "Próxima palavra" changes the word.
4. In the Cloudflare dashboard (R2 → `lga-recordings`) confirm `<user_id>/<uuid>.webm` and `.json` objects exist, and in Supabase confirm matching `recordings` rows.
5. As a second, non-admin user, confirm `/admin` is refused and that the user cannot see the first user's progress.
6. In R2, confirm the bucket has no public URL enabled.

- [ ] **Step 5: Commit**

```bash
git add web/README.md
git commit -m "docs: add web app README with local setup and Cloudflare deployment"
```

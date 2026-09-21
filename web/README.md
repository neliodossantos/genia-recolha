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
npm run typecheck           # nuxi typecheck (vue-tsc)
npx supabase test db        # RLS policy tests (pgTAP)
```

## Deploy

Both hosts need the hosted Supabase project first (steps below), and both store recordings in the
same Cloudflare R2 bucket.

**Supabase (hosted), once:** create a project, run `npx supabase link --project-ref <your-project-ref>`
(it prompts for the database password), then `npx supabase db push`, run the contents of
`supabase/seed.sql` in the SQL editor, and in Authentication → Providers → Email turn **off**
"Confirm email". Then create the R2 bucket once: `npx wrangler login`, then
`npx wrangler r2 bucket create lga-recordings` (keep it private).

### Vercel

1. Import the GitHub repository in Vercel and set **Root Directory = `web`** (the repo also contains
   `backend/` and `frontend/`). Framework preset: Nuxt. Vercel is detected automatically, so no
   Nitro preset is needed.
2. Create an R2 API token: Cloudflare dashboard → R2 → **Manage API tokens** → *Object Read & Write*,
   limited to the `lga-recordings` bucket. Copy the Access Key ID and the Secret (shown once).
3. In Vercel → Settings → Environment Variables (Production) add:
   - `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`, `NUXT_PUBLIC_EMAIL_DOMAIN`
   - `NUXT_R2_ACCOUNT_ID` (Cloudflare account id), `NUXT_R2_ACCESS_KEY_ID`,
     `NUXT_R2_SECRET_ACCESS_KEY`, `NUXT_R2_BUCKET` (= `lga-recordings`)
   The `NUXT_R2_*` values are server-only and never reach the browser.
4. Deploy (push to `main` or press Redeploy). Vercel limits request bodies to about 4.5 MB; clips
   are well below that (about 0.3 to 1 MB).
5. Make yourself admin (SQL editor):
   `update public.profiles set role = 'admin' where username = '<your-slug>';`

### Cloudflare Pages (alternative)

1. Build with the Cloudflare preset and the hosted Supabase values in the environment:
   ```bash
   NITRO_PRESET=cloudflare-pages npm run build
   npx wrangler pages project create lga-recolha   # first time only
   npx wrangler pages deploy dist --project-name lga-recolha
   ```
2. Set `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY` and `NUXT_PUBLIC_EMAIL_DOMAIN`
   in the Pages project (for example `npx wrangler pages secret put <NAME> --project-name lga-recolha`);
   the values are read at runtime, they are not baked into the build. The R2 binding
   `RECORDINGS_BUCKET` → `lga-recordings` comes from `wrangler.toml`, so no R2 API token is needed.
   If the site opens blank with "Configuração em falta", a variable is missing.


## Notes

- Signup uses a synthetic email `<username>@<NUXT_PUBLIC_EMAIL_DOMAIN>`. Decide the domain
  BEFORE the first signup and NEVER change it afterwards (existing accounts would become
  unreachable). If hosted Supabase rejects `lga.local`, change the domain to one you control
  (it does not need to receive mail) before creating any account.
- Vocabulary lives in the `vocabulary` table: add or deactivate words in the Supabase table editor.
- Stored `handedness` in the landmark JSON is the signer's physical hand. MediaPipe assumes a
  mirrored (selfie) input and the page feeds the raw unmirrored frame, so its labels are swapped
  before saving.
- There is no per-user rate limit on the upload route; add a rate-limiting rule (Vercel Firewall or Cloudflare) on
  `/api/recordings`.
- MediaPipe model: `public/mediapipe/hand_landmarker.task` is committed; its source is
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
  The wasm files under `public/mediapipe/wasm` are git-ignored and copied from
  `@mediapipe/tasks-vision` by `npm run postinstall`.
- Recordings are private in R2; download them with `wrangler r2 object get` or the S3-compatible API.

## First-run verification checklist (not yet done)

- [ ] Database: `cd web && npx supabase start && npx supabase db reset && npx supabase test db` — expect 8 pgTAP tests passing (if pgTAP functions are not found after `set local role authenticated`, prefix them with `extensions.`).
- [ ] Auth: register `Nélio Santos`, sign in again as `nelio santos`, wrong password message, and confirm the synthetic email domain is accepted by hosted Supabase (otherwise set `NUXT_PUBLIC_EMAIL_DOMAIN` to a domain you control).
- [ ] Recording page on desktop and phone: camera/hand overlay, countdown, the word stays after a recording and the count rises, "Próxima palavra" changes word, camera permission denied message, offline upload → "Tentar de novo", files appear in R2 and rows in `recordings`, "Sair" returns to login.
- [ ] Progress and admin pages: including promoting a user to admin.
- [ ] Deployment (Vercel or Cloudflare section of the README) and a second non-admin user check (cannot see other users' data, `/admin` refused, R2 bucket has no public URL).
- [ ] Run `cd web && npm run typecheck` (the build does not type-check).
- [ ] After the 0002 migration, run `cd web && npx supabase db reset && npx supabase test db` again.
- [ ] Confirm an uploaded `.json` in R2 contains non-empty frames with hands and that stored `handedness` matches the signer's physical hand.

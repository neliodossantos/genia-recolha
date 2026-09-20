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

## Deploy (Cloudflare Pages)

1. Supabase (hosted): create a project, run `npx supabase link --project-ref <your-project-ref>`
   (it prompts for the database password), then `npx supabase db push`, run the contents of
   `supabase/seed.sql` in the SQL editor, and in Authentication → Providers → Email turn **off**
   "Confirm email".
2. Wrangler login: `npx wrangler login` (do this once before R2 and Pages commands).
3. R2: `npx wrangler r2 bucket create lga-recordings` (keep it private, no public access).
4. **Before building**, set the three environment variables for the hosted Supabase project:
   export them in your shell or add to `web/.env` the values `NUXT_PUBLIC_SUPABASE_URL` (hosted
   URL, not `http://127.0.0.1:54321`), `NUXT_PUBLIC_SUPABASE_ANON_KEY`, and `NUXT_PUBLIC_EMAIL_DOMAIN`.
   For this client-only app the `NUXT_PUBLIC_*` values **must be present when `npm run build`
   runs**: values that exist only in the Pages dashboard may not reach the browser bundle (if they
   are missing the app shows a "Configuração em falta" error instead of a blank page). As a
   secondary hedge, since Nuxt may also inject public runtime config at runtime, also set them in
   the Pages dashboard.
5. Build and deploy:
   ```bash
   npm run build
   npx wrangler pages deploy dist --project-name lga-recolha
   ```
   If this is the first deploy, `wrangler` may ask to create the Pages project, or you can run
   `npx wrangler pages project create lga-recolha` first.
6. In the Pages project settings (Settings → Environment variables) add `NUXT_PUBLIC_SUPABASE_URL`,
   `NUXT_PUBLIC_SUPABASE_ANON_KEY`, `NUXT_PUBLIC_EMAIL_DOMAIN`, and confirm the R2 binding in
   Settings → Functions as `RECORDINGS_BUCKET` → `lga-recordings`. (Note: because `wrangler.toml`
   defines `pages_build_output_dir`, Pages uses it as the source of truth for bindings, so the
   R2 binding may appear read-only in the dashboard; environment variables are still set there.)
7. Make yourself admin (SQL editor):
   `update public.profiles set role = 'admin' where username = '<your-slug>';`

## Notes

- Signup uses a synthetic email `<username>@<NUXT_PUBLIC_EMAIL_DOMAIN>`. Decide the domain
  BEFORE the first signup and NEVER change it afterwards (existing accounts would become
  unreachable). If hosted Supabase rejects `lga.local`, change the domain to one you control
  (it does not need to receive mail) before creating any account.
- Vocabulary lives in the `vocabulary` table: add or deactivate words in the Supabase table editor.
- Stored `handedness` in the landmark JSON is the signer's physical hand. MediaPipe assumes a
  mirrored (selfie) input and the page feeds the raw unmirrored frame, so its labels are swapped
  before saving.
- There is no per-user rate limit on the upload route; add a Cloudflare rate-limiting rule on
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
- [ ] Deployment steps 1-7 of the README and a second non-admin user check (cannot see other users' data, `/admin` refused, R2 bucket has no public URL).
- [ ] Run `cd web && npm run typecheck` (the build does not type-check).
- [ ] After the 0002 migration, run `cd web && npx supabase db reset && npx supabase test db` again.
- [ ] Confirm an uploaded `.json` in R2 contains non-empty frames with hands and that stored `handedness` matches the signer's physical hand.

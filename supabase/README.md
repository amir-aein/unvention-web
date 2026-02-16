# Supabase Setup (DB + Auth)

This repo uses Supabase for:
- Auth (email OTP / magic link, configured in the Supabase dashboard)
- Postgres (durable storage for room event history + legacy profile snapshot)

## 1) Apply Database Schema

In Supabase dashboard:
1. Open `SQL Editor`
2. Create a new query
3. Paste the contents of `supabase/sql/001_init.sql`
4. Run it

This creates:
- `public.app_users` (one row per authenticated user)
- `public.legacy_profiles` (mirrors current server-generated profiles)
- `public.room_events` (append-only room event stream)

It also enables RLS and locks down tables from the public Data API by default.
Server writes use the Supabase `secret` key (service role) and bypass RLS.

## 2) Import Existing Local Logs (Optional)

After schema is applied, you can backfill existing files:
- `server/output/profiles.json`
- `server/output/room-events.ndjson`

Run:
```bash
node tools/import-supabase-legacy.js
```

Requirements:
- `.env` contains `SUPABASE_URL` and `SUPABASE_SECRET_KEY`

## 3) Live Sync From Server

`server/index.js` now performs best-effort Supabase sync when credentials are present:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`)

Local files in `server/output/*` are still written and remain fallback source-of-truth.

## 4) Browser Auth Bootstrap

The browser app reads public auth config from:
- `GET /api/auth/config`

`/api/auth/config` is enabled when server env includes:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`)

That endpoint returns:
- `url` (Supabase project URL)
- `publishableKey` (safe for client-side use)

## Notes

- Do not commit secrets. `.env` is git-ignored.
- The schema is intentionally conservative: only `app_users` is readable by the logged-in user.

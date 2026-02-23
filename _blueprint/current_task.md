# Current Task: Deploy to Vercel + Render

## Status

All local dev issues fixed. Ready to deploy.

## Architecture

```
Vercel          Render            Upstash         Supabase
â”€â”€â”€â”€â”€â”€â”€â”€â”€       â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€     â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
apps/web   â†’    apps/api    â†’    Redis TCP   â†’   PostgreSQL
(Next.js)       (Express)        port 6380
                apps/worker
                (BullMQ)
```

## Deploy Order

1. **Render first** (API + worker must be live before web points to them)
2. **Vercel second** (web â€” set NEXTAUTH_URL after first deploy)
3. **Post-deploy** â€” add Vercel URL to Google OAuth Console + set NEXTAUTH_URL + WEB_BASE_URL

## Full env var tables

See `progress.md` â†’ "Deployment Guide" section â€” every key and value is listed there.

## Key notes

- `REDIS_URL` for Render = Upstash TCP: `rediss://default:AcDkAAIn...@smiling-crow-49380.upstash.io:6380`
  (Upstash TCP port 6380 was blocked locally but works fine on Render)
- `NEXTAUTH_URL` must be set AFTER first Vercel deploy once you have the real URL, then redeploy
- `vercel.json` root dir must be set to `apps/web` in Vercel dashboard
- Google OAuth redirect URI to add: `https://<your-vercel-url>/api/auth/callback/google`

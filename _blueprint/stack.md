# AdAvatar — Tech Stack

## Monorepo

- Turborepo (pnpm workspaces)
- TypeScript (strict mode, ES2022)
- ESLint + Prettier + Husky pre-commit

## apps/web (Frontend)

- Next.js 14 (App Router, Server Components)
- NextAuth.js **v4** — `next-auth@4.x` (NOT Auth.js v5 / `next-auth@5.x`)
  - Adapter: `@next-auth/prisma-adapter` v1 (NOT `@auth/prisma-adapter` v2 — that's Auth.js v5)
  - Session strategy: **`database`** (sessions stored in DB, NOT `jwt`)
  - Session callback signature: `({ session, user })` — `user` is the DB record
  - `session.accessToken` = short-lived JWT signed with `API_JWT_SECRET` for API calls
  - Key file: `apps/web/src/lib/auth.ts`
  - Type extensions: `apps/web/src/types/next-auth.d.ts`
- Tailwind CSS + Radix UI primitives
- SWR (data fetching / cache)
- React Hook Form + Zod
- Recharts (analytics charts)
- Lucide React (icons)

## apps/api (Backend)

- Node.js 20 + Express 4
- Prisma ORM (PostgreSQL via Supabase)
- BullMQ (job queue producer)
- Cloudinary SDK (presigned uploads, asset management)
- Upstash Redis (@upstash/ratelimit) for rate limiting
- JWT Bearer auth — `API_JWT_SECRET` env var; middleware: `apps/api/src/middleware/auth.ts`
  - All routes use `requireAuth` → verifies `Authorization: Bearer <jwt>`
  - JWT payload: `{ userId, role }`
  - Admin routes additionally use `requireAdmin`
- Zod (request validation)
- Resend (email)

## apps/worker (Background)

- BullMQ workers (concurrency: avatar=3, ad=2, publish=5)
- Bull Board UI at /admin/queues
- node-cron (token refresh every 6h, analytics every 24h)
- Platform SDKs: TikTok, YouTube, Instagram, Facebook, Snapchat (via fetch)
- HuggingFace Inference API (LivePortrait, Wan2.1-I2V, CogVideoX)
- Cloudinary (generated asset upload)

## packages/types

- Shared TypeScript interfaces: User, Avatar, Product, Ad, PublishJob, Analytics, Notification, etc.
- Job payload types
- API response shapes

## packages/utils

- Prompt enhancement (enhanceAdPrompt)
- API response helpers (apiSuccess, apiError, isApiError)
- Validation helpers
- Queue name constants
- Cloudinary folder constants
- withRetry utility

## packages/config

- App constants, upload limits, rate limits, BullMQ job options
- AI model IDs (LivePortrait, Wan2.1-I2V, CogVideoX)
- Platform OAuth config (auth/token URLs, scopes)
- Cron schedules

## Database

- PostgreSQL (Supabase free tier)
- Prisma ORM + migrations
- Supabase Realtime for live status updates

## Storage

- Cloudinary free tier (25 GB)
- Folders: raw_uploads/, processed_avatars/, generated_ads/, product_images/

## Queue / Cache

- Redis via Upstash free tier
- BullMQ (dead-letter, 3 retries, exponential backoff)

## Deployment

- web → Vercel (free tier, preview on PR, production on main)
- api → Render (free tier web service)
- worker → Render (free tier background worker — no sleep)

## CI/CD

- GitHub Actions: lint + type-check → build → deploy preview (PR) / deploy production (main)
- Husky pre-commit: lint-staged on .ts/.tsx/.js/.jsx and .json/.md

## Monitoring

- Sentry (web, api, worker) — free tier
- Bull Board (queue monitoring)

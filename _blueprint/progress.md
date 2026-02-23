# AdAvatar — Progress Log

## Phase 1: Infrastructure & Project Foundation

### ✅ 1.1 Repo & CI/CD Setup (COMPLETE)

- Turborepo monorepo with pnpm workspaces
- `apps/web` (Next.js 14), `apps/api` (Node/Express), `apps/worker` (BullMQ)
- `packages/types`, `packages/utils`, `packages/config`
- ESLint + Prettier + Husky pre-commit hooks
- GitHub Actions CI: lint → build → deploy preview/production
- `.gitignore`, `.env.example`, root `tsconfig.json`, `turbo.json`

### ✅ 1.2 Database Schema Design (COMPLETE)

- Full Prisma schema: users, organizations, accounts, sessions,
  avatars, products, ads, platform_tokens, publish_jobs, analytics,
  notifications, usage_limits
- All enums defined: UserRole, AvatarStatus, AdStatus, AspectRatio,
  PlatformName, PublishJobStatus, SubscriptionTier
- Seed script with usage_limits per tier and dev admin user
- Schema documented in `_blueprint/schema.md`

### ✅ 1.3 Auth System (COMPLETE)

- NextAuth.js v4 with Google OAuth + Credentials providers
- Prisma adapter for session storage
- JWT strategy with role embedded in token
- Session extended with `id` and `role` fields
- Protected dashboard routes (server-side redirect)
- Login + Signup pages with Google OAuth button
- Auth types extended (`next-auth.d.ts`)

### ✅ 1.4 File Storage Setup (COMPLETE)

- Cloudinary config in API routes
- Presigned upload endpoints: `/api/avatars/presign`, `/api/products/presign`
- Folders: raw_uploads/, processed_avatars/, generated_ads/, product_images/
- Cloudinary URLs stored in DB

### ✅ 1.5 BullMQ + Redis Job Queues (COMPLETE)

- Three queues: avatar_processing, ad_generation, social_publishing
- Redis connection via IORedis
- Queue definitions with JOB_OPTIONS (3 attempts, exponential backoff, remove-on-complete/fail)
- Bull Board UI at `/admin/queues` (worker app, port 4001)
- Dead-letter handled by BullMQ failed job retention

### ✅ 1.6 Base Dashboard Shell (COMPLETE)

- Authenticated dashboard layout with sidebar navigation
- Sidebar: Dashboard, Avatars, Products, Ads, Published, Analytics, Platforms, Settings
- Active state highlighting, user avatar + name, sign-out button
- Mobile-responsive (icon-only on small screens, full labels on lg+)
- Empty-state pages for all dashboard sections
- Loading/error skeleton infrastructure ready

---

## Phase 2: Avatar Creation Module

### ✅ 2.1 Avatar Upload UI (COMPLETE)

- Drag-and-drop file picker with 200MB limit (JPG/PNG/MP4/MOV)
- XHR-based Cloudinary upload via presigned URL (`useCloudinaryUpload` hook)
- Progress bar during upload; POST to `/api/avatars` on complete
- `/dashboard/avatars/new` page

### ✅ 2.2 Avatar Validation Worker (COMPLETE — Phase 1)

- Image: min 512×512px check via Cloudinary API
- Video: 3–60s duration and ≥720p resolution check
- Status set to `failed` with error message on rejection

### ✅ 2.3 AI Avatar Processing Worker (COMPLETE — Phase 1)

- HuggingFace inference (LivePortrait model)
- Output uploaded to `processed_avatars/` on Cloudinary
- DB: `avatar_video_url` set, `status: ready`

### ✅ 2.4 Avatar Gallery Page (COMPLETE)

- SWR-powered grid, polls every 5s when processing / 30s otherwise
- Status badges: Processing / Ready / Failed
- Video hover preview; delete action

---

## Phase 3: Product Management Module

### ✅ 3.1 Product Upload UI (COMPLETE)

- Multi-image upload (up to 10 images, 20MB each)
- Sequential XHR per image with per-image progress
- POST to `/api/products` with all Cloudinary URLs
- `/dashboard/products/new` page

### ✅ 3.2 Product Gallery Page (COMPLETE)

- SWR-powered grid, inline delete, thumbnail + image count

---

## Phase 4: Ad Generation Module

### ✅ 4.1 Ad Creator — 3-Step Wizard UI (COMPLETE)

- Step 1: Select ready avatar; Step 2: Select product; Step 3: Prompt + aspect ratio
- Submits to `POST /api/ads/generate`

### ✅ 4.2 Prompt Enhancement (COMPLETE — Phase 1)

- `enhanceAdPrompt()` in `packages/utils`; raw + enhanced stored in DB

### ✅ 4.3 AI Ad Generation Worker (COMPLETE — Phase 1)

- HuggingFace Wan2.1-I2V; polls for async completion
- Re-uploads to `generated_ads/`; sets `status: ready`

### ✅ 4.4 Ad Preview & Management Page (COMPLETE)

- SWR grid with polling; video preview in card
- Delete, regenerate, publish; `/dashboard/ads/[id]/publish` link

---

## Phase 5: Platform Connection Module

### ✅ 5.1 Platform OAuth Connect UI (COMPLETE)

- Cards for TikTok, YouTube, Instagram, Facebook, Snapchat in `/dashboard/platforms`
- Connect / Disconnect per platform; connected status with username

### ✅ 5.2 OAuth Handlers (COMPLETE)

- Next.js initiate route: `/api/oauth/connect/[platform]` (signs state JWT)
- Express callback: `GET /api/oauth/callback/:platform` (exchanges code, upserts token)

### ✅ 5.3 Token Refresh Cron (COMPLETE — Phase 1)

- 6-hour cron; refreshes tokens expiring within 24h; sets `isExpired: true` on failure

---

## Phase 6: Publishing Module

### ✅ 6.1 Publish Flow UI (COMPLETE)

- `PublishForm` component: platform multi-select, caption, hashtags, schedule datetime
- `/dashboard/ads/[id]/publish` page

### ✅ 6.2 Publish API Route (COMPLETE)

- `POST /api/publish` creates `publish_job` per platform; enqueues BullMQ job
- Optional scheduling via BullMQ delay

### ✅ 6.3–6.7 Platform Publishing Workers (COMPLETE — Phase 1)

- TikTok, YouTube, Instagram, Facebook, Snapchat workers in `apps/worker`

### ✅ 6.8 Published Posts Page (COMPLETE)

- `PublishedPostsList` SWR table; platform filter + status filter
- Retry button on failed jobs; post link when published

---

## Phase 7: Analytics Module

### ✅ 7.1 Analytics Ingestion Cron (COMPLETE — Phase 1)

- 24h cron; fetches platform metrics for all published jobs
- Upserts into analytics table with raw JSONB

### ✅ 7.2 Analytics Dashboard (COMPLETE)

- Overview cards: Total Ads, Published, Views, Likes, Comments, Shares
- Bar chart: performance by platform (Recharts)
- Horizontal bar chart: top 5 ads by views
- Per-ad breakdown table with platform badges

---

## Phase 8: Notifications & Polish

### ✅ 8.1 In-App Notifications (COMPLETE)

- `NotificationsDropdown` in sidebar; polls every 30s via SWR
- Mark-as-read on click; mark-all-read button; unread badge
- 7 event types with human-readable labels

### ✅ 8.2 Email Notifications (COMPLETE)

- Resend integration in worker (`apps/worker/src/lib/email.ts`)
- Welcome email: NextAuth `events.createUser` callback
- Ad generation complete email
- Publish success email
- Token expiry email

### ✅ 8.3 Error Handling & Monitoring (COMPLETE)

- Sentry integrated in web (client + server + edge configs)
- Sentry in API (`Sentry.init` + `captureException` on 5xx in errorHandler)
- Sentry in worker
- Custom 404 (`not-found.tsx`) and 500 (`global-error.tsx`) pages
- All API routes already return `{ error, code, success: false }` shape

### ✅ 8.4 Rate Limiting (COMPLETE — Phase 1)

- Upstash Redis-based sliding window on all API routes
- 3 tiers: upload (10/min), generation (5/min), publish (20/min)
- Returns 429 with `Retry-After` header

---

## Phase 9: DevOps & Deployment

### ✅ 9.1 Frontend Deployment Config (COMPLETE)

- `apps/web/vercel.json` with monorepo build command
- Preview deployments on every PR via GitHub Actions

### ✅ 9.2 API Deployment Config (COMPLETE)

- `render.yaml` defines `adavatar-api` web service with health check

### ✅ 9.3 Worker Deployment Config (COMPLETE)

- `render.yaml` defines `adavatar-worker` background worker (no sleep)

### ✅ 9.4 Environment Config (COMPLETE)

- `.env.example` fully documented with all required keys and instructions
- `README.md` with full setup guide, env variable table, and deployment instructions

## Phase 2–9: Pending

- See `project.md` for full breakdown
- Next task: see `current_task.md`

---

## Phase 10: Usage Limits & Tier Management

### ✅ 10.1 DB Schema — Usage Models (COMPLETE)

- Added `DailyUsage` model: `(userId, feature, date)` unique key `userId_feature_date`
- Added `MonthlyUsage` model: `(userId, feature, year, month)` unique key `userId_feature_year_month`
- Added `LimitChangeLog` model: admin audit trail (adminId, tier, feature, oldValue, newValue, limitType)
- Updated `UsageLimit` with `updatedAt`, `updatedBy` fields
- Added `dailyUsage` / `monthlyUsage` relations on `User` model
- Ran `prisma generate` to regenerate client

### ✅ 10.2 checkUsageLimit Middleware (COMPLETE)

- `apps/api/src/middleware/checkUsageLimit.ts`
- Factory `checkUsageLimit(feature)` returns Express middleware
- Checks daily + monthly limits against `UsageLimit` for user's tier
- Returns 429 with `{ success: false, code: 'daily_limit_reached' | 'monthly_limit_reached' }`
- Atomically increments both `DailyUsage` and `MonthlyUsage` via `prisma.$transaction`
- Wired into: `POST /api/avatars`, `POST /api/ads/generate`, `POST /api/publish`

### ✅ 10.3 Usage API Routes (COMPLETE)

- `apps/api/src/routes/usage.ts` mounted at `/api/usage`
- `GET /api/usage` — current user's live daily + monthly usage per feature
- `GET /api/usage/history` — last 7 days daily + last 3 months monthly
- `GET /api/usage/admin/limits` — all tiers × features (admin only)
- `PUT /api/usage/admin/limits` — upsert limit with audit log (admin only)
- `GET /api/usage/admin/logs` — last 200 change log entries (admin only)

### ✅ 10.8 Admin Tiers Page (COMPLETE)

- `apps/web/src/app/(dashboard)/admin/tiers/page.tsx`
- Inline-editable table: 3 tiers × 3 features = 9 rows
- Each row: daily + monthly number inputs, Save button per row
- Dirty-state detection; Save calls `PUT /api/usage/admin/limits`
- Change Log tab: timestamped audit table
- Admin-only nav item in sidebar (shown only when `user.role === 'admin'`)

### ✅ 10.9 Monthly Reset Cron (COMPLETE)

- `apps/worker/src/crons/monthlyReset.ts`
- Runs `0 0 1 * *` (1st of each month midnight)
- Finds users who were at their monthly limit → creates notifications
- Deletes previous month's `MonthlyUsage` records
- `MONTHLY_RESET_CRON` constant added to `packages/config/src/index.ts`

### ✅ 10.10 Usage Dashboard Page (COMPLETE)

- `apps/web/src/app/(dashboard)/dashboard/usage/page.tsx`
- 3 QuotaCard components (avatar creation, ad generation, publishing)
- 7-day daily bar chart (Recharts), 3-month monthly bar chart
- SWR fetches `GET /api/usage` (30s refresh) + `GET /api/usage/history`
- `apps/web/src/components/usage/usage-bars.tsx` — reusable dual progress bars
  - Color coding: green < 60%, yellow 60–90%, red ≥ 90%

### ✅ Types & Config (COMPLETE)

- `packages/types/src/index.ts`: added `DailyUsage`, `MonthlyUsage`, `LimitChangeLog`,
  `UsageFeatureStatus`, `UsageHistory`; updated `UsageLimit` with `id`, `updatedAt`, `updatedBy`
- Seed file updated: correct feature names `avatar_creation`, `ad_generation`, `publish_jobs`
  with sensible free/pro/enterprise defaults

### Commit: `0796768` — feat: phase 10 usage limits system

---

## Local Dev Environment Setup (Session — Feb 2026)

### ✅ Supabase connection fixed

- Session pooler: `aws-1-ap-southeast-2.pooler.supabase.com`
- `DATABASE_URL` uses port `6543` with `?pgbouncer=true`
- `DIRECT_URL` uses port `5432` (no pgbouncer param)
- All `updatedAt` columns fixed with `ALTER TABLE ... ALTER COLUMN "updatedAt" SET DEFAULT NOW()` via Supabase SQL Editor
- `emailVerified DateTime?` column added to `users` table

### ✅ Google OAuth login working

- Root causes found and fixed:
  1. Wrong adapter: replaced `@auth/prisma-adapter` v2 with `@next-auth/prisma-adapter` v1
  2. Session strategy changed from `jwt` → `database` (required by PrismaAdapter)
  3. Session callback updated from `({ session, token })` → `({ session, user })`
  4. Removed custom `output` from Prisma `generator client {}` block (was generating to wrong path)
  5. Re-ran `pnpm prisma generate` from `apps/api` + cleared `apps/web/.next`
- User creation, account linking, session creation all confirmed working

### ✅ Redis graceful failure

- Upstash TCP port 6380 blocked; ioredis retryStrategy returns `null` after 3 attempts
- Each BullMQ Queue instance has `.on('error', silenceError)`
- Worker Redis: same pattern in `apps/worker/src/lib/redis.ts`

### ⬜ JWT bridge (NEXT TASK)

- API returns 401 for all authenticated web requests
- Fix: mint a JWT in `apps/web/src/lib/auth.ts` session callback, expose as `session.accessToken`
- See `current_task.md` for full implementation steps

### ✅ Env vars resolved

- `CLOUDINARY_CLOUD_NAME=diihbs5cy` — set in `apps/api/.env` and `apps/web/.env.local`
- `API_JWT_SECRET` — copied from `apps/api/.env` to `apps/web/.env.local` ✅

### ⬜ Remaining env vars

- `SENTRY_DSN` — get from Sentry → Project Settings → Client Keys → DSN (optional for local dev)

---

## Deployment Guide

### Architecture

- `apps/web` → **Vercel** (Next.js)
- `apps/api` → **Render** web service (Express)
- `apps/worker` → **Render** background worker (BullMQ)
- Redis → **Upstash** TCP (works on Render; port 6380 was only blocked locally)

---

### Step 1 — Deploy API + Worker to Render

1. Go to [render.com/dashboard](https://render.com/dashboard) → New → Blueprint
2. Connect GitHub repo → Render auto-reads `render.yaml` and creates both services
3. Set these env vars in **both** `adavatar-api` and `adavatar-worker`:

| Key                        | Value                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`             | `<your Supabase session pooler URL with password>`                                |
| `DIRECT_URL`               | `<your Supabase direct URL with password>`                                        |
| `REDIS_URL`                | `<Upstash TCP URL — rediss://default:<token>@smiling-crow-49380.upstash.io:6380>` |
| `UPSTASH_REDIS_REST_URL`   | `https://smiling-crow-49380.upstash.io`                                           |
| `UPSTASH_REDIS_REST_TOKEN` | `<Upstash REST token from upstash.io dashboard>`                                  |
| `API_JWT_SECRET`           | `<shared secret — copy from apps/api/.env>`                                       |
| `CLOUDINARY_CLOUD_NAME`    | `diihbs5cy`                                                                       |
| `CLOUDINARY_API_KEY`       | `879673843434632`                                                                 |
| `CLOUDINARY_API_SECRET`    | `<Cloudinary API secret from cloudinary.com dashboard>`                           |
| `HUGGINGFACE_API_TOKEN`    | `<HuggingFace token from huggingface.co/settings/tokens>`                         |
| `RESEND_API_KEY`           | `<Resend API key from resend.com dashboard>`                                      |
| `TIKTOK_CLIENT_ID`         | `<TikTok client ID>`                                                              |
| `TIKTOK_CLIENT_SECRET`     | `<TikTok client secret>`                                                          |
| `WEB_BASE_URL`             | `https://<your-vercel-url>` (set after Step 2)                                    |
| `API_BASE_URL`             | `https://adavatar-api.onrender.com`                                               |

4. After first deploy, note the API URL (should be `https://adavatar-api.onrender.com` if name matches)

---

### Step 2 — Deploy Web to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → Import GitHub repo
2. **Root Directory**: `apps/web`
3. Framework auto-detected as Next.js
4. Set these env vars in the Vercel dashboard:

| Key                    | Value                                                |
| ---------------------- | ---------------------------------------------------- |
| `DATABASE_URL`         | `<your Supabase session pooler URL with password>`   |
| `DIRECT_URL`           | `<your Supabase direct URL with password>`           |
| `NEXTAUTH_SECRET`      | `<copy from apps/web/.env.local NEXTAUTH_SECRET>`    |
| `NEXTAUTH_URL`         | `https://<your-vercel-url>` (set after first deploy) |
| `GOOGLE_CLIENT_ID`     | `<copy from Google Cloud Console OAuth credentials>` |
| `GOOGLE_CLIENT_SECRET` | `<copy from Google Cloud Console OAuth credentials>` |
| `API_JWT_SECRET`       | `<shared secret — copy from apps/api/.env>`          |
| `SENTRY_AUTH_TOKEN`    | `<Sentry auth token from sentry.io settings>`        |

> `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` are already hardcoded in `vercel.json`

5. Click Deploy → get the production URL (e.g. `https://ad-app.vercel.app`)

---

### Step 3 — Post-deploy fixes

1. **Set `NEXTAUTH_URL`** in Vercel dashboard to your real URL → Redeploy
2. **Set `WEB_BASE_URL`** in Render to the same URL
3. **Add the Vercel URL to Google OAuth** allowed redirect URIs:
   - Go to [Google Cloud Console](https://console.cloud.google.com) → APIs → Credentials → your OAuth client
   - Add to Authorized redirect URIs: `https://<your-vercel-url>/api/auth/callback/google`
4. Run `pnpm run db:seed` one more time against production DB if needed

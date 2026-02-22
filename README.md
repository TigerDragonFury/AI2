# AdAvatar

AI-powered video ad generator that combines your product images with animated avatars and publishes to TikTok, YouTube, Instagram, Facebook, and Snapchat — all from one dashboard.

---

## Tech Stack

| Layer         | Technology                                            |
| ------------- | ----------------------------------------------------- |
| Frontend      | Next.js 14 (App Router), Tailwind CSS, SWR, Recharts  |
| Backend       | Node.js / Express 4, Prisma 5, BullMQ 5               |
| Worker        | BullMQ workers, node-cron                             |
| Database      | PostgreSQL via Supabase                               |
| File Storage  | Cloudinary (free tier — 25 GB)                        |
| Queue / Cache | Redis via Upstash                                     |
| AI            | HuggingFace Inference API (LivePortrait + Wan2.1-I2V) |
| Auth          | NextAuth.js v4 (Google OAuth + email/password)        |
| Email         | Resend (free tier — 3,000 emails/month)               |
| Monitoring    | Sentry (free tier)                                    |
| Monorepo      | Turborepo + pnpm workspaces                           |

---

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm install -g pnpm@9`)
- A **PostgreSQL** database (Supabase free tier recommended)
- An **Upstash Redis** instance (free tier)
- A **Cloudinary** account (free tier)
- A **HuggingFace** account with API token

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/your-org/adavatar.git
cd adavatar

# 2. Install dependencies
pnpm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and fill in all values — see the Environment Variables section below

# 4. Generate Prisma client & run migrations
cd apps/api
pnpm db:generate
pnpm db:migrate

# 5. (Optional) Seed the database
pnpm db:seed

# 6. Start all services in development
cd ../..
pnpm dev
```

### Individual service start

```bash
# Web (port 3000)
cd apps/web && pnpm dev

# API (port 4000)
cd apps/api && pnpm dev

# Worker (port 4001, Bull Board at /admin/queues)
cd apps/worker && pnpm dev
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in every value. Here's where to get each one:

### Database

| Variable       | Where to get it                                              |
| -------------- | ------------------------------------------------------------ |
| `DATABASE_URL` | Supabase → Project → Settings → Database → Connection string |

### Auth

| Variable               | Where to get it                                                                |
| ---------------------- | ------------------------------------------------------------------------------ |
| `NEXTAUTH_SECRET`      | Generate: `openssl rand -base64 32`                                            |
| `NEXTAUTH_URL`         | Your web app URL (e.g. `http://localhost:3000`)                                |
| `GOOGLE_CLIENT_ID`     | Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client |
| `GOOGLE_CLIENT_SECRET` | Same as above                                                                  |

### Cloudinary

| Variable                            | Where to get it                 |
| ----------------------------------- | ------------------------------- |
| `CLOUDINARY_CLOUD_NAME`             | Cloudinary Dashboard            |
| `CLOUDINARY_API_KEY`                | Cloudinary Dashboard → API Keys |
| `CLOUDINARY_API_SECRET`             | Cloudinary Dashboard → API Keys |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Same as `CLOUDINARY_CLOUD_NAME` |

### HuggingFace

| Variable                | Where to get it                                                     |
| ----------------------- | ------------------------------------------------------------------- |
| `HUGGINGFACE_API_TOKEN` | huggingface.co → Settings → Access Tokens → New token (write scope) |

### Redis (Upstash)

| Variable                   | Where to get it                                                    |
| -------------------------- | ------------------------------------------------------------------ |
| `UPSTASH_REDIS_REST_URL`   | Upstash Console → Redis database → REST API                        |
| `UPSTASH_REDIS_REST_TOKEN` | Same as above                                                      |
| `REDIS_URL`                | Upstash Console → Redis database → Connect → Node.js (ioredis URL) |

### JWT

| Variable         | Where to get it                     |
| ---------------- | ----------------------------------- |
| `API_JWT_SECRET` | Generate: `openssl rand -base64 32` |

### Email (Resend)

| Variable         | Where to get it                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| `RESEND_API_KEY` | resend.com → API Keys                                                   |
| `EMAIL_FROM`     | Your verified sender address (e.g. `AdAvatar <noreply@yourdomain.com>`) |

### Sentry

| Variable                 | Where to get it                                    |
| ------------------------ | -------------------------------------------------- |
| `NEXT_PUBLIC_SENTRY_DSN` | sentry.io → Project → Settings → Client Keys (DSN) |
| `SENTRY_DSN`             | Same DSN but without `NEXT_PUBLIC_` prefix         |
| `SENTRY_ORG`             | Your Sentry organization slug                      |
| `SENTRY_PROJECT`         | Your Sentry project slug                           |
| `SENTRY_AUTH_TOKEN`      | sentry.io → Settings → Auth Tokens → Create token  |

### Platform OAuth

| Platform             | Variables                                      | Where to get them                                                  |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| TikTok               | `TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`     | developers.tiktok.com → App → Keys & Credentials                   |
| YouTube              | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`   | Google Cloud Console (same project, add YouTube Data API v3 scope) |
| Instagram / Facebook | `META_APP_ID`, `META_APP_SECRET`               | developers.facebook.com → App → Settings → Basic                   |
| Snapchat             | `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET` | business.snapchat.com → Apps                                       |

### Internal

| Variable              | Description                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| `API_BASE_URL`        | URL of the Express API (e.g. `http://localhost:4000` in dev, Render URL in prod) |
| `WEB_BASE_URL`        | URL of the Next.js app (e.g. `http://localhost:3000`)                            |
| `NEXT_PUBLIC_API_URL` | Same as `API_BASE_URL` but exposed to the browser                                |
| `PORT`                | API server port (defaults to `4000`)                                             |
| `NODE_ENV`            | `development` or `production`                                                    |

---

## Deployment

### Frontend → Vercel

1. Connect your GitHub repo to [Vercel](https://vercel.com)
2. Set **Root Directory** to `apps/web`
3. Vercel auto-detects Next.js — no framework config needed
4. Add all environment variables in Vercel dashboard (see table above)
5. Production deploys on merge to `main`, previews on every PR

### API & Worker → Render

The `render.yaml` at the repo root defines both services:

```bash
# Deploy via Render Blueprint
# 1. Go to render.com → New → Blueprint
# 2. Connect your repo — Render reads render.yaml automatically
# 3. Fill in all env vars marked sync: false in the Render dashboard
```

Both services share the same PostgreSQL (Supabase) and Redis (Upstash) instances.

---

## Project Structure

```
adavatar/
├── apps/
│   ├── web/          # Next.js 14 App Router frontend
│   ├── api/          # Express API (REST, Prisma, BullMQ enqueue)
│   └── worker/       # BullMQ workers + cron jobs
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── config/       # Queue names, OAuth config, rate limits, AI models
│   └── utils/        # Cloudinary folders, prompt enhancer, shared utils
├── render.yaml       # Render deployment config (API + Worker)
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example      # All required env vars documented
```

---

## Available Scripts

```bash
# Root
pnpm dev          # Start all apps in parallel (turborepo)
pnpm build        # Build all apps
pnpm lint         # Lint all apps
pnpm type-check   # TypeScript check all apps

# apps/api
pnpm db:generate  # Generate Prisma client
pnpm db:migrate   # Run migrations (production)
pnpm db:migrate:dev  # Run migrations (development, creates migration files)
pnpm db:studio    # Open Prisma Studio
pnpm db:seed      # Seed the database

# Worker Bull Board
# Available at http://localhost:4001/admin/queues in development
```

---

## License

MIT

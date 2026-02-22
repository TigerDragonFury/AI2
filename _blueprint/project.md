AdAvatar — Full Development Plan

1 — Infrastructure & Project Foundation
1.1 Repo & CI/CD Setup
GitHub monorepo with Turborepo. GitHub Actions pipelines for lint, test, and deploy on PR and merge to main. ESLint + Prettier + Husky pre-commit hooks. Separate apps: web (Next.js 14), api (Node/Express), worker (BullMQ). Shared packages/ for types, utils, and config.
1.2 Database Schema Design
Tables: users, organizations, avatars, products, ads, publish_jobs, platform_tokens, analytics. Prisma ORM with PostgreSQL (Supabase free tier). Write and run all migrations. Seed script for local dev.
1.3 Auth System
Email/password signup and login. Google OAuth. Session management via NextAuth.js. Roles: admin, user. JWT for API-to-worker auth. Middleware to protect all dashboard routes.
1.4 File Storage Setup
Use Cloudinary free tier (25GB). Presigned upload flow from frontend directly to Cloudinary. Folders: raw_uploads/, processed_avatars/, generated_ads/, product_images/. Store returned Cloudinary URLs in DB.
1.5 BullMQ + Redis Job Queues
Queues: avatar_processing, ad_generation, social_publishing. Dead-letter queue for failed jobs. Retry logic (3 attempts, exponential backoff). Bull Board UI mounted at /admin/queues for monitoring. Redis via Upstash free tier.
1.6 Base Dashboard Shell
Authenticated layout with sidebar nav. Empty-state pages for: Avatars, Products, Ads, Published, Analytics, Platforms, Settings. Fully mobile responsive with Tailwind CSS. Loading skeletons and error boundaries on all pages.

2 — Avatar Creation Module
2.1 Avatar Upload UI
Drag-and-drop + file picker. Accept JPG/PNG/MP4/MOV up to 200MB. Upload directly to Cloudinary via presigned URL. Show upload progress bar. On complete, POST to /api/avatars to create DB record with status: processing. Redirect to avatar detail page.
2.2 Avatar Validation Worker
On upload complete, worker checks: file is readable, if video then duration between 3–60s and resolution ≥720p, if image then minimum 512×512px. Reject with a clear error message stored on the record and shown in the UI. Update status to failed if invalid.
2.3 AI Avatar Processing Worker
Valid uploads are pushed to avatar_processing queue. Worker calls HuggingFace Inference API with LivePortrait model. Image inputs get animated into a looping 5s base avatar video. Video inputs get face-tracked and normalized via FFmpeg. Output uploaded to Cloudinary processed_avatars/ folder. DB record updated: avatar_video_url set, status: ready.
2.4 Avatar Gallery Page
Grid view of all user avatars. Status badge per card: Processing / Ready / Failed. Supabase Realtime subscription auto-updates card status without page refresh. Click to preview avatar video in a modal. Delete avatar option. "Create New" button prominent at top.

3 — Product Management Module
3.1 Product Upload UI
Multi-image upload supporting up to 10 images per product. Accept JPG/PNG up to 10MB each. Bulk upload with individual progress indicators. Product name input. After upload, POST to /api/products to create DB record with all Cloudinary image URLs stored as an array.
3.2 Product Gallery Page
Grid of saved products. Each card shows first image as thumbnail, product name, image count, and date added. Click to open detail view showing all product images. Edit name and images inline. Delete product (with warning if product is used in existing ads).

4 — Ad Generation Module
4.1 Ad Creator — 3-Step Wizard UI
Step 1: Select avatar from gallery (only ready avatars shown). Step 2: Select product from gallery. Step 3: Write a prompt describing what the avatar does with the product, select output aspect ratio (9:16 for TikTok/Reels, 16:9 for YouTube, 1:1 for feed). "Generate" button submits to /api/ads/generate. User is taken to a waiting screen immediately.
4.2 Prompt Enhancement
Before sending to AI, the backend auto-enhances the user's raw prompt. Appends visual quality instructions, motion direction, and product placement context. Store both raw prompt and enhanced prompt in the ads table. Show user the enhanced prompt so they can learn and improve over time.
4.3 AI Ad Generation Worker
Job picked from ad_generation queue. Worker builds a composite payload: avatar video URL + product image URLs + enhanced prompt. Calls HuggingFace Inference API using Wan2.1-I2V (image-to-video) or CogVideoX depending on input type. Polls for completion (HF async jobs). On completion, downloads generated video, re-uploads to Cloudinary generated_ads/ folder. Updates ads record: generated_video_url set, status: ready. Triggers realtime notification to frontend.
4.4 Ad Preview & Management Page
Lists all ads with status badges. Click to open preview modal with video player. Shows avatar used, product used, and prompt. Option to regenerate with edited prompt. Option to delete. "Publish" button opens the publishing flow. Download button to save video locally.

5 — Platform Connection Module
5.1 Platform OAuth Connect UI
Settings page with a "Connected Platforms" section. Cards for: TikTok, YouTube, Instagram, Facebook, Snapchat. Each card shows connected/disconnected status and connected account name. "Connect" button initiates OAuth flow per platform. "Disconnect" button revokes and deletes stored token.
5.2 OAuth Handlers (per platform)
Individual OAuth callback routes for each platform: /api/auth/callback/tiktok, /api/auth/callback/youtube, etc. On success, store access_token, refresh_token, expires_at, platform_user_id, and platform_username in platform_tokens table. Handle token refresh automatically before expiry using a cron job.
5.3 Token Refresh Cron Job
Runs every 6 hours. Queries platform_tokens where expires_at is within 24 hours. Attempts refresh for each. On failure, marks token as expired and sends in-app notification to user to reconnect.

6 — Publishing Module
6.1 Publish Flow UI
Triggered from the ad detail page. Multi-select checkboxes for each connected platform. Caption/description input (pre-filled with the ad prompt, editable). Hashtag input with suggestions. Schedule toggle: publish now or pick a date and time. "Publish" button submits to /api/publish.
6.2 Publish API Route
Receives: ad_id, array of selected platforms, caption, hashtags, scheduled time (optional). Creates one publish_jobs record per platform, all with status: pending. Enqueues jobs to social_publishing queue. If scheduled, jobs are delayed in BullMQ until the scheduled time. Returns job IDs to frontend.
6.3 TikTok Publishing Worker
Uses TikTok Content Posting API v2. Downloads video from Cloudinary. Initiates a chunked upload to TikTok. Posts with caption and hashtags. Stores returned post_id in publish_jobs. Updates status to published. Handles errors: invalid token (prompt reconnect), video format rejected (log error), rate limit (retry with backoff).
6.4 YouTube Publishing Worker
Uses YouTube Data API v3. Uploads video via resumable upload protocol. Sets title (from caption), description, tags (from hashtags), category (22 = People & Blogs by default). Sets privacy to public. Stores video_id. Updates publish job status.
6.5 Instagram Publishing Worker
Uses Meta Graph API. Two-step process: first POST to create a media container with the video URL, then POST to publish the container. Adds caption with hashtags. Stores returned media_id. Updates publish job status. Note: Requires Facebook Page linked to Instagram Business account.
6.6 Facebook Publishing Worker
Uses Meta Graph API. POST video directly to the page's /videos endpoint. Adds description. Stores video_id. Updates publish job status. Handles page token vs user token distinction.
6.7 Snapchat Publishing Worker
Uses Snapchat Marketing API. Uploads creative asset, then creates a Snap Ad object linked to the asset. Stores snap_id. Updates publish job status. Note: Snapchat API requires a Business account.
6.8 Published Posts Page
Table view of all publish jobs. Columns: Ad thumbnail, Platform icon, Caption preview, Status badge, Published date, Link to post. Filter by platform and status. Retry button on failed jobs. Real-time status updates via polling every 10s.

7 — Analytics Module
7.1 Analytics Ingestion Cron
Runs every 24 hours. For each published job, calls platform APIs to fetch post metrics: views, likes, comments, shares, reach, click-through. Upserts data into analytics table keyed by publish_job_id + fetched_at. Store raw platform response as JSONB for future use.
7.2 Analytics Dashboard
Overview cards: Total Ads Generated, Total Posts Published, Total Views (sum across platforms), Best Performing Post. Line chart: views over time. Bar chart: performance by platform. Per-ad breakdown table: each ad and its aggregate performance across all platforms where it was published.

8 — Notifications & Polish
8.1 In-App Notifications
Notification bell in navbar. Events that trigger a notification: avatar processing complete, ad generation complete, publish job succeeded or failed, platform token expired. Store in notifications table. Mark as read. Realtime delivery via Supabase Realtime.
8.2 Email Notifications
Use Resend free tier (3,000 emails/month). Send emails for: welcome on signup, ad generation complete, publish success summary (batched daily digest), platform token expiry warning.
8.3 Error Handling & Monitoring
Sentry free tier integrated in web, api, and worker. All unhandled errors captured with user context. Source maps uploaded on deploy. Custom error pages: 404, 500. All API routes return consistent error shape { error: string, code: string }.
8.4 Rate Limiting
Upstash Redis-based rate limiting on all API routes. Limits: upload endpoints 10 req/min, generation endpoints 5 req/min, publish endpoints 20 req/min. Return 429 with Retry-After header. Show friendly message in UI when limit hit.

9 — DevOps & Deployment
9.1 Frontend Deployment
Deploy web app to Vercel free tier. Environment variables configured in Vercel dashboard. Preview deployments on every PR. Production deploy on merge to main. Custom domain setup.
9.2 API Deployment
Deploy api (Node/Express) to Render free tier. Auto-deploy from main branch. Health check endpoint at /health. Graceful shutdown handling. Environment variables in Render dashboard.
9.3 Worker Deployment
Deploy worker (BullMQ) to Render free tier as a background worker service (not a web service, no sleep). Separate from API so jobs run independently. Shares same Redis (Upstash) and DB (Supabase) as API.
9.4 Environment Config
.env.example file committed to repo with all required keys and no values. Actual .env files gitignored. Document all required environment variables in README.md with instructions on where to get each one (Cloudinary, HuggingFace, each platform OAuth app, etc.).

That's the complete blueprint. Each numbered item is a discrete ticket your developers can be assigned independently. The recommended build order is exactly as numbered: infrastructure first, then avatar, product, ad generation, platforms, publishing, analytics, and polish last.

10.1 Updated Tier Schema & DB Changes
Update usage_limits table to support both daily and monthly limits per feature per tier. Admins can configure both independently.
usage_limits table:
tier | feature | daily_limit | monthly_limit
free | ad_generation | 1 | 10
free | avatar_creation | 1 | 5
free | publish_jobs | 3 | 30
pro | ad_generation | 5 | 60
pro | avatar_creation | 3 | 20
pro | publish_jobs | 15 | 200
business | ad_generation | 10 | 200
business | avatar_creation | 10 | 100
business | publish_jobs | 50 | 1000

daily_usage table:
id, user_id, feature, count, date

monthly_usage table:
id, user_id, feature, count, year, month
10.2 Updated Usage Enforcement Middleware
checkUsageLimit(userId, feature) now checks both limits in a single call. If either daily OR monthly limit is reached, block the action. Return distinct messages so the frontend knows which limit was hit: "daily_limit_reached" or "monthly_limit_reached". Atomic increments on both daily_usage and monthly_usage tables simultaneously on every allowed action.
10.3 Updated Usage Indicator UI
Each generation screen shows two usage bars stacked: one for daily, one for monthly. Example: "2 of 5 today · 18 of 60 this month". Color coding: green under 60%, yellow 60–90%, red 90–100%. When either limit is hit the generate button is disabled and the bar that caused the block is highlighted red with an upgrade prompt.
10.8 Admin Limit Configuration Panel
Add a dedicated "Tier Limits" page in the /admin panel. Renders a table with all tiers and features. Every daily and monthly limit value is an inline-editable number input. Admins change any value and hit Save — updates usage_limits table instantly. No code deploy needed to change limits. Changes take effect immediately for all users on that tier. Log every change: which admin, which tier, which feature, old value, new value, timestamp.
10.9 Monthly Reset Cron Job
A separate cron job runs at midnight UTC on the 1st of every month. Resets all monthly_usage counts. Logs the reset in cron_logs. Sends an in-app notification to users who hit their monthly limit: "Monthly quota reset. You're back to full power."
10.10 User-Facing Usage History Page
A "Usage" page in the user dashboard. Shows daily usage for the past 7 days as a bar chart per feature. Shows monthly usage for the past 3 months. Shows current period remaining quota for both daily and monthly limits side by side. Helps users understand their consumption and naturally nudges upgrades when they consistently hit limits.
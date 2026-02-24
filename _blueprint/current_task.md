# Current Task: Production Stability Ad Generation

## Status

**DEPLOYED & RUNNING.** All critical crashes fixed. Ad video generation is working end-to-end.

## Live URLs

| Service         | URL                               |
| --------------- | --------------------------------- |
| Web (Vercel)    | https://ai-2-web.vercel.app       |
| API (Render)    | https://adavatar-api.onrender.com |
| Worker (Render) | https://ai2-cvvx.onrender.com     |

## Latest Commits (Feb 2026)

| Commit    | Description                                                               |
| --------- | ------------------------------------------------------------------------- |
| `53a3027` | revert: back to wan2.1-i2v (wan2.2-i2v not confirmed on intl endpoint)    |
| `103f8b7` | fix(worker): load ad data from DB instead of undefined job payload fields |
| `efee14c` | fix: 429 polling rate (10s/60s) + optional chaining on imageUrls[0]       |
| `c0dccb0` | fix: DashScope img_url field name (was image_url)                         |
| `ac4db1c` | fix: admin pages use Bearer token instead of cookies                      |
| `646ef6d` | feat: DB-based API key storage + admin settings UI                        |
| `ca242c8` | fix: detectProvider() auto-detects from available keys                    |

## Known Issues / Next Steps

- **Video subject fidelity** Wan 2.1 sometimes transforms subjects (e.g. burger ingredients -> bread).
  This is a model limitation. Better prompts with cinematic/close-up direction help significantly.
  Wan 2.2 I2V upgrade pending availability on DashScope international endpoint.
- **Wan 2.2 upgrade** Check DashScope quota page for `wan2.2-i2v-plus` and `wan2.2-i2v-turbo`.
  When confirmed available, update `DASHSCOPE_AVATAR_ANIMATION` and `DASHSCOPE_AD_GENERATION_I2V`
  in `packages/config/src/index.ts`.
- **AI API key** Must be set via admin UI at `/admin/settings` OR as `ALIBABA_API_KEY` env var on Render worker.

## Architecture

```
Vercel          Render              Upstash         Supabase
---------       ----------------    -----------     ------------
apps/web   ->   apps/api       ->   Redis TCP   ->  PostgreSQL
(Next.js)       (Express :4000)     port 6380
                apps/worker
                (BullMQ)
```

## DB-stored AI Settings (admin UI)

- Route: `GET/PUT/DELETE /api/settings` (admin only)
- UI: https://ai-2-web.vercel.app/admin/settings
- Keys: `ai_provider`, `alibaba_api_key`, `fal_key`, `huggingface_api_key`
- Worker reads from DB first (60s cache), falls back to env var

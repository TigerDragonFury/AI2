# Current Task: Bootstrap the Project

## Task
Run `pnpm install` to install all dependencies, then verify the monorepo
structure builds correctly.

## Steps to Run
```bash
# From repo root:
pnpm install

# Generate Prisma client:
cd apps/api && pnpm db:generate

# Dev mode (all apps):
cd ../.. && pnpm dev
```

## After Bootstrap — Next Build Task: 2.1 Avatar Upload UI

Build the avatar upload page at `apps/web/src/app/(dashboard)/dashboard/avatars/new/page.tsx`:

### Requirements
1. Drag-and-drop + file picker
   - Accept: image/jpeg, image/png, video/mp4, video/quicktime
   - Max size: 200 MB
2. Upload directly to Cloudinary via presigned URL from `/api/avatars/presign`
3. Show upload progress bar (use XMLHttpRequest for progress events)
4. On complete:
   - POST to `/api/avatars` with `{ name, rawUrl, inputType }`
   - Show success state with link to avatar gallery
   - OR show error with message
5. Redirect to `/dashboard/avatars` after success

### Files to Create
- `apps/web/src/app/(dashboard)/dashboard/avatars/new/page.tsx` — upload page
- `apps/web/src/components/avatar/avatar-upload-form.tsx` — drag-drop form
- `apps/web/src/hooks/useCloudinaryUpload.ts` — upload logic hook

### Notes
- Use the `useSession` hook for the auth token
- The presign endpoint returns: `{ signature, timestamp, folder, cloudName, apiKey }`
- Cloudinary upload URL: `https://api.cloudinary.com/v1_1/{cloudName}/auto/upload`
- After upload Cloudinary returns `secure_url` — use that as `rawUrl`
- Worker will automatically process the avatar once the DB record is created
  (worker polls for new `status: 'processing'` avatars — implement that in 2.2/2.3)

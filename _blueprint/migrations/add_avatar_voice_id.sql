-- Add Fish Audio voice reference ID to avatars
-- Run: psql $DATABASE_URL -f this_file.sql

ALTER TABLE avatars ADD COLUMN IF NOT EXISTS "voiceId" TEXT;

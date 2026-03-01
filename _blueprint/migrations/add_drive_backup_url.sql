-- Migration: add driveBackupUrl to ads table
-- Run this against your production database after deploying the schema change.

ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "driveBackupUrl" TEXT;

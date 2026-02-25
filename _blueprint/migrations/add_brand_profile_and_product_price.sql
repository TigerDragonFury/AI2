-- Migration: Add company brand profile fields to users table
-- and price/description fields to products table.
-- Run this in your Supabase SQL editor (or any Postgres client).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "companyName"       text,
  ADD COLUMN IF NOT EXISTS "companyLogoUrl"    text,
  ADD COLUMN IF NOT EXISTS "brandVoicePreset"  text,
  ADD COLUMN IF NOT EXISTS "brandVoiceCustom"  text,
  ADD COLUMN IF NOT EXISTS "productCategories" text,
  ADD COLUMN IF NOT EXISTS "onboardingDone"    boolean NOT NULL DEFAULT false;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "price"       double precision,
  ADD COLUMN IF NOT EXISTS "currency"    text DEFAULT 'USD';

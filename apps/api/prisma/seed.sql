-- Seed usage limits
INSERT INTO usage_limits (id, tier, feature, "dailyLimit", "monthlyLimit", "updatedAt")
VALUES
  -- Free tier
  (gen_random_uuid()::text, 'free', 'avatar_creation', 10, 50, NOW()),
  (gen_random_uuid()::text, 'free', 'ad_generation', 10, 50, NOW()),
  (gen_random_uuid()::text, 'free', 'publish_jobs', 20, 100, NOW()),
  -- Pro tier
  (gen_random_uuid()::text, 'pro', 'avatar_creation', 3, 20, NOW()),
  (gen_random_uuid()::text, 'pro', 'ad_generation', 5, 60, NOW()),
  (gen_random_uuid()::text, 'pro', 'publish_jobs', 15, 200, NOW()),
  -- Enterprise tier
  (gen_random_uuid()::text, 'enterprise', 'avatar_creation', 10, 100, NOW()),
  (gen_random_uuid()::text, 'enterprise', 'ad_generation', 10, 200, NOW()),
  (gen_random_uuid()::text, 'enterprise', 'publish_jobs', 50, 1000, NOW())
ON CONFLICT (tier, feature) DO UPDATE
  SET "dailyLimit" = EXCLUDED."dailyLimit",
      "monthlyLimit" = EXCLUDED."monthlyLimit",
      "updatedAt" = NOW();

-- Seed dev admin user
INSERT INTO users (id, email, name, role, tier, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'admin@adavatar.dev',
  'Dev Admin',
  'admin',
  'enterprise',
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

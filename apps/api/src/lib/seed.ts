import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Seed usage limits
  const usageLimits = [
    // Free tier
    { tier: 'free' as const, feature: 'avatar_creation', dailyLimit: 1, monthlyLimit: 5 },
    { tier: 'free' as const, feature: 'ad_generation', dailyLimit: 1, monthlyLimit: 10 },
    { tier: 'free' as const, feature: 'publish_jobs', dailyLimit: 3, monthlyLimit: 30 },
    // Pro tier
    { tier: 'pro' as const, feature: 'avatar_creation', dailyLimit: 3, monthlyLimit: 20 },
    { tier: 'pro' as const, feature: 'ad_generation', dailyLimit: 5, monthlyLimit: 60 },
    { tier: 'pro' as const, feature: 'publish_jobs', dailyLimit: 15, monthlyLimit: 200 },
    // Enterprise tier
    { tier: 'enterprise' as const, feature: 'avatar_creation', dailyLimit: 10, monthlyLimit: 100 },
    { tier: 'enterprise' as const, feature: 'ad_generation', dailyLimit: 10, monthlyLimit: 200 },
    { tier: 'enterprise' as const, feature: 'publish_jobs', dailyLimit: 50, monthlyLimit: 1000 },
  ];

  for (const limit of usageLimits) {
    await prisma.usageLimit.upsert({
      where: { tier_feature: { tier: limit.tier, feature: limit.feature } },
      create: limit,
      update: limit,
    });
  }

  console.log(`Seeded ${usageLimits.length} usage limits.`);

  // Create dev admin user
  if (process.env.NODE_ENV === 'development') {
    const admin = await prisma.user.upsert({
      where: { email: 'admin@adavatar.dev' },
      create: {
        email: 'admin@adavatar.dev',
        name: 'Dev Admin',
        role: 'admin',
        tier: 'enterprise',
      },
      update: {},
    });
    console.log(`Dev admin user: ${admin.email}`);
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

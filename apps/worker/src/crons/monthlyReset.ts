import { prisma } from '../lib/prisma';

/**
 * Runs at midnight UTC on the 1st of every month.
 * Resets all monthly_usage counts for all users.
 * Sends in-app notification to users who had hit their limit.
 */
export async function runMonthlyResetCron() {
  console.log('[monthlyReset] Starting monthly usage reset…');

  const now = new Date();
  // We want the PREVIOUS month (since this runs at the start of the new month)
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  try {
    // Find users who hit their monthly limit last month (for notification)
    const usersAtLimit = await prisma.$queryRaw<
      { userId: string; feature: string; count: number }[]
    >`
      SELECT mu.user_id as "userId", mu.feature, mu.count
      FROM monthly_usage mu
      JOIN users u ON u.id = mu.user_id
      JOIN usage_limits ul ON ul.tier = u.tier AND ul.feature = mu.feature
      WHERE mu.year = ${prevYear}
        AND mu.month = ${prevMonth}
        AND ul.monthly_limit IS NOT NULL
        AND mu.count >= ul.monthly_limit
    `;

    // Delete all monthly usage records for the previous month
    const deleted = await prisma.monthlyUsage.deleteMany({
      where: { year: prevYear, month: prevMonth },
    });

    console.log(
      `[monthlyReset] Deleted ${deleted.count} monthly usage records for ${prevYear}-${prevMonth}`
    );

    // Notify users who were at their limit
    if (usersAtLimit.length > 0) {
      const uniqueUsers = [...new Set(usersAtLimit.map((r) => r.userId))];
      await prisma.notification.createMany({
        data: uniqueUsers.map((userId) => ({
          userId,
          event: 'monthly_quota_reset',
          message: "Your monthly quota has been reset. You're back to full power!",
          metadata: { year: prevYear, month: prevMonth },
        })),
        skipDuplicates: true,
      });
      console.log(`[monthlyReset] Sent quota-reset notifications to ${uniqueUsers.length} users`);
    }

    console.log('[monthlyReset] Complete.');
  } catch (err) {
    console.error('[monthlyReset] Error:', err);
    throw err;
  }
}

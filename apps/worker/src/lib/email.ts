import { Resend } from 'resend';

const FROM = process.env.EMAIL_FROM ?? 'AdAvatar <noreply@adavatar.app>';

// Lazy — only instantiated when RESEND_API_KEY is present, avoiding startup crash
function getResend(): Resend {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  await getResend().emails.send({
    from: FROM,
    to,
    subject: 'Welcome to AdAvatar 🎉',
    html: `
      <h1>Welcome, ${name || 'Creator'}!</h1>
      <p>Thanks for joining AdAvatar. You can now upload avatars, create products, and generate AI-powered ads in minutes.</p>
      <p><a href="${process.env.WEB_BASE_URL}/dashboard">Open your dashboard →</a></p>
      <p>If you have any questions, reply to this email and we'll help right away.</p>
    `,
  });
}

export async function sendAdReadyEmail(to: string, name: string, _adId: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  await getResend().emails.send({
    from: FROM,
    to,
    subject: 'Your ad is ready! 🎬',
    html: `
      <h1>Your ad is ready, ${name || 'Creator'}!</h1>
      <p>We've finished generating your video ad. Head over to your dashboard to preview and publish it.</p>
      <p><a href="${process.env.WEB_BASE_URL}/dashboard/ads">View your ads →</a></p>
    `,
  });
}

export async function sendPublishSummaryEmail(
  to: string,
  name: string,
  platforms: string[]
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const platformList = platforms.map((p) => `<li>${p}</li>`).join('');
  await getResend().emails.send({
    from: FROM,
    to,
    subject: 'Your ad was published ✅',
    html: `
      <h1>Published successfully, ${name || 'Creator'}!</h1>
      <p>Your ad has been published to the following platform(s):</p>
      <ul>${platformList}</ul>
      <p><a href="${process.env.WEB_BASE_URL}/dashboard/published">View published posts →</a></p>
    `,
  });
}

export async function sendTokenExpiryEmail(
  to: string,
  name: string,
  platform: string
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Action required: Reconnect your ${platform} account`,
    html: `
      <h1>Reconnect ${platform}, ${name || 'Creator'}</h1>
      <p>Your ${platform} connection has expired. To continue publishing to ${platform}, please reconnect your account.</p>
      <p><a href="${process.env.WEB_BASE_URL}/dashboard/platforms">Reconnect now →</a></p>
    `,
  });
}

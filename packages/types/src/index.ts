// ─── Users & Auth ─────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Avatars ──────────────────────────────────────────────────────────────────

export type AvatarStatus = 'uploading' | 'processing' | 'ready' | 'failed';
export type AvatarInputType = 'image' | 'video';

export interface Avatar {
  id: string;
  userId: string;
  name: string;
  inputType: AvatarInputType;
  rawUrl: string;
  avatarVideoUrl: string | null;
  status: AvatarStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Products ─────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  userId: string;
  name: string;
  imageUrls: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Ads ──────────────────────────────────────────────────────────────────────

export type AdStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type AspectRatio = '9:16' | '16:9' | '1:1';

export interface Ad {
  id: string;
  userId: string;
  avatarId: string;
  productId: string;
  rawPrompt: string;
  enhancedPrompt: string | null;
  aspectRatio: AspectRatio;
  duration: number;
  generatedVideoUrl: string | null;
  status: AdStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Platforms ────────────────────────────────────────────────────────────────

export type PlatformName = 'tiktok' | 'youtube' | 'instagram' | 'facebook' | 'snapchat';

export interface PlatformToken {
  id: string;
  userId: string;
  platform: PlatformName;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  platformUserId: string;
  platformUsername: string;
  isExpired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Publish Jobs ─────────────────────────────────────────────────────────────

export type PublishJobStatus = 'pending' | 'processing' | 'published' | 'failed';

export interface PublishJob {
  id: string;
  userId: string;
  adId: string;
  platform: PlatformName;
  caption: string;
  hashtags: string[];
  scheduledAt: Date | null;
  publishedAt: Date | null;
  status: PublishJobStatus;
  postId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface Analytics {
  id: string;
  publishJobId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  clickThrough: number;
  rawData: Record<string, unknown>;
  fetchedAt: Date;
  createdAt: Date;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationEvent =
  | 'avatar_processing_complete'
  | 'avatar_processing_failed'
  | 'ad_generation_complete'
  | 'ad_generation_failed'
  | 'publish_succeeded'
  | 'publish_failed'
  | 'platform_token_expired';

export interface Notification {
  id: string;
  userId: string;
  event: NotificationEvent;
  message: string;
  isRead: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ─── Job Queue Payloads ────────────────────────────────────────────────────────

export interface AvatarProcessingJobPayload {
  avatarId: string;
  userId: string;
  rawUrl: string;
  inputType: AvatarInputType;
}

export interface AdGenerationJobPayload {
  adId: string;
  userId: string;
  avatarVideoUrl: string;
  productImageUrls: string[];
  enhancedPrompt: string;
  aspectRatio: AspectRatio;
}

export interface SocialPublishingJobPayload {
  publishJobId: string;
  userId: string;
  adId: string;
  platform: PlatformName;
  generatedVideoUrl: string;
  caption: string;
  hashtags: string[];
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  success: true;
}

export interface ApiError {
  error: string;
  code: string;
  success: false;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ─── Usage / Tiers ────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export interface UsageLimit {
  id: string;
  tier: SubscriptionTier;
  feature: string;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface DailyUsage {
  id: string;
  userId: string;
  feature: string;
  count: number;
  date: Date;
}

export interface MonthlyUsage {
  id: string;
  userId: string;
  feature: string;
  count: number;
  year: number;
  month: number;
}

export interface LimitChangeLog {
  id: string;
  adminId: string;
  tier: SubscriptionTier;
  feature: string;
  oldValue: number | null;
  newValue: number | null;
  limitType: 'daily' | 'monthly';
  createdAt: Date;
}

/** Returned by GET /api/usage */
export interface UsageFeatureStatus {
  feature: string;
  tier: SubscriptionTier;
  daily: { used: number; limit: number | null };
  monthly: { used: number; limit: number | null };
}

/** Returned by GET /api/usage/history */
export interface UsageHistory {
  daily: DailyUsage[];
  monthly: MonthlyUsage[];
}

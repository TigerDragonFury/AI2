# AdAvatar — Database Schema

Source of truth: `apps/api/prisma/schema.prisma`

## Enums
| Enum | Values |
|---|---|
| UserRole | admin, user |
| AvatarStatus | uploading, processing, ready, failed |
| AvatarInputType | image, video |
| AdStatus | pending, processing, ready, failed |
| AspectRatio | RATIO_9_16 (9:16), RATIO_16_9 (16:9), RATIO_1_1 (1:1) |
| PlatformName | tiktok, youtube, instagram, facebook, snapchat |
| PublishJobStatus | pending, processing, published, failed |
| SubscriptionTier | free, pro, enterprise |

## Tables

### organizations
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| name | String | |
| ownerId | String | |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### users
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| email | String | unique |
| name | String? | |
| image | String? | |
| role | UserRole | default: user |
| organizationId | String? | FK → organizations |
| tier | SubscriptionTier | default: free |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### accounts / sessions / verification_tokens
Standard NextAuth.js adapter tables.

### avatars
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| userId | String | FK → users |
| name | String | |
| inputType | AvatarInputType | image or video |
| rawUrl | String | Cloudinary raw_uploads/ URL |
| avatarVideoUrl | String? | Cloudinary processed_avatars/ URL |
| status | AvatarStatus | default: uploading |
| errorMessage | String? | |
| createdAt / updatedAt | DateTime | |

### products
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| userId | String | FK → users |
| name | String | |
| imageUrls | String[] | Cloudinary product_images/ URLs |
| createdAt / updatedAt | DateTime | |

### ads
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| userId | String | FK → users |
| avatarId | String | FK → avatars |
| productId | String | FK → products |
| rawPrompt | String (Text) | User's original prompt |
| enhancedPrompt | String? (Text) | Auto-enhanced prompt |
| aspectRatio | AspectRatio | |
| generatedVideoUrl | String? | Cloudinary generated_ads/ URL |
| status | AdStatus | default: pending |
| errorMessage | String? | |
| createdAt / updatedAt | DateTime | |

### platform_tokens
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| userId | String | FK → users |
| platform | PlatformName | |
| accessToken | String (Text) | |
| refreshToken | String? (Text) | |
| expiresAt | DateTime? | |
| platformUserId | String | |
| platformUsername | String | |
| isExpired | Boolean | default: false |
| createdAt / updatedAt | DateTime | |
| UNIQUE | (userId, platform) | one token per platform per user |

### publish_jobs
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| userId | String | FK → users |
| adId | String | FK → ads |
| platformTokenId | String | FK → platform_tokens |
| platform | PlatformName | |
| caption | String (Text) | |
| hashtags | String[] | |
| scheduledAt | DateTime? | null = publish immediately |
| publishedAt | DateTime? | |
| status | PublishJobStatus | default: pending |
| postId | String? | Platform-returned post ID |
| errorMessage | String? | |
| createdAt / updatedAt | DateTime | |

### analytics
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| publishJobId | String | FK → publish_jobs |
| views | Int | |
| likes | Int | |
| comments | Int | |
| shares | Int | |
| reach | Int | |
| clickThrough | Int | |
| rawData | Json | Platform raw response |
| fetchedAt | DateTime | |
| createdAt | DateTime | |

### notifications
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| userId | String | FK → users |
| event | String | NotificationEvent enum value |
| message | String | |
| isRead | Boolean | default: false |
| metadata | Json? | |
| createdAt | DateTime | |

### usage_limits
| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| tier | SubscriptionTier | |
| feature | String | e.g. avatar_uploads, ad_generations |
| dailyLimit | Int? | null = unlimited |
| monthlyLimit | Int? | null = unlimited |
| UNIQUE | (tier, feature) | |

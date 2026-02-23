import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { Response, NextFunction } from 'express';
import { RATE_LIMITS } from '@adavatar/config';
import type { AuthRequest } from './auth';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function createLimiter(requests: number) {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, '1 m'),
    analytics: true,
  });
}

const limiters = {
  upload: createLimiter(RATE_LIMITS.UPLOAD),
  generation: createLimiter(RATE_LIMITS.GENERATION),
  publish: createLimiter(RATE_LIMITS.PUBLISH),
};

type LimiterKey = keyof typeof limiters;

export function rateLimiter(type: LimiterKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const identifier = req.userId ?? req.ip ?? 'anonymous';
      const { success, limit, remaining, reset } = await limiters[type].limit(identifier);

      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', reset);

      if (!success) {
        res.setHeader('Retry-After', Math.ceil((reset - Date.now()) / 1000));
        res.status(429).json({
          error: 'Too many requests. Please slow down.',
          code: 'RATE_LIMITED',
          success: false,
        });
        return;
      }
    } catch (err) {
      // Fail open — if Upstash is unavailable, don't block the request
      console.warn('[rate-limiter] Upstash unavailable, skipping:', (err as Error).message);
    }

    next();
  };
}

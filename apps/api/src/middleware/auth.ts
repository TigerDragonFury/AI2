import type { Request, Response, NextFunction } from 'express';
import jwt, { JsonWebTokenError, TokenExpiredError, NotBeforeError } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', code: 'NO_TOKEN', success: false });
    return;
  }

  const secret = process.env.API_JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured', code: 'NO_SECRET', success: false });
    return;
  }

  let payload: { userId: string; role: string };
  try {
    payload = jwt.verify(token, secret) as { userId: string; role: string };
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED', success: false });
    } else if (err instanceof JsonWebTokenError || err instanceof NotBeforeError) {
      res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN', success: false });
    } else {
      res.status(401).json({ error: 'Token error', code: 'TOKEN_ERROR', success: false });
    }
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND', success: false });
      return;
    }
    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (err) {
    console.error('[requireAuth] DB error:', err);
    res.status(500).json({ error: 'Database error', code: 'DB_ERROR', success: false });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', success: false });
    return;
  }
  next();
}

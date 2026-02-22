import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ error: 'Unauthorized', code: 'NO_TOKEN', success: false });
      return;
    }

    const secret = process.env.API_JWT_SECRET;
    if (!secret) throw new Error('API_JWT_SECRET not configured');

    const payload = jwt.verify(token, secret) as { userId: string; role: string };

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND', success: false });
      return;
    }

    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN', success: false });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', success: false });
    return;
  }
  next();
}

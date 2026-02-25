import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { createError } from '../middleware/errorHandler';
import { CLOUDINARY_FOLDERS } from '@adavatar/utils';
import { v2 as cloudinary } from 'cloudinary';

export const productsRouter = Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// GET /api/products
productsRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: products, success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/products/:id
productsRouter.get('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      include: { ads: { select: { id: true } } },
    });
    if (!product) return next(createError('Product not found', 404, 'NOT_FOUND'));
    res.json({ data: product, success: true });
  } catch (err) {
    next(err);
  }
});

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  imageUrls: z.array(z.string().url()).min(1).max(10),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().positive().optional().nullable(),
  currency: z.string().max(10).optional().default('USD'),
});

// POST /api/products
productsRouter.post(
  '/',
  requireAuth,
  rateLimiter('upload'),
  async (req: AuthRequest, res, next) => {
    try {
      const body = createProductSchema.parse(req.body);
      const product = await prisma.product.create({
        data: {
          userId: req.userId!,
          name: body.name,
          imageUrls: body.imageUrls,
          description: body.description ?? null,
          price: body.price ?? null,
          currency: body.currency ?? 'USD',
        },
      });
      res.status(201).json({ data: product, success: true });
    } catch (err) {
      next(err);
    }
  }
);

const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  imageUrls: z.array(z.string().url()).min(1).max(10).optional(),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().positive().optional().nullable(),
  currency: z.string().max(10).optional(),
});

// PATCH /api/products/:id
productsRouter.patch('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!product) return next(createError('Product not found', 404, 'NOT_FOUND'));

    const body = updateProductSchema.parse(req.body);
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: body,
    });
    res.json({ data: updated, success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/products/:id
productsRouter.delete('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      include: { ads: { select: { id: true } } },
    });
    if (!product) return next(createError('Product not found', 404, 'NOT_FOUND'));

    if (product.ads.length > 0) {
      return next(
        createError(
          `Cannot delete product — it is used in ${product.ads.length} ad(s)`,
          409,
          'PRODUCT_IN_USE'
        )
      );
    }

    await prisma.product.delete({ where: { id: product.id } });
    res.json({ data: { id: product.id }, success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/products/presign
productsRouter.post(
  '/presign',
  requireAuth,
  rateLimiter('upload'),
  async (req: AuthRequest, res, next) => {
    try {
      const timestamp = Math.round(Date.now() / 1000);
      const folder = CLOUDINARY_FOLDERS.PRODUCT_IMAGES;
      const signature = cloudinary.utils.api_sign_request(
        { timestamp, folder },
        process.env.CLOUDINARY_API_SECRET!
      );
      res.json({
        data: {
          signature,
          timestamp,
          folder,
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
          apiKey: process.env.CLOUDINARY_API_KEY,
        },
        success: true,
      });
    } catch (err) {
      next(err);
    }
  }
);

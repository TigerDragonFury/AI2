import { Router } from 'express';
import { avatarsRouter } from './avatars';
import { productsRouter } from './products';
import { adsRouter } from './ads';
import { publishRouter } from './publish';
import { platformsRouter } from './platforms';
import { analyticsRouter } from './analytics';
import { notificationsRouter } from './notifications';

export const router = Router();

router.use('/avatars', avatarsRouter);
router.use('/products', productsRouter);
router.use('/ads', adsRouter);
router.use('/publish', publishRouter);
router.use('/platforms', platformsRouter);
router.use('/analytics', analyticsRouter);
router.use('/notifications', notificationsRouter);

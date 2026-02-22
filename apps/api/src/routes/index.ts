import { Router } from 'express';
import { avatarsRouter } from './avatars';
import { productsRouter } from './products';
import { adsRouter } from './ads';
import { publishRouter } from './publish';
import { platformsRouter } from './platforms';
import { oauthRouter } from './oauth';
import { analyticsRouter } from './analytics';
import { notificationsRouter } from './notifications';
import { usageRouter } from './usage';

export const router = Router();

router.use('/avatars', avatarsRouter);
router.use('/products', productsRouter);
router.use('/ads', adsRouter);
router.use('/publish', publishRouter);
router.use('/platforms', platformsRouter);
router.use('/oauth', oauthRouter);
router.use('/analytics', analyticsRouter);
router.use('/notifications', notificationsRouter);
router.use('/usage', usageRouter);

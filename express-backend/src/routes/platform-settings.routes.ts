import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.middleware';
import * as controller from '../controllers/platform-settings.controller';

/** Matches the NestJS route exactly: `admin/platform-settings`, mounted under `/api` — see
 * app.ts — so the full path is `GET/PATCH /api/admin/platform-settings`. */
export const platformSettingsRouter = Router();

platformSettingsRouter.use(
  requireAuth,
  requirePermission('platform-settings:manage'),
);
platformSettingsRouter.get('/', controller.getSettings);
platformSettingsRouter.patch('/', controller.updateSettings);
platformSettingsRouter.post(
  '/refresh-exchange-rate',
  controller.refreshExchangeRate,
);

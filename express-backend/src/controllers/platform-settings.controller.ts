import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import * as platformSettingsService from '../services/platform-settings.service';
import * as exchangeRateService from '../services/exchange-rate.service';
import { updatePlatformSettingsSchema } from '../validators/platform-settings.validator';

/**
 * Ported from `src/modules/platform-settings/admin-platform-settings.controller.ts` —
 * same three routes, same permission gate (`platform-settings:manage`, applied as
 * route-level middleware instead of a decorator — see `routes/platform-settings.routes.ts`).
 * Handlers stay thin: parse/validate, call the service, return its result — all the
 * actual logic already lives in the service layer, same discipline the NestJS side used.
 */

export const getSettings = asyncHandler(
  async (_req: AuthenticatedRequest, res: Response) => {
    const settings = await platformSettingsService.getSettings();
    res.json({
      success: true,
      message: 'Platform settings retrieved successfully',
      data: settings,
    });
  },
);

export const updateSettings = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const dto = updatePlatformSettingsSchema.parse(req.body);
    const settings = await platformSettingsService.updateSettings(
      req.user!.sub,
      dto,
    );
    res.json({
      success: true,
      message: 'Platform settings updated successfully',
      data: settings,
    });
  },
);

export const refreshExchangeRate = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const snapshot = await exchangeRateService.refreshFromApi(req.user!.sub);
    res.json({
      success: true,
      message: 'Exchange rate refreshed successfully',
      data: snapshot,
    });
  },
);

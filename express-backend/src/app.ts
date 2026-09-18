import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Env } from './config/env';
import { prisma } from './config/prisma';
import { errorMiddleware } from './middleware/error.middleware';
import { platformSettingsRouter } from './routes/platform-settings.routes';

/**
 * The Express skeleton — security middleware, health probes, and the first ported
 * module mounted under `/api`. Matches the deploy guide's real, documented probe
 * contract (`GET /health` liveness, `GET /health/ready` readiness) rather than
 * inventing a new one, so a load balancer configured for the NestJS API needs no
 * changes to point at this one instead, once it's ready to.
 */
export function createApp(env: Env): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));

  const globalLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(globalLimiter);

  // Exempt from the rate limiter, same as the NestJS side's probes.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/health/ready', async (_req, res) => {
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3_000),
        ),
      ]);
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not ready' });
    }
  });

  app.use('/api/admin/platform-settings', platformSettingsRouter);

  // 404 for anything not matched above — a real handler, not a silent fall-through.
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: `No route for ${req.method} ${req.path}`,
      error: 'NOT_FOUND',
    });
  });

  app.use(errorMiddleware);

  return app;
}

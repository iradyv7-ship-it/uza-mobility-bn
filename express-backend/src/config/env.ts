import 'dotenv/config';

/**
 * Boot-time environment validation — the Express side of the same contract
 * `docs/.../deploy-env.md` already documents for the NestJS API: refuse to start in
 * production with a broken environment, and name every problem at once rather than
 * one crash per restart.
 *
 * Deliberately scoped to what THIS slice (Platform Settings) actually reads. As each
 * further module ports over (Mongo/GridFS for uploads, mail, Google OAuth, the
 * exchange-rate API key), its required variables join this list — never validate a
 * variable no code path here actually uses yet.
 */
export interface Env {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  exchangeRateApiKey: string | null;
}

const PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'secret',
  'your-secret-here',
  'local-simulation-only-secret-do-not-use-in-prod-32chars-min',
]);

export function loadEnv(): Env {
  const problems: string[] = [];
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as Env['nodeEnv'];
  const isProd = nodeEnv === 'production';

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) problems.push('DATABASE_URL is not set');

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    problems.push('JWT_SECRET is not set');
  } else if (isProd && jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters in production');
  } else if (isProd && PLACEHOLDER_SECRETS.has(jwtSecret.toLowerCase())) {
    problems.push(
      'JWT_SECRET is a known placeholder value — generate a real one',
    );
  }

  const corsOriginsRaw = process.env.CORS_ORIGINS?.trim();
  if (isProd && !corsOriginsRaw) {
    problems.push('CORS_ORIGINS is required in production');
  }
  const corsOrigins = (
    corsOriginsRaw ?? 'http://localhost:3000,http://localhost:3100'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin.endsWith('/')) {
      problems.push(
        `CORS_ORIGINS entry "${origin}" has a trailing slash — must be scheme+host only`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Environment is not valid — ${problems.length} problem(s):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
  }

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 7000),
    databaseUrl: databaseUrl!,
    jwtSecret: jwtSecret!,
    corsOrigins,
    exchangeRateApiKey: process.env.EXCHANGE_RATE_API_KEY?.trim() || null,
  };
}

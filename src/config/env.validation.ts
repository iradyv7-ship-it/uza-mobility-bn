/**
 * Environment validation, run once at boot before any module is constructed.
 *
 * Every rule here exists because of a specific way the platform fails when the variable is
 * wrong — and in each case the failure was silent. With `FRONTEND_URL` unset, password-reset
 * emails and Google sign-in redirect the user to `http://localhost:3000`. With
 * `PUBLIC_UPLOAD_BASE_URL` unset, every image URL the API returns points at
 * `http://localhost:7000`. With `CORS_ORIGINS` unset, the API quietly allows localhost only
 * and the deployed front end gets opaque network errors. None of those throw. All of them
 * are discovered by a real user, on the new host, after deployment.
 *
 * So: in production, the variables whose absence would send a customer to localhost are
 * REQUIRED, and the process refuses to start without them, naming what is missing. In
 * development the same variables keep their localhost defaults so `npm run start:dev` on a
 * fresh clone still works.
 *
 * Kept as plain checks rather than a schema library on purpose. Reading this file should be
 * enough to know exactly what a new host needs — see `04-uza-cloud/deploy-env.md` in the
 * guide repository for the annotated list this is derived from.
 */

type Env = Record<string, string | undefined>;

const PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'secret',
  'devsecret',
  'devsecretdevsecretdevsecretdevsecret',
  'your-secret-here',
  'replace-me',
]);

function present(env: Env, key: string): boolean {
  return typeof env[key] === 'string' && env[key].trim().length > 0;
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string | undefined): boolean {
  return isHttpUrl(value) && new URL(value!.trim()).protocol === 'https:';
}

export function validateEnv(env: Env): Env {
  const isProduction = env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Always required ─────────────────────────────────────────────────────────────────
  // Without these the process cannot do anything useful, in any environment.
  for (const key of ['DATABASE_URL', 'MONGODB_URI', 'JWT_SECRET'] as const) {
    if (!present(env, key)) errors.push(`${key} is required.`);
  }

  if (
    present(env, 'DATABASE_URL') &&
    !/^postgres(ql)?:\/\//.test(env.DATABASE_URL!)
  ) {
    errors.push('DATABASE_URL must be a postgresql:// connection string.');
  }
  if (
    present(env, 'MONGODB_URI') &&
    !/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI!)
  ) {
    errors.push(
      'MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string.',
    );
  }

  if (present(env, 'JWT_SECRET')) {
    const secret = env.JWT_SECRET!.trim();
    if (secret.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters.');
    }
    if (isProduction && PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
      errors.push(
        'JWT_SECRET is a placeholder value. Generate one: openssl rand -base64 48',
      );
    }
  }

  // ── Required in production, defaulted to localhost otherwise ────────────────────────
  // These are the variables whose absence sends a real user to localhost.
  if (isProduction) {
    for (const key of [
      'FRONTEND_URL',
      'ADMIN_FRONTEND_URL',
      'PUBLIC_UPLOAD_BASE_URL',
      'CORS_ORIGINS',
    ] as const) {
      if (!present(env, key)) {
        errors.push(
          `${key} is required in production — without it the API falls back to a localhost URL.`,
        );
      }
    }
    for (const key of [
      'FRONTEND_URL',
      'ADMIN_FRONTEND_URL',
      'PUBLIC_UPLOAD_BASE_URL',
    ] as const) {
      if (present(env, key) && !isHttpsUrl(env[key])) {
        errors.push(
          `${key} must be an https:// URL in production (got "${env[key]}").`,
        );
      }
    }
    if (present(env, 'CORS_ORIGINS')) {
      const bad = env
        .CORS_ORIGINS!.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .filter((o) => !isHttpUrl(o) || o.endsWith('/'));
      if (bad.length) {
        errors.push(
          `CORS_ORIGINS entries must be origins (scheme + host, no trailing slash): ${bad.join(', ')}`,
        );
      }
      // The two front ends must actually be allowed, or every browser call fails.
      for (const key of ['FRONTEND_URL', 'ADMIN_FRONTEND_URL'] as const) {
        if (present(env, key) && isHttpUrl(env[key])) {
          const origin = new URL(env[key]!.trim()).origin;
          if (
            !env
              .CORS_ORIGINS!.split(',')
              .map((o) => o.trim())
              .includes(origin)
          ) {
            errors.push(
              `CORS_ORIGINS does not include ${key}'s origin (${origin}).`,
            );
          }
        }
      }
    }
  }

  // ── Conditional groups ──────────────────────────────────────────────────────────────
  // Mail: turning it on without a transport produces a service that "sends" nothing.
  if ((env.MAIL_ENABLED ?? 'false').trim().toLowerCase() === 'true') {
    for (const key of [
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASS',
      'MAIL_FROM',
    ] as const) {
      if (!present(env, key))
        errors.push(`${key} is required when MAIL_ENABLED=true.`);
    }
  } else if (isProduction) {
    warnings.push(
      'MAIL_ENABLED is not true: email verification and password reset will not be delivered.',
    );
  }

  // Google: the three travel together. Two of three is a sign-in button that 400s.
  const google = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
  ] as const;
  const googleSet = google.filter((k) => present(env, k));
  if (googleSet.length > 0 && googleSet.length < google.length) {
    const missing = google.filter((k) => !present(env, k));
    errors.push(
      `Google sign-in is partially configured. Missing: ${missing.join(', ')}. Set all three or none.`,
    );
  }
  if (
    present(env, 'GOOGLE_REDIRECT_URI') &&
    !env.GOOGLE_REDIRECT_URI!.endsWith('/auth/google/callback')
  ) {
    errors.push(
      'GOOGLE_REDIRECT_URI must end with /auth/google/callback and match the URI registered in Google Cloud.',
    );
  }

  // Exchange rate: optional, but a production platform pricing in USD without it shows stale rates.
  if (isProduction && !present(env, 'EXCHANGE_RATE_API_KEY')) {
    warnings.push(
      'EXCHANGE_RATE_API_KEY is not set: /exchange-rate will return 503.',
    );
  }

  // Swagger must be an explicit decision in production.
  if (
    isProduction &&
    (env.ENABLE_SWAGGER ?? '').trim().toLowerCase() === 'true'
  ) {
    warnings.push(
      'ENABLE_SWAGGER=true in production: the API schema is publicly browsable.',
    );
  }

  for (const w of warnings) {
    console.warn(`[env] warning: ${w}`);
  }

  if (errors.length) {
    throw new Error(
      `Environment is not valid for NODE_ENV=${env.NODE_ENV ?? 'development'}:\n` +
        errors.map((e) => `  - ${e}`).join('\n') +
        '\n\nSee 04-uza-cloud/deploy-env.md for every variable and how to generate the secrets.',
    );
  }

  return env;
}

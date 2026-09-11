import { describe, expect, it, vi } from 'vitest';
import { validateEnv } from './env.validation';

/**
 * Each test is one way a deployment to a new host has gone wrong silently. The validator's
 * job is to make it go wrong loudly, at boot, with the variable named.
 */

const SECRET = 'a-perfectly-adequate-secret-of-at-least-forty-characters';

const dev = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  MONGODB_URI: 'mongodb://localhost:27017/db',
  JWT_SECRET: SECRET,
};

const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.internal:5432/uza',
  MONGODB_URI: 'mongodb+srv://u:p@cluster.mongodb.net/uza',
  JWT_SECRET: SECRET,
  FRONTEND_URL: 'https://uzamobility.com',
  ADMIN_FRONTEND_URL: 'https://admin.uzamobility.com',
  PUBLIC_UPLOAD_BASE_URL: 'https://api.uzamobility.com/uploads',
  CORS_ORIGINS: 'https://uzamobility.com,https://admin.uzamobility.com',
  MAIL_ENABLED: 'true',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'u',
  SMTP_PASS: 'p',
  MAIL_FROM: 'UZA <no-reply@uzamobility.com>',
  EXCHANGE_RATE_API_KEY: 'k',
};

const failsWith = (env: Record<string, string>, fragment: string | RegExp) => {
  expect(() => validateEnv(env)).toThrow(fragment);
};

describe('what every environment needs', () => {
  it('accepts a minimal development configuration', () => {
    expect(() => validateEnv(dev)).not.toThrow();
  });

  it('names each missing core variable', () => {
    failsWith({ ...dev, DATABASE_URL: '' }, 'DATABASE_URL is required');
    failsWith({ ...dev, MONGODB_URI: '' }, 'MONGODB_URI is required');
    failsWith({ ...dev, JWT_SECRET: '' }, 'JWT_SECRET is required');
  });

  it('refuses a connection string for the wrong database', () => {
    failsWith({ ...dev, DATABASE_URL: 'mysql://x' }, 'postgresql://');
    failsWith({ ...dev, MONGODB_URI: 'redis://x' }, 'mongodb://');
  });

  it('refuses a short JWT secret anywhere', () => {
    failsWith({ ...dev, JWT_SECRET: 'short' }, 'at least 32 characters');
  });
});

describe('what production additionally refuses', () => {
  it('accepts a complete production configuration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateEnv(prod)).not.toThrow();
    warn.mockRestore();
  });

  it('refuses to start without the URLs that otherwise default to localhost', () => {
    // The specific failure: a password-reset email pointing at http://localhost:3000.
    for (const key of [
      'FRONTEND_URL',
      'ADMIN_FRONTEND_URL',
      'PUBLIC_UPLOAD_BASE_URL',
      'CORS_ORIGINS',
    ]) {
      failsWith(
        { ...prod, [key]: '' },
        new RegExp(`${key} is required in production`),
      );
    }
  });

  it('refuses http:// front-end URLs in production', () => {
    failsWith(
      { ...prod, FRONTEND_URL: 'http://uzamobility.com' },
      'must be an https:// URL',
    );
  });

  it('refuses a placeholder JWT secret in production even if it is long enough', () => {
    failsWith(
      { ...prod, JWT_SECRET: 'devsecretdevsecretdevsecretdevsecret' },
      'placeholder',
    );
  });

  it('refuses CORS_ORIGINS that omit a front end — the exact misconfiguration that produces opaque network errors', () => {
    failsWith(
      { ...prod, CORS_ORIGINS: 'https://uzamobility.com' },
      'does not include ADMIN_FRONTEND_URL',
    );
  });

  it('refuses CORS entries with paths or trailing slashes, which browsers never match', () => {
    failsWith(
      {
        ...prod,
        CORS_ORIGINS: 'https://uzamobility.com/,https://admin.uzamobility.com',
      },
      'no trailing slash',
    );
  });
});

describe('groups that travel together', () => {
  it('requires the SMTP transport when mail is enabled', () => {
    failsWith(
      { ...dev, MAIL_ENABLED: 'true' },
      'SMTP_HOST is required when MAIL_ENABLED=true',
    );
  });

  it('does not require SMTP when mail is off', () => {
    expect(() => validateEnv({ ...dev, MAIL_ENABLED: 'false' })).not.toThrow();
  });

  it('refuses two-thirds of a Google configuration', () => {
    // Two of three is a sign-in button that returns 400 to the customer.
    failsWith(
      { ...dev, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' },
      'Missing: GOOGLE_REDIRECT_URI',
    );
  });

  it('accepts all three or none', () => {
    expect(() =>
      validateEnv({
        ...dev,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REDIRECT_URI: 'https://api.uzamobility.com/auth/google/callback',
      }),
    ).not.toThrow();
    expect(() => validateEnv(dev)).not.toThrow();
  });

  it('insists the Google redirect URI is the callback route the API actually serves', () => {
    failsWith(
      {
        ...dev,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REDIRECT_URI: 'https://api.uzamobility.com/auth/google',
      },
      '/auth/google/callback',
    );
  });
});

describe('the message a new host sees', () => {
  it('lists every problem at once rather than one per restart', () => {
    let message = '';
    try {
      validateEnv({ NODE_ENV: 'production' });
    } catch (e) {
      message = (e as Error).message;
    }
    for (const key of [
      'DATABASE_URL',
      'MONGODB_URI',
      'JWT_SECRET',
      'FRONTEND_URL',
      'CORS_ORIGINS',
    ]) {
      expect(message).toContain(key);
    }
    expect(message).toContain('deploy-env.md');
  });
});

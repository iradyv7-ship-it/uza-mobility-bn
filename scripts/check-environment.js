#!/usr/bin/env node
/**
 * `npm run env:check` — was referenced in package.json with nothing behind it.
 *
 * Every one of these checks corresponds to a real, observed failure mode, not a
 * hypothetical one:
 *
 *  - DATABASE_URL / JWT_SECRET missing: PrismaService and JwtStrategy call
 *    `configService.getOrThrow(...)`, which throws deep inside Nest's dependency
 *    injection, mid-boot, with a stack trace that names an internal file rather than
 *    the environment variable a deployer actually needs to set.
 *  - MONGODB_URI missing: MongoService.onModuleInit throws its own clear message, but
 *    only after every route has already been mapped — the crash looks like it happened
 *    somewhere in the routing layer if you are not reading closely.
 *
 * This script runs BEFORE any of that, reads .env the same way the app does, and says
 * plainly what is missing and why it matters — nothing here duplicates business logic,
 * it only duplicates the *names* of variables the app already requires.
 */
require('dotenv/config');

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

let hasError = false;
let hasWarning = false;

function ok(name) {
  console.log(`  ${GREEN}✓${RESET} ${name}`);
}

function error(name, reason) {
  hasError = true;
  console.log(`  ${RED}✗${RESET} ${name} — ${reason}`);
}

function warn(name, reason) {
  hasWarning = true;
  console.log(`  ${YELLOW}!${RESET} ${name} — ${reason}`);
}

function isSet(name) {
  return Boolean(process.env[name]?.trim());
}

const isProduction = process.env.NODE_ENV === 'production';

console.log('Required — the app refuses to boot without these:');
// PrismaService: configService.getOrThrow('DATABASE_URL')
if (isSet('DATABASE_URL')) ok('DATABASE_URL');
else error('DATABASE_URL', 'PrismaService.getOrThrow throws mid-boot without it');
// JwtStrategy / JwtRefreshStrategy / WsAuthService: configService.getOrThrow('JWT_SECRET')
if (isSet('JWT_SECRET')) ok('JWT_SECRET');
else error('JWT_SECRET', 'JwtStrategy.getOrThrow throws mid-boot without it');
// MongoService.onModuleInit throws its own Error if this is unset
if (isSet('MONGODB_URI')) ok('MONGODB_URI');
else
  error(
    'MONGODB_URI',
    'MongoService throws once every route is already mapped — uploads use GridFS',
  );

console.log('\nProduction-sensitive — silently wrong rather than crashing:');
// main.ts's corsOrigins() falls back to a localhost-only allowlist if this is unset,
// which is the right default in dev and a silently broken production deploy otherwise.
if (isSet('CORS_ORIGINS')) {
  ok('CORS_ORIGINS');
} else if (isProduction) {
  error(
    'CORS_ORIGINS',
    'unset in production — main.ts falls back to a localhost-only allowlist, so every real browser origin is silently rejected',
  );
} else {
  warn('CORS_ORIGINS', 'unset — fine in development, must be set before a production deploy');
}

console.log('\nPaired — one without the other leaves a half-configured integration:');
const googleId = isSet('GOOGLE_CLIENT_ID');
const googleSecret = isSet('GOOGLE_CLIENT_SECRET');
if (googleId === googleSecret) {
  if (googleId) ok('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET');
  else warn('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET', 'both unset — Google sign-in disabled');
} else {
  error(
    'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET',
    `only ${googleId ? 'GOOGLE_CLIENT_ID' : 'GOOGLE_CLIENT_SECRET'} is set — Google sign-in will fail, not fall back`,
  );
}

if (process.env.MAIL_ENABLED === 'true') {
  const mailVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
  const missing = mailVars.filter((v) => !isSet(v));
  if (missing.length === 0) ok('MAIL_ENABLED=true, SMTP fully configured');
  else error('MAIL_ENABLED=true', `missing ${missing.join(', ')} — email sends will fail silently by default`);
} else {
  warn('MAIL_ENABLED', 'not "true" — verification, reset and order emails are not sent');
}

console.log('\nOptional — has a real fallback, listed so the fallback is a choice, not a surprise:');
if (isSet('EXCHANGE_RATE_API_KEY')) ok('EXCHANGE_RATE_API_KEY');
else warn('EXCHANGE_RATE_API_KEY', 'unset — falls back to the DB-cached rate, then a hardcoded default');

console.log('');
if (hasError) {
  console.log(`${RED}Environment check failed.${RESET} Fix the items above before starting the app.`);
  process.exit(1);
}
if (hasWarning) {
  console.log(`${YELLOW}Environment check passed with warnings.${RESET}`);
  process.exit(0);
}
console.log(`${GREEN}Environment check passed.${RESET}`);

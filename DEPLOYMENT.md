# Deploying the UZA Mobility API

The runbook a competent engineer can follow without asking anyone. Read once; then the
checklist at the bottom is the only part you need each time.

## What you are deploying

- **API** — NestJS 11, Node 20+. Port from `PORT` (default 7050). Health: `GET /health`
  (liveness), `GET /health/ready` (Postgres + Mongo, bounded at 3 s → 503 when either is down).
- **Postgres 16** — every business record. Migrations are hand-written SQL under
  `prisma/migrations/` and applied with `prisma migrate deploy` (never `migrate dev` in prod).
- **MongoDB 7** — two GridFS buckets: `uploads` (public, served at `/uploads/*` to anyone with
  the URL — images only) and `private_documents` (signed fund requests, bank confirmations —
  never served without a token and consent).
- **Front ends** — `uza-mobility-fn` (customers, drivers, lenders) and `uza-mobility-admin`
  (staff). Both Next.js; both talk to the API over HTTPS with `NEXT_PUBLIC_API_URL`.

Alibaba Cloud fit (SAE/ACK + RDS PostgreSQL + ApsaraDB for MongoDB + ALB + KMS + SLS, Dubai
region) is documented in the guide repo at `04-uza-cloud/alibaba-cloud-fit.md`. The compose
file here (`docker-compose.prod.yml` + `Caddyfile`) is the single-VM path; both work.

## Before the first deploy — one time

1. **Personal data.** The applicants' names are not in any repository and must not be. Seeds
   read them from runtime JSON (`BATCH1_CANDIDATES_JSON`, `PROFORMAS_JSON`) that lives on the
   server only. Confirm the repository you deploy from is private.
2. **Secrets.** `openssl rand -base64 48` for `JWT_SECRET`; `openssl rand -base64 36` for the
   Postgres password. Store them in the cloud secret manager, not in a file in git.
3. **Mail is required.** Admin sign-in sends a one-time code by email on every login; staff
   invite codes are emailed; real users set their password through Forgot password. Set
   `MAIL_ENABLED=true` and a working SMTP (`SMTP_HOST/PORT/USER/PASS/SECURE`, `MAIL_FROM`).
   Test it: an admin sign-in that never receives a code is a mail problem, not an auth bug.
4. **Google sign-in (customer portal).** In Google Cloud Console → APIs & Services →
   Credentials → *Create OAuth client ID* → Web application. Authorised JavaScript origin: the
   customer portal URL. Authorised redirect URI: `https://<api-host>/auth/google/callback` —
   identical to `GOOGLE_REDIRECT_URI`. Publish the consent screen (External) or only test
   users can sign in. Google sign-in only ever creates a *client* account; it never grants a
   role (see *Staff access* below).
5. **CORS.** `CORS_ORIGINS` = the two front-end origins, comma-separated, no trailing slash.
   Websocket notifications use the same list.
6. **Cron.** `CRON_ENABLED=true` on exactly one API instance. Every other replica: `false`.
7. **NODE_ENV=production.** Always. It turns off the echoed dev sign-in code, among other things.

## Each deploy

```bash
npm ci
npm run verify:all          # typecheck + lint + tests + build. Red = do not deploy.
npx prisma migrate deploy   # against the production DATABASE_URL
npm run start:prod          # or the container's CMD
curl -fsS https://<api-host>/health/ready
```

`verify:all` is the gate. It is the same command CI should run.

## First deploy on a fresh database

```bash
npx prisma migrate deploy
# Roles, permissions and the first super admin, from the server (never through the public
# register route). The password is used exactly once: sign in, then change it.
SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… SEED_ADMIN_ROLES=SUPER_ADMIN npm run db:seed
```

Then sign in to the admin panel (password → one-time code by email), go to **Staff access**,
and issue codes for everyone else.

## Promoting the simulation database (batch 1)

If the simulation database is being promoted rather than rebuilt:

```bash
CONFIRM_PREPARE=yes DATABASE_URL=… npx ts-node scripts/prepare-for-production.ts
```

It deletes the servicing test loan and test borrower, invalidates every simulation
password (named accounts get `mustChangePassword`; their first real sign-in is via Forgot
password — mail must be on), and prints exactly what it did. Idempotent.

## Staff access — how exclusivity works

- Anyone can sign up on the customer portal (Google or password). That makes a **client**.
- A **role** is granted only by (a) a super admin on the Users page, or (b) a **staff invite
  code**: super admin → Staff access → email + roles → a `UZA-XXXX-XXXX` code shown once and
  emailed. The employee signs in with that exact email, opens *My UZA → Staff access* on the
  customer portal, enters the code once within 72 hours. Roles attach; the code dies.
- The **admin panel** never opens on a password alone: every sign-in emails a six-digit code
  (10 minutes, 5 attempts). Google sign-in is not offered on the admin panel.
- Lender staff (`LENDER_<KEY>`) are invited the same way and use the lender portal on the
  customer front end; the tenant wall is enforced by the API, not the UI.

## Rollback

Application: redeploy the previous image/commit. Database: migrations are forward-only;
each migration's SQL is in the repo — write the inverse by hand if one must be undone, and
take a snapshot before every `migrate deploy` (RDS: automated backups on; compose: `pg_dump`).

## Checklist

- [ ] Repository private; no personal data in git history
- [ ] Secrets in the secret manager; `NODE_ENV=production`
- [ ] `MAIL_ENABLED=true`, SMTP tested with a real sign-in code
- [ ] `CORS_ORIGINS` = both front-end origins
- [ ] `CRON_ENABLED=true` on one instance only
- [ ] Google OAuth client created; redirect URI matches exactly (or leave blank: button hides itself)
- [ ] `npm run verify:all` green
- [ ] `prisma migrate deploy` run; `/health/ready` returns 200
- [ ] `prepare-for-production.ts` run if promoting the simulation DB
- [ ] First super admin created from the server; everyone else via Staff access codes
- [ ] Test the door: wrong code five times locks the challenge; a client account cannot open `/admin`

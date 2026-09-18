# express-backend — the Node/Express migration, in progress

**Status: one module ported and proven (Platform Settings). This does not replace the
NestJS API yet — both run side by side against the same database until parity is real,
tested, and verified module by module.**

## Why this exists

The founder's standing engineering directive is a Node/Express backend with JWT auth,
separated cleanly from the frontend — this repo (`uza-mobility-bn`) is already frontend-free
(the two Next.js apps are separate repos), so the actual gap is the framework itself, not
folder layout. Rewriting ~30 NestJS modules and ~200 endpoints in one pass would be exactly
the "huge amount of code at once" the founder's own process explicitly warns against. This
is the strangler-fig alternative: port one real module, prove the pattern end-to-end
(migration, boot, a real request, real auth), then repeat — never a big-bang cutover.

## What's real here right now

- `config/env.ts` — boot-time environment validation, same discipline as the NestJS API's
  own (fail fast, name every problem at once).
- `config/prisma.ts` — the exact same generated Prisma client the NestJS app uses. Same
  schema, same database, same migrations. Nothing here is a fork.
- `middleware/auth.middleware.ts` — JWT verification + permission-checking, ported from
  `JwtStrategy`/`PermissionsGuard` with the same checks in the same order.
- `services/rbac.service.ts`, `services/audit.service.ts`, `services/exchange-rate.service.ts`,
  `services/platform-settings.service.ts` — ported logic, verified against the schema
  (`ActivityLog`, not a guessed "AuditLog" name) rather than assumed.
- `controllers/` + `routes/` + `validators/` (zod, replacing class-validator) for the
  Platform Settings module — `GET/PATCH /api/admin/platform-settings`,
  `POST /api/admin/platform-settings/refresh-exchange-rate`, gated on the same
  `platform-settings:manage` permission as the NestJS route.
- `GET /health` and `GET /health/ready` — the same two probes the deploy guide documents
  for the NestJS side, so a load balancer's health-check config doesn't need to change
  when it eventually points here instead.

## What's NOT here yet

Every other module (Wallet, Academy, Financing/Lender, Workshop, Impact, Marketplace, Auth
itself — login/register/refresh isn't ported yet, only token verification for an
already-issued token) — still NestJS-only. Don't assume parity beyond Platform Settings.

## Running it

```bash
npm run express:dev        # boots on PORT (default 7000), same DATABASE_URL as the NestJS app
npm run express:typecheck  # tsc --noEmit against express-backend/tsconfig.json
```

## Next module to port

Following the same order the migration plan proposed: richest-tested-first. Wallet or
Academy are the next candidates — both have real, focused test suites already, so "does
the Express port behave identically" has something concrete to verify against.

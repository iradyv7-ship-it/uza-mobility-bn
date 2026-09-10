# `test/`

`npm run test:e2e` (`vitest run test/`) pointed here with nothing in it — it failed with
"No test files found" on every run. This directory now exists, but honestly: it does not
yet hold real HTTP end-to-end tests, and here is why, so nobody assumes it does.

A genuine e2e suite means booting the real `AppModule` and firing requests at it with
`supertest`. `AppModule` requires `MongoModule`, and `MongoService.onModuleInit` throws
if `MONGODB_URI` is unset or unreachable — so a full-app e2e test can only run somewhere
with a live MongoDB, which this repository's automated test run does not currently
provision (CI's Postgres/Mongo service containers exist for `prisma migrate deploy` and
the Docker build, not for a test run against them — see `.github/workflows/verify.yml`).

Building that properly (a test MongoDB, a way to skip/mock GridFS uploads, fixtures for
the Postgres side) is a real, separate piece of work — not something to fake here by
writing a test that technically passes without exercising an HTTP route.

What's here instead: tests that exercise real production code — guards, mostly — at the
unit level, using `@nestjs/testing`'s `Test.createTestingModule` or a plain constructed
instance, without booting the app or touching a database. `lender-access.guard.spec.ts`
is the first of these, covering `LenderAccessGuard` (unknown lender key, wrong lender's
role, and the entitled-lender pass-through all return the same 404, never a 403 — see
that guard's own doc comment for why that distinction matters).

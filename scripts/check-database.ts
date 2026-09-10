#!/usr/bin/env ts-node
/**
 * `npm run db:check` — was referenced in package.json with nothing behind it.
 *
 * Two real, separate ways this app fails to talk to its data layer, and this script
 * checks both, because a green result on one says nothing about the other:
 *
 *   1. Postgres reachable, AND every migration in prisma/migrations actually applied.
 *      A missing migration is not a connectivity problem — the connection succeeds,
 *      queries against tables from an unapplied migration then fail one at a time,
 *      wherever the code happens to touch them first.
 *   2. MongoDB reachable — GridFS uploads (listing photos, payment proofs, PDFs) depend
 *      on it entirely; nothing else in the app exercises that connection before a real
 *      upload request does.
 *
 * Uses `prisma migrate status`'s own exit code for the migration check rather than
 * re-implementing it — that command is Prisma's, and re-deriving "is everything
 * applied" here would be a second implementation that can drift from the real one.
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { MongoClient } from 'mongodb';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

let hasError = false;

async function checkPostgres(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    hasError = true;
    console.log(`  ${RED}✗${RESET} DATABASE_URL is not set — see \`npm run env:check\``);
    return;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`  ${GREEN}✓${RESET} Postgres reachable`);
  } catch (e) {
    hasError = true;
    console.log(`  ${RED}✗${RESET} Postgres unreachable — ${(e as Error).message}`);
    await prisma.$disconnect();
    return;
  }
  await prisma.$disconnect();

  try {
    // Exit code 0: schema up to date. Non-zero: pending or unapplied migrations.
    // stdio 'pipe' so this script controls what gets printed, not prisma's own banner.
    const output = execSync('npx prisma migrate status', { encoding: 'utf-8', stdio: 'pipe' });
    if (/up to date/i.test(output)) {
      console.log(`  ${GREEN}✓${RESET} All migrations applied`);
    } else {
      hasError = true;
      console.log(`  ${RED}✗${RESET} Migrations are not up to date — run \`npm run db:migrate:deploy\``);
    }
  } catch (e) {
    hasError = true;
    const output = (e as { stdout?: string }).stdout ?? (e as Error).message;
    console.log(`  ${RED}✗${RESET} \`prisma migrate status\` failed:\n${output}`);
  }
}

async function checkMongo(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    hasError = true;
    console.log(`  ${RED}✗${RESET} MONGODB_URI is not set — GridFS uploads will fail at first use`);
    return;
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    console.log(`  ${GREEN}✓${RESET} MongoDB reachable`);
  } catch (e) {
    hasError = true;
    console.log(`  ${RED}✗${RESET} MongoDB unreachable — ${(e as Error).message}`);
  } finally {
    await client.close();
  }
}

async function main() {
  console.log('Postgres:');
  await checkPostgres();
  console.log('\nMongoDB:');
  await checkMongo();

  console.log('');
  if (hasError) {
    console.log(`${RED}Database check failed.${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}Database check passed.${RESET}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from './env';

/**
 * The SAME generated Prisma client the NestJS app uses — same `prisma/schema.prisma`,
 * same database, same migrations. This is deliberately not a second schema or a second
 * client: the whole point of the strangler-fig migration is that both the old and new
 * backend read and write the identical data, so nothing can drift between them while
 * both are running.
 *
 * Prisma 7 has no built-in query engine — a driver adapter is required, exactly as
 * `src/prisma/prisma.service.ts` already does on the NestJS side.
 */
const env = loadEnv();

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.databaseUrl }),
});

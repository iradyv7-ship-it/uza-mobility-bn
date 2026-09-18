import { PrismaClient } from '@prisma/client';

/**
 * The SAME generated Prisma client the NestJS app uses — same `prisma/schema.prisma`,
 * same database, same migrations. This is deliberately not a second schema or a second
 * client: the whole point of the strangler-fig migration is that both the old and new
 * backend read and write the identical data, so nothing can drift between them while
 * both are running.
 */
export const prisma = new PrismaClient();

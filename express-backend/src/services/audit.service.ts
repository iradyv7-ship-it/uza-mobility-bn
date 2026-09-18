import { prisma } from '../config/prisma';

/**
 * Ported from `src/common/audit/audit.service.ts`'s `record()` — same target model
 * (`ActivityLog`, not a literal "AuditLog" — confirmed against the real schema before
 * writing this, not assumed from the name), same field mapping: `userId` connects the
 * relation rather than setting a scalar, metadata is optional and passed through as-is.
 * Logs and rethrows on failure rather than swallowing it, matching the original —
 * an audit write that silently fails is worse than one that crashes loudly.
 */
export interface RecordActivityInput {
  userId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordActivity(input: RecordActivityInput) {
  try {
    return await prisma.activityLog.create({
      data: {
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        ipAddress: input.ipAddress?.trim() || null,
        userAgent: input.userAgent?.trim() || null,
        ...(input.userId ? { user: { connect: { id: input.userId } } } : {}),
        ...(input.metadata !== undefined && input.metadata !== null
          ? { metadata: input.metadata as never }
          : {}),
      },
    });
  } catch (error) {
    console.error(
      `[audit] failed to save activity log [${input.action}]`,
      error,
    );
    throw error;
  }
}

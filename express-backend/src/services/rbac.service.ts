import { prisma } from '../config/prisma';

/**
 * Ported verbatim from `src/modules/auth/rbac.service.ts` — same rule, same shape:
 * SUPER_ADMIN gets the wildcard, everyone else's permissions are the union of every
 * role they hold. Kept as a plain function rather than a class since Express has no
 * DI container to inject it through — the pure logic doesn't need one.
 */
export async function resolvePermissionsForRoleNames(
  roleNames: string[],
): Promise<string[]> {
  if (roleNames.includes('SUPER_ADMIN')) {
    return ['*'];
  }

  if (roleNames.length === 0) {
    return [];
  }

  const roles = await prisma.role.findMany({
    where: { name: { in: roleNames } },
    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
    },
  });

  const permissions = new Set<string>();
  for (const role of roles) {
    for (const rolePermission of role.permissions) {
      permissions.add(rolePermission.permission.action);
    }
  }

  return Array.from(permissions);
}

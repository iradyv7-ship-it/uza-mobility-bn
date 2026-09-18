import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env';
import { prisma } from '../config/prisma';
import { resolvePermissionsForRoleNames } from '../services/rbac.service';

/**
 * The same shape NestJS's `JwtStrategy.validate()` returns (see
 * `src/users/users.types.ts`'s `JwtUserPayload`) — kept identical so a future caller
 * (a controller, a test) written against either backend sees the same `req.user`.
 */
export interface JwtUserPayload {
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
  tokenType: 'access' | 'refresh';
  iat: number;
  exp: number;
}

// Augments Express's own Request type (global declaration merging) rather than a
// locally-extended interface — the idiomatic pattern, and the one that doesn't fight
// Express's own overloaded RequestHandler typing when a handler is passed to
// `router.use()`/`router.get()` etc.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

/** Kept as an alias so existing call sites reading `AuthenticatedRequest` still work —
 * it's just `Request` now that `user` is merged into Express's own type. */
export type AuthenticatedRequest = Request;

interface RawAccessTokenPayload {
  sub: string;
  email?: string;
  tokenType?: string;
  iat?: number;
  exp?: number;
}

/**
 * Ported from `JwtStrategy.validate()` — same checks, same order: token must decode,
 * must be an access token (never a refresh token used where an access token belongs),
 * the user must still exist, be active, and not soft-deleted. A 401 either way — this
 * never leaks WHICH check failed, matching the guard it replaces.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized',
      error: 'MISSING_TOKEN',
    });
    return;
  }

  let payload: RawAccessTokenPayload;
  try {
    const env = loadEnv();
    payload = jwt.verify(token, env.jwtSecret) as RawAccessTokenPayload;
  } catch {
    res.status(401).json({
      success: false,
      message: 'Unauthorized',
      error: 'INVALID_TOKEN',
    });
    return;
  }

  if (payload.tokenType !== 'access' || !payload.sub) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized',
      error: 'INVALID_TOKEN',
    });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { roles: { include: { role: true } } },
  });

  if (!user || !user.isActive || user.deletedAt) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized',
      error: 'INVALID_TOKEN',
    });
    return;
  }

  const roles = user.roles.map((userRole) => userRole.role.name);
  const permissions = await resolvePermissionsForRoleNames(roles);

  req.user = {
    sub: user.id,
    email: user.email,
    roles,
    permissions,
    tokenType: 'access',
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
  next();
};

/**
 * Ported from `PermissionsGuard` — same rule: every required permission must be
 * present, either named directly or covered by the `'*'` wildcard (SUPER_ADMIN).
 */
export function requirePermission(...required: string[]): RequestHandler {
  return (req, res, next) => {
    const userPermissions = req.user?.permissions ?? [];
    const allowed = required.every(
      (permission) =>
        userPermissions.includes(permission) || userPermissions.includes('*'),
    );
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permission',
        error: 'FORBIDDEN',
      });
      return;
    }
    next();
  };
}

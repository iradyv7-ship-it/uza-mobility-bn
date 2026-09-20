import type { Request } from 'express';

export interface RequestAuditContext {
  ipAddress?: string;
  userAgent?: string;
  actorEmail?: string;
}

function normalizeIp(ip?: string): string | undefined {
  if (!ip) return undefined;
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

export function getRequestAuditContext(request: Request): RequestAuditContext {
  const forwarded = request.headers['x-forwarded-for'];
  const ipFromForwarded =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : undefined;

  const user = request.user;

  return {
    ipAddress: normalizeIp(
      ipFromForwarded ?? request.ip ?? request.socket?.remoteAddress,
    ),
    userAgent:
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : undefined,
    actorEmail: user?.email,
  };
}

import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { LenderAccessGuard } from '../src/modules/financing/guards/lender-access.guard';

/**
 * `LenderAccessGuard` is the enforcement the lender portal's own security design depends
 * on — see its doc comment and `src/modules/financing/lenders.registry.ts`. No database,
 * no app bootstrap: `canActivate` only ever reads `request.params.key` and
 * `request.user.roles`, so a plain constructed `ExecutionContext` stand-in is enough to
 * exercise every branch for real. See test/README.md for why this lives here rather than
 * as an HTTP-level e2e test.
 */
function contextFor(
  params: { key?: string },
  roles?: string[],
): ExecutionContext {
  const request = { params, user: roles ? { roles } : undefined } as {
    params: typeof params;
    user?: { roles: string[] };
    lender?: unknown;
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('LenderAccessGuard', () => {
  const guard = new LenderAccessGuard();

  it('refuses an unknown lender key before roles are read at all', () => {
    expect(() =>
      guard.canActivate(contextFor({ key: 'bank-of-kigali' }, ['SUPER_ADMIN'])),
    ).toThrow(NotFoundException);
  });

  it('refuses a caller with no roles', () => {
    expect(() => guard.canActivate(contextFor({ key: 'unguka' }))).toThrow(
      NotFoundException,
    );
  });

  it("refuses one lender's role on another lender's key — same 404 as an unknown key", () => {
    expect(() =>
      guard.canActivate(contextFor({ key: 'equity' }, ['LENDER_UNGUKA'])),
    ).toThrow(NotFoundException);
  });

  it("passes a lender's own role, and attaches the resolved config to the request", () => {
    const context = contextFor({ key: 'unguka' }, ['LENDER_UNGUKA']);
    expect(guard.canActivate(context)).toBe(true);
    const request = context
      .switchToHttp()
      .getRequest<{ lender?: { key: string } }>();
    expect(request.lender?.key).toBe('unguka');
  });

  it('passes SUPER_ADMIN for any onboarded lender', () => {
    expect(
      guard.canActivate(contextFor({ key: 'ncba' }, ['SUPER_ADMIN'])),
    ).toBe(true);
  });

  it('is case- and whitespace-insensitive on the key, matching findLender', () => {
    expect(
      guard.canActivate(contextFor({ key: '  UNGUKA  ' }, ['LENDER_UNGUKA'])),
    ).toBe(true);
  });
});

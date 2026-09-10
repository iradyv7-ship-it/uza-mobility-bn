import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { findLender, lenderRole, type LenderConfig } from '../lenders.registry';

interface LenderScopedRequest {
  params: { key?: string };
  user?: { roles?: string[] };
  lender?: LenderConfig;
}

/**
 * Guards every `/financing/lenders/:key/*` route.
 *
 * Two checks, in order, and the order is the point (mirrors
 * `canAccessLenderPath` in uza-mobility-fn's `src/lib/auth/redirect.ts`, which carries
 * the full reasoning):
 *
 *  1. Does `:key` name a real, onboarded lender? If not, refused before this user's
 *     roles are even read, so the answer cannot vary by who is asking.
 *  2. Does this user hold that lender's role (`LENDER_<KEY>`), or SUPER_ADMIN?
 *
 * Both failures throw the SAME 404, not a 403 for one and a 404 for the other. A lender
 * asking for another lender's key must get the same answer as one asking for a key that
 * does not exist — otherwise the status code itself discloses which banks are real, which
 * is the exact disclosure `lender.ts`'s own doc comment on the frontend describes
 * avoiding for the collateral page. The same care applies to every route under here.
 */
@Injectable()
export class LenderAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<LenderScopedRequest>();
    const key = request.params.key;
    const lender = key ? findLender(key) : undefined;

    if (!lender) {
      throw new NotFoundException();
    }

    const roles = request.user?.roles ?? [];
    if (
      !roles.includes(lenderRole(lender.key)) &&
      !roles.includes('SUPER_ADMIN')
    ) {
      throw new NotFoundException();
    }

    request.lender = lender;
    return true;
  }
}

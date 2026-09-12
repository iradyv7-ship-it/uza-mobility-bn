import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { isInternalWorkshopStaff } from '../inspection.rules';

interface WorkshopRequest {
  user?: { sub?: string; roles?: string[] };
}

/**
 * The internal side of the workshop — job cards, the mechanic roster, rescue calls.
 *
 * MECHANIC is one role held by two tenants: UZA's own employed mechanics and independent
 * certified partner garages. Until 12 September 2026 both could read all of it. A partner
 * garage may file inspections (`/workshop/inspections`, which does NOT carry this guard)
 * and nothing else.
 *
 * Refuses with 404, not 403, for the same reason the lender wall does: an external party
 * probing an internal route should get the same answer as a typo, so the shape of UZA's
 * internal operation is not disclosed by which paths say "forbidden".
 */
@Injectable()
export class InternalWorkshopGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkshopRequest>();
    const roles = request.user?.roles ?? [];
    const userId = request.user?.sub;

    const mechanic =
      userId && roles.includes('MECHANIC')
        ? await this.prisma.mechanic.findUnique({
            where: { userId },
            select: { engagement: true },
          })
        : null;

    if (!isInternalWorkshopStaff(roles, mechanic))
      throw new NotFoundException();
    return true;
  }
}

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WorkshopService } from './workshop.service';

/**
 * Same three roles as `hasWorkshopWorkspace()` in uza-mobility-fn's `src/lib/permissions.ts` —
 * kept in sync deliberately, the same way `src/config/lenders.ts` documents its own role
 * derivation must be. SUPER_ADMIN is included there so somebody can see a broken portal;
 * mirrored here for the same reason.
 */
@ApiTags('workshop')
@ApiBearerAuth('JWT-access')
@Controller('workshop/job-cards')
@UseGuards(RolesGuard)
@Roles('MECHANIC', 'WORKSHOP_ADMIN', 'SUPER_ADMIN')
export class JobCardsController {
  constructor(private readonly workshopService: WorkshopService) {}

  @Get()
  @ApiOperation({ summary: 'Open job cards, most urgent first' })
  list() {
    return this.workshopService.listJobCards();
  }
}

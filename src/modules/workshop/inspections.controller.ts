import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditContext } from '../../common/audit/request-context.util';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateVehicleInspectionDto } from './dto/create-vehicle-inspection.dto';
import { WorkshopService } from './workshop.service';

/**
 * A mechanic filing a monthly report on the vehicle securing a specific loan — reading
 * that history back is a lender concern, not a workshop one, so it lives on
 * `LenderController` (`GET /financing/lenders/:key/loans/:loanId/inspections`), scoped to
 * the loan's own bank the same way every other lender-facing read is.
 */
@ApiTags('workshop')
@ApiBearerAuth('JWT-access')
@Controller('workshop/inspections')
@UseGuards(RolesGuard)
@Roles('MECHANIC', 'WORKSHOP_ADMIN', 'SUPER_ADMIN')
export class InspectionsController {
  constructor(private readonly workshopService: WorkshopService) {}

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Post()
  @ApiOperation({
    summary: 'File a monthly condition report on a financed vehicle',
  })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateVehicleInspectionDto,
  ) {
    return this.workshopService.createInspection(
      this.requireUserId(request),
      dto,
      getRequestAuditContext(request),
    );
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
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

  /**
   * The garage has either the client's UZA ID card in hand, or just the vehicle (a
   * drop-off, a rescue tow) and its plate. Either turns into the loan to file against and
   * a name to check against the card — never anything about the loan itself.
   */
  @Get('vehicle')
  @ApiOperation({
    summary:
      "Find the financed vehicle(s) behind a client's UZA ID or plate number",
  })
  @ApiQuery({ name: 'uzaId', required: false, example: 'UZA-P-2026-000141' })
  @ApiQuery({ name: 'plate', required: false, example: 'RAD 123 A' })
  lookup(
    @Req() request: AuthenticatedRequest,
    @Query('uzaId') uzaId?: string,
    @Query('plate') plate?: string,
  ) {
    if (!uzaId?.trim() && !plate?.trim()) {
      throw new BadRequestException('uzaId or plate is required');
    }
    if (uzaId?.trim() && plate?.trim()) {
      throw new BadRequestException('Provide uzaId or plate, not both');
    }
    return this.workshopService.lookupVehicleForInspection(
      this.requireUserId(request),
      { uzaId: uzaId?.trim(), plate: plate?.trim() },
    );
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

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
   * The garage has the client's UZA ID card in hand. This turns it into the loan to file
   * against and a name to check against the card — and nothing about the loan itself.
   */
  @Get('vehicle')
  @ApiOperation({
    summary: "Find the financed vehicle(s) behind a client's UZA ID",
  })
  @ApiQuery({ name: 'uzaId', example: 'UZA-P-2026-000141' })
  lookup(@Req() request: AuthenticatedRequest, @Query('uzaId') uzaId?: string) {
    if (!uzaId?.trim()) throw new BadRequestException('uzaId is required');
    return this.workshopService.lookupVehicleForInspection(
      this.requireUserId(request),
      uzaId,
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

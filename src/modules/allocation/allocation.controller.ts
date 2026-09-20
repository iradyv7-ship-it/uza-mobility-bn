import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditContext } from '../../common/audit/request-context.util';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AllocationService } from './allocation.service';
import { AllocateUnitDto } from './dto/allocate-unit.dto';
import { EnqueueDriverDto } from './dto/enqueue-driver.dto';
import { ListAvailableUnitsDto } from './dto/list-available-units.dto';
import { ListQueueDto } from './dto/list-queue.dto';
import { RespondAllocationDto } from './dto/respond-allocation.dto';

/**
 * The allocations desk.
 *
 * Staff-only, and deliberately narrow: LOGISTICS_ADMIN holds the yard and the consignments,
 * FINANCE_ADMIN holds the loans these units are promised against, SUPER_ADMIN holds
 * everything. A driver does not allocate their own vehicle, so there is no self-service
 * surface here at all — what a driver is shown is their allocation, through the surfaces
 * that already read it (the bank file, the proforma).
 *
 * `JwtAuthGuard` is global (registered as APP_GUARD in `AuthModule`), so this adds the role
 * gate only — the same pattern as `AdminLoansController` and `AcademyController`.
 */
@ApiTags('allocation')
@ApiBearerAuth('JWT-access')
@Controller('admin/allocation')
@UseGuards(RolesGuard)
@Roles('LOGISTICS_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN')
export class AllocationController {
  constructor(private readonly allocation: AllocationService) {}

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Get('queue')
  @ApiOperation({
    summary:
      'The line for a class of vehicle, in readiness order, with positions derived at read time',
  })
  queue(@Query() dto: ListQueueDto) {
    return this.allocation.listQueue(dto.classCode);
  }

  @Post('queue')
  @ApiOperation({
    summary:
      'Put a person in the line for a class of vehicle, dated from when they became ready',
  })
  enqueue(@Req() request: AuthenticatedRequest, @Body() dto: EnqueueDriverDto) {
    return this.allocation.enqueue(
      this.requireUserId(request),
      dto,
      getRequestAuditContext(request),
    );
  }

  @Get('available-units')
  @ApiOperation({
    summary:
      'Units that can be promised right now — eligible status and no live hold',
  })
  availableUnits(@Query() dto: ListAvailableUnitsDto) {
    return this.allocation.listAvailableUnits(dto);
  }

  @Get(':allocationId')
  @ApiOperation({
    summary: 'One allocation: the unit, the person, who decided it and when',
  })
  findOne(@Param('allocationId') allocationId: string) {
    return this.allocation.findOne(allocationId);
  }

  @Post()
  @ApiOperation({ summary: 'Promise one specific unit to one person' })
  allocate(@Req() request: AuthenticatedRequest, @Body() dto: AllocateUnitDto) {
    return this.allocation.allocate(
      this.requireUserId(request),
      dto,
      getRequestAuditContext(request),
    );
  }

  @Post(':allocationId/confirm')
  @ApiOperation({ summary: 'Record that the driver accepted the unit' })
  confirm(
    @Req() request: AuthenticatedRequest,
    @Param('allocationId') allocationId: string,
    @Body() dto: RespondAllocationDto,
  ) {
    return this.allocation.confirm(
      this.requireUserId(request),
      allocationId,
      dto,
      getRequestAuditContext(request),
    );
  }

  @Post(':allocationId/decline')
  @ApiOperation({
    summary:
      'Record a decline or withdrawal, with a reason, and release the unit',
  })
  decline(
    @Req() request: AuthenticatedRequest,
    @Param('allocationId') allocationId: string,
    @Body() dto: RespondAllocationDto,
  ) {
    return this.allocation.decline(
      this.requireUserId(request),
      allocationId,
      dto,
      getRequestAuditContext(request),
    );
  }

  @Post('lapse-expired')
  @ApiOperation({
    summary:
      'Release every promise whose offer window has closed, back into the pool',
  })
  lapseExpired(@Req() request: AuthenticatedRequest) {
    return this.allocation.lapseExpired(
      this.requireUserId(request),
      getRequestAuditContext(request),
    );
  }
}

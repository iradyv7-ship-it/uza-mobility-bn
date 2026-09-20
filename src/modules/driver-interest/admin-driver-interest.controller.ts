import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DriverInterestStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../../users/users.types';
import { RequirePermission } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { UpdateDriverInterestStatusDto } from './dto/update-driver-interest-status.dto';
import { DriverInterestService } from './driver-interest.service';

@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/driver-interest')
export class AdminDriverInterestController {
  constructor(private readonly driverInterest: DriverInterestService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission('driver-interest:read')
  @ApiOperation({ summary: 'List driver interest leads, newest first' })
  list(@Query('status') status?: DriverInterestStatus) {
    return this.driverInterest.list(status);
  }

  @Patch(':id/status')
  @UseGuards(PermissionsGuard)
  @RequirePermission('driver-interest:update-status')
  @ApiOperation({ summary: 'Update a lead as contacted/converted/closed' })
  updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateDriverInterestStatusDto,
  ) {
    return this.driverInterest.updateStatus(id, dto, request.user);
  }
}

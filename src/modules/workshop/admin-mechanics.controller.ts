import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RegisterMechanicDto } from './dto/register-mechanic.dto';
import { WorkshopService } from './workshop.service';

/**
 * Garage/workshop partner onboarding — see WorkshopService.registerMechanic's doc
 * comment for why this did not exist before.
 */
@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/mechanics')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'MARKETPLACE_ADMIN')
export class AdminMechanicsController {
  constructor(private readonly workshopService: WorkshopService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new garage/workshop partner' })
  register(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RegisterMechanicDto,
  ) {
    const registeredByUserId = request.user?.sub;
    if (!registeredByUserId) throw new UnauthorizedException();

    return this.workshopService.registerMechanic({
      name: dto.name,
      engagement: dto.engagement,
      level: dto.level,
      certifiedFor: dto.certifiedFor,
      certifiedUntil: new Date(dto.certifiedUntil),
      userId: dto.userId,
      registeredByUserId,
    });
  }
}

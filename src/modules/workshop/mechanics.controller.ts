import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { InternalWorkshopGuard } from './guards/internal-workshop.guard';
import { WorkshopService } from './workshop.service';

@ApiTags('workshop')
@ApiBearerAuth('JWT-access')
@Controller('workshop/mechanics')
@UseGuards(RolesGuard, InternalWorkshopGuard)
@Roles('MECHANIC', 'WORKSHOP_ADMIN', 'SUPER_ADMIN')
export class MechanicsController {
  constructor(private readonly workshopService: WorkshopService) {}

  @Get()
  @ApiOperation({ summary: 'The mechanic pool and their certification status' })
  list() {
    return this.workshopService.listMechanics();
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { WorkCategory } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WorkshopService } from './workshop.service';

/**
 * The training catalog a certified garage's portal surfaces to its own technicians —
 * Section 05. Read-only here; entries are added via AdminTrainingCoursesController. Also
 * the list this admin panel's own management screen reads (MARKETPLACE_ADMIN can create
 * a course via AdminTrainingCoursesController but has no reason to hold WORKSHOP_ADMIN
 * too, so it needs its own way in here rather than a 403 on the same screen it manages).
 */
@ApiTags('workshop')
@ApiBearerAuth('JWT-access')
@Controller('workshop/training-courses')
@UseGuards(RolesGuard)
@Roles('MECHANIC', 'WORKSHOP_ADMIN', 'SUPER_ADMIN', 'MARKETPLACE_ADMIN')
export class TrainingCoursesController {
  constructor(private readonly workshopService: WorkshopService) {}

  @Get()
  @ApiOperation({
    summary: 'The technician-training catalog, optionally filtered by category',
  })
  @ApiQuery({ name: 'category', required: false })
  list(@Query('category') category?: WorkCategory) {
    return this.workshopService.listTrainingCourses(category);
  }
}

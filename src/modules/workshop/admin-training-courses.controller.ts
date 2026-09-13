import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateTrainingCourseDto } from './dto/create-training-course.dto';
import { WorkshopService } from './workshop.service';

/**
 * Curating the technician-training catalog — see CreateTrainingCourseDto's doc comment
 * for why this is manual-entry today rather than agent-populated.
 */
@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/training-courses')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'MARKETPLACE_ADMIN')
export class AdminTrainingCoursesController {
  constructor(private readonly workshopService: WorkshopService) {}

  @Post()
  @ApiOperation({ summary: 'Add a technician-training course to the catalog' })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateTrainingCourseDto,
  ) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.workshopService.addTrainingCourse(dto, userId);
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Remove a course from the active catalog (kept for history)',
  })
  deactivate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.workshopService.deactivateTrainingCourse(id, userId);
  }
}

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
import { UsersService } from '../../users/users.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AssignTaskDto } from './dto/assign-task.dto';
import { NotificationsService } from './notifications.service';

/**
 * Assigning a task is a staff action — anyone with a role that does real Twara EV / UZA
 * Empower work can hand a follow-up to a named colleague. This is deliberately broader
 * than `SUPER_ADMIN` (unlike role-granting): the point is Scorah, an intake officer, a
 * finance admin, and so on being able to assign each other work, not gatekeeping it behind
 * the one super-admin seat. See NotificationsController for the recipient side ("my tasks").
 */
@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/tasks')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'FINANCE_ADMIN', 'INTAKE_OFFICER', 'MARKETPLACE_ADMIN')
export class AdminTasksController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Assign a task with a deadline to a named colleague',
  })
  async assign(
    @Req() request: AuthenticatedRequest,
    @Body() dto: AssignTaskDto,
  ) {
    const assignedByUserId = request.user?.sub;
    if (!assignedByUserId) throw new UnauthorizedException();

    const assigner = await this.usersService.findById(assignedByUserId);
    const assignedByName = assigner
      ? `${assigner.firstName} ${assigner.lastName}`.trim()
      : 'UZA staff';

    return this.notificationsService.assignTask({
      assigneeUserId: dto.assigneeUserId,
      title: dto.title,
      body: dto.body,
      dueAt: new Date(dto.dueAt),
      assignedByUserId,
      assignedByName,
      entityRef: dto.entityRef,
    });
  }
}

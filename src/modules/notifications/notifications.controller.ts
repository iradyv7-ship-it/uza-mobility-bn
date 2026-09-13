import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { FilterNotificationsDto } from './dto/filter-notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('JWT-access')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  }

  @Get()
  @ApiOperation({ summary: 'List my in-app notifications (paginated)' })
  findMine(
    @Req() request: AuthenticatedRequest,
    @Query() filters: FilterNotificationsDto,
  ) {
    return this.notificationsService.findForUser(
      this.requireUserId(request),
      filters,
    );
  }

  @Get('tasks')
  @ApiOperation({
    summary: 'My task box — work assigned to me, soonest deadline first',
  })
  myTasks(
    @Req() request: AuthenticatedRequest,
    @Query('includeCompleted', new DefaultValuePipe(false), ParseBoolPipe)
    includeCompleted: boolean,
  ) {
    return this.notificationsService.findTasksForUser(
      this.requireUserId(request),
      includeCompleted,
    );
  }

  @Patch('tasks/:id/complete')
  @ApiOperation({ summary: 'Mark one of my assigned tasks done' })
  completeTask(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.notificationsService.completeTask(
      this.requireUserId(request),
      id,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count' })
  unreadCount(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.unreadCount(this.requireUserId(request));
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.markAllRead(this.requireUserId(request));
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.notificationsService.markRead(this.requireUserId(request), id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';
import { AccessRecoveryDto, CreateStaffInviteDto } from './dto/staff-access.dto';
import { StaffAccessService } from './staff-access.service';

/** Issuing and revoking staff access codes. Super admin only — this is the door to the panel. */
@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/staff-invites')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class StaffInvitesController {
  constructor(private readonly staffAccess: StaffAccessService) {}

  private me(req: AuthenticatedRequest): string {
    const id = req.user?.sub;
    if (!id) throw new UnauthorizedException();
    return id;
  }

  @Get()
  @ApiOperation({ summary: 'Every staff invite, newest first, with its status' })
  list() {
    return this.staffAccess.listInvites();
  }

  @Post()
  @ApiOperation({
    summary:
      'Issue a one-time staff access code to an email, for the given roles. The code is returned once and emailed when mail is on.',
  })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateStaffInviteDto) {
    return this.staffAccess.createInvite({ ...dto, byUserId: this.me(req) });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an unredeemed invite' })
  revoke(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.staffAccess.revokeInvite(id, this.me(req));
  }

  @Post('recovery-code/:userId')
  @ApiOperation({
    summary:
      'Issue a one-time recovery code that replaces ONE emailed sign-in code for 30 minutes. Read it to the person on a call you placed; never email it.',
  })
  recoveryCode(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: AccessRecoveryDto,
  ) {
    return this.staffAccess.issueRecoveryCode({ userId, reason: dto.reason, byUserId: this.me(req) });
  }

  @Post('reset-access/:userId')
  @ApiOperation({
    summary:
      'Reset a person’s access: temporary password (shown once), must change at first sign-in, all sessions revoked.',
  })
  resetAccess(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: AccessRecoveryDto,
  ) {
    return this.staffAccess.resetAccess({ userId, reason: dto.reason, byUserId: this.me(req) });
  }
}

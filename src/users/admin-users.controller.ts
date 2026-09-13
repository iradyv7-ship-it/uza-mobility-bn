import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipAudit } from '../common/audit/decorators/skip-audit.decorator';
import { getRequestAuditContext } from '../common/audit/request-context.util';
import { RequirePermission } from '../modules/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../modules/auth/guards/permissions.guard';
import { RolesGuard } from '../modules/auth/guards/roles.guard';
import { Roles } from '../modules/auth/decorators/roles.decorator';
import { AssignUserRolesDto } from './dto/assign-user-roles.dto';
import { CreateAdminAccountDto } from './dto/create-admin-account.dto';
import { UsersService } from './users.service';
import type { AuthenticatedRequest } from './users.types';

@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/users')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  private requireAdmin(
    request: AuthenticatedRequest,
    handler: (
      adminId: string,
      ctx: ReturnType<typeof getRequestAuditContext>,
    ) => unknown,
  ) {
    const userId = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return handler(userId, getRequestAuditContext(request));
  }

  @Get()
  @ApiOperation({ summary: 'List all users (administrator)' })
  @ApiOkResponse({ description: 'All users' })
  listAll() {
    return this.usersService.findAll();
  }

  @Post()
  @SkipAudit() // the service records its own, richer audit entry
  @UseGuards(PermissionsGuard)
  @RequirePermission('users:manage-roles')
  @ApiOperation({
    summary:
      "Create an account on someone else's behalf (driver, bank officer, workshop partner) with a temporary password",
  })
  @ApiOkResponse({
    description:
      'The created user and a ONE-TIME plaintext temporary password. It is never shown again and never stored in cleartext — relay it to the person out of band.',
  })
  createAccount(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateAdminAccountDto,
  ) {
    return this.requireAdmin(request, (adminId, ctx) =>
      this.usersService.createAdminAccount({
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        roleNames: dto.roles,
        createdByUserId: adminId,
        auditContext: ctx,
      }),
    );
  }

  @Patch(':id/roles')
  @SkipAudit()
  @UseGuards(PermissionsGuard)
  @RequirePermission('users:manage-roles')
  @ApiOperation({ summary: 'Assign roles to a user' })
  @ApiOkResponse({ description: 'Updated user roles' })
  updateRoles(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AssignUserRolesDto,
  ) {
    return this.requireAdmin(request, (adminId, ctx) =>
      this.usersService.updateUserRoles(id, dto.roles, adminId, ctx),
    );
  }

  @Patch(':id/uza-id')
  @SkipAudit() // the service records its own audit entry
  @ApiOperation({
    summary:
      'Assign the permanent UZA-P-… id to an account that does not have one yet',
  })
  assignUzaId(@Param('id') id: string) {
    return this.usersService.assignUzaId(id);
  }

  @Patch(':id/deactivate')
  @SkipAudit()
  @ApiOperation({ summary: 'Deactivate user' })
  @ApiOkResponse({ description: 'Deactivated user' })
  deactivate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.requireAdmin(request, (adminId, ctx) =>
      this.usersService.deactivateUser(id, adminId, ctx),
    );
  }

  @Patch(':id/activate')
  @SkipAudit()
  @UseGuards(PermissionsGuard)
  @RequirePermission('users:manage-roles')
  @ApiOperation({ summary: 'Reactivate a deactivated user' })
  @ApiOkResponse({ description: 'Reactivated user' })
  activate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.requireAdmin(request, (adminId, ctx) =>
      this.usersService.activateUser(id, adminId, ctx),
    );
  }
}

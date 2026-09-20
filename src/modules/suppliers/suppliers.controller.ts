import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SupplierKind, SupplierStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import {
  ApproveSupplierRegistrationDto,
  RejectSupplierRegistrationDto,
} from './dto/decide-supplier-registration.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SUPPLY_STAFF_ROLES } from './supplier-access';
import { SuppliersService } from './suppliers.service';

/**
 * Suppliers, as UZA sourcing staff see them.
 *
 * Staff-only, all of it. The public front door a company registers through lives in
 * `supplier-registration.controller.ts`, in its own class rather than as one @Public()
 * handler here — a class-level @Roles() that one route opts out of is exactly the kind of
 * arrangement that survives a refactor as a hole.
 */
@ApiTags('suppliers')
@ApiBearerAuth('JWT-access')
@Controller('suppliers')
@UseGuards(RolesGuard)
@Roles(...SUPPLY_STAFF_ROLES)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a supplier' })
  create(@Body() dto: CreateSupplierDto, @Req() req: AuthenticatedRequest) {
    return this.suppliers.create(dto, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'List suppliers' })
  @ApiQuery({ name: 'status', required: false, enum: SupplierStatus })
  @ApiQuery({ name: 'kind', required: false, enum: SupplierKind })
  @ApiQuery({ name: 'q', required: false, description: 'Legal name or code' })
  list(
    @Query('status') status?: SupplierStatus,
    @Query('kind') kind?: SupplierKind,
    @Query('q') q?: string,
  ) {
    return this.suppliers.list({ status, kind, q });
  }

  /**
   * Registrations waiting for a human, oldest first.
   *
   * Declared before `:id` deliberately — Nest matches routes in declaration order, and
   * `GET /suppliers/pending` would otherwise be read as a supplier whose id is "pending".
   */
  @Get('registrations/pending')
  @ApiOperation({ summary: 'PROSPECT suppliers awaiting approval' })
  listPendingRegistrations() {
    return this.suppliers.listPendingRegistrations();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One supplier' })
  findOne(@Param('id') id: string) {
    return this.suppliers.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Amend a supplier. The code is not amendable.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.suppliers.update(id, dto, req.user);
  }

  @Post(':id/approve')
  @ApiOperation({
    summary:
      'Approve a registration: ACTIVE, a permanent code, and the portal grant for the applicant.',
  })
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveSupplierRegistrationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.suppliers.approveRegistration(id, dto, req.user);
  }

  @Post(':id/reject')
  @ApiOperation({
    summary: 'Reject a registration. The row and the account both stay.',
  })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectSupplierRegistrationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.suppliers.rejectRegistration(id, dto, req.user);
  }
}

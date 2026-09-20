import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { getRequestAuditContext } from '../../common/audit/request-context.util';
import { Public } from '../auth/decorators/public.decorator';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { SuppliersService } from './suppliers.service';

/**
 * The public front door: a company that wants to sell to UZA, registering itself.
 *
 * One route, in a class of its own, so that being public is a property of this file rather
 * than an exception inside a staff controller.
 *
 * Why it is safe to leave open: registering creates a PROSPECT Supplier and an ordinary
 * User holding SUPPLIER_PORTAL, and NO `CounterpartyAccess` grant. Every portal route
 * resolves the caller's supplier from that grant, so until staff approve, the new account
 * can sign in and read nothing whatsoever — not its own company's offers, because it has
 * none, and certainly not anybody else's.
 *
 * Throttled at the auth routes' five-a-minute. This creates a User; it is an
 * account-creation route wearing a different name, and it must not become a way to probe
 * which email addresses already hold UZA accounts.
 */
@ApiTags('suppliers')
@Controller('suppliers')
export class SupplierRegistrationController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @Public()
  @ApiOperation({
    summary:
      'Register as a supplier. Creates a PROSPECT company and a portal login that sees nothing until approved.',
  })
  register(@Body() dto: RegisterSupplierDto, @Req() request: Request) {
    return this.suppliers.register(dto, getRequestAuditContext(request));
  }
}

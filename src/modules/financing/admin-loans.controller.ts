import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditContext } from '../../common/audit/request-context.util';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateLoanSavingsEntryDto } from './dto/create-loan-savings-entry.dto';
import { FinancingService } from './financing.service';

/**
 * Recording a loan's daily savings-vs-required-payment data — the ongoing-behaviour
 * signal UZA Empower gives a lender alongside the monthly vehicle inspection (see
 * `InspectionsController`). No wallet/MoMo integration exists yet to populate this
 * automatically (see docs/mobility-audit.md); this is the interim, honest path — a real
 * person confirms a real deposit — rather than pretending an automated feed exists.
 */
@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/loans')
@UseGuards(RolesGuard)
@Roles('FINANCE_ADMIN', 'SUPER_ADMIN')
export class AdminLoansController {
  constructor(private readonly financingService: FinancingService) {}

  @Post(':loanId/savings-entries')
  @ApiOperation({
    summary: "Record one day's deposit against a loan's required payment",
  })
  recordSavings(
    @Req() request: AuthenticatedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: CreateLoanSavingsEntryDto,
  ) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();

    return this.financingService.recordLoanSavings(
      loanId,
      dto,
      userId,
      getRequestAuditContext(request),
    );
  }
}

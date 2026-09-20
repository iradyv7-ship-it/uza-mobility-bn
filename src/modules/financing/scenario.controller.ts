import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { PLATFORM_STAFF_ROLES } from '../auth/auth-workspace.util';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApplyScenarioDto, ScenarioDto } from './dto/scenario.dto';
import { LENDER_TERMS } from './lender-terms.registry';
import { forBorrower, study } from './scenario.rules';
import { ScenarioService } from './scenario.service';

/**
 * Who may see a rate. Staff and lenders reconcile against it; a borrower is told what they
 * pay per day and never a percentage (loan-terms.ts). The same endpoint serves both — the
 * difference is what is stripped on the way out, decided from the token, never the request.
 */
function seesRates(req: AuthenticatedRequest): boolean {
  const roles = req.user?.roles ?? [];
  return roles.some(
    (r) =>
      (PLATFORM_STAFF_ROLES as readonly string[]).includes(r) ||
      r.startsWith('LENDER_'),
  );
}

@ApiTags('financing')
@ApiBearerAuth('JWT-access')
@Controller('financing/scenarios')
export class ScenarioController {
  @Get('lender-terms')
  @ApiOperation({
    summary: 'Every lender on file with its contribution rule, tenors and evidence',
  })
  lenderTerms(@Req() req: AuthenticatedRequest) {
    const full = seesRates(req);
    return LENDER_TERMS.map((l) => ({
      key: l.key,
      name: l.name,
      contributionPct: l.contributionPct,
      tenorsMonths: l.tenorsMonths,
      uzaCollateralAvailable: l.uzaCollateralAvailable,
      rateOnFile: l.rateBands !== null,
      rateBands: full ? l.rateBands : undefined,
      evidence: l.evidence,
    }));
  }

  @Post()
  @ApiOperation({
    summary:
      'Study a financing scenario: the 10% rule, UZA’s support, what the bank funds, and how the daily figure moves by lender, tenor, rate and contribution',
  })
  study(@Req() req: AuthenticatedRequest, @Body() dto: ScenarioDto) {
    if (!req.user?.sub) throw new UnauthorizedException();
    const s = study(dto);
    return seesRates(req) ? s : forBorrower(s);
  }
}

@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/loans')
@UseGuards(RolesGuard)
@Roles('FINANCE_ADMIN', 'SUPER_ADMIN')
export class AdminLoanScenarioController {
  constructor(private readonly scenarios: ScenarioService) {}

  @Get(':loanId/scenario')
  @ApiOperation({
    summary: 'The loan’s booked numbers as a scenario, with the studies around them',
  })
  forLoan(@Param('loanId') loanId: string) {
    return this.scenarios.studyLoan(loanId);
  }

  @Post(':loanId/scenario/apply')
  @ApiOperation({
    summary:
      'Book these numbers onto an undisbursed loan: price, contribution, UZA pledge, bank principal, schedule, wallet targets — audited with before and after',
  })
  apply(
    @Req() req: AuthenticatedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: ApplyScenarioDto,
  ) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.scenarios.applyToLoan(loanId, dto, userId);
  }
}

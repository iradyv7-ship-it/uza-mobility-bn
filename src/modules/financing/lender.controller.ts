import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { LenderConfig } from './lenders.registry';
import { LenderAccessGuard } from './guards/lender-access.guard';
import { LenderService } from './lender.service';

interface LenderScopedRequest extends Request {
  lender?: LenderConfig;
}

/**
 * `/financing/lenders/:key/*` — matches uza-mobility-fn's `src/lib/api/lender.ts` exactly.
 *
 * Every route runs `LenderAccessGuard` first: an unknown key or a caller without that
 * bank's role gets a 404 before any handler runs, and `:key` gets replaced with the
 * validated `LenderConfig` on the request. Handlers never re-derive access from `:key`
 * themselves — reading `request.lender` is the only path in.
 */
@ApiTags('financing')
@ApiBearerAuth('JWT-access')
@Controller('financing/lenders/:key')
@UseGuards(LenderAccessGuard)
export class LenderController {
  constructor(private readonly lenderService: LenderService) {}

  private requireLender(request: LenderScopedRequest): LenderConfig {
    // Set by LenderAccessGuard, which runs first — absent only if that invariant breaks.
    if (!request.lender) throw new NotFoundException();
    return request.lender;
  }

  @Get('summary')
  @ApiOperation({ summary: "A lender's pipeline at a glance" })
  summary(@Req() request: LenderScopedRequest) {
    return this.lenderService.summary(this.requireLender(request));
  }

  @Get('applications')
  @ApiOperation({ summary: "A lender's loans not yet decided" })
  applications(@Req() request: LenderScopedRequest) {
    return this.lenderService.applications(this.requireLender(request));
  }

  @Get('borrowers')
  @ApiOperation({ summary: "A lender's active and historical borrowers" })
  borrowers(@Req() request: LenderScopedRequest) {
    return this.lenderService.borrowers(this.requireLender(request));
  }

  @Get('disbursements')
  @ApiOperation({ summary: "A lender's disbursed loans" })
  disbursements(@Req() request: LenderScopedRequest) {
    return this.lenderService.disbursements(this.requireLender(request));
  }

  @Get('portfolio')
  @ApiOperation({ summary: "A lender's book, grouped by disbursal month" })
  portfolio(@Req() request: LenderScopedRequest) {
    return this.lenderService.portfolio(this.requireLender(request));
  }

  /**
   * The cash-collateral facility. `seesCollateral` is checked here, not in the guard,
   * because it applies to this one route only — the same shape as `canAccessLenderPath`
   * on the frontend, which checks the base lender+role rule everywhere and adds this one
   * extra condition only when `rest[0] === 'collateral'`. Absent for an unentitled lender,
   * not disabled: this returns the same 404 as an unknown route, never a 403 that would
   * itself disclose the facility exists.
   */
  @Get('credit-enhancement')
  @ApiOperation({
    summary: 'The cash-collateral facility (entitled lenders only)',
  })
  creditEnhancement(@Req() request: LenderScopedRequest) {
    const lender = this.requireLender(request);
    if (!lender.seesCollateral) throw new NotFoundException();
    return this.lenderService.creditEnhancement(lender);
  }

  /**
   * The two things UZA Empower gives a lender alongside the equity top-up already
   * visible on `applications`/`borrowers`: the vehicle's condition history, and the
   * borrower's ongoing savings behaviour. Both 404 identically to an unknown loan id if
   * the loan belongs to another bank — `LenderService.requireOwnLoan` is the only path
   * to either, same as every other cross-tenant boundary in this controller.
   */
  @Get('loans/:loanId/inspections')
  @ApiOperation({ summary: "A financed vehicle's condition-report history" })
  inspections(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
  ) {
    return this.lenderService.inspectionsForLoan(
      this.requireLender(request),
      loanId,
    );
  }

  @Get('loans/:loanId/savings')
  @ApiOperation({
    summary: "A borrower's daily savings against their required payment",
  })
  savings(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
  ) {
    return this.lenderService.savingsForLoan(
      this.requireLender(request),
      loanId,
    );
  }
}

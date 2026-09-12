import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { AskInfoRequestDto } from './dto/ask-info-request.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { RecordLenderDecisionDto } from './dto/record-lender-decision.dto';
import type { LenderConfig } from './lenders.registry';
import { LenderAccessGuard } from './guards/lender-access.guard';
import { LenderService } from './lender.service';

interface LenderScopedRequest extends AuthenticatedRequest {
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

  private requireUserId(request: LenderScopedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
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

  @Get('loans/:loanId/training')
  @ApiOperation({
    summary:
      "The borrower's training summary — modules passed by kind, comprehension score and trend",
  })
  training(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
  ) {
    return this.lenderService.trainingForLoan(
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

  @Get('queue')
  @ApiOperation({
    summary:
      "A bank's working queue — pending/in-review loans plus each one's open " +
      'information request and latest decision, if any',
  })
  queue(@Req() request: LenderScopedRequest) {
    return this.lenderService.queue(this.requireLender(request));
  }

  @Post('loans/:loanId/decisions')
  @ApiOperation({
    summary: 'Record a credit decision on one of this bank’s own loans',
  })
  recordDecision(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: RecordLenderDecisionDto,
  ) {
    return this.lenderService.recordDecision(
      this.requireLender(request),
      loanId,
      dto,
      this.requireUserId(request),
    );
  }

  @Get('loans/:loanId/decisions')
  @ApiOperation({ summary: 'Every decision recorded on this loan' })
  listDecisions(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
  ) {
    return this.lenderService.listDecisions(
      this.requireLender(request),
      loanId,
    );
  }

  @Post('loans/:loanId/info-requests')
  @ApiOperation({
    summary: 'Ask UZA a question about one of this bank’s own loans',
  })
  askInfoRequest(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: AskInfoRequestDto,
  ) {
    return this.lenderService.askInfoRequest(
      this.requireLender(request),
      loanId,
      dto,
      this.requireUserId(request),
    );
  }

  @Get('loans/:loanId/info-requests')
  @ApiOperation({
    summary: 'This bank’s own question-and-answer thread on this loan',
  })
  listInfoRequests(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
  ) {
    return this.lenderService.listInfoRequests(
      this.requireLender(request),
      loanId,
    );
  }

  /**
   * Bank-internal only. This is the ONE place in the whole API surface that reads or
   * writes a credit note — see CreditNote's own doc comment in schema.prisma for why
   * UZA-staff-facing code never touches this table at all.
   */
  @Post('loans/:loanId/credit-notes')
  @ApiOperation({
    summary:
      'Add a bank-internal underwriting note (UZA staff cannot read this)',
  })
  addCreditNote(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.lenderService.addCreditNote(
      this.requireLender(request),
      loanId,
      dto,
      this.requireUserId(request),
    );
  }

  @Get('loans/:loanId/credit-notes')
  @ApiOperation({
    summary: 'This bank’s own internal notes on this loan',
  })
  listCreditNotes(
    @Req() request: LenderScopedRequest,
    @Param('loanId') loanId: string,
  ) {
    return this.lenderService.listCreditNotes(
      this.requireLender(request),
      loanId,
    );
  }
}

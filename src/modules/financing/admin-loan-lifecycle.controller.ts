import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ChangeTenorDto } from './dto/change-tenor.dto';
import { CreateLoanDto } from './dto/create-loan.dto';
import { FilterLoansDto } from './dto/filter-loans.dto';
import { ReviewLoanChangeDto } from './dto/review-loan-change.dto';
import {
  CloseLoanDto,
  DisburseLoanDto,
  RecordRepaymentDto,
} from './dto/loan-servicing.dto';
import { readFirstSheet } from './empower-support.controller';
import { parseCsv } from './empower-support.rules';
import { LoanLifecycleService } from './loan-lifecycle.service';
import { LoanServicingService } from './loan-servicing.service';

/**
 * The loan-origination and tenor-change surface that did not exist anywhere in this
 * codebase — see docs/mobility-audit.md. Staff-only: originating a loan or overriding its
 * terms directly is a UZA decision, not a lender one (the lender's own path is
 * LenderController's `POST loans/:loanId/change-requests`, which lands here for review).
 */
@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/loans')
@UseGuards(RolesGuard)
@Roles('FINANCE_ADMIN', 'SUPER_ADMIN')
export class AdminLoanLifecycleController {
  constructor(
    private readonly loanLifecycleService: LoanLifecycleService,
    private readonly servicing: LoanServicingService,
  ) {}

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Get()
  @ApiOperation({
    summary: 'Every loan, filterable by status/search, paginated',
  })
  listLoans(@Query() filters: FilterLoansDto) {
    return this.loanLifecycleService.listLoans(filters);
  }

  @Post()
  @ApiOperation({ summary: 'Originate a loan for an existing borrower' })
  createLoan(@Req() request: AuthenticatedRequest, @Body() dto: CreateLoanDto) {
    return this.loanLifecycleService.createLoan({
      ...dto,
      createdByUserId: this.requireUserId(request),
    });
  }

  @Get(':loanId')
  @ApiOperation({
    summary: "A loan's full current state (vehicle, tenor-change history)",
  })
  getLoan(@Param('loanId') loanId: string) {
    return this.loanLifecycleService.getLoan(loanId);
  }

  @Patch(':loanId/tenor')
  @ApiOperation({
    summary:
      "Change a loan's tenor directly (staff decision, recalculates and notifies)",
  })
  changeTenor(
    @Req() request: AuthenticatedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: ChangeTenorDto,
  ) {
    return this.loanLifecycleService.changeTenor({
      loanId,
      newTenorMonths: dto.newTenorMonths,
      reason: dto.reason,
      changedByUserId: this.requireUserId(request),
    });
  }

  @Get(':loanId/change-requests')
  @ApiOperation({ summary: 'Every change a lender has proposed on this loan' })
  listChangeRequests(@Param('loanId') loanId: string) {
    return this.loanLifecycleService.listChangeRequests(loanId);
  }

  @Patch('change-requests/:changeRequestId/review')
  @ApiOperation({
    summary: "Approve (and apply) or reject a lender's proposed loan change",
  })
  reviewChange(
    @Req() request: AuthenticatedRequest,
    @Param('changeRequestId') changeRequestId: string,
    @Body() dto: ReviewLoanChangeDto,
  ) {
    return this.loanLifecycleService.reviewChange({
      changeRequestId,
      approve: dto.approve,
      reviewNote: dto.reviewNote,
      reviewedByUserId: this.requireUserId(request),
    });
  }

  // ── Servicing: what happens after the bank says yes ────────────────────────────────────

  @Post(':loanId/disburse')
  @ApiOperation({
    summary:
      'Record the disbursement. Balance becomes total repayable; the wallet daily target is set; the first instalment is due in 30 days.',
  })
  disburse(
    @Req() request: AuthenticatedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: DisburseLoanDto,
  ) {
    return this.servicing.disburse({
      loanId,
      disbursedAt: dto.disbursedAt ? new Date(dto.disbursedAt) : undefined,
      reference: dto.reference,
      byUserId: this.requireUserId(request),
    });
  }

  @Get(':loanId/repayments')
  @ApiOperation({
    summary: 'Every repayment recorded against the loan, newest first',
  })
  repayments(@Param('loanId') loanId: string) {
    return this.servicing.listRepayments(loanId);
  }

  @Post(':loanId/repayments')
  @ApiOperation({
    summary:
      "Record one repayment (idempotent on the bank's reference). Recomputes balance, arrears and status; writes the sweep to the driver's wallet.",
  })
  recordRepayment(
    @Req() request: AuthenticatedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: RecordRepaymentDto,
  ) {
    return this.servicing.recordRepayment({
      loanId,
      amountRwf: dto.amountRwf,
      paidAt: new Date(dto.paidAt),
      reference: dto.reference,
      source: dto.source,
      note: dto.note,
      byUserId: this.requireUserId(request),
    });
  }

  @Post('repayments/import')
  @ApiOperation({
    summary:
      "The bank's repayment file (.csv or .xlsx). Columns matched by name: Loan / Amount / Date / Reference. Rows already recorded are counted as duplicates, never recorded twice.",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async importRepayments(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file)
      throw new BadRequestException('Attach a .csv or .xlsx file as "file".');
    const name = (file.originalname || '').toLowerCase();
    let records: Record<string, unknown>[];
    if (name.endsWith('.csv') || file.mimetype === 'text/csv') {
      records = parseCsv(file.buffer.toString('utf8'));
    } else if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
      records = await readFirstSheet(file.buffer);
    } else {
      throw new BadRequestException(
        `Unsupported file "${file.originalname}". Send .csv or .xlsx.`,
      );
    }
    return this.servicing.importRepayments(
      records,
      this.requireUserId(request),
    );
  }

  @Post('recompute-arrears')
  @ApiOperation({
    summary:
      'Recompute balance, arrears and status for every live loan now (the nightly job does this at 04:30).',
  })
  recomputeArrears() {
    return this.servicing.recomputeAll();
  }

  @Post(':loanId/close')
  @ApiOperation({
    summary:
      'Close the loan. Refused with a balance unless a reason is written. Returns the reserve to the driver as their own savings.',
  })
  close(
    @Req() request: AuthenticatedRequest,
    @Param('loanId') loanId: string,
    @Body() dto: CloseLoanDto,
  ) {
    return this.servicing.close({
      loanId,
      note: dto.note,
      byUserId: this.requireUserId(request),
    });
  }
}

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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ChangeTenorDto } from './dto/change-tenor.dto';
import { CreateLoanDto } from './dto/create-loan.dto';
import { ReviewLoanChangeDto } from './dto/review-loan-change.dto';
import { LoanLifecycleService } from './loan-lifecycle.service';

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
  constructor(private readonly loanLifecycleService: LoanLifecycleService) {}

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
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
}

import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CovenantService } from './covenant.service';
import { AllocateDto } from './dto/allocate.dto';
import { RecordDepositDto } from './dto/record-deposit.dto';
import { SetSplitDto } from './dto/set-split.dto';
import { WalletService } from './wallet.service';

/**
 * The driver's own wallet. Every route is "me": a driver sees their own money and nobody
 * else's, and the user id comes from the token, never from the request.
 */
@ApiTags('wallet')
@ApiBearerAuth('JWT-access')
@Controller('wallet/me')
@UseGuards(RolesGuard)
@Roles('BUYER')
export class WalletController {
  constructor(
    private readonly wallets: WalletService,
    private readonly covenants: CovenantService,
    private readonly prisma: PrismaService,
  ) {}

  private me(req: AuthenticatedRequest): string {
    const id = req.user?.sub;
    if (!id) throw new UnauthorizedException();
    return id;
  }

  @Get()
  @ApiOperation({
    summary: 'My buckets, targets, streak, performance — and whose money it is',
  })
  overview(@Req() req: AuthenticatedRequest) {
    return this.wallets.overview(this.me(req));
  }

  @Get('statement')
  @ApiOperation({
    summary:
      'My ledger, newest first, with recorded / confirmed state on every line',
  })
  statement(@Req() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    return this.wallets.statement(
      this.me(req),
      limit ? Number(limit) : undefined,
    );
  }

  @Get('warnings')
  @ApiOperation({ summary: 'Open covenant warnings on my loan, if any' })
  async warnings(@Req() req: AuthenticatedRequest) {
    const userId = this.me(req);
    const loan = await this.prisma.loan.findFirst({
      where: {
        borrowerUserId: userId,
        status: { in: ['ACTIVE', 'IN_ARREARS', 'DISBURSED'] },
      },
      select: { id: true },
    });
    if (!loan) return { loan: null, covenants: [], worst: null };
    const r = await this.covenants.runForLoan(loan.id, new Date(), false);
    return {
      loan: r.loanRef,
      worst: r.worst,
      covenants: r.covenants.filter((c) => c.audience.includes('DRIVER')),
    };
  }

  @Post('deposits')
  @ApiOperation({
    summary:
      'Record a MoMo deposit I made to my own account. Idempotent on the transaction ID.',
  })
  deposit(@Req() req: AuthenticatedRequest, @Body() dto: RecordDepositDto) {
    return this.wallets.recordDeposit(
      this.me(req),
      dto,
      getRequestAuditContext(req),
    );
  }

  @Post('allocations')
  @ApiOperation({
    summary:
      'Move a label between my buckets. No money moves. Not out of LOAN.',
  })
  allocate(@Req() req: AuthenticatedRequest, @Body() dto: AllocateDto) {
    const userId = this.me(req);
    return this.wallets.allocate(
      userId,
      dto,
      'DRIVER',
      userId,
      getRequestAuditContext(req),
    );
  }

  @Put('split')
  @ApiOperation({
    summary:
      'My default split of a day’s money across buckets. Must sum to 100.',
  })
  split(@Req() req: AuthenticatedRequest, @Body() dto: SetSplitDto) {
    return this.wallets.setSplit(this.me(req), dto);
  }
}

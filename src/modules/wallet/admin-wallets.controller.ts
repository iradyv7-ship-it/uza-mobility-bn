import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
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
import { ConfirmDepositDto } from './dto/confirm-deposit.dto';
import { OpenWalletDto } from './dto/open-wallet.dto';
import { WalletService } from './wallet.service';

/**
 * UZA finance: open wallets against the institution's account, confirm deposits from the
 * statement, re-allocate with a reason, run the covenants.
 */
@ApiTags('wallet')
@ApiBearerAuth('JWT-access')
@Controller('admin/wallets')
@UseGuards(RolesGuard)
@Roles('FINANCE_ADMIN', 'SUPER_ADMIN')
export class AdminWalletsController {
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

  @Post()
  @ApiOperation({
    summary:
      'Open (or update) a participant’s wallet against their own account at the institution',
  })
  open(@Req() req: AuthenticatedRequest, @Body() dto: OpenWalletDto) {
    return this.wallets.open(this.me(req), dto, getRequestAuditContext(req));
  }

  @Get('pending')
  @ApiOperation({
    summary: 'Driver-recorded deposits awaiting a statement match',
  })
  pending(@Query('uzaId') uzaId?: string) {
    return this.wallets.pendingForStaff(uzaId);
  }

  @Post('entries/:id/confirm')
  @ApiOperation({
    summary:
      'Match a recorded deposit to the institution’s statement. Balances move here.',
  })
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ConfirmDepositDto,
  ) {
    return this.wallets.confirmDeposit(
      this.me(req),
      id,
      dto,
      getRequestAuditContext(req),
    );
  }

  @Post('covenants/run')
  @ApiOperation({
    summary:
      'Run the covenant rules now for every active loan (the 07:00 job, on demand)',
  })
  run() {
    return this.covenants.runAll();
  }

  @Get('covenants/loans/:loanId')
  @ApiOperation({
    summary: 'Open covenants on one loan, computed now, without notifying',
  })
  forLoan(@Param('loanId') loanId: string) {
    return this.covenants.runForLoan(loanId, new Date(), false);
  }

  @Get(':uzaId')
  @ApiOperation({ summary: 'A participant’s wallet as they see it' })
  file(@Param('uzaId') uzaId: string) {
    return this.wallets.fileForStaff(uzaId);
  }

  @Post(':uzaId/allocations')
  @ApiOperation({
    summary:
      'Re-allocate on a participant’s behalf. Out of LOAN needs a reason.',
  })
  async allocate(
    @Req() req: AuthenticatedRequest,
    @Param('uzaId') uzaId: string,
    @Body() dto: AllocateDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { uzaId: uzaId.trim().toUpperCase() },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('No participant with that UZA ID.');
    return this.wallets.allocate(
      user.id,
      dto,
      'STAFF',
      this.me(req),
      getRequestAuditContext(req),
    );
  }
}

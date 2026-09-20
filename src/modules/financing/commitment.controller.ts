import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CommitmentService } from './commitment.service';

/** The driver's own rung and next step. */
@ApiTags('financing')
@ApiBearerAuth('JWT-access')
@Controller('financing/commitment')
export class CommitmentController {
  constructor(private readonly commitment: CommitmentService) {}

  @Get('me')
  @ApiOperation({ summary: 'Where I am on the ladder and the one thing to do next' })
  me(@Req() req: AuthenticatedRequest) {
    const id = req.user?.sub;
    if (!id) throw new UnauthorizedException();
    return this.commitment.forUser(id);
  }
}

/** Staff: the whole client base by rung, so time goes to the people who did the work. */
@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/commitment')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'FINANCE_ADMIN', 'INTAKE_OFFICER', 'TRAINER')
export class AdminCommitmentController {
  constructor(private readonly commitment: CommitmentService) {}

  @Get()
  @ApiOperation({ summary: 'Every client, highest rung first, with counts per stage' })
  ladder(@Query('limit') limit?: string) {
    return this.commitment.ladder(limit ? Math.min(1000, Number(limit) || 200) : 200);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'One client’s rung, evidence, next step and the raw signals' })
  one(@Param('userId') userId: string) {
    return this.commitment.forUser(userId);
  }
}

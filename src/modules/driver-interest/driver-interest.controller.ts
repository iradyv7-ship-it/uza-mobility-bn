import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CreateDriverInterestDto } from './dto/create-driver-interest.dto';
import { DriverInterestService } from './driver-interest.service';

@ApiTags('driver-interest')
@Controller('driver-interest')
export class DriverInterestController {
  constructor(private readonly driverInterest: DriverInterestService) {}

  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Public 'I'm interested' lead from the marketing site — not the fund application",
  })
  submit(@Body() dto: CreateDriverInterestDto) {
    return this.driverInterest.submit(dto);
  }
}

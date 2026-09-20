import { ApiProperty } from '@nestjs/swagger';
import { DriverInterestStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateDriverInterestStatusDto {
  @ApiProperty({ enum: DriverInterestStatus })
  @IsEnum(DriverInterestStatus)
  status!: DriverInterestStatus;
}

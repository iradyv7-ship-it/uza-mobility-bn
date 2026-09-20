import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListQueueDto {
  @ApiPropertyOptional({
    description: 'Vehicle class code, e.g. CAR, BIKE, TRUCK',
  })
  @IsOptional()
  @IsString()
  classCode?: string;
}

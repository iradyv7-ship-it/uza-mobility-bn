import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListAvailableUnitsDto {
  @ApiPropertyOptional({
    description: 'Vehicle class code, e.g. CAR, BIKE, TRUCK',
  })
  @IsOptional()
  @IsString()
  classCode?: string;

  @ApiPropertyOptional({ description: 'Only units inside this consignment' })
  @IsOptional()
  @IsString()
  consignmentId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

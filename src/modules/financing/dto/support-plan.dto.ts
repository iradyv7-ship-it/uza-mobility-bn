import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SupportRowDto {
  @ApiProperty({
    example: 'UZA-P-2026-000141',
    description: 'UZA ID, application ref, or a name',
  })
  @IsString()
  @MaxLength(120)
  reference!: string;

  @ApiPropertyOptional({ example: 'Neta U Pro 2022' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  vehicle?: string;

  @ApiProperty({ example: 23_500_000, description: 'Whole RWF' })
  @IsNumber()
  @Min(1)
  vehiclePriceRwf!: number;

  @ApiPropertyOptional({
    example: 500_000,
    description: 'What the driver has, whole RWF',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  driverHasRwf?: number;

  @ApiPropertyOptional({
    example: 40,
    description: 'Or: the share of the required contribution they have, 0–100',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  driverHasPctOfRequired?: number;

  @ApiPropertyOptional({ enum: [36, 60], default: 60 })
  @IsOptional()
  @IsInt()
  @IsIn([36, 60])
  tenorMonths?: 36 | 60;
}

export class SupportPlanDto {
  @ApiProperty({ type: [SupportRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SupportRowDto)
  rows!: SupportRowDto[];
}

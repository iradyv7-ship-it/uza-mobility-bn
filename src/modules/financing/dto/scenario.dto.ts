import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** One financing scenario. Every field beyond the first three is an override of a rule. */
export class ScenarioDto {
  @ApiProperty({ example: 22500000, description: 'Vehicle price, whole RWF' })
  @IsInt()
  @IsPositive()
  vehiclePriceRwf!: number;

  @ApiProperty({
    example: 1500000,
    description: "The client's own money toward the price, whole RWF",
  })
  @IsInt()
  @Min(0)
  clientContributionRwf!: number;

  @ApiProperty({ example: 60 })
  @IsInt()
  @Min(1)
  @Max(120)
  tenorMonths!: number;

  @ApiPropertyOptional({ example: 'unguka' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  lenderKey?: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Contribution the bank expects, % of price. Default: the lender’s.',
  })
  @IsOptional()
  @Min(0)
  @Max(100)
  contributionPct?: number;

  @ApiPropertyOptional({
    example: 3600,
    description: 'Annual nominal rate in basis points. Default: the lender’s band.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  annualRateBps?: number;

  @ApiPropertyOptional({ description: 'UZA cash collateral, whole RWF' })
  @IsOptional()
  @IsInt()
  @Min(0)
  uzaCollateralRwf?: number;

  @ApiPropertyOptional({ description: 'What the bank lends, whole RWF' })
  @IsOptional()
  @IsInt()
  @Min(0)
  bankLoanRwf?: number;

  @ApiPropertyOptional({
    description:
      'A client minimum accepted for this row that differs from the band (cohort 1: 500000)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  grandfatheredMinimumRwf?: number;
}

export class ApplyScenarioDto extends ScenarioDto {
  @ApiPropertyOptional({
    description: 'Why the numbers are being set — goes into the audit line and the pledge note',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Book even with warnings (never with blocks). Warnings are listed back either way.',
  })
  @IsOptional()
  @IsBoolean()
  acceptWarnings?: boolean;
}

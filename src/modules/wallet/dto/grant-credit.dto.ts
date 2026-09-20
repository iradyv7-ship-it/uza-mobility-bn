import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const CONTRIBUTION_CREDIT_SOURCES = [
  'EARN_IN',
  'GRANT',
  'PARTNER',
  'ADJUSTMENT',
] as const;

/**
 * A credit toward a driver's contribution. UZA's own promise, recorded with a reason —
 * never money UZA holds for the driver. See ContributionCredit in the schema.
 */
export class GrantCreditDto {
  @ApiProperty({ example: 15000, description: 'Whole francs' })
  @IsInt()
  @IsPositive()
  amountRwf!: number;

  @ApiProperty({ enum: CONTRIBUTION_CREDIT_SOURCES, example: 'EARN_IN' })
  @IsIn(CONTRIBUTION_CREDIT_SOURCES)
  source!: (typeof CONTRIBUTION_CREDIT_SOURCES)[number];

  @ApiProperty({
    example: 'Earn-in: 25% of the week 3 placement fee (RWF 60,000)',
    description: 'Why, in words a driver and an auditor both understand.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(300)
  reason!: string;

  @ApiPropertyOptional({
    example: 'PLACEMENT-W3-2026-09',
    description:
      'Idempotency handle per driver — a placement week, a grant reference. The same reference is never credited twice.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

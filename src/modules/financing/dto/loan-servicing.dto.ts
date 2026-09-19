import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class DisburseLoanDto {
  @ApiPropertyOptional({
    description: 'When the bank paid out. Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  disbursedAt?: string;

  @ApiPropertyOptional({ description: "The bank's disbursement reference" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class RecordRepaymentDto {
  @ApiProperty({ example: 883000, description: 'Whole francs' })
  @IsInt()
  @IsPositive()
  amountRwf!: number;

  @ApiProperty({ example: '2026-10-14', description: 'Value date at the bank' })
  @IsDateString()
  paidAt!: string;

  @ApiProperty({
    example: 'UNG-STO-2026-10-14-0001',
    description:
      "The bank's own reference for the receipt or standing-order line. Unique per loan; the same reference is never recorded twice.",
  })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  reference!: string;

  @ApiProperty({ enum: ['LENDER_FILE', 'MANUAL', 'SWEEP'], example: 'MANUAL' })
  @IsIn(['LENDER_FILE', 'MANUAL', 'SWEEP'])
  source!: 'LENDER_FILE' | 'MANUAL' | 'SWEEP';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CloseLoanDto {
  @ApiPropertyOptional({
    description:
      'Required when a balance remains: settlement, write-off, or restructure into a new loan.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

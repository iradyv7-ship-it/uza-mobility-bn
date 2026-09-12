import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BUCKETS } from '../wallet.rules';

/**
 * The driver recording a deposit THEY made by MoMo to their own account at the institution.
 * The transaction ID from the confirmation SMS is the idempotency key: the same SMS typed
 * twice lands once. Until matched to the institution's statement it is a claim, shown as
 * "waiting for the bank".
 */
export class RecordDepositDto {
  @ApiProperty({
    example: '12345678901',
    description: 'MoMo transaction ID from the confirmation SMS',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(40)
  momoTransactionId!: string;

  @ApiProperty({ example: 30000, description: 'Whole RWF' })
  @IsInt()
  @Min(100)
  amountRwf!: number;

  @ApiPropertyOptional({
    enum: BUCKETS,
    description:
      'Put it all in one bucket. Omit to use your default split (loan first).',
  })
  @IsOptional()
  @IsIn(BUCKETS)
  bucket?: (typeof BUCKETS)[number];

  @ApiPropertyOptional({
    description: 'When the deposit happened. Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

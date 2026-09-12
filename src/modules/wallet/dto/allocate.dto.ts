import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BUCKETS } from '../wallet.rules';

/** Move a label between buckets. No money moves. */
export class AllocateDto {
  @ApiProperty({ enum: BUCKETS })
  @IsIn(BUCKETS)
  from!: (typeof BUCKETS)[number];

  @ApiProperty({ enum: BUCKETS })
  @IsIn(BUCKETS)
  to!: (typeof BUCKETS)[number];

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(1)
  amountRwf!: number;

  @ApiPropertyOptional({
    description: 'Required when staff move money out of LOAN.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

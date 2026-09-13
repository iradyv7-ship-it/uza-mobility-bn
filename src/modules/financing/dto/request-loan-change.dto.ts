import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanChangeType } from '@prisma/client';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * A lender proposing a change to a loan they cannot edit directly — see LoanChangeRequest's
 * doc comment in schema.prisma for why this exists at all.
 */
export class RequestLoanChangeDto {
  @ApiProperty({ enum: LoanChangeType })
  @IsEnum(LoanChangeType)
  changeType!: LoanChangeType;

  @ApiProperty({
    description:
      'Shape depends on changeType: { toTenorMonths } | { contributionRwf } | { vehiclePriceRwf }',
    example: { toTenorMonths: 60 },
  })
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

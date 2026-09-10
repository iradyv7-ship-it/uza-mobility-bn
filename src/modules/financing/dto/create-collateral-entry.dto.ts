import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollateralEntryKind } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class CreateCollateralEntryDto {
  @ApiProperty({ enum: CollateralEntryKind })
  @IsEnum(CollateralEntryKind)
  kind!: CollateralEntryKind;

  @ApiProperty()
  @IsInt()
  @IsPositive()
  amountRwf!: number;

  @ApiPropertyOptional({
    description:
      "Set when this entry is UZA Empower's equity top-up for one specific candidate's " +
      'vehicle purchase, rather than a bank-wide facility deposit.',
  })
  @IsOptional()
  @IsString()
  loanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

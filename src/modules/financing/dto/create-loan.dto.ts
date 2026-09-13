import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class LoanVehicleInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  chassisNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  make?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1990)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  plate?: string;
}

/**
 * Originating a loan directly — the code path that did not exist anywhere in this repo
 * (see docs/mobility-audit.md's finding on this). Deliberately staff-only: a loan this
 * way is UZA's own record of "this person is in this programme, financed for this
 * vehicle," independent of whether the bank has issued its formal decision yet — decisions
 * are still recorded through LenderController, on their own timeline.
 */
export class CreateLoanDto {
  @ApiProperty({
    description: 'Existing UZA Mobility user id for the borrower.',
  })
  @IsString()
  borrowerUserId!: string;

  @ApiProperty({ example: 'unguka' })
  @IsString()
  lenderKey!: string;

  @ApiProperty()
  @IsInt()
  @IsPositive()
  vehiclePriceRwf!: number;

  @ApiProperty({
    description:
      "The borrower's own cash contribution toward the vehicle price.",
  })
  @IsInt()
  @Min(0)
  clientContributionRwf!: number;

  @ApiProperty({ example: 60 })
  @IsInt()
  @IsPositive()
  tenorMonths!: number;

  @ApiPropertyOptional({
    enum: LoanStatus,
    description:
      'Defaults to PENDING — UZA has selected this person; the bank has not yet decided.',
  })
  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;

  @ApiProperty({ type: LoanVehicleInputDto })
  @ValidateNested()
  @Type(() => LoanVehicleInputDto)
  vehicle!: LoanVehicleInputDto;
}

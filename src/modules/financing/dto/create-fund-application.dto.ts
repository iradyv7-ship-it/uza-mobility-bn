import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * The UZA Empower fund application, as a taxi driver answers it.
 *
 * Almost every field is optional, deliberately. A driver sitting at a table must never be
 * blocked from starting because they cannot remember a licence expiry — the form saves as
 * a DRAFT with whatever is known, and `assertSubmittable` decides what has to be there
 * before it can be signed. Validation at the door and validation at signature are
 * different jobs, and conflating them is how a form becomes an obstacle.
 *
 * Amounts are whole RWF. There is no minor unit in circulation and a decimal on a form
 * invites somebody to write one.
 */
export class CreateFundApplicationDto {
  // --- Identity -----------------------------------------------------------------
  @ApiProperty({ example: 'Mukamana Alice' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ description: 'Rwandan national ID' })
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  nationalId!: string;

  @ApiProperty({ example: '+250788000000' })
  @IsString()
  @MinLength(8)
  @MaxLength(24)
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(24)
  alternatePhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: ['FEMALE', 'MALE', 'PREFER_NOT_TO_SAY'] })
  @IsOptional()
  @IsIn(['FEMALE', 'MALE', 'PREFER_NOT_TO_SAY'])
  gender?: 'FEMALE' | 'MALE' | 'PREFER_NOT_TO_SAY';

  @ApiProperty({ example: 'Nyarugenge' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  district!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sector?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  cell?: string;

  // --- Driving ------------------------------------------------------------------
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  licenceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  licenceCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  licenceExpiry?: string;

  @ApiPropertyOptional({ description: 'Years driving for a living' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  yearsDriving?: number;

  @ApiPropertyOptional({
    enum: ['OWNS', 'RENTS', 'DRIVES_FOR_EMPLOYER', 'NONE'],
  })
  @IsOptional()
  @IsIn(['OWNS', 'RENTS', 'DRIVES_FOR_EMPLOYER', 'NONE'])
  currentVehicle?: 'OWNS' | 'RENTS' | 'DRIVES_FOR_EMPLOYER' | 'NONE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  currentPlate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  associationName?: string;

  // --- Income, whole RWF --------------------------------------------------------
  @ApiPropertyOptional({
    description:
      'Self-declared. Becomes verified only through the wallet record.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  averageDailyTakingsRwf?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(7)
  workingDaysPerWeek?: number;

  @ApiPropertyOptional({
    description: 'What renting a vehicle currently costs per day',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentDailyRentalRwf?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  otherMonthlyIncomeRwf?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  dependants?: number;

  // --- Savings and banking ------------------------------------------------------
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentSavingsRwf?: number;

  @ApiPropertyOptional({
    enum: ['BANK', 'SACCO', 'MOBILE_MONEY', 'CASH_AT_HOME', 'NONE'],
  })
  @IsOptional()
  @IsIn(['BANK', 'SACCO', 'MOBILE_MONEY', 'CASH_AT_HOME', 'NONE'])
  savingsHeldAt?: 'BANK' | 'SACCO' | 'MOBILE_MONEY' | 'CASH_AT_HOME' | 'NONE';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlySavingCapacityRwf?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasBankAccount?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(24)
  mobileMoneyNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasBorrowedBefore?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  currentlyRepayingLoan?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  currentLoanDetail?: string;

  // --- What they are applying for -----------------------------------------------
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cohortId?: string;

  @ApiPropertyOptional({ description: 'Preferred repayment term in months' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(12)
  @Max(60)
  preferredTenorMonths?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  depositAvailableRwf?: number;

  @ApiPropertyOptional({ example: 'unguka' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  preferredLenderKey?: string;

  // --- Declarations --------------------------------------------------------------
  //
  // Three separate agreements, never one tickbox. Bundling consents is what makes them
  // unenforceable.
  @ApiPropertyOptional({ description: 'The answers given are true' })
  @IsOptional()
  @IsBoolean()
  declarationAccepted?: boolean;

  @ApiPropertyOptional({
    description: 'UZA may keep and process the training record',
  })
  @IsOptional()
  @IsBoolean()
  dataProcessingConsentGiven?: boolean;

  @ApiPropertyOptional({ description: 'The named lender may read this file' })
  @IsOptional()
  @IsBoolean()
  lenderConsentGiven?: boolean;

  @ApiPropertyOptional({
    enum: ['SELF_SERVICE', 'ASSISTED'],
    description:
      'ASSISTED means a staff member read the form aloud in Kinyarwanda and recorded the answers.',
  })
  @IsOptional()
  @IsIn(['SELF_SERVICE', 'ASSISTED'])
  completionMode?: 'SELF_SERVICE' | 'ASSISTED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  assistedByRef?: string;
}

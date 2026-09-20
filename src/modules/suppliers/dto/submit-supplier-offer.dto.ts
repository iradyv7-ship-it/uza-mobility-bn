import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierOfferCondition, SupplierOfferKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * One available option a supplier is offering — a vehicle, or a line of spare parts.
 *
 * Almost everything is optional because an offer is not a commitment: a supplier listing
 * stock often has no VIN, no firm price and no mileage reading yet, and refusing the whole
 * submission over a missing field is how a portal stops being used. What IS required is
 * enough to know what is being offered at all: brand and model.
 *
 * Money is integer minor units, like everywhere else in this schema — never a float, and
 * never a decimal on a form.
 */
export class SubmitSupplierOfferDto {
  @ApiPropertyOptional({
    enum: SupplierOfferKind,
    default: SupplierOfferKind.VEHICLE,
  })
  @IsOptional()
  @IsEnum(SupplierOfferKind)
  kind?: SupplierOfferKind;

  @ApiPropertyOptional({
    description:
      'Chassis / VIN, if one is already allocated. 17 characters, never I, O or Q. Leave empty if the unit has no VIN yet.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  vin?: string;

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @Length(1, 80)
  brand!: string;

  @ApiProperty({ example: 'bZ4X' })
  @IsString()
  @Length(1, 120)
  model!: string;

  @ApiPropertyOptional({ example: 2022 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ example: 'White' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  colour?: string;

  @ApiPropertyOptional({
    enum: SupplierOfferCondition,
    default: SupplierOfferCondition.USED,
  })
  @IsOptional()
  @IsEnum(SupplierOfferCondition)
  condition?: SupplierOfferCondition;

  @ApiPropertyOptional({ example: 34000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  mileageKm?: number;

  @ApiPropertyOptional({
    example: 92,
    description: 'Measured battery state of health, not claimed.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  batterySohPct?: number;

  @ApiPropertyOptional({
    example: 'Front bumper resprayed 2024, no structural damage.',
    description:
      'Accident and repair history in your own words. Leaving this empty records NOT STATED — it is not read as "none".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accidentHistory?: string;

  @ApiPropertyOptional({ description: 'Spare parts only.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  partNumber?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity?: number;

  @ApiPropertyOptional({
    example: 1850000,
    description:
      'Indicative price in MINOR units of the currency (1850000 = 18,500.00). Not binding.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  indicativePriceMinor?: number;

  @ApiPropertyOptional({
    example: 'USD',
    description: "Defaults to the supplier's own default currency.",
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency is a 3-letter ISO code' })
  currency?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  availableFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

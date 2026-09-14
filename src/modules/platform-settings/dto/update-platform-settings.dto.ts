import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpdatePlatformSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  bookingFeeUsd?: number;

  /** The contracted per-visit inspection fee (whole RWF, never a float — see
   * inspection-economics.ts). Floored at 1,000 and capped at 500,000 as a sanity check
   * against a fat-fingered entry, not a real business limit. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(500_000)
  inspectionRateRwf?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  companyLegalName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  companyBankName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  companyAccountNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  companyBankNameRwf?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  companyAccountNumberRwf?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  companyWhatsappNumber?: string;

  /** Static markup % applied on top of the API USDT→RWF rate. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  rwfMarkupPercent?: number;
}

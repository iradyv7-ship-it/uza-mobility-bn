import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Staff opening a wallet for a participant, by UZA ID, against the account the participant
 * holds at the licensed institution. Only the last four digits of the account ever enter
 * this system.
 */
export class OpenWalletDto {
  @ApiProperty({ example: 'UZA-P-2026-000141' })
  @IsString()
  @MinLength(6)
  uzaId!: string;

  @ApiProperty({ example: 'Unguka Bank (LOLC)' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  institutionName!: string;

  @ApiProperty({ example: '••••4821', description: 'Last four digits only' })
  @IsString()
  @Matches(/^(\D*)?\d{4}$/, {
    message:
      'Give the last four digits only — the full account number must never be entered here.',
  })
  accountLastFour!: string;

  @ApiPropertyOptional({
    example: 29393,
    description: 'Instalment ÷ 26 working days',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  dailyTargetRwf?: number;

  @ApiPropertyOptional({
    example: 2350000,
    description: 'The band contribution for the target vehicle',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  contributionTargetRwf?: number;
}

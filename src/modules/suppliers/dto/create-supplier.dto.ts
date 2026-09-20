import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierKind, SupplierStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * A supplier as UZA staff record one — Mento, Mediateur, a factory.
 *
 * `legalName` is the exact registered name and not a trading name, because
 * `SupplierBankAccount.accountName` must equal it: a company invoice paid into an account
 * in another name has no audit trail and no counterparty.
 */
export class CreateSupplierDto {
  @ApiProperty({
    example: 'SUP-MENTO',
    description: 'Short stable code used in references. Upper case.',
  })
  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'code is upper-case letters, digits and hyphens only',
  })
  code!: string;

  @ApiProperty({
    example: 'Mento Auto Export Ltd',
    description: 'The exact registered name — payments must match it.',
  })
  @IsString()
  @Length(2, 200)
  legalName!: string;

  @ApiProperty({ enum: SupplierKind, example: SupplierKind.EXPORTER })
  @IsEnum(SupplierKind)
  kind!: SupplierKind;

  @ApiPropertyOptional({
    enum: SupplierStatus,
    description:
      'Defaults to PROSPECT. A supplier becomes ACTIVE deliberately, not on creation.',
  })
  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;

  @ApiProperty({
    example: 'Japan',
    description: 'Where the CONTRACTING entity is registered.',
  })
  @IsString()
  @Length(2, 80)
  country!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  registrationNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional({ example: '+81312345678' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'sales@example.com' })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: 'USD', description: 'ISO 4217, upper case.' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'defaultCurrency is a 3-letter ISO code' })
  defaultCurrency?: string;
}

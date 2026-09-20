import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierKind } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * A supplier applying to UZA, in one form.
 *
 * Deliberately shaped like `RegisterDto`: the person filling this in gets an ordinary UZA
 * User account with the SUPPLIER_PORTAL role, not a second parallel identity system. What
 * they do NOT get from this endpoint is any access — the Supplier lands as PROSPECT and
 * the `CounterpartyAccess` grant is written only when staff approve. Until then the
 * account can sign in and see its own application and nothing else.
 *
 * No `code` field: the supplier does not choose their own reference. Staff assign it at
 * approval, or the service derives one from the legal name.
 */
export class RegisterSupplierDto {
  // --- The company -----------------------------------------------------------------
  @ApiProperty({
    example: 'Mento Auto Export Ltd',
    description:
      'Your exact registered name, as it appears on your bank account.',
  })
  @IsString()
  @Length(2, 200)
  legalName!: string;

  @ApiProperty({ enum: SupplierKind, example: SupplierKind.EXPORTER })
  @IsEnum(SupplierKind)
  kind!: SupplierKind;

  @ApiProperty({
    example: 'Japan',
    description: 'Where the contracting entity is registered.',
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

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;

  // --- The person who will sign in ---------------------------------------------------
  @ApiProperty({ example: 'sales@mentoauto.example' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPassword123!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Kenji' })
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty({ example: 'Sato' })
  @IsString()
  @Length(1, 100)
  lastName!: string;

  @ApiPropertyOptional({ example: '+81312345678' })
  @IsOptional()
  @IsString()
  @Length(3, 32)
  phone?: string;

  @ApiPropertyOptional({ example: 'en', enum: ['en', 'fr', 'rw'] })
  @IsOptional()
  @IsString()
  @IsIn(['en', 'fr', 'rw'])
  preferredLanguage?: string;
}

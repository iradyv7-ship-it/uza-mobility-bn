import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Staff creating an account on someone else's behalf — a driver, a bank officer, a
 * workshop partner — with a temporary password the API generates and returns exactly
 * once. Distinct from self-registration (`POST auth/register`), which requires the
 * person to already have chosen their own password. The returned account has
 * `mustChangePassword: true`.
 */
export class CreateAdminAccountDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    type: [String],
    example: ['LENDER_UNGUKA'],
    description: 'Role names to grant on creation.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roles!: string[];
}

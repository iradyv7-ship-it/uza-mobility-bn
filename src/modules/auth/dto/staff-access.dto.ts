import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class VerifyAdminLoginDto {
  @ApiProperty()
  @IsString()
  @Length(10, 64)
  challengeId!: string;

  @ApiProperty({ example: '482913', description: 'The six-digit code from the email' })
  @IsString()
  @Length(6, 8)
  code!: string;
}

export class CreateStaffInviteDto {
  @ApiProperty({ example: 'scorah@uzasolutions.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: ['INTAKE_OFFICER'], description: 'Staff role names, or LENDER_<KEY>' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roles!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class RedeemStaffInviteDto {
  @ApiProperty({ example: 'UZA-7K4M-2QXP' })
  @IsString()
  @Length(8, 20)
  code!: string;
}

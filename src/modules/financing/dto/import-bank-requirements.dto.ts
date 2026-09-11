import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ImportBankRequirementsDto {
  @ApiProperty({
    description:
      'The document-requirements email pasted verbatim from the bank. Greetings, ' +
      'signatures and quoted headers are stripped automatically.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(20_000)
  text!: string;
}

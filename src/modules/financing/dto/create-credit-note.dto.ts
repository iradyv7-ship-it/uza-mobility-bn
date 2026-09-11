import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCreditNoteDto {
  @ApiProperty({
    description: 'Bank-internal only. UZA staff can never read this field.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note!: string;
}

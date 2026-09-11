import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AnswerInfoRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  answer!: string;
}

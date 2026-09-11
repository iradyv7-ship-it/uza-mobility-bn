import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AskInfoRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  question!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AssignTaskDto {
  @ApiProperty({ description: 'The user id of the person the task is for.' })
  @IsString()
  assigneeUserId!: string;

  @ApiProperty({
    description: 'Short task title, e.g. "Follow up: Twara EV batch 1".',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'What needs to happen.' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  body!: string;

  @ApiProperty({
    description: 'Deadline, ISO 8601. The task is overdue after this.',
  })
  @IsDateString()
  dueAt!: string;

  @ApiPropertyOptional({
    description:
      'Free-form pointer to what this task is about, e.g. "loan:cli123" or "batch:twara-ev-1".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  entityRef?: string;
}

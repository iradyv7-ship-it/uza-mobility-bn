import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class UploadComfortLetterTemplateDto {
  @ApiProperty({
    description:
      "The bank's own comfort-letter template — uploaded once, reused for every loan this bank approves.",
  })
  @IsUrl()
  fileUrl!: string;
}

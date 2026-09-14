import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class UploadComfortLetterDto {
  @ApiProperty({
    description:
      'Where the signed, scanned comfort letter actually lives (object storage URL) — the bank prints its template, signs it, scans it, and this is that file.',
  })
  @IsUrl()
  fileUrl!: string;

  @ApiPropertyOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  notes?: string;
}

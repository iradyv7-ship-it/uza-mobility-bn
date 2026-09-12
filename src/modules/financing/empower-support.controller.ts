import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupportPlanDto } from './dto/support-plan.dto';
import {
  parseCsv,
  planSupport,
  planToCsv,
  rowsFromCells,
  type SupportPlan,
} from './empower-support.rules';

/**
 * What UZA Empower puts in, per client and in total — from rows, or from the spreadsheet a
 * finance officer already has.
 *
 * Staff only. This is the number the facility is sized to and it names clients; a lender
 * sees the pledged amount on a loan through its own portal, never this plan.
 */
@ApiTags('financing')
@ApiBearerAuth('JWT-access')
@Controller('financing/empower/support-plan')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'FINANCE_ADMIN')
export class EmpowerSupportController {
  @Post()
  @ApiOperation({
    summary:
      'Size UZA Empower support for a list of clients: required contribution by band, what the driver has, the gap UZA places, the facility and the daily figure',
  })
  plan(
    @Body() dto: SupportPlanDto,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(planSupport(dto.rows), [], format, res);
  }

  @Post('import')
  @ApiOperation({
    summary:
      'The same, from a CSV or Excel file. Columns are matched by name — "UZA ID", "Vehicle", "Vehicle price (RWF)", "Has RWF", "% of 10%", "Tenor" all work',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async importFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file)
      throw new BadRequestException('Attach a .csv or .xlsx file as "file".');
    const name = (file.originalname || '').toLowerCase();

    let records: Record<string, unknown>[];
    if (name.endsWith('.csv') || file.mimetype === 'text/csv') {
      records = parseCsv(file.buffer.toString('utf8'));
    } else if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
      records = await readFirstSheet(file.buffer);
    } else {
      throw new BadRequestException(
        `Unsupported file "${file.originalname}". Send .csv or .xlsx.`,
      );
    }

    const { inputs, skipped } = rowsFromCells(records);
    if (!inputs.length) {
      throw new BadRequestException(
        `No usable rows. ${skipped.length} row(s) skipped: ${skipped
          .slice(0, 5)
          .map((s) => `row ${s.row} (${s.reason})`)
          .join(
            ', ',
          )}. The sheet needs a price column and either an amount or a percentage column.`,
      );
    }
    return this.respond(planSupport(inputs), skipped, format, res);
  }

  private respond(
    plan: SupportPlan,
    skipped: { row: number; reason: string }[],
    format: string | undefined,
    res: Response,
  ) {
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="uza-empower-support-plan-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return planToCsv(plan);
    }
    return { ...plan, skipped };
  }
}

/** First worksheet → keyed rows, header row first. Dates and rich text flattened to text. */
async function readFirstSheet(
  buffer: Buffer,
): Promise<Record<string, unknown>[]> {
  // exceljs is CommonJS; under a compiled dynamic import the module lands on `.default`.
  const mod = (await import('exceljs')) as unknown as {
    default?: typeof import('exceljs');
    Workbook?: typeof import('exceljs').Workbook;
  };
  const Workbook = mod.Workbook ?? mod.default?.Workbook;
  if (!Workbook) throw new Error('exceljs failed to load');
  const wb = new Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col] = String(cell.text ?? cell.value ?? '').trim();
  });
  const out: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const rec: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const h = headers[col];
      if (!h) return;
      const v = cell.value;
      rec[h] =
        typeof v === 'object' && v !== null && 'result' in v
          ? (v as { result: unknown }).result
          : typeof v === 'object' && v !== null && 'richText' in v
            ? cell.text
            : v;
    });
    if (Object.keys(rec).length) out.push(rec);
  });
  return out;
}

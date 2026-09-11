import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import {
  DEFAULT_BANK_FILE_ITEMS,
  type RequiredBankFileItem,
} from '../bank-files/default-bank-file-items';
import { parseEmailRequirements } from './document-requirements.parser';

/**
 * Per-institution document requirements — the data that used to be a code change to
 * `bank-files/bank-file-generator.service.ts`.
 *
 * A bank with rows in `LenderRequirement` gets its own checklist; a bank with none gets
 * `DEFAULT_BANK_FILE_ITEMS`, the same eleven items the platform has always required. The
 * fallback is deliberate and permanent, not a migration step to remove later: it is what
 * lets a partner's configuration be deleted without ever leaving a file with zero
 * requirements (see `resolveRequiredItems`).
 *
 * `BankFile` records its lender as a free-text `lenderName` rather than a `bankId`
 * foreign key (a decision this service did not make and is not in scope to change), so
 * resolution below matches on `Bank.name` case-insensitively. A bank with no matching
 * name row simply falls back to the UZA default, the same as a bank with no requirements
 * configured — the two "we don't know this lender's own list" cases collapse into one
 * safe answer instead of two.
 */
@Injectable()
export class LenderRequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** The requirement list a `BankFile` for this lender name should be built against. */
  async resolveRequiredItems(
    lenderName: string,
  ): Promise<RequiredBankFileItem[]> {
    const bank = await this.prisma.bank.findFirst({
      where: { name: { equals: lenderName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!bank) return [...DEFAULT_BANK_FILE_ITEMS];

    const rows = await this.prisma.lenderRequirement.findMany({
      where: { bankId: bank.id },
      orderBy: { sortOrder: 'asc' },
    });
    if (rows.length === 0) return [...DEFAULT_BANK_FILE_ITEMS];

    return rows.map((row) => ({
      code: row.code,
      label: row.label,
      source: row.source,
    }));
  }

  /** The bank's own configured list, exactly as stored (for the admin editor). */
  async listForBank(bankId: string) {
    await this.requireBank(bankId);
    return this.prisma.lenderRequirement.findMany({
      where: { bankId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Parse a pasted email and REPLACE this bank's requirement list with the result.
   *
   * Replace rather than merge: a bank pasting an updated checklist means "this is the
   * list now", and silently keeping stale rows from a superseded email is the same
   * failure mode `Loan.clientContributionRwf`'s own doc comment warns about elsewhere in
   * this codebase — a number nobody remembers to update. The parse happens before
   * anything is deleted, so a paste that recognises nothing leaves the existing list
   * untouched instead of wiping it.
   */
  async importFromEmail(
    bankId: string,
    text: string,
    actorUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    await this.requireBank(bankId);

    const parsed = parseEmailRequirements(text);
    if (parsed.length === 0) {
      return {
        imported: 0,
        items: await this.listForBank(bankId),
        recognised: false,
      };
    }

    const items = await this.prisma.$transaction(async (tx) => {
      await tx.lenderRequirement.deleteMany({ where: { bankId } });
      await tx.lenderRequirement.createMany({
        data: parsed.map((r, index) => ({
          bankId,
          code: r.code,
          label: r.label,
          guidance: r.guidance || null,
          required: r.required,
          sortOrder: (index + 1) * 10,
        })),
      });
      return tx.lenderRequirement.findMany({
        where: { bankId },
        orderBy: { sortOrder: 'asc' },
      });
    });

    await this.auditService.record({
      userId: actorUserId,
      action: 'lender-requirements:imported',
      entity: 'LenderRequirement',
      entityId: bankId,
      metadata: {
        bankId,
        count: items.length,
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return { imported: items.length, items, recognised: true };
  }

  private async requireBank(bankId: string) {
    const bank = await this.prisma.bank.findUnique({ where: { id: bankId } });
    if (!bank) throw new NotFoundException('Bank not found');
    return bank;
  }
}

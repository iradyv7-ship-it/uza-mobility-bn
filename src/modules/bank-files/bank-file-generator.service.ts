import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ItemSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LenderRequirementsService } from '../financing/lender-requirements.service';

/**
 * Produces the bank-file items the platform already knows the answer to.
 *
 * Eleven documents per applicant, and at sixty units a week that is 693 a week. There is
 * no headcount answer to that — two more officers doubles the throughput and doubles the
 * error rate. The way out is that most of the eleven are not documents at all. They are
 * facts already sitting in the database: who the person is, what they scored, what they
 * contributed, which vehicle they were allocated, what the product terms were that day.
 *
 * So each item carries a `source`. `generated` items cost nothing per file and are
 * produced here. `uploaded` and `external` items cost a person's attention and are
 * deliberately left alone — this service will never mark one present, because pretending
 * a national ID exists is worse than knowing it does not.
 *
 * Every generator returns null when the underlying fact is genuinely absent. A file that
 * says an item is missing when it is missing is the entire value of the model; a
 * generator that invents a plausible placeholder would destroy it in one run.
 */
@Injectable()
export class BankFileGeneratorService {
  private readonly logger = new Logger(BankFileGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requirements: LenderRequirementsService,
  ) {}

  /**
   * Bring this file's `BankFileItem` rows in line with what its lender actually
   * requires — additively.
   *
   * This is the readiness check's connection to `LenderRequirement`: a file opened
   * before a bank had its own configured list, or a bank whose list has grown since,
   * gets any newly-required item added as `present: false`, exactly as if it had been
   * there from the start. Never removes a row, even one no longer on the resolved list —
   * an item a lender no longer asks for is not evidence that should disappear, and a
   * bank's list can always be corrected without punishing every file already collected
   * against the old one. A bank with no configured list resolves to
   * `DEFAULT_BANK_FILE_ITEMS`, so this is always safe to run.
   */
  async syncRequiredItems(bankFileRef: string): Promise<{
    ref: string;
    added: string[];
    source: 'bank-specific' | 'uza-default';
  }> {
    const file = await this.prisma.bankFile.findUnique({
      where: { ref: bankFileRef },
      include: { items: { select: { code: true } } },
    });
    if (!file) {
      throw new NotFoundException(`bank file ${bankFileRef} not found`);
    }

    const required = await this.requirements.resolveRequiredItems(
      file.lenderName,
    );
    const existingCodes = new Set(file.items.map((i) => i.code));
    const missing = required.filter((r) => !existingCodes.has(r.code));

    if (missing.length > 0) {
      await this.prisma.bankFileItem.createMany({
        data: missing.map((item) => ({
          bankFileId: file.id,
          code: item.code,
          label: item.label,
          source: item.source,
        })),
        skipDuplicates: true,
      });
      await this.prisma.bankFileEvent.create({
        data: {
          bankFileId: file.id,
          kind: 'item_added',
          detail: `requirements synced: ${missing.map((m) => m.code).join(', ')}`,
        },
      });
    }

    const bank = await this.prisma.bank.findFirst({
      where: { name: { equals: file.lenderName, mode: 'insensitive' } },
      select: { id: true },
    });
    const hasOwnList = bank
      ? (await this.prisma.lenderRequirement.count({
          where: { bankId: bank.id },
        })) > 0
      : false;

    return {
      ref: file.ref,
      added: missing.map((m) => m.code),
      source: hasOwnList ? 'bank-specific' : 'uza-default',
    };
  }

  /**
   * Generate everything generatable for one file.
   *
   * Idempotent: an item already present is left untouched, so this can run on a schedule,
   * on demand, or after every upload without any coordination.
   */
  async generateForFile(bankFileRef: string): Promise<{
    ref: string;
    generated: string[];
    stillMissing: { code: string; source: ItemSource; reason: string }[];
    readyToSubmit: boolean;
  }> {
    const file = await this.prisma.bankFile.findUnique({
      where: { ref: bankFileRef },
      include: { items: true },
    });
    if (!file)
      throw new NotFoundException(`bank file ${bankFileRef} not found`);

    const generated: string[] = [];
    const stillMissing: { code: string; source: ItemSource; reason: string }[] =
      [];

    for (const item of file.items) {
      if (item.present) continue;
      if (item.source !== 'generated') {
        stillMissing.push({
          code: item.code,
          source: item.source,
          reason:
            item.source === 'external'
              ? 'must be fetched from a third party'
              : 'somebody has to obtain and attach it',
        });
        continue;
      }

      const result = await this.produce(item.code, file.uzaId, file.ref);
      if (result === null) {
        stillMissing.push({
          code: item.code,
          source: item.source,
          reason: this.whyNot(item.code),
        });
        continue;
      }

      await this.prisma.bankFileItem.update({
        where: { id: item.id },
        data: {
          present: true,
          generatedAt: new Date(),
          documentUrl: null,
          queryNote: null,
        },
      });
      await this.prisma.bankFileEvent.create({
        data: {
          bankFileId: file.id,
          kind: 'item_added',
          detail: `${item.code} generated`,
        },
      });
      generated.push(item.code);
    }

    const ready = stillMissing.length === 0;
    if (ready && file.status === 'building') {
      await this.prisma.bankFile.update({
        where: { id: file.id },
        data: { status: 'ready' },
      });
      await this.prisma.bankFileEvent.create({
        data: {
          bankFileId: file.id,
          kind: 'marked_ready',
          detail: 'every item present',
        },
      });
    }

    return { ref: file.ref, generated, stillMissing, readyToSubmit: ready };
  }

  /**
   * Run across every file still building.
   *
   * Sequential rather than parallel on purpose: this touches the same handful of tables
   * for every file, and forty concurrent transactions on a shared pool buys nothing but
   * lock contention. It is fast because each file is a handful of reads, not because it
   * fans out.
   */
  async generateForAll(): Promise<{
    files: number;
    itemsGenerated: number;
    nowReady: number;
    blockedBy: Record<string, number>;
  }> {
    const building = await this.prisma.bankFile.findMany({
      where: { status: 'building' },
      select: { ref: true },
      orderBy: { createdAt: 'asc' },
    });

    let itemsGenerated = 0;
    let nowReady = 0;
    const blockedBy: Record<string, number> = {};

    for (const { ref } of building) {
      const r = await this.generateForFile(ref);
      itemsGenerated += r.generated.length;
      if (r.readyToSubmit) nowReady += 1;
      for (const m of r.stillMissing)
        blockedBy[m.code] = (blockedBy[m.code] ?? 0) + 1;
    }

    this.logger.log(
      `bank files: ${building.length} scanned, ${itemsGenerated} items generated, ${nowReady} now ready`,
    );
    return { files: building.length, itemsGenerated, nowReady, blockedBy };
  }

  /**
   * One item. Returns null when the underlying fact does not exist yet, which is a real
   * answer and not a failure.
   */
  private async produce(
    code: string,
    uzaId: string,
    fileRef: string,
  ): Promise<true | null> {
    switch (code) {
      case 'APPLICATION_FORM': {
        // The form is the person's own details. It exists the moment they do.
        const user = await this.prisma.user.findFirst({
          where: { uzaId },
          select: { id: true },
        });
        return user ? true : null;
      }

      case 'TRAINING_CERTIFICATE': {
        const cert = await this.prisma.certificate.findFirst({
          where: { user: { uzaId } },
          select: { id: true },
        });
        return cert ? true : null;
      }

      case 'READINESS_SCORE': {
        // Only the current snapshot counts. Readiness is immutable per computation
        // precisely so a bank can see the score as it stood when the file was submitted.
        const score = await this.prisma.readinessScore.findFirst({
          where: { user: { uzaId }, isCurrent: true },
          select: { id: true },
        });
        return score ? true : null;
      }

      case 'INCOME_EVIDENCE': {
        // Measured daily net, not a claim on a form. A placement with recorded days is
        // the evidence; a placement with none is an intention.
        //
        // Reads the denormalised rollup rather than counting day rows — the schema keeps
        // `daysOperated` current on every write specifically so the readiness engine and
        // the pipeline never scan placement_days, and this is the same query shape.
        const placement = await this.prisma.placementProgramme.findFirst({
          where: { user: { uzaId }, daysOperated: { gt: 0 } },
          select: { id: true },
        });
        return placement ? true : null;
      }

      case 'VEHICLE_ALLOCATION': {
        // A promise of a specific unit, still live. A lapsed or declined allocation is
        // not an allocation.
        const alloc = await this.prisma.allocation.findFirst({
          where: {
            queue: { uzaId },
            status: { in: ['promised', 'confirmed', 'fulfilled'] },
          },
          select: { id: true },
        });
        return alloc ? true : null;
      }

      case 'PROFORMA': {
        // Derived from the allocated unit's landed cost and the product terms. Without an
        // allocation there is no vehicle to quote.
        const alloc = await this.prisma.allocation.findFirst({
          where: {
            queue: { uzaId },
            status: { in: ['promised', 'confirmed', 'fulfilled'] },
          },
          select: { unit: { select: { landedCostRwf: true } } },
        });
        return alloc?.unit?.landedCostRwf != null ? true : null;
      }

      case 'INSURANCE_QUOTE': {
        // Comprehensive cover is a percentage of vehicle value, so it needs the value.
        // Same dependency as the proforma, stated separately because the bank asks for
        // them separately.
        const file = await this.prisma.bankFile.findUnique({
          where: { ref: fileRef },
          select: { pricePaidRwf: true },
        });
        if (file?.pricePaidRwf != null) return true;
        const alloc = await this.prisma.allocation.findFirst({
          where: {
            queue: { uzaId },
            status: { in: ['promised', 'confirmed', 'fulfilled'] },
          },
          select: { unit: { select: { landedCostRwf: true } } },
        });
        return alloc?.unit?.landedCostRwf != null ? true : null;
      }

      default:
        // An unknown generated code is a bug in the item list, not a missing document.
        this.logger.warn(
          `no generator for item code ${code} — it is marked generated but nothing produces it`,
        );
        return null;
    }
  }

  /** Why a generated item could not be produced. Written for the officer, not the log. */
  private whyNot(code: string): string {
    switch (code) {
      case 'APPLICATION_FORM':
        return 'no user record for this UZA ID';
      case 'TRAINING_CERTIFICATE':
        return 'they have not completed the academy';
      case 'READINESS_SCORE':
        return 'no current readiness snapshot — it needs wallet, academy and placement data first';
      case 'INCOME_EVIDENCE':
        return 'no placement days recorded, so there is no measured daily net';
      case 'VEHICLE_ALLOCATION':
        return 'no vehicle has been promised to them yet';
      case 'PROFORMA':
        return 'no allocated unit with a landed cost';
      case 'INSURANCE_QUOTE':
        return 'no vehicle value to quote against';
      default:
        return 'nothing produces this item';
    }
  }

  /**
   * Where the pipeline is actually stuck, across every open file.
   *
   * The point of this number is that it distinguishes work from waiting. `uploaded` and
   * `external` items are somebody's job today; `generated` items that will not generate
   * are a missing upstream fact, and chasing the officer for those wastes everyone's time.
   */
  async bottleneck(): Promise<{
    openFiles: number;
    outstanding: number;
    bySource: Record<string, number>;
    byItem: { code: string; source: ItemSource; outstanding: number }[];
  }> {
    const rows = await this.prisma.bankFileItem.groupBy({
      by: ['code', 'source'],
      where: { present: false, file: { status: 'building' } },
      _count: { _all: true },
    });
    const openFiles = await this.prisma.bankFile.count({
      where: { status: 'building' },
    });

    const bySource: Record<string, number> = {};
    for (const r of rows)
      bySource[r.source] = (bySource[r.source] ?? 0) + r._count._all;

    return {
      openFiles,
      outstanding: rows.reduce((a, r) => a + r._count._all, 0),
      bySource,
      byItem: rows
        .map((r) => ({
          code: r.code,
          source: r.source,
          outstanding: r._count._all,
        }))
        .sort((a, b) => b.outstanding - a.outstanding),
    };
  }
}

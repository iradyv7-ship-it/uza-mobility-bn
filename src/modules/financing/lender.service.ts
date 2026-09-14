import { Injectable, NotFoundException } from '@nestjs/common';
import type { LoanStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkshopService } from '../workshop/workshop.service';
import { AcademyService } from '../academy/academy.service';
import { worstOf, type Severity } from '../wallet/covenant.rules';
import { CovenantService } from '../wallet/covenant.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Staff roles that do real day-to-day Twara EV / UZA Empower work on a loan file. */
const LOAN_STAFF_ROLES = ['FINANCE_ADMIN', 'INTAKE_OFFICER', 'SUPER_ADMIN'];

/** The loan states the covenant engine evaluates — the same set `CovenantService.forLender` scans. */
const COVENANT_WATCHED_STATUSES: ReadonlySet<LoanStatus> = new Set<LoanStatus>([
  'ACTIVE',
  'IN_ARREARS',
  'DISBURSED',
]);
import type { AskInfoRequestDto } from './dto/ask-info-request.dto';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import type { RecordLenderDecisionDto } from './dto/record-lender-decision.dto';
import type { UploadComfortLetterDto } from './dto/upload-comfort-letter.dto';
import type { UploadComfortLetterTemplateDto } from './dto/upload-comfort-letter-template.dto';
import {
  assertComfortLetterAllowed,
  assertDecisionAllowed,
  loanStatusForDecision,
} from './lender-decision.rules';
import { mayDisclose } from './lender-access';
import type { LenderConfig } from './lenders.registry';
import { summarizeSavings } from './loan-savings.util';

/**
 * What a bank sees about its own loan book.
 *
 * Scoped to `Loan`, not `FinancingRequest` — a `FinancingRequest` is UZA facilitating a
 * buyer's paperwork before any lender has agreed to anything (see financing.service.ts);
 * a `Loan` exists once a bank has actually approved and (usually) disbursed. Keeping the
 * two apart means this file can never show a bank an application it never received.
 *
 * A lender whose `Bank` row has no `lenderKey` set yet, or one with a key but zero loans,
 * gets honest zeroes and empty lists here — not an error. Onboarding a bank in
 * `lenders.registry.ts` is meant to be routine; somebody still has to book its first loan.
 */
@Injectable()
export class LenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workshopService: WorkshopService,
    private readonly academyService: AcademyService,
    private readonly walletService: WalletService,
    private readonly covenantService: CovenantService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async resolveBankId(lender: LenderConfig): Promise<string | null> {
    const bank = await this.prisma.bank.findUnique({
      where: { lenderKey: lender.key },
      select: { id: true },
    });
    return bank?.id ?? null;
  }

  /**
   * The consent gate.
   *
   * Being the lender of record does not, on its own, create permission to read the file —
   * consent under Law N° 058/2021 is specific to the recipient, and the portal tells the
   * bank in writing that files appear only where the borrower consented. Until 12 September
   * 2026 that sentence was true in the UI and false in this file: every borrower with a loan
   * at the bank was returned regardless.
   *
   * Every list below is scoped by this fragment in addition to `bankId`. A borrower with a
   * loan here and no live consent for this lender is simply absent — from the counts as well
   * as the rows, because "3 active loans" above a list of one is itself a disclosure.
   *
   * Consent is matched on the borrower's UZA ID, the identifier the lender actually sees. A
   * borrower without a UZA ID cannot have a matchable consent and is therefore not shown,
   * which is the fail-safe direction.
   */
  private async disclosureScope(
    lender: LenderConfig,
  ): Promise<Prisma.LoanWhereInput> {
    const consents = await this.prisma.lenderConsent.findMany({
      where: { lenderKey: lender.key, withdrawnAt: null, uzaId: { not: null } },
      select: { uzaId: true },
    });
    const uzaIds = consents
      .map((c) => c.uzaId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return { borrower: { uzaId: { in: uzaIds } } };
  }

  /**
   * A loan, only if it belongs to this lender's own bank AND its borrower has a live consent
   * for this lender — the same 404-for-both shape as `LenderAccessGuard` itself. A loan that
   * exists but belongs to another bank, and a loan at this bank whose borrower withdrew
   * consent, must both be indistinguishable from a loan that does not exist at all.
   *
   * The reason is recorded in the audit log, where a lender repeatedly asking about people
   * who are not its borrowers can be told apart from one asking about a borrower who
   * withdrew — while the lender itself learns nothing.
   */
  private async requireOwnLoan(lender: LenderConfig, loanId: string) {
    const bankId = await this.resolveBankId(lender);
    const loan = bankId
      ? await this.prisma.loan.findFirst({
          where: { id: loanId, bankId },
          include: { borrower: { select: { uzaId: true } } },
        })
      : null;

    const exists = loan
      ? true
      : !!(await this.prisma.loan.findUnique({
          where: { id: loanId },
          select: { id: true },
        }));

    const consent = loan?.borrower.uzaId
      ? await this.prisma.lenderConsent.findUnique({
          where: {
            uzaId_lenderKey: {
              uzaId: loan.borrower.uzaId,
              lenderKey: lender.key,
            },
          },
          select: { grantedAt: true, withdrawnAt: true },
        })
      : null;

    const decision = mayDisclose({
      borrowerExists: exists,
      isBorrowerOfThisLender: !!loan,
      consentGivenAt: consent?.grantedAt ?? null,
      consentWithdrawnAt: consent?.withdrawnAt ?? null,
    });

    if (!decision.allowed || !loan) {
      await this.auditService.record({
        userId: null,
        action: 'lender:disclosure-refused',
        entity: 'Loan',
        metadata: { lenderKey: lender.key, loanId, reason: decision.reason },
      });
      throw new NotFoundException();
    }
    return loan;
  }

  /** The equity gap this loan closed: what the vehicle cost, what the buyer brought, and
   *  what UZA Empower topped up to reach it — the latter summed from this loan's own
   *  PLEDGED collateral entries, never stored as a separate, driftable field. */
  private async equityBreakdown(loanId: string) {
    const pledged = await this.prisma.collateralEntry.aggregate({
      where: { loanId, kind: 'PLEDGED' },
      _sum: { amountRwf: true },
    });
    return { uzaTopUpRwf: pledged._sum.amountRwf ?? 0 };
  }

  async summary(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) {
      return {
        applicationsPending: 0,
        activeLoans: 0,
        disbursedTotal: 0,
        arrearsTotal: 0,
      };
    }

    const scope = await this.disclosureScope(lender);
    const [applicationsPending, activeLoans, disbursed, arrears] =
      await Promise.all([
        this.prisma.loan.count({
          where: { bankId, ...scope, status: { in: ['PENDING', 'IN_REVIEW'] } },
        }),
        this.prisma.loan.count({
          where: { bankId, ...scope, status: { in: ['ACTIVE', 'IN_ARREARS'] } },
        }),
        this.prisma.loan.aggregate({
          where: { bankId, ...scope, disbursedAt: { not: null } },
          _sum: { principalRwf: true },
        }),
        this.prisma.loan.aggregate({
          where: { bankId, ...scope },
          _sum: { arrearsRwf: true },
        }),
      ]);

    return {
      applicationsPending,
      activeLoans,
      disbursedTotal: disbursed._sum.principalRwf ?? 0,
      arrearsTotal: arrears._sum.arrearsRwf ?? 0,
    };
  }

  /** Loans not yet decided — the bank's open pipeline. */
  async applications(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const scope = await this.disclosureScope(lender);
    const rows = await this.prisma.loan.findMany({
      where: { bankId, ...scope, status: { in: ['PENDING', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
      include: { borrower: { select: { firstName: true, lastName: true } } },
    });

    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        reference: r.reference,
        applicantName: `${r.borrower.firstName} ${r.borrower.lastName}`.trim(),
        amount: r.principalRwf,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        vehiclePriceRwf: r.vehiclePriceRwf,
        clientContributionRwf: r.clientContributionRwf,
        ...(await this.equityBreakdown(r.id)),
      })),
    );
  }

  /** Every borrower this bank has an active or historical loan relationship with. */
  async borrowers(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const scope = await this.disclosureScope(lender);
    const rows = await this.prisma.loan.findMany({
      where: {
        bankId,
        ...scope,
        status: { notIn: ['PENDING', 'IN_REVIEW', 'DECLINED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        borrower: { select: { uzaId: true, firstName: true, lastName: true } },
      },
    });

    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        uzaId: r.borrower.uzaId ?? '',
        displayName: `${r.borrower.firstName} ${r.borrower.lastName}`.trim(),
        loanRef: r.reference,
        balance: r.outstandingRwf,
        status: r.status,
        vehiclePriceRwf: r.vehiclePriceRwf,
        clientContributionRwf: r.clientContributionRwf,
        ...(await this.equityBreakdown(r.id)),
        ...(await this.covenantBadge(r.id, r.status)),
      })),
    );
  }

  /**
   * The one field per borrower row that says whether the covenant engine has something open
   * on this loan — so an officer reading the borrowers list does not need the warnings page
   * to see who needs a call. Only the lender-facing covenants count, the same filter as
   * `covenantsForLoan`; the row is already inside `disclosureScope`, so consent is honoured.
   * Loans the engine does not watch (closed, written off, not yet disbursed) carry `null`,
   * which the portal renders as nothing rather than as "all clear".
   */
  private async covenantBadge(
    loanId: string,
    status: LoanStatus,
  ): Promise<{ worst: Severity | null; openWarnings: number }> {
    if (!COVENANT_WATCHED_STATUSES.has(status)) {
      return { worst: null, openWarnings: 0 };
    }
    const r = await this.covenantService.runForLoan(loanId, new Date(), false);
    const visible = r.covenants.filter((c) => c.audience.includes('LENDER'));
    return { worst: worstOf(visible), openWarnings: visible.length };
  }

  async disbursements(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const scope = await this.disclosureScope(lender);
    const rows = await this.prisma.loan.findMany({
      where: { bankId, ...scope, disbursedAt: { not: null } },
      orderBy: { disbursedAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      amount: r.principalRwf,
      disbursedAt: r.disbursedAt!.toISOString(),
      status: r.status,
    }));
  }

  /**
   * Grouped by disbursal month, which is the one cohort boundary the data actually
   * carries. `Loan` has no separate "cohort" field to fabricate a grouping from — this
   * one is real, if coarse, and can be refined once there is a reason to.
   */
  async portfolio(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const scope = await this.disclosureScope(lender);
    const rows = await this.prisma.loan.findMany({
      where: { bankId, ...scope, disbursedAt: { not: null } },
      select: { disbursedAt: true, outstandingRwf: true, arrearsRwf: true },
    });

    const byMonth = new Map<
      string,
      { count: number; outstanding: number; arrears: number }
    >();
    for (const r of rows) {
      const cohort = r.disbursedAt!.toISOString().slice(0, 7); // YYYY-MM
      const bucket = byMonth.get(cohort) ?? {
        count: 0,
        outstanding: 0,
        arrears: 0,
      };
      bucket.count += 1;
      bucket.outstanding += r.outstandingRwf;
      bucket.arrears += r.arrearsRwf;
      byMonth.set(cohort, bucket);
    }

    return [...byMonth.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([cohort, bucket]) => ({
        id: cohort,
        cohort,
        count: bucket.count,
        outstanding: bucket.outstanding,
        arrears: bucket.arrears,
      }));
  }

  /**
   * The cash-collateral facility. Only ever called from a route the guard has already
   * confirmed this lender is entitled to (`seesCollateral`) — see lender.controller.ts.
   */
  async creditEnhancement(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return { pledged: 0, released: 0, calledBack: 0 };

    const entries = await this.prisma.collateralEntry.findMany({
      where: { bankId },
      select: { kind: true, amountRwf: true },
    });

    const sum = (kind: 'PLEDGED' | 'RELEASED' | 'CALLED_BACK') =>
      entries
        .filter((e) => e.kind === kind)
        .reduce((total, e) => total + e.amountRwf, 0);

    return {
      pledged: sum('PLEDGED'),
      released: sum('RELEASED'),
      calledBack: sum('CALLED_BACK'),
    };
  }

  /**
   * One of the two data products UZA Empower gives a lender in exchange for financing at
   * better terms than the vehicle alone would justify — see `InspectionsController`. 404s
   * (via `requireOwnLoan`) rather than an empty list for a loan belonging to another
   * bank, same reasoning as everywhere else in this guard chain.
   */
  async inspectionsForLoan(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    return this.workshopService.listInspectionsForLoan(loanId);
  }

  /**
   * The other data product: daily deposits against the loan's required daily figure,
   * with the running surplus/shortfall a lender actually cares about — a candidate
   * consistently ahead of `requiredDailyRwf` is the live signal that they may support
   * more, not just that they can service this loan (see LoanSavingsEntry's own comment).
   */
  /**
   * The FIRST of the data products NCBA asked for: what the borrower was taught, what they
   * passed, and how their loan comprehension held up on re-test. A computed summary — module
   * counts by kind, the latest and previous comprehension scores with the trend, and the
   * warnings a reader should notice — never the recordings, which stay with UZA unless a
   * lender asks for a specific one and the borrower's consent covers it.
   */
  async trainingForLoan(lender: LenderConfig, loanId: string) {
    const loan = await this.requireOwnLoan(lender, loanId);
    return this.academyService.summaryForUser(loan.borrowerUserId);
  }

  /**
   * The THIRD data product: the borrower's daily savings behaviour from the wallet —
   * confirmed deposits only, loan-facing buckets only, the driver's personal savings never.
   * The consistency ratio here is the number the readiness score is built on.
   */
  async walletForLoan(lender: LenderConfig, loanId: string) {
    const loan = await this.requireOwnLoan(lender, loanId);
    return this.walletService.performanceForUser(loan.borrowerUserId);
  }

  /** Open covenant warnings on one loan, as the covenant engine computes them right now. */
  async covenantsForLoan(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    const r = await this.covenantService.runForLoan(loanId, new Date(), false);
    // `worst` must be computed over what the lender is shown, not over everything the engine
    // found — otherwise a UZA-only warning (a stale reconciliation, a coaching flag) leaks as
    // a severity with an empty list, which tells the bank that something exists.
    const visible = r.covenants.filter((c) => c.audience.includes('LENDER'));
    return {
      loanRef: r.loanRef,
      worst: worstOf(visible),
      covenants: visible.map(({ kind, severity, message, detail }) => ({
        kind,
        severity,
        message,
        detail,
      })),
    };
  }

  /** Every open warning across this lender's consenting borrowers — the portal's list. */
  async covenants(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];
    return this.covenantService.forLender(lender.key, bankId);
  }

  async savingsForLoan(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);

    const rows = await this.prisma.loanSavingsEntry.findMany({
      where: { loanId },
      orderBy: { date: 'asc' },
    });

    return summarizeSavings(
      rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        depositedRwf: r.depositedRwf,
        requiredDailyRwf: r.requiredDailyRwf,
      })),
    );
  }

  /**
   * A richer view of `applications()` for the bank's working queue: the same pending /
   * in-review loans, plus whether each one has an information request still awaiting a
   * UZA answer and its latest recorded decision, if any. Parallels `applications()`
   * rather than replacing it — a consumer already calling that endpoint keeps working.
   */
  async queue(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const scope = await this.disclosureScope(lender);
    const rows = await this.prisma.loan.findMany({
      where: { bankId, ...scope, status: { in: ['PENDING', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        borrower: { select: { firstName: true, lastName: true } },
        infoRequests: {
          where: { answeredAt: null },
          select: { id: true, question: true, askedAt: true },
          orderBy: { askedAt: 'desc' },
          take: 1,
        },
        lenderDecisions: {
          select: { outcome: true, decidedAt: true },
          orderBy: { decidedAt: 'desc' },
          take: 1,
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      applicantName: `${r.borrower.firstName} ${r.borrower.lastName}`.trim(),
      amount: r.principalRwf,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      openInfoRequest: r.infoRequests[0] ?? null,
      latestDecision: r.lenderDecisions[0] ?? null,
    }));
  }

  /**
   * Record a credit decision — the structured replacement for silently flipping
   * `Loan.status`. Only moves the loan's own status for APPROVED/REJECTED, and only from
   * a state the bank is actually allowed to decide on; CONDITIONAL leaves status alone
   * (still IN_REVIEW — a conditional approval is not yet a disbursement decision).
   */
  async recordDecision(
    lender: LenderConfig,
    loanId: string,
    dto: RecordLenderDecisionDto,
    actorUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const loan = await this.requireOwnLoan(lender, loanId);
    assertDecisionAllowed(loan.status, dto);

    const nextStatus = loanStatusForDecision(dto.outcome);

    const decision = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lenderDecision.create({
        data: {
          loanId,
          outcome: dto.outcome,
          reasons: dto.reasons,
          conditions: dto.conditions ?? null,
          decidedByRef: actorUserId,
        },
      });

      if (nextStatus) {
        await tx.loan.update({
          where: { id: loanId },
          data: { status: nextStatus },
        });
      }

      return created;
    });

    await this.auditService.record({
      userId: actorUserId,
      action: `lender-decision:${dto.outcome.toLowerCase()}`,
      entity: 'LenderDecision',
      entityId: decision.id,
      metadata: {
        loanId,
        lenderKey: lender.key,
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    // A bank recording a decision used to be silent to everyone but the bank itself --
    // the record existed but nobody at UZA or the borrower found out except by checking.
    // Both audiences learn now, same as every other consequential change on a loan file.
    const outcomeText = dto.outcome.toLowerCase();
    await Promise.all([
      this.notificationsService.sendToRoleNames(LOAN_STAFF_ROLES, {
        type: 'FINANCING_UPDATE',
        title: `${lender.name}: loan decision recorded`,
        body: `${lender.name} recorded a ${outcomeText} decision on loan ${loanId}.`,
        metadata: { loanId, lenderKey: lender.key, outcome: dto.outcome },
      }),
      this.notificationsService.send({
        userId: loan.borrowerUserId,
        type: 'FINANCING_UPDATE',
        title: `${lender.name}: an update on your loan`,
        body:
          dto.outcome === 'APPROVED'
            ? `${lender.name} has approved your loan.`
            : dto.outcome === 'REJECTED'
              ? `${lender.name} was unable to approve your loan this time.`
              : `${lender.name} has conditionally approved your loan. UZA will be in touch about the conditions.`,
        metadata: { loanId, lenderKey: lender.key, outcome: dto.outcome },
      }),
    ]);

    return decision;
  }

  async listDecisions(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.lenderDecision.findMany({
      where: { loanId },
      orderBy: { decidedAt: 'desc' },
    });
  }

  /** A bank asking UZA a question about one of its own loans. */
  async askInfoRequest(
    lender: LenderConfig,
    loanId: string,
    dto: AskInfoRequestDto,
    actorUserId: string,
  ) {
    await this.requireOwnLoan(lender, loanId);
    const infoRequest = await this.prisma.infoRequest.create({
      data: {
        loanId,
        question: dto.question,
        askedByRef: actorUserId,
      },
    });

    // Previously silent: a bank could ask a question and nobody at UZA would know until
    // someone happened to check the loan file.
    await this.notificationsService.sendToRoleNames(LOAN_STAFF_ROLES, {
      type: 'FINANCING_UPDATE',
      title: `${lender.name} has a question about a loan`,
      body: dto.question,
      metadata: {
        loanId,
        lenderKey: lender.key,
        infoRequestId: infoRequest.id,
      },
    });

    return infoRequest;
  }

  /** The bank's own view of its question-and-answer thread on one loan. */
  async listInfoRequests(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.infoRequest.findMany({
      where: { loanId },
      orderBy: { askedAt: 'desc' },
    });
  }

  /**
   * A bank-internal underwriting note. Deliberately the only place in this codebase that
   * writes `prisma.creditNote` from the lender side — see the model's own doc comment on
   * why nothing staff-facing may ever touch this table.
   */
  async addCreditNote(
    lender: LenderConfig,
    loanId: string,
    dto: CreateCreditNoteDto,
    actorUserId: string,
  ) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.creditNote.create({
      data: {
        loanId,
        note: dto.note,
        authorRef: actorUserId,
      },
    });
  }

  /** The bank's own credit notes on one loan. Never exposed to a UZA-staff caller. */
  async listCreditNotes(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.creditNote.findMany({
      where: { loanId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A bank uploads its own comfort-letter template once, reused for every loan it
   * approves. Deliberately a Bank-level field, not per-loan — the template itself never
   * changes loan to loan, only what a bank staff member fills in and signs on top of it.
   */
  async uploadComfortLetterTemplate(
    lender: LenderConfig,
    dto: UploadComfortLetterTemplateDto,
    actorUserId: string,
  ) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) {
      throw new NotFoundException(
        `${lender.name} has no bank record on file yet`,
      );
    }

    const bank = await this.prisma.bank.update({
      where: { id: bankId },
      data: {
        comfortLetterTemplateUrl: dto.fileUrl,
        comfortLetterTemplateUploadedAt: new Date(),
        comfortLetterTemplateUploadedBy: actorUserId,
      },
    });

    await this.auditService.record({
      userId: actorUserId,
      action: 'lender:comfort-letter-template-uploaded',
      entity: 'Bank',
      entityId: bankId,
      metadata: { lenderKey: lender.key },
    });

    return bank;
  }

  /**
   * The bank's signed comfort letter for one loan — printed from its template, signed,
   * scanned, and uploaded here. This is also the one event that moves `LoanVehicle`
   * ownership from UZA to the client: the comfort letter is the bank's written
   * confirmation the loan is real, and that confirmation is what the ownership transfer
   * has been waiting on the whole time. The real-world registration change at RURA
   * happens outside this system; this just records the fact once it's true.
   */
  async uploadComfortLetter(
    lender: LenderConfig,
    loanId: string,
    dto: UploadComfortLetterDto,
    actorUserId: string,
  ) {
    const loan = await this.requireOwnLoan(lender, loanId);
    assertComfortLetterAllowed(loan.status);

    const { comfortLetter, vehicle } = await this.prisma.$transaction(
      async (tx) => {
        const letter = await tx.loanComfortLetter.upsert({
          where: { loanId },
          create: {
            loanId,
            fileUrl: dto.fileUrl,
            notes: dto.notes ?? null,
            uploadedByRef: actorUserId,
          },
          update: {
            fileUrl: dto.fileUrl,
            notes: dto.notes ?? null,
            uploadedByRef: actorUserId,
            uploadedAt: new Date(),
          },
        });

        // Never move a vehicle "back" to company-owned by re-uploading a letter — the
        // transfer, once real, stays real. Only the first upload can trigger it.
        const existingVehicle = await tx.loanVehicle.findUnique({
          where: { loanId },
        });
        const transferred =
          existingVehicle && existingVehicle.ownershipStatus === 'COMPANY_OWNED'
            ? await tx.loanVehicle.update({
                where: { loanId },
                data: {
                  ownershipStatus: 'TRANSFERRED_TO_CLIENT',
                  ownershipTransferredAt: new Date(),
                },
              })
            : existingVehicle;

        return { comfortLetter: letter, vehicle: transferred };
      },
    );

    await this.auditService.record({
      userId: actorUserId,
      action: 'lender:comfort-letter-uploaded',
      entity: 'Loan',
      entityId: loanId,
      metadata: {
        lenderKey: lender.key,
        ownershipTransferred:
          vehicle?.ownershipStatus === 'TRANSFERRED_TO_CLIENT',
      },
    });

    await Promise.all([
      this.notificationsService.sendToRoleNames(LOAN_STAFF_ROLES, {
        type: 'FINANCING_UPDATE',
        title: `${lender.name}: comfort letter uploaded`,
        body: `${lender.name} uploaded the signed comfort letter for loan ${loanId}.${
          vehicle?.ownershipStatus === 'TRANSFERRED_TO_CLIENT'
            ? ' Vehicle ownership is now recorded as transferred to the client.'
            : ''
        }`,
        metadata: { loanId, lenderKey: lender.key },
      }),
      this.notificationsService.send({
        userId: loan.borrowerUserId,
        type: 'FINANCING_UPDATE',
        title: `${lender.name}: your comfort letter is in`,
        body: `${lender.name} has issued your comfort letter — your loan is confirmed in writing. UZA will be in touch about the next step.`,
        metadata: { loanId, lenderKey: lender.key },
      }),
    ]);

    return comfortLetter;
  }
}

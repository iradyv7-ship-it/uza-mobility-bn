import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import type { CreateVehicleInspectionDto } from './dto/create-vehicle-inspection.dto';
import { buildBoard, type BoardJob } from './workshop-board';
import { isCertificationCurrent } from './mechanic-pool';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, type Prisma } from '@prisma/client';
import { mayDisclose } from '../financing/lender-access';
import {
  assertFindingsConsistent,
  assertMayFileInspection,
  defaultNextDue,
  type InspectionFinding,
} from './inspection.rules';

/**
 * Read-side of the workshop. See `workshop.module.ts` for what this deliberately does
 * not yet do.
 */
@Injectable()
export class WorkshopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Job cards, most urgent first — `buildBoard()` from workshop-board.ts decides the
   * order (overdue, then at-risk, then blocked-on-us, then blocked-on-them, then on
   * track), the same ranking a service manager's board uses. Closed/handed-over/
   * cancelled/declined jobs are excluded by that function, not re-filtered here.
   */
  async listJobCards() {
    const rows = await this.prisma.jobCard.findMany({
      orderBy: { promisedAt: 'asc' },
    });

    const boardJobs: BoardJob[] = rows.map((r) => ({
      jobRef: r.reference,
      vehiclePlate: r.vehiclePlate ?? '',
      // BoardJob's JobState is workshop-board's own narrower type, but the two enums'
      // members are identical strings — see job-card.state.ts vs. the Prisma JobCardState
      // enum in schema.prisma section 30, which was generated to mirror it exactly.
      state: r.state,
      promisedAt: r.promisedAt,
      technicianId: r.performedByMechanicId,
    }));

    const board = buildBoard(boardJobs);
    const byRef = new Map(rows.map((r) => [r.reference, r]));

    return board.map((row) => {
      const source = byRef.get(row.jobRef);
      return {
        id: source?.id ?? row.jobRef,
        reference: row.jobRef,
        vehiclePlate: row.vehiclePlate || null,
        state: row.state,
        assignedTo: row.technicianId,
        promisedAt: source?.promisedAt.toISOString() ?? null,
        attention: row.attention,
        note: row.note,
      };
    });
  }

  /** Every mechanic in the pool, current certification status resolved for display. */
  async listMechanics() {
    const rows = await this.prisma.mechanic.findMany({
      orderBy: { name: 'asc' },
    });

    return rows.map((m) => {
      const current = isCertificationCurrent({
        mechanicId: m.id,
        uzaId: m.uzaId ?? '',
        engagement: m.engagement,
        level: m.level,
        certifiedFor: m.certifiedFor,
        certifiedUntil: m.certifiedUntil,
        suspendedAt: m.suspendedAt,
      });
      return {
        id: m.id,
        name: m.name,
        grade: m.level,
        hvCertificateStatus: !m.certifiedFor.includes('HIGH_VOLTAGE')
          ? null
          : current
            ? 'CURRENT'
            : m.suspendedAt
              ? 'SUSPENDED'
              : 'EXPIRED',
        hvCertificateExpiresAt: m.certifiedFor.includes('HIGH_VOLTAGE')
          ? m.certifiedUntil.toISOString()
          : null,
      };
    });
  }

  /**
   * Onboard a garage/workshop partner. Nothing wrote to `prisma.mechanic` anywhere before
   * this — a WORKSHOP_ADMIN/MECHANIC role granted the portal, but there was no partner
   * record behind it, so `InternalWorkshopGuard`'s "is this account a registered
   * mechanic" check (see inspections.controller.ts) could never pass. `userId`, when
   * given, inherits that account's uzaId so the two records reconcile onto one person.
   */
  async registerMechanic(input: {
    name: string;
    engagement: 'EMPLOYED' | 'CERTIFIED';
    level: 'APPRENTICE' | 'TECHNICIAN' | 'SENIOR' | 'MASTER';
    certifiedFor: Prisma.MechanicCreateInput['certifiedFor'];
    certifiedUntil: Date;
    userId?: string;
    registeredByUserId: string;
  }) {
    let uzaId: string | null = null;
    if (input.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { uzaId: true },
      });
      if (!user) throw new NotFoundException('Linked user not found');
      uzaId = user.uzaId;
    }

    const mechanic = await this.prisma.mechanic.create({
      data: {
        name: input.name,
        engagement: input.engagement,
        level: input.level,
        certifiedFor: input.certifiedFor,
        certifiedUntil: input.certifiedUntil,
        userId: input.userId,
        uzaId,
      },
    });

    await this.auditService.record({
      userId: input.registeredByUserId,
      action: 'workshop:register-mechanic',
      entity: 'Mechanic',
      entityId: mechanic.id,
      metadata: { name: mechanic.name, engagement: mechanic.engagement },
    });

    return mechanic;
  }

  /** Rescue calls, most recent first. `responderName` is null when nobody was available. */
  async listRescueCalls() {
    const rows = await this.prisma.rescueCall.findMany({
      orderBy: { createdAt: 'desc' },
      include: { responder: { select: { name: true } } },
    });

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      faultType: r.category,
      responderName: r.responder?.name ?? null,
      status: r.status,
    }));
  }

  /**
   * A certified mechanic files a monthly condition report on the vehicle securing one
   * loan — one of the three things UZA Empower gives a lender in exchange for financing
   * at better terms than the vehicle alone would justify: the collateral-ASSET risk
   * signal (LoanSavingsEntry, below, is the ongoing-behaviour signal).
   *
   * `userId` is the caller's own id, not the mechanic's — resolved to a Mechanic row
   * here so an inspection is always attributed to a real, identifiable person, never to
   * "whoever was logged in."
   */
  /**
   * What a garage may learn from a client's UZA ID before inspecting the car.
   *
   * The garage has the client in front of them holding a card with a UZA ID. It needs to
   * know which financed vehicle to file against and to confirm it has the right person —
   * and nothing else. No principal, no balance, no arrears, no bank: a garage is not a
   * party to the loan and must not become a way to read it. The display name is returned
   * because the person is physically present and the garage must be able to check the
   * name on the card against the name on the file.
   *
   * 404 for an unknown UZA ID and for a UZA ID with no active financed vehicle, so the
   * endpoint cannot be used to confirm who is a UZA client.
   */
  async lookupVehicleForInspection(userId: string, uzaId: string) {
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { userId },
    });
    if (!mechanic) {
      throw new ForbiddenException(
        'This account is not registered as a mechanic',
      );
    }
    assertMayFileInspection(mechanic);

    const normalised = uzaId.trim().toUpperCase();
    const loans = await this.prisma.loan.findMany({
      where: {
        borrower: { uzaId: normalised },
        status: { in: ['DISBURSED', 'ACTIVE', 'IN_ARREARS'] },
      },
      select: {
        id: true,
        reference: true,
        borrower: { select: { firstName: true, lastName: true } },
        inspections: {
          orderBy: { inspectedAt: 'desc' },
          take: 1,
          select: { inspectedAt: true, nextDueAt: true, passed: true },
        },
        _count: { select: { inspections: true } },
      },
    });
    if (loans.length === 0) throw new NotFoundException();

    return loans.map((l) => ({
      loanId: l.id,
      loanRef: l.reference,
      displayName: `${l.borrower.firstName} ${l.borrower.lastName}`.trim(),
      inspectionsFiled: l._count.inspections,
      lastInspectedAt: l.inspections[0]?.inspectedAt ?? null,
      lastPassed: l.inspections[0]?.passed ?? null,
      nextDueAt: l.inspections[0]?.nextDueAt ?? null,
    }));
  }

  /**
   * File a monthly inspection.
   *
   * `userId` is the caller's own id, not the mechanic's — resolved to a Mechanic row here so
   * an inspection is always attributed to a real, identifiable person, never to "whoever was
   * logged in." The mechanic must be currently certified and not suspended; until
   * 12 September 2026 neither was checked, so a lapsed garage could file reports a bank would
   * read as current. A "passed" verdict over an unresolved SAFETY finding is refused.
   *
   * On success the lender of record is told — but only if the borrower has a live consent
   * for that lender. The notification is itself a disclosure, and the same rule that scopes
   * the lender's portal scopes what the lender is told about.
   */
  async createInspection(
    userId: string,
    dto: CreateVehicleInspectionDto,
    auditContext: RequestAuditContext = {},
  ) {
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { userId },
    });
    if (!mechanic) {
      throw new ForbiddenException(
        'This account is not registered as a mechanic',
      );
    }
    assertMayFileInspection(mechanic);
    assertFindingsConsistent(dto.passed, dto.findings);

    const loan = await this.prisma.loan.findUnique({
      where: { id: dto.loanId },
      include: {
        bank: { select: { lenderKey: true, name: true } },
        borrower: { select: { uzaId: true, firstName: true, lastName: true } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');

    const inspectedAt = new Date();
    const inspection = await this.prisma.vehicleInspection.create({
      data: {
        loanId: dto.loanId,
        mechanicId: mechanic.id,
        inspectedAt,
        mileageKm: dto.mileageKm,
        batteryHealthPct: dto.batteryHealthPct,
        condition: dto.condition,
        notes: dto.notes,
        // Plain data for the JSON column: the DTO instances carry class metadata Prisma
        // will not accept, and structuredClone strips it without a stringify round-trip.
        findings: dto.findings
          ? (structuredClone(dto.findings) as unknown as Prisma.InputJsonValue)
          : undefined,
        passed: dto.passed,
        certificateRef: dto.certificateRef,
        nextDueAt: dto.nextDueAt
          ? new Date(dto.nextDueAt)
          : defaultNextDue(inspectedAt),
      },
    });

    await this.auditService.record({
      userId,
      action: 'workshop:inspection-filed',
      entity: 'VehicleInspection',
      entityId: inspection.id,
      metadata: {
        loanId: dto.loanId,
        condition: dto.condition,
        passed: dto.passed ?? null,
        openSafetyFindings:
          dto.findings?.filter((f) => f.severity === 'SAFETY' && !f.resolvedAt)
            .length ?? 0,
        mechanicEngagement: mechanic.engagement,
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    await this.notifyInspectionFiled(loan, inspection.id, dto);

    return inspection;
  }

  /**
   * Tell the people who read inspections that one arrived. UZA finance always; the lender
   * only where the borrower consented to that lender — the notification carries the
   * borrower's name and is a disclosure in its own right.
   */
  private async notifyInspectionFiled(
    loan: {
      id: string;
      reference: string;
      bank: { lenderKey: string | null; name: string };
      borrower: { uzaId: string | null; firstName: string; lastName: string };
    },
    inspectionId: string,
    dto: CreateVehicleInspectionDto,
  ) {
    const displayName =
      `${loan.borrower.firstName} ${loan.borrower.lastName}`.trim();
    const openSafety =
      dto.findings?.filter((f) => f.severity === 'SAFETY' && !f.resolvedAt)
        .length ?? 0;
    const headline =
      dto.passed === false || openSafety > 0
        ? `Inspection needs attention — ${loan.reference}`
        : `Monthly inspection filed — ${loan.reference}`;
    const body = `${displayName}: condition ${dto.condition.toLowerCase().replaceAll('_', ' ')}${
      dto.passed === true
        ? ', certified'
        : dto.passed === false
          ? ', NOT certified'
          : ''
    }${openSafety ? `, ${openSafety} open safety finding${openSafety === 1 ? '' : 's'}` : ''}.`;
    const metadata = {
      loanId: loan.id,
      inspectionId,
      condition: dto.condition,
    };

    await this.notifications.sendToRoleNames(['FINANCE_ADMIN', 'SUPER_ADMIN'], {
      type: NotificationType.SYSTEM_ALERT,
      title: headline,
      body,
      metadata,
    });

    if (!loan.bank.lenderKey || !loan.borrower.uzaId) return;
    const consent = await this.prisma.lenderConsent.findUnique({
      where: {
        uzaId_lenderKey: {
          uzaId: loan.borrower.uzaId,
          lenderKey: loan.bank.lenderKey,
        },
      },
      select: { grantedAt: true, withdrawnAt: true },
    });
    const decision = mayDisclose({
      borrowerExists: true,
      isBorrowerOfThisLender: true,
      consentGivenAt: consent?.grantedAt ?? null,
      consentWithdrawnAt: consent?.withdrawnAt ?? null,
    });
    if (!decision.allowed) return;

    await this.notifications.sendToRoleNames(
      [`LENDER_${loan.bank.lenderKey.toUpperCase()}`],
      { type: NotificationType.SYSTEM_ALERT, title: headline, body, metadata },
    );
  }

  /** A loan's inspection history, most recent first — what a lender reads to judge the
   *  collateral asset's actual condition over the life of the loan, not just at purchase. */
  async listInspectionsForLoan(loanId: string) {
    const rows = await this.prisma.vehicleInspection.findMany({
      where: { loanId },
      orderBy: { inspectedAt: 'desc' },
      include: { mechanic: { select: { name: true } } },
    });

    return rows.map((r) => ({
      id: r.id,
      inspectedAt: r.inspectedAt.toISOString(),
      mechanicName: r.mechanic.name,
      mileageKm: r.mileageKm,
      batteryHealthPct: r.batteryHealthPct,
      condition: r.condition,
      notes: r.notes,
      // The part a lender actually underwrites on: what was found, what was done, and
      // whether the garage certified the vehicle. An open SAFETY finding here is the
      // early-warning signal the monthly inspection exists to produce.
      passed: r.passed,
      certificateRef: r.certificateRef,
      nextDueAt: r.nextDueAt?.toISOString() ?? null,
      findings: (r.findings as InspectionFinding[] | null) ?? [],
      openSafetyFindings: (
        (r.findings as InspectionFinding[] | null) ?? []
      ).filter((f) => f.severity === 'SAFETY' && !f.resolvedAt).length,
    }));
  }
}

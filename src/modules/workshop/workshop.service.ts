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

/**
 * Read-side of the workshop. See `workshop.module.ts` for what this deliberately does
 * not yet do.
 */
@Injectable()
export class WorkshopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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

    const loan = await this.prisma.loan.findUnique({
      where: { id: dto.loanId },
    });
    if (!loan) throw new NotFoundException('Loan not found');

    const inspection = await this.prisma.vehicleInspection.create({
      data: {
        loanId: dto.loanId,
        mechanicId: mechanic.id,
        mileageKm: dto.mileageKm,
        batteryHealthPct: dto.batteryHealthPct,
        condition: dto.condition,
        notes: dto.notes,
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
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return inspection;
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
    }));
  }
}

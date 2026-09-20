import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ALLOCATABLE_UNIT_STATUSES,
  DEFAULT_OFFER_DAYS,
  LIVE_ALLOCATION_STATUSES,
  assertLoanAllocatable,
  assertOfferWindow,
  assertQueueReady,
  assertRespondable,
  assertSupplierEncumbranceCleared,
  assertUnitAllocatable,
  offerExpiry,
  orderQueue,
  priorityReasonFor,
  unitStatusOnRelease,
  type QueueEntry,
} from './allocation.rules';
import type { AllocateUnitDto } from './dto/allocate-unit.dto';
import type { EnqueueDriverDto } from './dto/enqueue-driver.dto';
import type { ListAvailableUnitsDto } from './dto/list-available-units.dto';
import type { RespondAllocationDto } from './dto/respond-allocation.dto';

/**
 * Vehicle allocation: the step between "the bank approved you" and "this VIN is yours".
 *
 * Everything the bank file already asks for (`VEHICLE_ALLOCATION`, `PROFORMA`,
 * `INSURANCE_QUOTE` in `bank-file-generator.service.ts`) reads an `Allocation` row keyed by
 * the queue's UZA ID. Until now nothing wrote one, so those three items could never be
 * produced for anybody. This is the writer.
 *
 * ── Where this sits in the journey ───────────────────────────────────────────────────────
 *
 * `JourneyStage` numbers VEHICLE_SELECTED 13, VEHICLE_ORDERED 26 and VEHICLE_DELIVERED 30.
 * Allocation is not any one of them — it spans them. A *promise* of a specific unit is made
 * at or shortly after VEHICLE_SELECTED, because the bank file cannot be submitted (stage 14)
 * without it; the promise is *fulfilled* around VEHICLE_ORDERED/VEHICLE_DELIVERED. This
 * service deliberately does NOT write `CandidateJourney.stage` or `JourneyEvent`: no code in
 * this repository writes either yet, and inventing the first writer here would put the
 * journey's own rules in the wrong module. See the task report — it is a stated gap.
 *
 * ── Money ────────────────────────────────────────────────────────────────────────────────
 *
 * `ConsignmentUnit.landedCostRwf` and `SupplyOrderVehicle.balanceDueMinor` are BigInt in
 * Postgres. They go out as Numbers, through the same `plain()` trick `WalletService` uses —
 * whole francs never exceed 2^53.
 */

/** Ledger money is BigInt in Postgres and a Number on the wire. Whole francs never exceed 2^53. */
function plain<T>(row: T): T {
  return JSON.parse(
    JSON.stringify(row, (_k, v: unknown) =>
      typeof v === 'bigint' ? Number(v) : v,
    ),
  ) as T;
}

@Injectable()
export class AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The next allocation reference.
   *
   * Highest existing ref + 1, not `count() + 1` — the count scheme collides the moment a row
   * is deleted. Same reasoning, and same shape, as `FundApplicationService.nextRef()`.
   */
  private async nextRef(tx: Prisma.TransactionClient): Promise<string> {
    const prefix = `UZM-ALC-${new Date().getFullYear()}-`;
    const newest = await tx.allocation.findFirst({
      where: { ref: { startsWith: prefix } },
      orderBy: { ref: 'desc' },
      select: { ref: true },
    });
    const next = newest
      ? Number.parseInt(newest.ref.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(Number.isNaN(next) ? 1 : next).padStart(6, '0')}`;
  }

  /** The next queue reference, same scheme. */
  private async nextQueueRef(): Promise<string> {
    const prefix = `UZM-AQ-${new Date().getFullYear()}-`;
    const newest = await this.prisma.allocationQueue.findFirst({
      where: { ref: { startsWith: prefix } },
      orderBy: { ref: 'desc' },
      select: { ref: true },
    });
    const next = newest
      ? Number.parseInt(newest.ref.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(Number.isNaN(next) ? 1 : next).padStart(6, '0')}`;
  }

  /**
   * Put a person in the line for a class of vehicle.
   *
   * Nothing else in this repository writes `AllocationQueue`, so without this the whole
   * allocation path is unreachable — a unit could never be promised to anybody because
   * nobody would be in a queue. Re-enqueuing the same person for the same class updates
   * their readiness date rather than creating a second place in the line, which the
   * schema's `@@unique([uzaId, classCode])` requires anyway: one place per class per person.
   */
  async enqueue(
    actorUserId: string,
    dto: EnqueueDriverDto,
    auditContext: RequestAuditContext = {},
  ) {
    const uzaId = dto.uzaId.trim().toUpperCase();
    const classCode = dto.classCode.trim().toUpperCase();

    const person = await this.prisma.user.findUnique({
      where: { uzaId },
      select: { id: true },
    });
    if (!person) {
      throw new NotFoundException('No participant with that UZA ID.');
    }

    const vehicleClass = await this.prisma.vehicleClass.findUnique({
      where: { code: classCode },
      select: { code: true, active: true },
    });
    if (!vehicleClass || !vehicleClass.active) {
      throw new BadRequestException(
        `${classCode} is not an active vehicle class.`,
      );
    }

    const readyAt = new Date(dto.readyAt);
    const entry = await this.prisma.allocationQueue.upsert({
      where: { uzaId_classCode: { uzaId, classCode } },
      create: {
        ref: await this.nextQueueRef(),
        uzaId,
        classCode,
        readyAt,
        preferredMake: dto.preferredMake?.trim() || null,
        preferredModel: dto.preferredModel?.trim() || null,
      },
      update: {
        readyAt,
        active: true,
        preferredMake: dto.preferredMake?.trim() || null,
        preferredModel: dto.preferredModel?.trim() || null,
      },
    });

    await this.auditService.record({
      userId: actorUserId,
      action: 'ALLOCATION_QUEUE_ENTERED',
      entity: 'AllocationQueue',
      entityId: entry.id,
      metadata: {
        ref: entry.ref,
        uzaId,
        classCode,
        readyAt: readyAt.toISOString(),
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return entry;
  }

  /**
   * The line for a class of vehicle, in readiness order with positions derived at read time.
   *
   * Anyone already holding a live promise is not waiting, so they are not in the list —
   * they appear under `holding` instead, which is what an officer actually needs to see next
   * to the queue.
   */
  async listQueue(classCode?: string) {
    const rows = await this.prisma.allocationQueue.findMany({
      where: {
        active: true,
        ...(classCode ? { classCode: classCode.trim().toUpperCase() } : {}),
      },
      include: {
        allocations: {
          where: { status: { in: [...LIVE_ALLOCATION_STATUSES] } },
          select: {
            id: true,
            ref: true,
            status: true,
            expiresAt: true,
            unit: { select: { id: true, ref: true, identifier: true } },
          },
        },
      },
    });

    const entries: QueueEntry[] = rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      uzaId: r.uzaId,
      classCode: r.classCode,
      readyAt: r.readyAt,
      active: r.active,
      hasLiveAllocation: r.allocations.length > 0,
    }));

    const byId = new Map(rows.map((r) => [r.id, r]));

    return {
      waiting: orderQueue(entries).map((e) => {
        const row = byId.get(e.id);
        return {
          position: e.position,
          queueId: e.id,
          ref: e.ref,
          uzaId: e.uzaId,
          classCode: e.classCode,
          readyAt: e.readyAt,
          preferredMake: row?.preferredMake ?? null,
          preferredModel: row?.preferredModel ?? null,
          priorityReason: row?.priorityReason ?? null,
        };
      }),
      holding: rows
        .filter((r) => r.allocations.length > 0)
        .map((r) => ({
          queueId: r.id,
          ref: r.ref,
          uzaId: r.uzaId,
          classCode: r.classCode,
          allocation: r.allocations[0],
        })),
    };
  }

  /**
   * Units that can actually be promised right now.
   *
   * "Available" is two conditions, not one: an eligible `UnitStatus`, AND no live promise
   * over it. The second is checked through `activeHoldUnitId` — the column the schema keeps
   * unique precisely so this question has one answer — rather than by trusting the unit's
   * own status, because a status field and a hold are two different facts and this module
   * exists because they drift.
   */
  async listAvailableUnits(dto: ListAvailableUnitsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;

    const where: Prisma.ConsignmentUnitWhereInput = {
      status: { in: [...ALLOCATABLE_UNIT_STATUSES] },
      allocations: {
        none: { status: { in: [...LIVE_ALLOCATION_STATUSES] } },
      },
      ...(dto.classCode
        ? { classCode: dto.classCode.trim().toUpperCase() }
        : {}),
      ...(dto.consignmentId ? { consignmentId: dto.consignmentId } : {}),
    };

    const [total, units] = await this.prisma.$transaction([
      this.prisma.consignmentUnit.count({ where }),
      this.prisma.consignmentUnit.findMany({
        where,
        orderBy: [{ status: 'asc' }, { ref: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          consignment: {
            select: {
              id: true,
              ref: true,
              status: true,
              etaPlanned: true,
              etaActual: true,
            },
          },
        },
      }),
    ]);

    return plain({ total, page, limit, units });
  }

  /**
   * Promise one unit to one person.
   *
   * Every check runs inside the transaction, against rows read inside it, because each of
   * them is a race otherwise: two officers on two screens allocating the same unit at the
   * same second both pass a pre-flight check made outside. The last line of defence is the
   * database — `Allocation.activeHoldUnitId` is unique — and its violation is caught and
   * turned into a sentence rather than a 500.
   */
  async allocate(
    actorUserId: string,
    dto: AllocateUnitDto,
    auditContext: RequestAuditContext = {},
  ) {
    if (!dto.queueId && !dto.loanId) {
      throw new BadRequestException(
        'Name the person to allocate to: either queueId or loanId.',
      );
    }

    const offerDays = dto.offerDays ?? DEFAULT_OFFER_DAYS;
    assertOfferWindow(offerDays);

    const now = new Date();

    try {
      const allocation = await this.prisma.$transaction(async (tx) => {
        const unit = await tx.consignmentUnit.findUnique({
          where: { id: dto.unitId },
          include: { consignment: { select: { status: true } } },
        });
        if (!unit) throw new NotFoundException('No unit with that id.');

        assertUnitAllocatable(unit);

        // The supplier's claim, matched by VIN — the only thing the supply partition and
        // the consignment partition share. A unit with no VIN matches nothing and passes;
        // see the rule's doc comment for why that is honest rather than safe.
        if (unit.vin) {
          const supply = await tx.supplyOrderVehicle.findUnique({
            where: { vin: unit.vin },
            select: {
              vin: true,
              balanceDueMinor: true,
              balancePaidOn: true,
              securityReleasedOn: true,
            },
          });
          assertSupplierEncumbranceCleared(unit.ref, supply);
        }

        const queue = await this.resolveQueue(tx, dto, unit.classCode);
        assertQueueReady(queue, now);

        // One live promise per person. Someone holding a unit is not also owed another.
        const existingForPerson = await tx.allocation.findFirst({
          where: {
            queueId: queue.id,
            status: { in: [...LIVE_ALLOCATION_STATUSES] },
          },
          select: { ref: true, unit: { select: { ref: true } } },
        });
        if (existingForPerson) {
          throw new ConflictException(
            `${queue.uzaId} already holds ${existingForPerson.unit.ref} under allocation ${existingForPerson.ref}. Resolve that first.`,
          );
        }

        // Jumping the line is allowed and never invisible.
        const peers = await tx.allocationQueue.findMany({
          where: { classCode: unit.classCode, active: true },
          include: {
            allocations: {
              where: { status: { in: [...LIVE_ALLOCATION_STATUSES] } },
              select: { id: true },
            },
          },
        });
        const ordered = orderQueue(
          peers
            .filter((p) => p.readyAt.getTime() <= now.getTime())
            .map((p) => ({
              id: p.id,
              ref: p.ref,
              uzaId: p.uzaId,
              classCode: p.classCode,
              readyAt: p.readyAt,
              active: p.active,
              hasLiveAllocation: p.allocations.length > 0,
            })),
        );
        const jumpReason = priorityReasonFor(
          queue.id,
          ordered,
          dto.priorityReason,
        );
        if (jumpReason) {
          await tx.allocationQueue.update({
            where: { id: queue.id },
            data: {
              priorityReason: jumpReason,
              prioritisedById: actorUserId,
            },
          });
        }

        const created = await tx.allocation.create({
          data: {
            ref: await this.nextRef(tx),
            unitId: unit.id,
            queueId: queue.id,
            status: 'promised',
            promisedAt: now,
            expiresAt: offerExpiry(now, offerDays),
            decidedById: actorUserId,
            // Mirrors unitId while the promise is live. Unique, so the second officer
            // loses instead of the driver finding out at the yard.
            activeHoldUnitId: unit.id,
          },
          include: {
            unit: {
              select: { id: true, ref: true, identifier: true, vin: true },
            },
            queue: {
              select: { id: true, ref: true, uzaId: true, classCode: true },
            },
          },
        });

        await tx.consignmentUnit.update({
          where: { id: unit.id },
          data: { status: 'allocated' },
        });

        return created;
      });

      await this.auditService.record({
        userId: actorUserId,
        action: 'ALLOCATION_PROMISED',
        entity: 'Allocation',
        entityId: allocation.id,
        metadata: {
          ref: allocation.ref,
          unitRef: allocation.unit.ref,
          identifier: allocation.unit.identifier,
          uzaId: allocation.queue.uzaId,
          classCode: allocation.queue.classCode,
          expiresAt: allocation.expiresAt.toISOString(),
          ...(dto.loanId ? { loanId: dto.loanId } : {}),
          ...(dto.priorityReason
            ? { priorityReason: dto.priorityReason.trim() }
            : {}),
        },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });

      return plain(allocation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // activeHoldUnitId. Someone else promised this unit between our read and our write.
        throw new ConflictException(
          'That unit was promised to someone else a moment ago. Refresh the available list and pick another.',
        );
      }
      throw error;
    }
  }

  /**
   * The person named on the allocation, resolved from whichever handle the caller had.
   *
   * ── A gap, stated plainly ────────────────────────────────────────────────────────────
   * `Allocation` has no `loanId` column. The link between a loan and an allocation is
   * derived: Loan -> borrowerUserId -> User.uzaId -> AllocationQueue(uzaId, classCode).
   * That is the same join `bank-file-generator.service.ts` already relies on, so it is the
   * existing convention rather than a new one — but it means a loan whose borrower has no
   * queue entry for the unit's class cannot be allocated to until one exists, and the loan
   * id itself survives only in the audit metadata.
   */
  private async resolveQueue(
    tx: Prisma.TransactionClient,
    dto: AllocateUnitDto,
    classCode: string,
  ) {
    if (dto.queueId) {
      const queue = await tx.allocationQueue.findUnique({
        where: { id: dto.queueId },
      });
      if (!queue) throw new NotFoundException('No queue entry with that id.');
      if (queue.classCode !== classCode) {
        throw new BadRequestException(
          `That person is queued for ${queue.classCode}, and this unit is a ${classCode}.`,
        );
      }
      return queue;
    }

    const loanId = dto.loanId;
    if (!loanId) {
      throw new BadRequestException(
        'Name the person to allocate to: either queueId or loanId.',
      );
    }

    const loan = await tx.loan.findUnique({
      where: { id: loanId },
      select: {
        id: true,
        reference: true,
        status: true,
        borrower: { select: { uzaId: true } },
      },
    });
    if (!loan) throw new NotFoundException('No loan with that id.');
    assertLoanAllocatable(loan);

    const uzaId = loan.borrower?.uzaId;
    if (!uzaId) {
      throw new BadRequestException(
        `The borrower on ${loan.reference} has no UZA ID, so they cannot hold a place in the allocation queue.`,
      );
    }

    const queue = await tx.allocationQueue.findUnique({
      where: { uzaId_classCode: { uzaId, classCode } },
    });
    if (!queue) {
      throw new NotFoundException(
        `${uzaId} has no ${classCode} queue entry. Put them in the queue before allocating.`,
      );
    }
    return queue;
  }

  /** The driver accepted the unit. The hold stays — it is now a confirmed promise. */
  async confirm(
    actorUserId: string,
    allocationId: string,
    dto: RespondAllocationDto,
    auditContext: RequestAuditContext = {},
  ) {
    const allocation = await this.requireAllocation(allocationId);
    assertRespondable(allocation);

    const updated = await this.prisma.allocation.update({
      where: { id: allocation.id },
      data: {
        status: 'confirmed',
        respondedAt: new Date(),
        outcomeNote: dto.outcomeNote?.trim() || null,
      },
      include: {
        unit: { select: { ref: true, identifier: true } },
        queue: { select: { uzaId: true, classCode: true } },
      },
    });

    await this.auditService.record({
      userId: actorUserId,
      action: 'ALLOCATION_CONFIRMED',
      entity: 'Allocation',
      entityId: updated.id,
      metadata: {
        ref: updated.ref,
        unitRef: updated.unit.ref,
        uzaId: updated.queue.uzaId,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return plain(updated);
  }

  /**
   * The driver said no, or the offer is being withdrawn.
   *
   * The hold is cleared (`activeHoldUnitId` back to NULL, which is what makes a second
   * person able to decline the same unit later) and the unit goes back to where the
   * consignment says it physically is.
   */
  async decline(
    actorUserId: string,
    allocationId: string,
    dto: RespondAllocationDto,
    auditContext: RequestAuditContext = {},
  ) {
    const note = dto.outcomeNote?.trim();
    if (!note) {
      throw new BadRequestException(
        'A decline needs a reason. A make nobody accepts is a sourcing problem, and that can only be seen if it is written down.',
      );
    }

    const allocation = await this.requireAllocation(allocationId);
    assertRespondable(allocation);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.allocation.update({
        where: { id: allocation.id },
        data: {
          status: 'declined',
          respondedAt: new Date(),
          outcomeNote: note,
          activeHoldUnitId: null,
        },
        include: {
          unit: {
            select: {
              id: true,
              ref: true,
              consignment: { select: { status: true } },
            },
          },
          queue: { select: { uzaId: true, classCode: true } },
        },
      });

      await tx.consignmentUnit.update({
        where: { id: row.unit.id },
        data: { status: unitStatusOnRelease(row.unit.consignment.status) },
      });

      return row;
    });

    await this.auditService.record({
      userId: actorUserId,
      action: 'ALLOCATION_DECLINED',
      entity: 'Allocation',
      entityId: updated.id,
      metadata: {
        ref: updated.ref,
        unitRef: updated.unit.ref,
        uzaId: updated.queue.uzaId,
        outcomeNote: note,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return plain(updated);
  }

  /**
   * Sweep offers whose clock has run out.
   *
   * Called by hand for now (`POST /admin/allocation/lapse-expired`) rather than wired to a
   * schedule: the three existing cron jobs are registered centrally and gated on
   * CRON_ENABLED (see `app.module.ts`), and adding a fourth is a deployment decision, not
   * one this module should take by itself.
   */
  async lapseExpired(
    actorUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const now = new Date();
    const expired = await this.prisma.allocation.findMany({
      where: { status: 'promised', expiresAt: { lte: now } },
      include: {
        unit: {
          select: {
            id: true,
            ref: true,
            consignment: { select: { status: true } },
          },
        },
        queue: { select: { uzaId: true } },
      },
    });

    for (const allocation of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.allocation.update({
          where: { id: allocation.id },
          data: {
            status: 'lapsed',
            activeHoldUnitId: null,
            outcomeNote:
              allocation.outcomeNote ??
              `No answer by ${allocation.expiresAt.toISOString().slice(0, 10)}.`,
          },
        });
        await tx.consignmentUnit.update({
          where: { id: allocation.unit.id },
          data: {
            status: unitStatusOnRelease(allocation.unit.consignment.status),
          },
        });
      });

      await this.auditService.record({
        userId: actorUserId,
        action: 'ALLOCATION_LAPSED',
        entity: 'Allocation',
        entityId: allocation.id,
        metadata: {
          ref: allocation.ref,
          unitRef: allocation.unit.ref,
          uzaId: allocation.queue.uzaId,
          expiresAt: allocation.expiresAt.toISOString(),
        },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });
    }

    return { lapsed: expired.length, refs: expired.map((a) => a.ref) };
  }

  /** One allocation, with who decided it and when — the audit question, answered from the row. */
  async findOne(allocationId: string) {
    return plain(await this.requireAllocation(allocationId));
  }

  private async requireAllocation(allocationId: string) {
    const allocation = await this.prisma.allocation.findUnique({
      where: { id: allocationId },
      include: {
        unit: {
          include: {
            consignment: { select: { id: true, ref: true, status: true } },
          },
        },
        queue: true,
      },
    });
    if (!allocation) {
      throw new NotFoundException('No allocation with that id.');
    }
    return allocation;
  }
}

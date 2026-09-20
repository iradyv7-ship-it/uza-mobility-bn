import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Prisma,
  SupplierOfferCondition,
  SupplierOfferKind,
  SupplierOfferStatus,
  SupplierStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtUserPayload } from '../../users/users.types';
import type {
  DeclineSupplierOfferDto,
  ReviewSupplierOfferDto,
} from './dto/review-supplier-offer.dto';
import type { SubmitSupplierOfferDto } from './dto/submit-supplier-offer.dto';
import {
  assertOwnSupplierRecord,
  normaliseOfferVin,
  SUPPLIER_REFUSAL,
} from './supplier-access';
import { SuppliersService } from './suppliers.service';

/**
 * Offer money is BigInt in Postgres and a Number on the wire, the same convention
 * `WalletService` uses: whole minor units never exceed 2^53, and `JSON.stringify` refuses
 * a BigInt outright.
 */
function present<T extends { indicativePriceMinor: bigint | null }>(offer: T) {
  return {
    ...offer,
    indicativePriceMinor:
      offer.indicativePriceMinor === null
        ? null
        : Number(offer.indicativePriceMinor),
  };
}

/**
 * "Send me all available options they have."
 *
 * A supplier submits what they have in stock. UZA looks, and either converts it into a
 * real Addendum or declines it with a reason. Nothing here binds either side — which is
 * exactly why it could not be modelled as a `SupplyOrder`, whose every field assumes a
 * commitment already made.
 *
 * The partition is enforced on every method, and always the same way: the caller's
 * supplier is resolved from their `CounterpartyAccess` grant, never from a parameter, and
 * a row already fetched is checked again before it is returned.
 */
@Injectable()
export class SupplierOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliers: SuppliersService,
    private readonly audit: AuditService,
  ) {}

  // ── The supplier's own catalogue ─────────────────────────────────────────────────

  async submit(dto: SubmitSupplierOfferDto, user: JwtUserPayload | undefined) {
    if (!user?.sub) throw new UnauthorizedException();
    const supplierId = await this.suppliers.resolveSupplierIdFor(user);

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, status: true, defaultCurrency: true, code: true },
    });
    if (!supplier) throw new NotFoundException(SUPPLIER_REFUSAL);

    // A grant can outlive a status change. Suspended and closed suppliers keep their
    // history and stop offering; that is what SUSPENDED means — "stop new orders, finish
    // open ones" — and a new offer is a new order in waiting.
    if (supplier.status !== SupplierStatus.ACTIVE) {
      throw new BadRequestException(
        'Your company is not active with UZA at the moment, so new offers cannot be submitted. Contact UZA sourcing.',
      );
    }

    const kind = dto.kind ?? SupplierOfferKind.VEHICLE;
    const vin = normaliseOfferVin(dto.vin);

    if (kind === SupplierOfferKind.SPARE_PART && vin) {
      throw new BadRequestException(
        'A spare part has no VIN. Use partNumber, and quantity for how many you hold.',
      );
    }

    const offer = await this.prisma.supplierOffer.create({
      data: {
        ref: await this.nextRef(),
        supplierId,
        kind,
        vin,
        brand: dto.brand.trim(),
        model: dto.model.trim(),
        year: dto.year ?? null,
        colour: dto.colour?.trim() || null,
        condition: dto.condition ?? SupplierOfferCondition.USED,
        mileageKm: dto.mileageKm ?? null,
        batterySohPct: dto.batterySohPct ?? null,
        accidentHistory: dto.accidentHistory?.trim() || null,
        partNumber: dto.partNumber?.trim() || null,
        quantity: dto.quantity ?? 1,
        indicativePriceMinor:
          dto.indicativePriceMinor === undefined
            ? null
            : BigInt(dto.indicativePriceMinor),
        currency:
          dto.currency?.trim().toUpperCase() || supplier.defaultCurrency,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : null,
        notes: dto.notes?.trim() || null,
        status: SupplierOfferStatus.SUBMITTED,
        submittedByUserId: user.sub,
      },
    });

    await this.audit.record({
      userId: user.sub,
      action: 'supplier-offer:submitted',
      entity: 'SupplierOffer',
      entityId: offer.id,
      metadata: {
        ref: offer.ref,
        supplierCode: supplier.code,
        kind: offer.kind,
        brand: offer.brand,
        model: offer.model,
        vin: offer.vin,
        // Recorded so a later argument about condition can be settled against what was
        // actually said at submission, not against what was said afterwards.
        accidentHistoryStated: offer.accidentHistory !== null,
        batterySohPct: offer.batterySohPct,
      },
    });

    return present(offer);
  }

  /** The supplier's own offers. Scoped by grant; no supplier id is ever accepted. */
  async listMine(
    user: JwtUserPayload | undefined,
    status?: SupplierOfferStatus,
  ) {
    const supplierId = await this.suppliers.resolveSupplierIdFor(user);
    const rows = await this.prisma.supplierOffer.findMany({
      where: { supplierId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        documents: {
          select: {
            id: true,
            kind: true,
            originalName: true,
            sizeBytes: true,
            uploadedAt: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      ...present(row),
      // Internal review notes are staff's. The supplier sees the decision and, when
      // declined, the reason — never the deliberation.
      reviewNote: undefined,
      reviewedByUserId: undefined,
    }));
  }

  /**
   * One offer, for the supplier who owns it.
   *
   * Fetched by id and then checked against the caller's supplier — belt and braces on
   * purpose. A `where` clause is easy to widen by accident in a later edit; an explicit
   * assertion on the row that is about to be returned is not.
   */
  async findMine(offerId: string, user: JwtUserPayload | undefined) {
    const supplierId = await this.suppliers.resolveSupplierIdFor(user);
    const offer = await this.prisma.supplierOffer.findUnique({
      where: { id: offerId },
      include: { documents: true },
    });
    if (!offer) throw new NotFoundException(SUPPLIER_REFUSAL);
    assertOwnSupplierRecord(supplierId, offer.supplierId);

    return {
      ...present(offer),
      reviewNote: undefined,
      reviewedByUserId: undefined,
    };
  }

  /** Withdraw an offer that has not been decided. Declining is UZA's; withdrawing is theirs. */
  async withdraw(offerId: string, user: JwtUserPayload | undefined) {
    const supplierId = await this.suppliers.resolveSupplierIdFor(user);
    const offer = await this.prisma.supplierOffer.findUnique({
      where: { id: offerId },
      select: { id: true, supplierId: true, ref: true, status: true },
    });
    if (!offer) throw new NotFoundException(SUPPLIER_REFUSAL);
    assertOwnSupplierRecord(supplierId, offer.supplierId);

    if (
      offer.status === SupplierOfferStatus.CONVERTED_TO_ORDER ||
      offer.status === SupplierOfferStatus.DECLINED
    ) {
      throw new BadRequestException(
        `This offer is already ${offer.status} and cannot be withdrawn.`,
      );
    }

    const updated = await this.prisma.supplierOffer.update({
      where: { id: offer.id },
      data: {
        status: SupplierOfferStatus.DECLINED,
        declinedReason: 'Withdrawn by the supplier.',
        reviewedAt: new Date(),
      },
    });

    await this.audit.record({
      userId: user?.sub,
      action: 'supplier-offer:withdrawn',
      entity: 'SupplierOffer',
      entityId: updated.id,
      metadata: { ref: updated.ref, statusBefore: offer.status },
    });

    return present(updated);
  }

  // ── Staff review ─────────────────────────────────────────────────────────────────

  /** Everything waiting for a decision, across all suppliers. Staff only. */
  async listForStaff(filter: {
    status?: SupplierOfferStatus;
    supplierId?: string;
    kind?: SupplierOfferKind;
  }) {
    const where: Prisma.SupplierOfferWhereInput = {};
    where.status = filter.status ?? {
      in: [SupplierOfferStatus.SUBMITTED, SupplierOfferStatus.UNDER_REVIEW],
    };
    if (filter.supplierId) where.supplierId = filter.supplierId;
    if (filter.kind) where.kind = filter.kind;

    const rows = await this.prisma.supplierOffer.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        supplier: {
          select: { id: true, code: true, legalName: true, kind: true },
        },
        documents: {
          select: {
            id: true,
            kind: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            uploadedAt: true,
          },
        },
      },
    });

    return rows.map((row) => present(row));
  }

  async findForStaff(offerId: string) {
    const offer = await this.prisma.supplierOffer.findUnique({
      where: { id: offerId },
      include: { supplier: true, documents: true },
    });
    if (!offer) throw new NotFoundException('No such offer.');
    return present(offer);
  }

  /** Pick it up for review. Visible to the supplier as UNDER_REVIEW; the note is not. */
  async startReview(
    offerId: string,
    dto: ReviewSupplierOfferDto,
    actor: JwtUserPayload | undefined,
  ) {
    const offer = await this.requireDecidable(offerId);

    const updated = await this.prisma.supplierOffer.update({
      where: { id: offer.id },
      data: {
        status: SupplierOfferStatus.UNDER_REVIEW,
        reviewedByUserId: actor?.sub ?? null,
        reviewedAt: new Date(),
        reviewNote: dto.note?.trim() || null,
      },
    });

    await this.audit.record({
      userId: actor?.sub,
      action: 'supplier-offer:under-review',
      entity: 'SupplierOffer',
      entityId: updated.id,
      metadata: { ref: updated.ref, statusBefore: offer.status },
    });

    return present(updated);
  }

  /**
   * Accept. The offer becomes CONVERTED_TO_ORDER and records which SupplyOrder it became.
   *
   * It does NOT create the order. Writing an Addendum is the supply-chain flow's job and
   * carries its own gates — route, price basis, deposit percentages, an accepted evidence
   * pack per VIN. An accept here is the sourcing decision, and the link is the audit trail
   * between the two.
   */
  async accept(
    offerId: string,
    dto: ReviewSupplierOfferDto,
    actor: JwtUserPayload | undefined,
  ) {
    const offer = await this.requireDecidable(offerId);

    if (dto.convertedSupplyOrderId) {
      const order = await this.prisma.supplyOrder.findUnique({
        where: { id: dto.convertedSupplyOrderId },
        select: { id: true, supplierId: true, ref: true },
      });
      if (!order) throw new BadRequestException('No such supply order.');
      if (order.supplierId !== offer.supplierId) {
        throw new BadRequestException(
          "That supply order belongs to a different supplier. An offer cannot be converted into another supplier's order.",
        );
      }
    }

    const updated = await this.prisma.supplierOffer.update({
      where: { id: offer.id },
      data: {
        status: SupplierOfferStatus.CONVERTED_TO_ORDER,
        convertedSupplyOrderId: dto.convertedSupplyOrderId ?? null,
        reviewedByUserId: actor?.sub ?? null,
        reviewedAt: new Date(),
        reviewNote: dto.note?.trim() || null,
      },
    });

    await this.audit.record({
      userId: actor?.sub,
      action: 'supplier-offer:accepted',
      entity: 'SupplierOffer',
      entityId: updated.id,
      metadata: {
        ref: updated.ref,
        statusBefore: offer.status,
        convertedSupplyOrderId: updated.convertedSupplyOrderId,
        vin: updated.vin,
      },
    });

    return present(updated);
  }

  async decline(
    offerId: string,
    dto: DeclineSupplierOfferDto,
    actor: JwtUserPayload | undefined,
  ) {
    const offer = await this.requireDecidable(offerId);

    const updated = await this.prisma.supplierOffer.update({
      where: { id: offer.id },
      data: {
        status: SupplierOfferStatus.DECLINED,
        declinedReason: dto.reason.trim(),
        reviewedByUserId: actor?.sub ?? null,
        reviewedAt: new Date(),
      },
    });

    await this.audit.record({
      userId: actor?.sub,
      action: 'supplier-offer:declined',
      entity: 'SupplierOffer',
      entityId: updated.id,
      metadata: {
        ref: updated.ref,
        statusBefore: offer.status,
        reason: updated.declinedReason,
      },
    });

    return present(updated);
  }

  private async requireDecidable(offerId: string) {
    const offer = await this.prisma.supplierOffer.findUnique({
      where: { id: offerId },
      select: { id: true, ref: true, status: true, supplierId: true },
    });
    if (!offer) throw new NotFoundException('No such offer.');
    if (
      offer.status === SupplierOfferStatus.CONVERTED_TO_ORDER ||
      offer.status === SupplierOfferStatus.DECLINED
    ) {
      throw new BadRequestException(
        `This offer is already ${offer.status}. A decided offer is not decided again — the record of what was represented has to stay as it was.`,
      );
    }
    return offer;
  }

  /** OFF-<year>-000001, derived from the highest existing ref, as elsewhere in this repo. */
  private async nextRef(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `OFF-${year}-`;
    const newest = await this.prisma.supplierOffer.findFirst({
      where: { ref: { startsWith: prefix } },
      orderBy: { ref: 'desc' },
      select: { ref: true },
    });
    const next = newest?.ref
      ? Number.parseInt(newest.ref.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(Number.isNaN(next) ? 1 : next).padStart(6, '0')}`;
  }
}

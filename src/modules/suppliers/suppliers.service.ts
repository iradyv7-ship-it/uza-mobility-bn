import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PartyScope,
  Prisma,
  SupplierKind,
  SupplierStatus,
} from '@prisma/client';
import { genSaltSync, hashSync } from 'bcryptjs';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtUserPayload } from '../../users/users.types';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import type {
  ApproveSupplierRegistrationDto,
  RejectSupplierRegistrationDto,
} from './dto/decide-supplier-registration.dto';
import type { RegisterSupplierDto } from './dto/register-supplier.dto';
import type { UpdateSupplierDto } from './dto/update-supplier.dto';
import {
  SUPPLIER_PORTAL_ROLE,
  supplierIdForGrant,
  type CounterpartyGrant,
} from './supplier-access';

/**
 * The supplier side of the supply chain: who UZA may buy from, and who may sign in on
 * their behalf.
 *
 * Two audiences, one service, and the difference between them is the whole design:
 *
 *   · UZA staff create and amend suppliers, and approve or refuse the ones who apply.
 *   · A supplier's own user sees exactly one Supplier — theirs — and only because a
 *     `CounterpartyAccess` row says so. There is no route on which a supplier passes a
 *     supplier id.
 *
 * Self-registration deliberately lands as PROSPECT with NO grant. An applicant gets an
 * account they can sign in with; they get sight of nothing until a human approves. That
 * separation is what makes the endpoint safe to leave unauthenticated.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Staff CRUD ───────────────────────────────────────────────────────────────────

  async create(dto: CreateSupplierDto, actor: JwtUserPayload | undefined) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.supplier.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException(
        `A supplier with code ${code} already exists.`,
      );
    }

    const supplier = await this.prisma.supplier.create({
      data: {
        code,
        legalName: dto.legalName.trim(),
        kind: dto.kind,
        status: dto.status ?? SupplierStatus.PROSPECT,
        country: dto.country.trim(),
        registrationNo: dto.registrationNo?.trim() || null,
        addressLine: dto.addressLine?.trim() || null,
        contactName: dto.contactName?.trim() || null,
        contactPhone: dto.contactPhone?.trim() || null,
        contactEmail: dto.contactEmail?.trim().toLowerCase() || null,
        defaultCurrency: dto.defaultCurrency?.trim().toUpperCase() || 'RWF',
      },
    });

    await this.audit.record({
      userId: actor?.sub,
      action: 'supplier:create',
      entity: 'Supplier',
      entityId: supplier.id,
      metadata: {
        code: supplier.code,
        legalName: supplier.legalName,
        kind: supplier.kind,
        status: supplier.status,
      },
    });

    return supplier;
  }

  async list(filter: {
    status?: SupplierStatus;
    kind?: SupplierKind;
    q?: string;
  }) {
    const where: Prisma.SupplierWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.kind) where.kind = filter.kind;
    if (filter.q?.trim()) {
      const q = filter.q.trim();
      where.OR = [
        { legalName: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.supplier.findMany({
      where,
      orderBy: [{ status: 'asc' }, { legalName: 'asc' }],
      include: { _count: { select: { offers: true, orders: true } } },
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        bankAccounts: { where: { isActive: true } },
        agreements: { where: { terminatedAt: null } },
        _count: { select: { offers: true, orders: true } },
      },
    });
    if (!supplier) throw new NotFoundException('No such supplier.');
    return supplier;
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    actor: JwtUserPayload | undefined,
  ) {
    const before = await this.prisma.supplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('No such supplier.');

    const data: Prisma.SupplierUpdateInput = {};
    if (dto.legalName !== undefined) data.legalName = dto.legalName.trim();
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.country !== undefined) data.country = dto.country.trim();
    if (dto.registrationNo !== undefined)
      data.registrationNo = dto.registrationNo?.trim() || null;
    if (dto.addressLine !== undefined)
      data.addressLine = dto.addressLine?.trim() || null;
    if (dto.contactName !== undefined)
      data.contactName = dto.contactName?.trim() || null;
    if (dto.contactPhone !== undefined)
      data.contactPhone = dto.contactPhone?.trim() || null;
    if (dto.contactEmail !== undefined)
      data.contactEmail = dto.contactEmail?.trim().toLowerCase() || null;
    if (dto.defaultCurrency !== undefined)
      data.defaultCurrency = dto.defaultCurrency?.trim().toUpperCase() || 'RWF';

    const supplier = await this.prisma.supplier.update({ where: { id }, data });

    await this.audit.record({
      userId: actor?.sub,
      action: 'supplier:update',
      entity: 'Supplier',
      entityId: supplier.id,
      metadata: {
        code: supplier.code,
        changed: Object.keys(data),
        statusBefore: before.status,
        statusAfter: supplier.status,
      },
    });

    return supplier;
  }

  // ── Self-registration ────────────────────────────────────────────────────────────

  /**
   * A supplier applies. Creates a PROSPECT Supplier and an ordinary UZA User holding
   * SUPPLIER_PORTAL — and deliberately NO `CounterpartyAccess` grant, so the account can
   * sign in and see nothing until staff approve.
   *
   * Both writes happen in one transaction: an account with no company, or a company with
   * nobody who can be reached, are each worse than a failed submission.
   */
  async register(
    dto: RegisterSupplierDto,
    auditContext: RequestAuditContext = {},
  ) {
    const email = dto.email.trim().toLowerCase();
    const legalName = dto.legalName.trim();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, deletedAt: true, isActive: true },
    });
    if (existingUser && !existingUser.deletedAt && existingUser.isActive) {
      // Same wording as AuthService.register — this endpoint must not become an oracle
      // for which addresses hold UZA accounts.
      throw new ConflictException('Email already in use');
    }

    const duplicate = await this.prisma.supplier.findFirst({
      where: { legalName: { equals: legalName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'A supplier is already registered under that legal name. Contact UZA sourcing rather than registering twice.',
      );
    }

    const passwordHash = hashSync(dto.password, genSaltSync(10));

    const { supplier, userId } = await this.prisma.$transaction(async (tx) => {
      const createdSupplier = await tx.supplier.create({
        data: {
          code: await this.nextProspectCode(tx),
          legalName,
          kind: dto.kind,
          status: SupplierStatus.PROSPECT,
          country: dto.country.trim(),
          registrationNo: dto.registrationNo?.trim() || null,
          addressLine: dto.addressLine?.trim() || null,
          contactName: `${dto.firstName} ${dto.lastName}`.trim(),
          contactPhone: dto.phone?.trim() || null,
          contactEmail: email,
          defaultCurrency: dto.defaultCurrency?.trim().toUpperCase() || 'USD',
        },
      });

      const createdUser = await tx.user.create({
        data: {
          email,
          phone: dto.phone?.trim() || null,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          preferredLanguage: dto.preferredLanguage ?? 'en',
          roles: {
            create: [{ role: { connect: { name: SUPPLIER_PORTAL_ROLE } } }],
          },
        },
        select: { id: true },
      });

      return { supplier: createdSupplier, userId: createdUser.id };
    });

    await this.audit.record({
      userId,
      action: 'supplier:register',
      entity: 'Supplier',
      entityId: supplier.id,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: {
        email,
        legalName: supplier.legalName,
        kind: supplier.kind,
        country: supplier.country,
        // Stated plainly so a later reader is in no doubt: registering grants nothing.
        grantWritten: false,
      },
    });

    return {
      message:
        'Registration received. UZA sourcing will review it. You can sign in now, but your catalogue opens once your company is approved.',
      supplier: {
        id: supplier.id,
        legalName: supplier.legalName,
        status: supplier.status,
      },
    };
  }

  /** PROSPECT codes are provisional and replaced at approval. Collision-safe by sequence. */
  private async nextProspectCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `SUP-P-${year}-`;
    const newest = await tx.supplier.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const next = newest?.code
      ? Number.parseInt(newest.code.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(Number.isNaN(next) ? 1 : next).padStart(4, '0')}`;
  }

  // ── Staff review of registrations ────────────────────────────────────────────────

  /** Everything waiting for a human: PROSPECT suppliers, oldest first. */
  async listPendingRegistrations() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { status: SupplierStatus.PROSPECT },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { offers: true } } },
    });

    // The applicant's account is matched on contactEmail — suppliers created by staff have
    // no user behind them at all, and that is a normal and expected shape here.
    const emails = suppliers
      .map((s) => s.contactEmail)
      .filter((e): e is string => Boolean(e));
    const users = emails.length
      ? await this.prisma.user.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : [];
    const byEmail = new Map(users.map((u) => [u.email, u]));

    return suppliers.map((s) => ({
      ...s,
      applicant: s.contactEmail ? (byEmail.get(s.contactEmail) ?? null) : null,
    }));
  }

  /**
   * Approve: ACTIVE, a permanent code, and — the part that actually matters — the
   * `CounterpartyAccess` grant that opens the portal for this applicant's account.
   */
  async approveRegistration(
    supplierId: string,
    dto: ApproveSupplierRegistrationDto,
    actor: JwtUserPayload | undefined,
  ) {
    if (!actor?.sub) throw new UnauthorizedException();

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) throw new NotFoundException('No such supplier.');
    if (supplier.status !== SupplierStatus.PROSPECT) {
      throw new BadRequestException(
        `This supplier is already ${supplier.status}. Only a PROSPECT is approved.`,
      );
    }

    const code =
      dto.code?.trim().toUpperCase() ?? this.deriveCode(supplier.legalName);
    const clash = await this.prisma.supplier.findFirst({
      where: { code, id: { not: supplier.id } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `Code ${code} is taken. Pass a different one in "code".`,
      );
    }

    const applicant = supplier.contactEmail
      ? await this.prisma.user.findUnique({
          where: { email: supplier.contactEmail },
          select: { id: true, email: true },
        })
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.supplier.update({
        where: { id: supplier.id },
        data: { code, status: SupplierStatus.ACTIVE },
      });

      if (applicant) {
        // Upsert, not create: re-approving a supplier whose grant was revoked must
        // restore it rather than fail on the unique userId.
        await tx.counterpartyAccess.upsert({
          where: { userId: applicant.id },
          create: {
            userId: applicant.id,
            scope: PartyScope.SUPPLIER,
            supplierId: row.id,
            grantedBy: actor.sub,
          },
          update: {
            scope: PartyScope.SUPPLIER,
            supplierId: row.id,
            grantedBy: actor.sub,
            grantedAt: new Date(),
            revokedAt: null,
          },
        });
      }

      return row;
    });

    await this.audit.record({
      userId: actor.sub,
      action: 'supplier:registration-approved',
      entity: 'Supplier',
      entityId: updated.id,
      metadata: {
        code: updated.code,
        legalName: updated.legalName,
        note: dto.note?.trim() || null,
        grantedToUserId: applicant?.id ?? null,
        // If this is false the company is live but nobody can sign in for it. Staff need
        // to see that in the log rather than discover it from a confused supplier.
        grantWritten: Boolean(applicant),
      },
    });

    return { ...updated, portalOpenedFor: applicant?.email ?? null };
  }

  /**
   * Reject: CLOSED, with the reason in the log. The account and the row both stay — a
   * rejected application that vanishes cannot be appealed or audited.
   */
  async rejectRegistration(
    supplierId: string,
    dto: RejectSupplierRegistrationDto,
    actor: JwtUserPayload | undefined,
  ) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) throw new NotFoundException('No such supplier.');
    if (supplier.status !== SupplierStatus.PROSPECT) {
      throw new BadRequestException(
        `This supplier is already ${supplier.status}. Only a PROSPECT is rejected.`,
      );
    }

    const updated = await this.prisma.supplier.update({
      where: { id: supplier.id },
      data: { status: SupplierStatus.CLOSED },
    });

    await this.audit.record({
      userId: actor?.sub,
      action: 'supplier:registration-rejected',
      entity: 'Supplier',
      entityId: updated.id,
      metadata: {
        code: updated.code,
        legalName: updated.legalName,
        reason: dto.reason.trim(),
      },
    });

    return updated;
  }

  private deriveCode(legalName: string): string {
    const slug = legalName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 2)
      .join('-');
    return `SUP-${slug || 'UNNAMED'}`.slice(0, 32);
  }

  // ── The partition ────────────────────────────────────────────────────────────────

  /**
   * The supplier this signed-in user acts for.
   *
   * The only place a supplier id is ever resolved for a portal caller. No route takes one
   * from the caller, so there is no id to tamper with — see the PARTITIONS block in
   * `schema.prisma`: "SUPPLIER scope -> SupplyOrder WHERE supplierId = theirs."
   */
  async resolveSupplierIdFor(
    user: JwtUserPayload | undefined,
  ): Promise<string> {
    if (!user?.sub) throw new UnauthorizedException();
    const grant: CounterpartyGrant | null =
      await this.prisma.counterpartyAccess.findUnique({
        where: { userId: user.sub },
        select: { scope: true, supplierId: true, revokedAt: true },
      });
    return supplierIdForGrant(grant);
  }

  /** The portal's own "who am I" — the supplier's own record, and nothing around it. */
  async myProfile(user: JwtUserPayload | undefined) {
    const supplierId = await this.resolveSupplierIdFor(user);
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        code: true,
        legalName: true,
        kind: true,
        status: true,
        country: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        defaultCurrency: true,
        createdAt: true,
      },
    });
    if (!supplier) throw new NotFoundException('No such supplier.');
    return supplier;
  }

  /**
   * The supplier's own orders — order and money, which is all a supplier ever sees of a
   * vehicle. Never financing, never a listing price, never another supplier's anything.
   */
  async myOrders(user: JwtUserPayload | undefined) {
    const supplierId = await this.resolveSupplierIdFor(user);
    const orders = await this.prisma.supplyOrder.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ref: true,
        status: true,
        route: true,
        priceBasis: true,
        currency: true,
        orderValueMinor: true,
        depositPct: true,
        arrivalPct: true,
        signedOn: true,
        etaOn: true,
        landedOn: true,
        settledOn: true,
        vehicles: {
          select: {
            id: true,
            vin: true,
            brand: true,
            model: true,
            year: true,
            priceMinor: true,
            balanceDueMinor: true,
            balancePaidOn: true,
            securityReleasedOn: true,
            // listingId and managedVehicleId are deliberately NOT selected. They are the
            // fields that cross the partition, and they cross it inward only.
          },
        },
      },
    });

    return orders.map((o) => ({
      ...o,
      orderValueMinor: Number(o.orderValueMinor),
      vehicles: o.vehicles.map((v) => ({
        ...v,
        priceMinor: Number(v.priceMinor),
        balanceDueMinor:
          v.balanceDueMinor === null ? null : Number(v.balanceDueMinor),
      })),
    }));
  }
}

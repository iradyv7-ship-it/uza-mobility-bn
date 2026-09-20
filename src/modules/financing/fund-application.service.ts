import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  contributionBandPct,
  requiredContributionRwf,
} from './empower-support.rules';
import type { CreateFundApplicationDto } from './dto/create-fund-application.dto';
import type { SignFundApplicationDto } from './dto/sign-fund-application.dto';
import {
  consentCaptureFor,
  assertSubmittable,
  isBlockedAtIntake,
  screenApplication,
  type ScreeningGap,
} from './fund-application.rules';

/**
 * Taking an application, signing it, and screening it.
 *
 * The rules live in `fund-application.rules.ts` as pure functions. This is the part that
 * touches the database.
 *
 * ── THE ONE INVARIANT ─────────────────────────────────────────────────────────────────
 *
 * A signed application is not editable. Somebody put their name to a set of answers, and
 * changing them afterwards rewrites what they signed. `update()` refuses once `signedAt`
 * is set — a correction is a new application that references the old one, which is slower
 * and is the point.
 */

/** Default required contribution until a lender product is attached. 10% of a 16.0M car. */
const DEFAULT_REQUIRED_CONTRIBUTION_RWF = 1_600_000;

@Injectable()
export class FundApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The next application reference.
   *
   * Derived from the highest existing ref rather than `count() + 1`. The count scheme
   * collides the moment a row is deleted, and it did exactly that in the Nexus register
   * on 24 August — see `platform/ids/next-sequence.ts` there for the full account.
   */
  private async nextRef(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `UZM-APP-${year}-`;

    const newest = await this.prisma.fundApplication.findFirst({
      where: { ref: { startsWith: prefix } },
      orderBy: { ref: 'desc' },
      select: { ref: true },
    });

    const next = newest
      ? Number.parseInt(newest.ref.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(Number.isNaN(next) ? 1 : next).padStart(6, '0')}`;
  }

  /** Start an application. Saves whatever is known; nothing is required beyond identity. */
  async create(dto: CreateFundApplicationDto) {
    // The unchecked variant, because `cohortId` is written as a scalar foreign key rather
    // than through a nested `connect`. A cohort may not exist yet on the day a driver
    // applies, and requiring one at the door would block the first cohort's own intake.
    const data: Prisma.FundApplicationUncheckedCreateInput = {
      ref: await this.nextRef(),
      fullName: dto.fullName,
      nationalId: dto.nationalId,
      phone: dto.phone,
      district: dto.district,
      ...this.toData(dto),
      status: 'DRAFT',
    };
    return this.prisma.fundApplication.create({ data });
  }

  /**
   * Amend a draft.
   *
   * Refuses once signed. This is the invariant the whole record depends on: if a signed
   * application could be edited, the signature would attest to nothing in particular.
   */
  async update(id: string, dto: Partial<CreateFundApplicationDto>) {
    const existing = await this.prisma.fundApplication.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('No such application.');

    if (existing.signedAt) {
      throw new BadRequestException(
        'This application has been signed and cannot be changed. Record a new application instead.',
      );
    }

    return this.prisma.fundApplication.update({
      where: { id },
      data: this.toData(dto),
    });
  }

  /**
   * Sign and submit.
   *
   * One operation rather than two, because an application that is signed but not
   * submitted is a state nobody wants to be in — the driver has gone home and the form
   * sits in a drawer. `assertSubmittable` runs first, so an incomplete form is refused
   * BEFORE a signature is captured rather than after.
   */
  async sign(id: string, dto: SignFundApplicationDto) {
    const existing = await this.prisma.fundApplication.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('No such application.');
    if (existing.signedAt) {
      throw new BadRequestException(
        'This application has already been signed.',
      );
    }

    const now = new Date();
    assertSubmittable({
      ...existing,
      signedAt: now,
      signatureRef: dto.signatureRef,
    });

    const signed = await this.prisma.fundApplication.update({
      where: { id },
      data: {
        signedAt: now,
        signatureRef: dto.signatureRef,
        ...(dto.witnessName ? { witnessName: dto.witnessName } : {}),
        ...(dto.witnessRef ? { witnessRef: dto.witnessRef } : {}),
        submittedAt: now,
        status: 'SUBMITTED',
      },
    });

    // Consent to a named lender is captured here rather than at screening, because this
    // is the moment the applicant actually agreed to it in front of somebody.
    //
    // Anchored to the APPLICATION, not to a UZA ID. An applicant signing at intake has no
    // UZA ID yet — that is issued when they become a participant — and an earlier version
    // of this method skipped the capture entirely when `uzaId` was null. That silently
    // dropped consent for every first-time applicant, which is the entire first cohort:
    // the driver ticks the box, signs in front of a witness, and the system records
    // nothing. Consent is evidence of an event, so it is written when the event happens
    // and reconciled onto the UZA ID later.
    const capture = consentCaptureFor(signed);
    if (capture) {
      await this.prisma.lenderConsent.upsert({
        where: {
          fundApplicationId_lenderKey: {
            fundApplicationId: capture.fundApplicationId,
            lenderKey: capture.lenderKey,
          },
        },
        create: {
          ...capture,
          ...(signed.assistedByRef
            ? { capturedByRef: signed.assistedByRef }
            : {}),
          note: `Captured on application ${signed.ref}`,
        },
        update: { grantedAt: now, withdrawnAt: null, uzaId: capture.uzaId },
      });
    }

    return signed;
  }

  /**
   * What stands between this applicant and a loan.
   *
   * Returns gaps, never a verdict. `blockedAtIntake` is true only for a missing licence
   * or missing identity documents — being poor, unbanked or without a credit file is the
   * condition this fund exists to address, not a reason to turn somebody away.
   */
  async screen(
    id: string,
    requiredContributionOverrideRwf?: number,
    vehiclePriceRwf?: number,
  ): Promise<{
    ref: string;
    gaps: ScreeningGap[];
    blockedAtIntake: boolean;
    basis: {
      requiredContributionRwf: number;
      vehiclePriceRwf: number | null;
      bandPct: number | null;
    };
  }> {
    const app = await this.prisma.fundApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('No such application.');

    // The required contribution comes from the vehicle's price through the band Unguka
    // agreed (10% of price; Unguka extended it to the BYDs on 20 Sept 2026) — the same rule the support plan uses — when a
    // price is known. An explicit override still wins for what-if screening. The flat
    // default remains only for an application with no vehicle priced yet.
    let required = DEFAULT_REQUIRED_CONTRIBUTION_RWF;
    let bandPct: number | null = null;
    if (requiredContributionOverrideRwf) {
      required = requiredContributionOverrideRwf;
    } else if (vehiclePriceRwf && vehiclePriceRwf > 0) {
      required = requiredContributionRwf(vehiclePriceRwf);
      bandPct = contributionBandPct(vehiclePriceRwf);
    }

    const gaps = screenApplication(app, { requiredContributionRwf: required });
    return {
      ref: app.ref,
      gaps,
      blockedAtIntake: isBlockedAtIntake(gaps),
      basis: {
        requiredContributionRwf: required,
        vehiclePriceRwf: vehiclePriceRwf ?? null,
        bandPct,
      },
    };
  }

  async findOne(id: string) {
    const app = await this.prisma.fundApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('No such application.');
    return app;
  }

  async list(cohortId?: string, status?: string) {
    return this.prisma.fundApplication.findMany({
      where: {
        ...(cohortId ? { cohortId } : {}),
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Map the DTO's ISO date strings onto Date, and drop keys that were not sent.
   *
   * Undefined keys are omitted rather than written as null, so a PATCH that mentions
   * three fields leaves the other thirty alone instead of clearing them.
   */
  private toData(
    dto: Partial<CreateFundApplicationDto>,
  ): Partial<Prisma.FundApplicationUncheckedCreateInput> {
    // The CREATE shape rather than the update shape, because every value here is a plain
    // scalar. Prisma's update inputs also admit operation objects (`{ set: ... }`), and a
    // value typed that way cannot be spread into a create.
    const { dateOfBirth, licenceExpiry, ...rest } = dto;
    const data: Partial<Prisma.FundApplicationUncheckedCreateInput> = {};

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        (data as Record<string, unknown>)[key] = value;
      }
    }
    if (dateOfBirth) data.dateOfBirth = new Date(dateOfBirth);
    if (licenceExpiry) data.licenceExpiry = new Date(licenceExpiry);

    return data;
  }
}

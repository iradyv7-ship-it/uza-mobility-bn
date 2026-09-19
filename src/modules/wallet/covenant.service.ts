import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { lenderRoleFor } from '../financing/lender-access';
import type { InspectionFinding } from '../workshop/inspection.rules';
import { evaluateCovenants, worstOf, type Covenant } from './covenant.rules';
import { performance } from './wallet.rules';
import { WalletService } from './wallet.service';

/**
 * Runs the covenant rules for every active loan and delivers each warning to its audience.
 *
 * Three audiences, three portals, one message. The driver sees it on their wallet; UZA
 * finance sees it in the admin app; the lender of record sees it in its portal — but only
 * where the borrower's consent for that lender is live, because a warning that names a
 * borrower is a disclosure. Nothing reaches a lender at NOTICE severity.
 *
 * Deduplicated per day per condition via `dedupeKey`, recorded in the activity log, so the
 * 07:00 run and an on-demand run in the same day do not both notify.
 */
@Injectable()
export class CovenantService {
  private readonly log = new Logger(CovenantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 07:00 Kigali (CAT, UTC+2) = 05:00 UTC. After yesterday's deposits have settled. */
  @Cron('0 5 * * *')
  async morningRun() {
    const result = await this.runAll();
    this.log.log(
      `Covenant run: ${result.loans} loans, ${result.raised} warnings raised, ${result.notified} notifications.`,
    );
  }

  async runAll(now = new Date()) {
    const loans = await this.prisma.loan.findMany({
      where: { status: { in: ['ACTIVE', 'IN_ARREARS', 'DISBURSED'] } },
      select: { id: true },
    });
    let raised = 0;
    let notified = 0;
    for (const l of loans) {
      const r = await this.runForLoan(l.id, now, true);
      raised += r.covenants.length;
      notified += r.notified;
    }
    return { loans: loans.length, raised, notified };
  }

  /** Evaluate one loan. `deliver=false` computes without notifying — used by the portals' reads. */
  async runForLoan(loanId: string, now = new Date(), deliver = false) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        borrower: {
          select: { id: true, uzaId: true, firstName: true, lastName: true },
        },
        bank: { select: { lenderKey: true, name: true } },
      },
    });
    if (!loan) return { covenants: [] as Covenant[], notified: 0, worst: null };

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: loan.borrowerUserId },
    });
    const lines = wallet
      ? (
          await this.prisma.ledgerEntry.findMany({
            where: { walletId: wallet.id },
          })
        ).map((r) => ({
          bucket: r.bucket,
          direction: r.direction,
          amountRwf: Number(r.amountRwf),
          occurredAt: r.occurredAt,
          confirmedAt: r.confirmedAt,
          recordedBy: r.recordedBy,
          reason: r.reason,
        }))
      : [];
    const perf = performance(
      lines,
      wallet?.dailyTargetRwf ?? null,
      wallet?.contributionTargetRwf ?? null,
      now,
    );

    const last = await this.prisma.vehicleInspection.findFirst({
      where: { loanId },
      orderBy: { inspectedAt: 'desc' },
    });
    const findings =
      (last?.findings as unknown as InspectionFinding[] | null) ?? [];
    const openSafety = findings.filter(
      (f) => f.severity === 'SAFETY' && !f.resolvedAt,
    ).length;

    const comp = await this.prisma.assessment.findMany({
      where: {
        kind: 'COMPREHENSION',
        enrolment: { userId: loan.borrowerUserId },
      },
      orderBy: { assessedAt: 'asc' },
      select: { scorePct: true },
    });

    const covenants = evaluateCovenants({
      now,
      daily: perf.daily,
      dailyTargetRwf: wallet?.dailyTargetRwf ?? null,
      loan: {
        id: loan.id,
        reference: loan.reference,
        disbursedAt: loan.disbursedAt,
        status: loan.status,
        arrearsRwf: loan.arrearsRwf,
        monthlyRwf: loan.monthlyRwf,
      },
      inspection: {
        lastAt: last?.inspectedAt ?? null,
        nextDueAt: last?.nextDueAt ?? null,
        lastPassed: last?.passed ?? null,
        openSafetyFindings: openSafety,
      },
      comprehension:
        comp.length >= 2
          ? {
              previousPct: comp.at(-2)!.scorePct,
              latestPct: comp.at(-1)!.scorePct,
            }
          : null,
    });

    let notified = 0;
    if (deliver && covenants.length) {
      notified = await this.deliver(loan, covenants);
    }
    return {
      covenants,
      notified,
      worst: worstOf(covenants),
      loanRef: loan.reference,
    };
  }

  private async deliver(
    loan: {
      id: string;
      reference: string;
      borrowerUserId: string;
      borrower: { uzaId: string | null; firstName: string; lastName: string };
      bank: { lenderKey: string | null; name: string };
    },
    covenants: Covenant[],
  ): Promise<number> {
    let sent = 0;
    for (const c of covenants) {
      // Once per day per condition, across morning and on-demand runs.
      const already = await this.prisma.activityLog.findFirst({
        where: {
          action: 'covenant:raised',
          entityId: loan.id,
          metadata: { path: ['dedupeKey'], equals: c.dedupeKey },
        },
        select: { id: true },
      });
      if (already) continue;

      const title =
        c.severity === 'ALERT'
          ? 'Loan covenant — action needed'
          : c.severity === 'WARNING'
            ? 'Loan covenant — warning'
            : 'Reminder';

      if (c.audience.includes('DRIVER')) {
        await this.notifications.send({
          userId: loan.borrowerUserId,
          type: NotificationType.SYSTEM_ALERT,
          title,
          body: c.message,
          metadata: { loanId: loan.id, kind: c.kind, severity: c.severity },
          skipEmail: c.severity === 'NOTICE',
        });
        sent += 1;
      }
      if (c.audience.includes('UZA')) {
        await this.notifications.sendToRoleNames(
          ['FINANCE_ADMIN', 'SUPER_ADMIN'],
          {
            type: NotificationType.SYSTEM_ALERT,
            title: `${title} · ${loan.reference}`,
            body: `${loan.borrower.firstName} ${loan.borrower.lastName} (${loan.borrower.uzaId ?? 'no UZA ID'}): ${c.message}`,
            metadata: { loanId: loan.id, kind: c.kind, severity: c.severity },
          },
        );
        sent += 1;
      }
      if (
        c.audience.includes('LENDER') &&
        loan.bank.lenderKey &&
        loan.borrower.uzaId
      ) {
        // The covenant is the borrower's promise to THIS bank; it reaches the bank only with
        // a live consent for this bank. The lender sees the UZA ID and the display name — the
        // same identifiers as everywhere else in its portal — never a phone or national ID.
        const consent = await this.prisma.lenderConsent.findFirst({
          where: {
            uzaId: loan.borrower.uzaId,
            lenderKey: loan.bank.lenderKey,
            withdrawnAt: null,
          },
          select: { id: true },
        });
        if (consent) {
          await this.notifications.sendToRoleNames(
            [lenderRoleFor(loan.bank.lenderKey)],
            {
              type: NotificationType.SYSTEM_ALERT,
              title: `${title} · ${loan.reference}`,
              body: `${loan.borrower.uzaId} — ${loan.borrower.firstName} ${loan.borrower.lastName}: ${c.message}`,
              metadata: { loanId: loan.id, kind: c.kind, severity: c.severity },
            },
          );
          sent += 1;
        }
      }

      await this.prisma.activityLog.create({
        data: {
          action: 'covenant:raised',
          entity: 'Loan',
          entityId: loan.id,
          metadata: {
            dedupeKey: c.dedupeKey,
            kind: c.kind,
            severity: c.severity,
            audience: c.audience,
            detail: c.detail,
          },
        },
      });
    }
    return sent;
  }

  /** Every open covenant across every active loan — UZA's own view, all audiences. */
  async forUza(now = new Date()) {
    const loans = await this.prisma.loan.findMany({
      where: { status: { in: ['ACTIVE', 'IN_ARREARS', 'DISBURSED'] } },
      include: {
        borrower: { select: { uzaId: true, firstName: true, lastName: true } },
        bank: { select: { name: true, lenderKey: true } },
      },
    });
    const out = [];
    for (const l of loans) {
      const r = await this.runForLoan(l.id, now, false);
      if (r.covenants.length) {
        out.push({
          loanId: l.id,
          loanRef: l.reference,
          uzaId: l.borrower.uzaId,
          displayName: `${l.borrower.firstName} ${l.borrower.lastName}`.trim(),
          lender: l.bank.name,
          worst: r.worst,
          covenants: r.covenants.map(
            ({ kind, severity, message, detail, audience }) => ({
              kind,
              severity,
              message,
              detail,
              audience,
            }),
          ),
        });
      }
    }
    const rank = (s: string | null) =>
      s === 'ALERT' ? 0 : s === 'WARNING' ? 1 : 2;
    return {
      generatedAt: now.toISOString(),
      activeLoans: loans.length,
      loansWithWarnings: out.length,
      alerts: out.filter((o) => o.worst === 'ALERT').length,
      rows: out.sort((a, b) => rank(a.worst) - rank(b.worst)),
    };
  }

  /** Every open covenant across a lender's consenting borrowers — the portal's warnings list. */
  async forLender(lenderKey: string, bankId: string, now = new Date()) {
    const consents = await this.prisma.lenderConsent.findMany({
      where: { lenderKey, withdrawnAt: null, uzaId: { not: null } },
      select: { uzaId: true },
    });
    const uzaIds = consents.map((c) => c.uzaId!).filter(Boolean);
    const loans = await this.prisma.loan.findMany({
      where: {
        bankId,
        status: { in: ['ACTIVE', 'IN_ARREARS', 'DISBURSED'] },
        borrower: { uzaId: { in: uzaIds } },
      },
      include: {
        borrower: { select: { uzaId: true, firstName: true, lastName: true } },
      },
    });
    const out = [];
    for (const l of loans) {
      const r = await this.runForLoan(l.id, now, false);
      const visible = r.covenants.filter((c) => c.audience.includes('LENDER'));
      if (visible.length) {
        out.push({
          loanId: l.id,
          loanRef: l.reference,
          uzaId: l.borrower.uzaId,
          displayName: `${l.borrower.firstName} ${l.borrower.lastName}`.trim(),
          worst: worstOf(visible),
          covenants: visible.map(({ kind, severity, message, detail }) => ({
            kind,
            severity,
            message,
            detail,
          })),
        });
      }
    }
    return out.sort(
      (a, b) => (a.worst === 'ALERT' ? -1 : 1) - (b.worst === 'ALERT' ? -1 : 1),
    );
  }
}

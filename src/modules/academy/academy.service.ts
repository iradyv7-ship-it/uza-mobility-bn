import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CURRICULUM,
  nextRetestDue,
  readinessSummary,
  scoreFromAnswers,
  type CurriculumModule,
} from './academy.rules';
import {
  NOT_MEASURED,
  repaymentComparison,
  trainingValue,
} from './impact.rules';
import type { EnrolDto } from './dto/enrol.dto';
import type { RecordAssessmentDto } from './dto/record-assessment.dto';
import type { RecordAttendanceDto } from './dto/record-attendance.dto';

/**
 * The academy: who is enrolled, what they attended and passed, what they scored.
 *
 * Every write here is attributed to the trainer's own user id — the same rule as
 * inspections: a record is always somebody's, never "whoever was logged in." Every read a
 * lender does goes through `LenderService.requireOwnLoan`, so the consent gate applies to
 * training exactly as it does to inspections and savings.
 *
 * Participants are addressed by UZA ID throughout, because that is what is on the card the
 * trainer, the garage and the bank all hold. A participant without a UZA ID has not been
 * admitted and cannot be enrolled.
 */
@Injectable()
export class AcademyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The curriculum lives in code (`academy.rules.ts`) and is mirrored into the table on
   * first use, so a fresh database has the modules without a separate seed step and an
   * existing one picks up a new module the first time anybody asks for the list. Titles and
   * hours follow the code; a module removed from the curriculum is deactivated, not deleted,
   * because attendance already recorded against it must stay readable.
   */
  async ensureModules(): Promise<void> {
    const codes = CURRICULUM.map((m) => m.code);
    await this.prisma.$transaction([
      ...CURRICULUM.map((m) =>
        this.prisma.academyModule.upsert({
          where: { code: m.code },
          create: {
            code: m.code,
            title: m.title,
            kind: m.kind,
            hours: m.hours,
            sequence: m.sequence,
            summary: m.summary,
            deliveredByPartner: m.deliveredByPartner,
            isActive: true,
          },
          update: {
            title: m.title,
            kind: m.kind,
            hours: m.hours,
            sequence: m.sequence,
            summary: m.summary,
            deliveredByPartner: m.deliveredByPartner ?? null,
            isActive: true,
          },
        }),
      ),
      this.prisma.academyModule.updateMany({
        where: { code: { notIn: codes }, isActive: true },
        data: { isActive: false },
      }),
    ]);
  }

  async listModules() {
    await this.ensureModules();
    const rows = await this.prisma.academyModule.findMany({
      where: { isActive: true },
      orderBy: { sequence: 'asc' },
    });
    // The Kinyarwanda title lives in code beside the curriculum, not in the table.
    const rw = new Map(CURRICULUM.map((m) => [m.code, m.titleRw]));
    return rows.map((r) => ({ ...r, titleRw: rw.get(r.code) ?? null }));
  }

  private async requireParticipant(uzaId: string) {
    const user = await this.prisma.user.findUnique({
      where: { uzaId: uzaId.trim().toUpperCase() },
      select: { id: true, uzaId: true, firstName: true, lastName: true },
    });
    if (!user) {
      throw new NotFoundException('No participant with that UZA ID.');
    }
    return user;
  }

  /** The participant's current (non-stopped, non-withdrawn) enrolment, newest first. */
  private async requireActiveEnrolment(userId: string) {
    const enrolment = await this.prisma.enrolment.findFirst({
      where: { userId, status: { in: ['ENROLLED', 'IN_PROGRESS'] } },
      orderBy: { enrolledAt: 'desc' },
    });
    if (!enrolment) {
      throw new BadRequestException(
        'This participant has no active enrolment. Enrol them in a cohort first.',
      );
    }
    return enrolment;
  }

  async enrol(
    trainerUserId: string,
    dto: EnrolDto,
    auditContext: RequestAuditContext = {},
  ) {
    const user = await this.requireParticipant(dto.uzaId);
    const cohort = await this.prisma.cohort.findUnique({
      where: { code: dto.cohortCode.trim() },
    });
    if (!cohort) throw new NotFoundException('No cohort with that code.');

    const enrolment = await this.prisma.enrolment.upsert({
      where: { userId_cohortId: { userId: user.id, cohortId: cohort.id } },
      create: { userId: user.id, cohortId: cohort.id, status: 'ENROLLED' },
      update: {},
      include: { cohort: { select: { code: true, name: true } } },
    });

    await this.auditService.record({
      userId: trainerUserId,
      action: 'academy:enrolled',
      entity: 'Enrolment',
      entityId: enrolment.id,
      metadata: { uzaId: user.uzaId, cohortCode: cohort.code },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });
    return enrolment;
  }

  async recordAttendance(
    trainerUserId: string,
    dto: RecordAttendanceDto,
    auditContext: RequestAuditContext = {},
  ) {
    await this.ensureModules();
    const user = await this.requireParticipant(dto.uzaId);
    const enrolment = await this.requireActiveEnrolment(user.id);
    const module = await this.prisma.academyModule.findUnique({
      where: { code: dto.moduleCode.trim() },
    });
    if (!module || !module.isActive) {
      throw new NotFoundException(
        `No active module ${dto.moduleCode}. See GET /academy/modules.`,
      );
    }

    // One row per module per enrolment (the schema's unique key). A re-sit — normal,
    // private, unlimited — updates the row to the latest sitting; every attempt, passed
    // or not, is kept in the activity log below, so "passed on the second sitting" is
    // still readable by anyone who needs the history.
    const attendedAt = dto.attendedAt ? new Date(dto.attendedAt) : new Date();
    const prior = await this.prisma.moduleAttendance.findUnique({
      where: {
        enrolmentId_moduleId: {
          enrolmentId: enrolment.id,
          moduleId: module.id,
        },
      },
      select: { passed: true },
    });
    const row = await this.prisma.moduleAttendance.upsert({
      where: {
        enrolmentId_moduleId: {
          enrolmentId: enrolment.id,
          moduleId: module.id,
        },
      },
      create: {
        enrolmentId: enrolment.id,
        moduleId: module.id,
        attendedAt,
        assessorId: trainerUserId,
        passed: dto.passed,
        notes: dto.notes,
      },
      update: {
        attendedAt,
        assessorId: trainerUserId,
        passed: dto.passed,
        notes: dto.notes,
      },
    });

    if (enrolment.status === 'ENROLLED') {
      await this.prisma.enrolment.update({
        where: { id: enrolment.id },
        data: { status: 'IN_PROGRESS' },
      });
    }

    await this.auditService.record({
      userId: trainerUserId,
      action: 'academy:attendance-recorded',
      entity: 'ModuleAttendance',
      entityId: row.id,
      metadata: {
        uzaId: user.uzaId,
        moduleCode: module.code,
        passed: dto.passed,
        resit: prior !== null,
        previouslyPassed: prior?.passed ?? null,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });
    return { ...row, moduleCode: module.code, moduleTitle: module.title };
  }

  async recordAssessment(
    trainerUserId: string,
    dto: RecordAssessmentDto,
    auditContext: RequestAuditContext = {},
  ) {
    const user = await this.requireParticipant(dto.uzaId);
    const enrolment = await this.requireActiveEnrolment(user.id);

    let scorePct: number;
    if (dto.kind === 'COMPREHENSION') {
      if (dto.scorePct !== undefined) {
        throw new BadRequestException(
          'A comprehension score is computed from the six recorded answers; do not send scorePct.',
        );
      }
      if (!dto.answers?.length) {
        throw new BadRequestException(
          'A comprehension assessment needs the six recorded answers.',
        );
      }
      scorePct = scoreFromAnswers(dto.answers);
    } else {
      if (dto.scorePct === undefined) {
        throw new BadRequestException(`${dto.kind} needs a scorePct.`);
      }
      scorePct = dto.scorePct;
    }

    // Which re-test is this, and when is the next one due? Counted from the original.
    let retestNumber: 0 | 1 | 2 = 0;
    let originalAssessedAt = dto.assessedAt
      ? new Date(dto.assessedAt)
      : new Date();
    if (dto.retestOfId) {
      const prior = await this.prisma.assessment.findFirst({
        where: { id: dto.retestOfId, enrolmentId: enrolment.id },
      });
      if (!prior) {
        throw new NotFoundException(
          'retestOfId does not match an assessment on this enrolment.',
        );
      }
      // Walk back to the original so day-30 / day-90 are measured from it.
      let root = prior;
      let depth = 1;
      while (root.retestOfId) {
        const up = await this.prisma.assessment.findUnique({
          where: { id: root.retestOfId },
        });
        if (!up) break;
        root = up;
        depth += 1;
      }
      originalAssessedAt = root.assessedAt;
      retestNumber = Math.min(depth, 2) as 1 | 2;
    }

    const assessedAt = dto.assessedAt ? new Date(dto.assessedAt) : new Date();
    const dueAgainOn = nextRetestDue(originalAssessedAt, retestNumber);

    const assessment = await this.prisma.assessment.create({
      data: {
        enrolmentId: enrolment.id,
        kind: dto.kind,
        scorePct,
        language: dto.language ?? 'rw',
        oral: dto.oral ?? true,
        recordingUrl: dto.recordingUrl,
        assessedAt,
        assessorId: trainerUserId,
        retestOfId: dto.retestOfId,
        dueAgainOn,
        ...(dto.answers?.length
          ? {
              answers: {
                create: dto.answers.map((a) => ({
                  questionCode: a.questionCode,
                  correct: a.correct,
                  note: a.note,
                })),
              },
            }
          : {}),
      },
      include: { answers: true },
    });

    await this.auditService.record({
      userId: trainerUserId,
      action: 'academy:assessment-recorded',
      entity: 'Assessment',
      entityId: assessment.id,
      metadata: {
        uzaId: user.uzaId,
        kind: dto.kind,
        scorePct,
        retestOfId: dto.retestOfId ?? null,
        dueAgainOn: dueAgainOn?.toISOString().slice(0, 10) ?? null,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });
    return assessment;
  }

  /** Everything the academy holds on one participant, with the computed summary on top. */
  async participantFile(uzaId: string) {
    await this.ensureModules();
    const user = await this.requireParticipant(uzaId);
    const enrolments = await this.prisma.enrolment.findMany({
      where: { userId: user.id },
      orderBy: { enrolledAt: 'desc' },
      include: {
        cohort: { select: { code: true, name: true, track: true } },
        attendance: {
          include: {
            module: { select: { code: true, title: true, kind: true } },
          },
          orderBy: { attendedAt: 'asc' },
        },
        assessments: {
          orderBy: { assessedAt: 'asc' },
          include: {
            answers: { select: { questionCode: true, correct: true } },
          },
        },
      },
    });
    return {
      uzaId: user.uzaId,
      displayName: `${user.firstName} ${user.lastName}`.trim(),
      summary: await this.summaryForUser(user.id),
      enrolments,
    };
  }

  /**
   * The summary a lender reads about a borrower — computed, never stored. Called from
   * `LenderService` after `requireOwnLoan` has already applied the consent gate; this method
   * itself does no access control, which is why it is keyed on an internal user id and not
   * exposed on a route.
   */
  async summaryForUser(userId: string) {
    const modules: CurriculumModule[] = [...CURRICULUM];
    const [attendance, assessments] = await Promise.all([
      this.prisma.moduleAttendance.findMany({
        where: { enrolment: { userId } },
        include: { module: { select: { code: true, kind: true } } },
      }),
      this.prisma.assessment.findMany({
        where: { enrolment: { userId } },
        select: {
          id: true,
          kind: true,
          scorePct: true,
          assessedAt: true,
          retestOfId: true,
        },
      }),
    ]);
    return readinessSummary(
      modules,
      attendance.map((a) => ({
        moduleCode: a.module.code,
        kind: a.module.kind,
        passed: a.passed,
        attendedAt: a.attendedAt,
      })),
      assessments,
    );
  }

  /**
   * Whether this person has actually finished training — `certified` on the same
   * `readinessSummary` a lender already reads, not a second, differently-computed notion
   * of "done." Not wired to any loan-application gate yet: whether self-service loan
   * applications are gated on this at all is an open design question (the founder's
   * "apply after completing training" request vs. `FundApplicationController`'s
   * deliberate oral-first, staff-assisted design) — see the 2026-09-14 lender-portal
   * memory. Exists now so whichever side of that question is answered, the check itself
   * doesn't need inventing from scratch.
   */
  async isCertifiedForLoanApplication(userId: string): Promise<boolean> {
    const summary = await this.summaryForUser(userId);
    return summary.certified;
  }

  /**
   * The impact report: what the academy has delivered, what it cost, and whether the
   * claim made to lenders — trained drivers repay better — holds on the data so far.
   *
   * Everything is computed from records at call time. The cost rate comes from the caller
   * (finance holds it); the EUR rate is for the S.U.L benchmark only. Anything that cannot
   * be computed from records is listed under `notMeasured` with what would unlock it,
   * because an estimate presented as a measurement is the thing a funder will catch first.
   */
  async impact(params: {
    costPerParticipantHourRwf?: number;
    rwfPerEur?: number;
  }) {
    await this.ensureModules();
    const [enrolments, attendance, assessments, journeys, loans] =
      await Promise.all([
        this.prisma.enrolment.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.moduleAttendance.findMany({
          select: {
            passed: true,
            assessorId: true,
            enrolment: { select: { userId: true } },
            module: { select: { hours: true, code: true } },
          },
        }),
        this.prisma.assessment.findMany({
          where: { kind: 'COMPREHENSION' },
          select: {
            scorePct: true,
            retestOfId: true,
            enrolment: { select: { userId: true } },
          },
          orderBy: { assessedAt: 'asc' },
        }),
        this.prisma.candidateJourney.groupBy({
          by: ['stage'],
          _count: { _all: true },
        }),
        this.prisma.loan.findMany({
          select: {
            borrowerUserId: true,
            status: true,
            arrearsRwf: true,
            outstandingRwf: true,
          },
        }),
      ]);

    // Certification per participant, from the same rule the lender's summary uses.
    const byUser = new Map<string, { passed: Set<string>; scores: number[] }>();
    for (const a of attendance) {
      const u = byUser.get(a.enrolment.userId) ?? {
        passed: new Set(),
        scores: [],
      };
      if (a.passed) u.passed.add(a.module.code);
      byUser.set(a.enrolment.userId, u);
    }
    for (const a of assessments) {
      const u = byUser.get(a.enrolment.userId) ?? {
        passed: new Set(),
        scores: [],
      };
      u.scores.push(a.scorePct);
      byUser.set(a.enrolment.userId, u);
    }
    const isCertified = (userId: string) => {
      const u = byUser.get(userId);
      if (!u) return false;
      const latest = u.scores.at(-1);
      return (
        u.passed.size === CURRICULUM.length &&
        latest !== undefined &&
        latest >= 70
      );
    };

    const hoursDelivered = attendance
      .filter((a) => a.passed)
      .reduce((t, a) => t + a.module.hours, 0);
    const participantsTrained = byUser.size;
    const firsts = assessments
      .filter((a) => !a.retestOfId)
      .map((a) => a.scorePct);
    const retests = assessments.filter((a) => a.retestOfId);
    const mean = (xs: number[]) =>
      xs.length
        ? Math.round((xs.reduce((t, x) => t + x, 0) / xs.length) * 10) / 10
        : null;

    // Falling on re-test: per user, latest vs previous.
    let falling = 0;
    for (const u of byUser.values()) {
      if (u.scores.length >= 2 && u.scores.at(-1)! < u.scores.at(-2)! - 5)
        falling += 1;
    }

    const stage = (name: string) =>
      journeys.find((j) => j.stage === name)?._count._all ?? 0;

    return {
      generatedAt: new Date().toISOString(),
      delivery: {
        enrolments: Object.fromEntries(
          enrolments.map((e) => [e.status, e._count._all]),
        ),
        participantsWithAnyRecord: participantsTrained,
        certified: [...byUser.keys()].filter(isCertified).length,
        moduleSittings: attendance.length,
        moduleSittingsPassed: attendance.filter((a) => a.passed).length,
        hoursDelivered,
        distinctTrainers: new Set(
          attendance.map((a) => a.assessorId).filter(Boolean),
        ).size,
        advisedToBuildFurther: stage('ADVISED_TO_BUILD_FURTHER'),
        placedInDriversPool: stage('PLACED_IN_DRIVERS_POOL'),
      },
      comprehension: {
        firstAssessments: firsts.length,
        meanFirstScorePct: mean(firsts),
        retestsTaken: retests.length,
        meanRetestScorePct: mean(retests.map((r) => r.scorePct)),
        participantsFallingOnRetest: falling,
      },
      value: trainingValue(hoursDelivered, participantsTrained, {
        costPerParticipantHourRwf: params.costPerParticipantHourRwf ?? 0,
        rwfPerEur: params.rwfPerEur,
      }),
      repayment: repaymentComparison(
        loans.map((l) => ({
          certified: isCertified(l.borrowerUserId),
          status: l.status,
          arrearsRwf: l.arrearsRwf,
          outstandingRwf: l.outstandingRwf,
        })),
      ),
      notMeasured: NOT_MEASURED,
      note:
        params.costPerParticipantHourRwf === undefined
          ? 'value.* is zero because no costPerParticipantHourRwf was supplied. Pass UZA’s own cost per participant-hour; it is not assumed here.'
          : undefined,
    };
  }
}

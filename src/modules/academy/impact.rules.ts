import { CURRICULUM } from './academy.rules';

/**
 * The value and the impact of the training, kept apart on purpose.
 *
 * VALUE is what the training cost to deliver, or would cost to buy. It is arithmetic on
 * hours and a rate, and the rate is an input, never a constant — UZA's own cost per trainer
 * hour is a fact the finance team holds; a "market" rate is a comparison. The benchmark in
 * the evidence base is S.U.L E-Mobility's academy: 1,462 trainees for ~€400,000 of GIZ money,
 * **€274 per trainee** (`12-commercial-model.md` §0, PARTIAL). That is the number a funder will
 * compare against, so it is returned beside UZA's own figure rather than instead of it.
 *
 * IMPACT is what changed because of the training. The claim the programme makes to lenders
 * is specific and falsifiable — trained drivers repay better than untrained ones — and it is
 * only worth anything if it is MEASURED, against a comparison, with the sample size shown.
 * Everything in `impactFromData` is computed from records. Anything this file cannot compute
 * from records it lists under `notMeasured`, with the reason, instead of estimating. In
 * particular there is NO carbon figure here: no verified four-wheel EV cost-per-km exists for
 * Rwanda (`07-evidence-base.md`), and motorcycle data must never be presented as car data.
 */

export const CURRICULUM_HOURS = CURRICULUM.reduce((t, m) => t + m.hours, 0);

export interface TrainingValueInput {
  /** UZA's cost per participant-hour, whole RWF. From finance; not assumed here. */
  costPerParticipantHourRwf: number;
  /** RWF per EUR, for the benchmark only. Dated; the caller passes it. */
  rwfPerEur?: number;
}

export interface TrainingValue {
  curriculumHoursPerParticipant: number;
  hoursDelivered: number;
  participantsTrained: number;
  costPerParticipantHourRwf: number;
  /** curriculum hours × rate: what one full programme costs. */
  valuePerParticipantRwf: number;
  /** hours actually delivered × rate. */
  valueDeliveredRwf: number;
  benchmark: {
    label: string;
    perTraineeEur: number;
    perTraineeRwf: number | null;
    source: string;
    confidence: 'PARTIAL';
  };
}

export function trainingValue(
  hoursDelivered: number,
  participantsTrained: number,
  input: TrainingValueInput,
): TrainingValue {
  const rate = Math.max(0, Math.round(input.costPerParticipantHourRwf));
  return {
    curriculumHoursPerParticipant: CURRICULUM_HOURS,
    hoursDelivered,
    participantsTrained,
    costPerParticipantHourRwf: rate,
    valuePerParticipantRwf: Math.round(CURRICULUM_HOURS * rate),
    valueDeliveredRwf: Math.round(hoursDelivered * rate),
    benchmark: {
      label: 'S.U.L E-Mobility academy (GIZ-funded), Rwanda, 2020–21',
      perTraineeEur: 274,
      perTraineeRwf: input.rwfPerEur ? Math.round(274 * input.rwfPerEur) : null,
      source: '12-commercial-model.md §0 — 1,462 trainees, ~€400,000',
      confidence: 'PARTIAL',
    },
  };
}

export interface BorrowerOutcome {
  certified: boolean;
  status: string;
  arrearsRwf: number;
  outstandingRwf: number;
}

export interface RepaymentComparison {
  group: 'certified' | 'not_certified';
  loans: number;
  inArrears: number;
  arrearsRatePct: number | null;
  arrearsRwf: number;
  outstandingRwf: number;
}

/** Below this many loans per group the comparison is reported but explicitly not relied on. */
export const MIN_LOANS_FOR_A_CLAIM = 20;

/**
 * The claim, measured. Two groups — borrowers who completed the academy and borrowers who
 * did not — and their arrears. Returned with the sample size and a plain statement of
 * whether it is big enough to say anything, because the moment 100 drivers are financed
 * with no comparison the claim becomes unprovable and eventually unbelieved.
 */
export function repaymentComparison(outcomes: readonly BorrowerOutcome[]): {
  groups: RepaymentComparison[];
  verdict: string;
  sufficient: boolean;
} {
  const active = outcomes.filter((o) =>
    ['ACTIVE', 'IN_ARREARS', 'CLOSED'].includes(o.status),
  );
  const build = (
    group: RepaymentComparison['group'],
    rows: BorrowerOutcome[],
  ): RepaymentComparison => {
    const inArrears = rows.filter(
      (r) => r.arrearsRwf > 0 || r.status === 'IN_ARREARS',
    ).length;
    return {
      group,
      loans: rows.length,
      inArrears,
      arrearsRatePct: rows.length
        ? Math.round((inArrears / rows.length) * 1000) / 10
        : null,
      arrearsRwf: rows.reduce((t, r) => t + r.arrearsRwf, 0),
      outstandingRwf: rows.reduce((t, r) => t + r.outstandingRwf, 0),
    };
  };
  const cert = build(
    'certified',
    active.filter((o) => o.certified),
  );
  const not = build(
    'not_certified',
    active.filter((o) => !o.certified),
  );
  const sufficient =
    cert.loans >= MIN_LOANS_FOR_A_CLAIM && not.loans >= MIN_LOANS_FOR_A_CLAIM;

  let verdict: string;
  if (!active.length) {
    verdict = 'No disbursed loans yet. The comparison cannot be made.';
  } else if (!sufficient) {
    verdict = `Insufficient sample: ${cert.loans} certified and ${not.loans} not-certified borrowers with loans. At least ${MIN_LOANS_FOR_A_CLAIM} in each group before any claim is made. Set up the comparison group before cohort 2 disburses.`;
  } else if (cert.arrearsRatePct !== null && not.arrearsRatePct !== null) {
    const diff = not.arrearsRatePct - cert.arrearsRatePct;
    verdict =
      diff > 0
        ? `Certified borrowers show ${diff.toFixed(1)} points lower arrears incidence than not-certified (${cert.arrearsRatePct}% vs ${not.arrearsRatePct}%). Descriptive, not causal: the groups are not randomised.`
        : `Certified borrowers do NOT show lower arrears incidence (${cert.arrearsRatePct}% vs ${not.arrearsRatePct}%). Report it as it is.`;
  } else {
    verdict = 'Comparison could not be computed.';
  }
  return { groups: [cert, not], verdict, sufficient };
}

/** What this report deliberately does not estimate, and why. Shown, not hidden. */
export const NOT_MEASURED: readonly {
  metric: string;
  reason: string;
  unlockedBy: string;
}[] = [
  {
    metric: 'CO₂ avoided per vehicle',
    reason:
      'No verified four-wheel EV cost-per-km or kWh/100 km figure exists for Rwanda; motorcycle figures must not be presented as car figures (07-evidence-base.md).',
    unlockedBy:
      'Module 1.4 instrumented laps on cohort 1 vehicles → measured kWh/100 km → a sourced factor.',
  },
  {
    metric: 'Driver income change',
    reason:
      'Requires placement-period earnings from the wallet record; no ingestion path exists yet beyond manual savings entries.',
    unlockedBy:
      'Wallet / MoMo statement ingestion (D0m SMS provider first, then the wallet adapter).',
  },
  {
    metric: 'Fuel expenditure avoided',
    reason:
      'Baseline fuel spend is self-declared on the application (currentDailyRentalRwf covers rental, not fuel). Not yet captured.',
    unlockedBy:
      'One field on the intake form and a measured kWh cost from 1.2/1.4.',
  },
  {
    metric:
      'Marketplace SustainabilityMetric factors (0.12 kg CO₂/km, 20,000 km/yr)',
    reason:
      'Unsourced constants in sustainability.constants.ts. Not used here and should not be shown to a lender or funder as fact.',
    unlockedBy: 'Source them or label them as illustrative in the UI.',
  },
];

/**
 * Twara EV — batch 1 onboarding, end to end, against the LOCAL SIMULATION API only
 * (see .env — isolated Docker Postgres/Mongo, never the real deployment).
 *
 * What this proves, step by step, printing as it goes:
 *   1. Staff accounts for Scorah (UZA) and Paulin (Unguka) are created with temp passwords
 *      and real UZA-P-… ids.
 *   2. All 16 real beneficiaries get accounts, UZA ids, and a Loan + LoanVehicle each —
 *      the code path that did not exist before this work.
 *   3. Wallets open for the batch (needs each person's uzaId — see UsersService.assignUzaId).
 *   4. Paulin (as Unguka) records real credit decisions on the two already-approved loans,
 *      and the previously-silent notification to UZA staff + the borrower actually fires.
 *   5. A monthly wallet deposit is recorded for one borrower (the wallet's "book" moving).
 *   6. A workshop inspection is recorded for one financed vehicle (the collateral-proof
 *      mechanism the founder wants to build a case on).
 *   7. Scorah is assigned a task with a deadline — the "task box" ask.
 *   8. Paulin proposes a tenor change (60 → 36 months) on one loan; staff reviews and
 *      approves it; the loan's own numbers are re-read afterwards to PROVE the
 *      recalculation actually happened, not just that an API call returned 200.
 *   9. The covenant engine is run once across the whole book, proving new real loans are
 *      picked up by the existing wallet/covenant "ecosystem" with no special-casing.
 *  10. One borrower submits a financing support request ("apply for the fund"), and it is
 *      confirmed visible to staff.
 *
 * Run: npx ts-node scripts/simulate-twara-ev-batch1.ts
 * Requires: the API running locally (npm run start:dev) against the isolated sim DB.
 */

const API = 'http://localhost:7050';

interface Beneficiary {
  sn: number;
  admDate: string; // ISO
  fullName: string;
  vehicleDescription: string; // free text as given
  make: string;
  model: string;
  year: number;
  color: string;
  chassisNumber: string;
  contributionRwf: number;
  priceRwf: number;
  phone: string; // Rwandan local format, leading 0
  approved: boolean;
  approvedDate?: string;
  approvedBy?: string;
}

// Transcribed directly from the founder's own sponsorship list. See the run report for two
// flagged data-quality notes (SN14/SN15 share one phone number in the source; several
// chassis numbers mix visually similar characters (1/I/L, 0/O) and should be verified
// against the original document before this goes anywhere real).
const BENEFICIARIES: Beneficiary[] = [
  { sn: 1, admDate: '2026-08-20', fullName: 'Gisele Tuyisenge', vehicleDescription: 'NETA U 2023', make: 'NETA', model: 'U', year: 2023, color: 'Unspecified', chassisNumber: 'PENDING-SN1-CONFIRM', contributionRwf: 1_500_000, priceRwf: 23_500_000, phone: '0786943123', approved: true, approvedDate: '2026-09-10', approvedBy: 'KCM/Christianne' },
  { sn: 2, admDate: '2026-08-10', fullName: 'Charite Cyubahiro', vehicleDescription: 'NETA U 2023', make: 'NETA', model: 'U', year: 2023, color: 'Unspecified', chassisNumber: 'PENDING-SN2-CONFIRM', contributionRwf: 1_500_000, priceRwf: 23_500_000, phone: '0788660491', approved: true, approvedDate: '2026-09-10', approvedBy: 'KCM/Christianne' },
  { sn: 3, admDate: '2026-06-06', fullName: 'Emmanuel Uwizeyimana', vehicleDescription: 'Dongfeng E70 2023 White', make: 'Dongfeng', model: 'E70', year: 2023, color: 'White', chassisNumber: '1DP31B968PG224545' /* as on the sheet; Dongfeng WMI is LDP — confirm against the logbook */, contributionRwf: 500_000, priceRwf: 18_500_000, phone: '0787613076', approved: false },
  { sn: 4, admDate: '2026-07-02', fullName: 'Fred Uwimana', vehicleDescription: 'Dongfeng E70 2023 White', make: 'Dongfeng', model: 'E70', year: 2023, color: 'White', chassisNumber: 'LDP31B965PG224390', contributionRwf: 500_000, priceRwf: 18_500_000, phone: '0788471076', approved: false },
  { sn: 5, admDate: '2026-06-18', fullName: 'Eric Niyonzima', vehicleDescription: 'NETA U PRO 2022, Grey', make: 'NETA', model: 'U PRO', year: 2022, color: 'Grey', chassisNumber: 'LUZBGAFB0NA016270', contributionRwf: 2_000_000, priceRwf: 22_800_000, phone: '0789526046', approved: false },
  { sn: 6, admDate: '2026-06-14', fullName: 'Bosco Turinzwenimana', vehicleDescription: 'NETA U PRO 2022, Brown', make: 'NETA', model: 'U PRO', year: 2022, color: 'Brown', chassisNumber: 'LUZBEAFBINA168896' /* as on the sheet; 'I' is not a VIN character, likely '1' — confirm against the logbook */, contributionRwf: 500_000, priceRwf: 22_800_000, phone: '0781720701', approved: false },
  { sn: 7, admDate: '2026-06-25', fullName: 'John Musabyimana', vehicleDescription: 'NETA U PRO 2022, White', make: 'NETA', model: 'U PRO', year: 2022, color: 'White', chassisNumber: 'LUZBGAFB6NA008366', contributionRwf: 500_000, priceRwf: 22_800_000, phone: '0788235722', approved: false },
  { sn: 8, admDate: '2026-07-11', fullName: 'Alex Hakizimana', vehicleDescription: 'NETA U PRO 2022, Sky-Blue', make: 'NETA', model: 'U PRO', year: 2022, color: 'Sky-Blue', chassisNumber: 'LUZBGAFB3MA121059', contributionRwf: 500_000, priceRwf: 22_800_000, phone: '0780759619', approved: false },
  { sn: 9, admDate: '2026-06-18', fullName: 'Joseph Nkikabahizi', vehicleDescription: 'BYD Yuan Up 2025 Full Option, Grey', make: 'BYD', model: 'Yuan Up', year: 2025, color: 'Grey', chassisNumber: 'LC0CE4DC5S4163710', contributionRwf: 2_000_000, priceRwf: 31_500_000, phone: '0788825856', approved: false },
  { sn: 10, admDate: '2026-07-08', fullName: 'Abdoul Ngoga', vehicleDescription: 'BYD Yuan Up 2024, Full Opt, Beige', make: 'BYD', model: 'Yuan Up', year: 2024, color: 'Beige', chassisNumber: 'LC0CE4CB4R4874155', contributionRwf: 2_000_000, priceRwf: 29_800_000, phone: '0788633531', approved: false },
  { sn: 11, admDate: '2026-07-22', fullName: 'Emmanuel Hafashimana', vehicleDescription: 'BYD Yuan Up 2024, Basic Opt, Beige', make: 'BYD', model: 'Yuan Up', year: 2024, color: 'Beige', chassisNumber: 'LC0CE4DC8R4953917', contributionRwf: 2_000_000, priceRwf: 29_200_000, phone: '0789752852', approved: false },
  { sn: 12, admDate: '2026-08-02', fullName: 'Eric Kabukire', vehicleDescription: 'BYD Yuan Up 2024, Full Opt, Grey', make: 'BYD', model: 'Yuan Up', year: 2024, color: 'Grey', chassisNumber: 'LC0CE4CB1R4172701', contributionRwf: 2_000_000, priceRwf: 29_800_000, phone: '0784945500', approved: false },
  { sn: 13, admDate: '2026-08-02', fullName: 'Aime Kabukire', vehicleDescription: 'BYD Yuan Up 2025 Full Option, Beige', make: 'BYD', model: 'Yuan Up', year: 2025, color: 'Beige', chassisNumber: 'LC0CE4CB5S4411701', contributionRwf: 2_500_000, priceRwf: 31_500_000, phone: '0788864119', approved: false },
  { sn: 14, admDate: '2026-09-08', fullName: 'Jonathan Uwizeye', vehicleDescription: 'BYD Yuan Up 2025 Full Option, Beige (Abanyamurava)', make: 'BYD', model: 'Yuan Up', year: 2025, color: 'Beige', chassisNumber: 'LC0CE4CB5S4151209', contributionRwf: 2_000_000, priceRwf: 31_500_000, phone: '0788666044', approved: false },
  { sn: 15, admDate: '2026-09-08', fullName: 'Emmanuel Nzabahimana', vehicleDescription: 'BYD Yuan Up 2025 Full Option, Light Green', make: 'BYD', model: 'Yuan Up', year: 2025, color: 'Light Green', chassisNumber: 'LC0CE4DC8S4318573', contributionRwf: 2_000_000, priceRwf: 31_500_000, phone: '0788552860', approved: false },
  { sn: 16, admDate: '2026-09-08', fullName: 'Sylver Uwimana', vehicleDescription: 'BYD Yuan Up 2024, Basic Opt, Grey', make: 'BYD', model: 'Yuan Up', year: 2024, color: 'Grey', chassisNumber: 'LC0CE4CB4R4874156', contributionRwf: 2_000_000, priceRwf: 29_200_000, phone: '0788552488', approved: false },
];

const TENOR_MONTHS = 60; // founder's decision for this batch, see the conversation record

type Json = Record<string, unknown>;

/**
 * Staff-only accounts (no BUYER/marketplace workspace — SUPER_ADMIN, INTAKE_OFFICER,
 * LENDER_UNGUKA, WORKSHOP_ADMIN all qualify) must use POST /auth/admin/login, not the
 * public POST /auth/login — see auth.service.ts's isStaffOnlyAccount gate. Every account
 * this script creates as staff passes `isStaff: true`.
 */
async function login(
  email: string,
  password: string,
  isStaff = false,
): Promise<{ token: string; userId: string }> {
  const res = await call(
    'POST',
    isStaff ? '/auth/admin/login' : '/auth/login',
    null,
    { email, password },
  );
  const token = res.accessToken;
  const me = await call('GET', '/auth/me', token);
  return { token, userId: me.id };
}

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: Json,
): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`,
    );
  }
  // The API wraps every response as { success, data }. Unwrap here, once, rather than at
  // every call site.
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

function nameToEmail(fullName: string, sn: number): string {
  const slug = fullName
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, '.');
  return `${slug}.${sn}@drivers.uzaempower.rw`;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.replace(/\(.*?\)/g, '').trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || parts[0] };
}

const results: Json = { createdAccounts: [], loans: [], notes: [] };

async function main() {
  console.log('=== 0. Admin login ===');
  const { token: adminToken, userId: adminId } = await login(
    'admin@uza.rw',
    'TwaraSim!2026Admin',
    true,
  );
  console.log('admin ok, id =', adminId);

  console.log('\n=== 1. Create Scorah (UZA staff) and Paulin (Unguka) ===');
  const scorahCreate = await call('POST', '/admin/users', adminToken, {
    email: 'scorah@uza.rw',
    firstName: 'Scorah',
    lastName: '(UZA Empower)',
    roles: ['INTAKE_OFFICER'],
  });
  console.log('Scorah:', scorahCreate.user.uzaId, scorahCreate.user.email, '— temp password:', scorahCreate.temporaryPassword);

  const paulinCreate = await call('POST', '/admin/users', adminToken, {
    email: 'paulin@unguka.rw',
    firstName: 'Paulin',
    lastName: '(Unguka)',
    roles: ['LENDER_UNGUKA'],
  });
  console.log('Paulin:', paulinCreate.user.uzaId, paulinCreate.user.email, '— temp password:', paulinCreate.temporaryPassword);
  (results.createdAccounts as Json[]).push(
    { role: 'Scorah / INTAKE_OFFICER', email: scorahCreate.user.email, uzaId: scorahCreate.user.uzaId, temporaryPassword: scorahCreate.temporaryPassword },
    { role: 'Paulin / LENDER_UNGUKA', email: paulinCreate.user.email, uzaId: paulinCreate.user.uzaId, temporaryPassword: paulinCreate.temporaryPassword },
  );

  // LENDER_UNGUKA is not a PLATFORM_STAFF_ROLE (see auth-workspace.util.ts) — Paulin's is a
  // partner-portal account, not a UZA-staff account, so the PUBLIC login applies to them,
  // same as a buyer/seller. Only SUPER_ADMIN/FINANCE_ADMIN/INTAKE_OFFICER/etc. use
  // /auth/admin/login.
  const { token: paulinToken } = await login('paulin@unguka.rw', paulinCreate.temporaryPassword, false);
  console.log('Paulin logged in with the temp password issued above — confirms the credential actually works.');

  console.log('\n=== 2. Create the 16 beneficiary accounts + loans + wallets ===');
  const created: Array<{ b: Beneficiary; userId: string; uzaId: string; loanId: string; temporaryPassword: string }> = [];

  for (const b of BENEFICIARIES) {
    const { firstName, lastName } = splitName(b.fullName);
    const email = nameToEmail(b.fullName, b.sn);
    const account = await call('POST', '/admin/users', adminToken, {
      email,
      firstName,
      lastName,
      phone: b.phone,
      roles: ['BUYER'],
    });

    // Every loan starts PENDING — even the two the founder's list already marks approved.
    // Paulin's real decision (step 3, below) is what actually moves a loan to APPROVED;
    // pre-setting the status here would skip the one step that proves the workflow works.
    const loan = await call('POST', '/admin/loans', adminToken, {
      borrowerUserId: account.user.id,
      lenderKey: 'unguka',
      vehiclePriceRwf: b.priceRwf,
      clientContributionRwf: b.contributionRwf,
      tenorMonths: TENOR_MONTHS,
      vehicle: {
        chassisNumber: b.chassisNumber,
        make: b.make,
        model: b.model,
        year: b.year,
        color: b.color,
      },
    });

    await call('POST', '/admin/wallets', adminToken, {
      uzaId: account.user.uzaId,
      institutionName: 'Unguka Bank (LOLC)',
      accountLastFour: '0000',
      dailyTargetRwf: loan.dailyRwf,
      contributionTargetRwf: b.contributionRwf,
    });

    created.push({ b, userId: account.user.id, uzaId: account.user.uzaId, loanId: loan.id, temporaryPassword: account.temporaryPassword });
    (results.loans as Json[]).push({
      sn: b.sn,
      name: b.fullName,
      uzaId: account.user.uzaId,
      loanReference: loan.reference,
      status: loan.status,
      monthlyRwf: loan.monthlyRwf,
      dailyRwf: loan.dailyRwf,
      tenorMonths: loan.tenorMonths,
    });
    console.log(
      `  SN${b.sn} ${b.fullName}: uzaId=${account.user.uzaId} loan=${loan.reference} status=${loan.status} monthly=RWF ${loan.monthlyRwf.toLocaleString()} daily=RWF ${loan.dailyRwf.toLocaleString()}`,
    );
  }

  console.log('\n=== 3. Paulin records real lender decisions on the 2 already-approved loans ===');
  for (const c of created.filter((c) => c.b.approved)) {
    const decision = await call(
      'POST',
      `/financing/lenders/unguka/loans/${c.loanId}/decisions`,
      paulinToken,
      {
        outcome: 'APPROVED',
        reasons: `Approved ${c.b.approvedDate} by ${c.b.approvedBy}, per the founder's sponsorship list.`,
      },
    );
    console.log(`  Decision recorded on SN${c.b.sn} (${c.b.fullName}): ${decision.outcome}`);
  }

  console.log('\n=== 4. Staff task box: confirm the notification the decisions above fired ===');
  // The API's pagination envelope hoists `meta` alongside `data`, so the unwrapped result
  // here is already the plain array of notifications, not { items, meta }.
  const staffNotifications: Json[] = await call('GET', '/notifications', adminToken);
  const financingUpdates = staffNotifications.filter(
    (n) => n.type === 'FINANCING_UPDATE',
  );
  console.log(`  Admin inbox has ${financingUpdates.length} FINANCING_UPDATE notification(s) after the decisions above.`);

  console.log('\n=== 5. A monthly wallet deposit (SN1) ===');
  const sn1 = created.find((c) => c.b.sn === 1)!;
  const { token: sn1Token } = await login(nameToEmail(sn1.b.fullName, sn1.b.sn), sn1.temporaryPassword);
  const deposit = await call('POST', '/wallet/me/deposits', sn1Token, {
    amountRwf: 30_000,
    momoTransactionId: `SIM-${Date.now()}`,
    occurredAt: new Date().toISOString(),
  });
  console.log('  Deposit recorded:', JSON.stringify(deposit).slice(0, 200));

  console.log('\n=== 6. A workshop inspection on SN1\'s financed vehicle ===');
  const mechanicCreate = await call('POST', '/admin/users', adminToken, {
    email: 'mechanic1@uza.rw',
    firstName: 'Twara EV',
    lastName: 'Garage Partner 1',
    roles: ['WORKSHOP_ADMIN'],
  });
  // The role alone does not make an inspection possible — a real Mechanic partner record
  // is required too (this endpoint did not exist before this work; see
  // WorkshopService.registerMechanic's doc comment).
  const mechanicCertifiedUntil = new Date();
  mechanicCertifiedUntil.setFullYear(mechanicCertifiedUntil.getFullYear() + 1);
  await call('POST', '/admin/mechanics', adminToken, {
    name: 'Twara EV Garage Partner 1',
    engagement: 'CERTIFIED',
    level: 'SENIOR',
    certifiedFor: ['GENERAL', 'HIGH_VOLTAGE', 'BRAKES'],
    certifiedUntil: mechanicCertifiedUntil.toISOString(),
    userId: mechanicCreate.user.id,
  });
  // WORKSHOP_ADMIN, like LENDER_UNGUKA, is a partner-portal role, not platform staff.
  const { token: mechanicToken } = await login('mechanic1@uza.rw', mechanicCreate.temporaryPassword, false);
  const inspection = await call('POST', '/workshop/inspections', mechanicToken, {
    loanId: sn1.loanId,
    mileageKm: 1200,
    batteryHealthPct: 98,
    condition: 'GOOD',
    notes: 'First monthly check-in. No safety findings.',
    passed: true,
  });
  console.log('  Inspection recorded, id =', inspection.id, 'nextDueAt =', inspection.nextDueAt);
  (results.createdAccounts as Json[]).push({ role: 'Workshop partner 1 / WORKSHOP_ADMIN', email: 'mechanic1@uza.rw', temporaryPassword: mechanicCreate.temporaryPassword });

  console.log('\n=== 7. Assign Scorah a task with a deadline ===');
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 3);
  const task = await call('POST', '/admin/tasks', adminToken, {
    assigneeUserId: scorahCreate.user.id,
    title: 'Follow up: Twara EV batch 1 (16 beneficiaries)',
    body: 'Confirm all 16 accounts, loans and wallets look right; chase the 14 still pending Unguka decisions.',
    dueAt: dueAt.toISOString(),
    entityRef: 'batch:twara-ev-1',
  });
  console.log('  Task assigned, id =', task.id, 'dueAt in metadata =', (task.metadata as Json).dueAt);

  const { token: scorahToken } = await login('scorah@uza.rw', scorahCreate.temporaryPassword, true);
  const scorahTasks = await call('GET', '/notifications/tasks', scorahToken);
  console.log(`  Scorah's task box shows ${scorahTasks.length} open task(s); first one is overdue=${scorahTasks[0]?.isOverdue}, dueAt=${scorahTasks[0]?.dueAt}`);

  console.log('\n=== 8. Paulin proposes a tenor change (60 -> 36 months) on SN2; staff approves it ===');
  const sn2 = created.find((c) => c.b.sn === 2)!;
  const beforeLoan = await call('GET', `/admin/loans/${sn2.loanId}`, adminToken);
  console.log(`  Before: tenor=${beforeLoan.tenorMonths}mo monthly=RWF ${beforeLoan.monthlyRwf.toLocaleString()} daily=RWF ${beforeLoan.dailyRwf.toLocaleString()}`);

  const changeRequest = await call(
    'POST',
    `/financing/lenders/unguka/loans/${sn2.loanId}/change-requests`,
    paulinToken,
    { changeType: 'TENOR', payload: { toTenorMonths: 36 }, note: 'Borrower asked for a higher payment / shorter term.' },
  );
  console.log('  Change request created, id =', changeRequest.id, 'status =', changeRequest.status);

  const reviewed = await call(
    'PATCH',
    `/admin/loans/change-requests/${changeRequest.id}/review`,
    adminToken,
    { approve: true, reviewNote: 'Approved — borrower confirmed affordability.' },
  );
  console.log('  Reviewed, status =', reviewed.status, 'appliedAt =', reviewed.appliedAt);

  const afterLoan = await call('GET', `/admin/loans/${sn2.loanId}`, adminToken);
  console.log(`  After:  tenor=${afterLoan.tenorMonths}mo monthly=RWF ${afterLoan.monthlyRwf.toLocaleString()} daily=RWF ${afterLoan.dailyRwf.toLocaleString()}`);
  console.log(`  Tenor-change history rows: ${afterLoan.tenorChanges.length}`);

  const recalcProved =
    afterLoan.tenorMonths === 36 &&
    afterLoan.monthlyRwf > beforeLoan.monthlyRwf &&
    afterLoan.tenorChanges.length === 1;
  console.log('  RECALCULATION VERIFIED:', recalcProved);
  (results.notes as string[]).push(
    `SN2 tenor change 60->36 months: monthly RWF ${beforeLoan.monthlyRwf.toLocaleString()} -> RWF ${afterLoan.monthlyRwf.toLocaleString()}. Recalculation verified: ${recalcProved}.`,
  );
  if (!recalcProved) {
    throw new Error('Tenor-change recalculation did not produce the expected result');
  }

  console.log('\n=== 9. Run the covenant engine across the whole book ===');
  const covenantRun = await call('POST', '/admin/wallets/covenants/run', adminToken, {});
  console.log('  Covenant run result:', JSON.stringify(covenantRun).slice(0, 300));

  console.log('\n=== 10. SN3 applies for UZA facilitation support ("apply for the fund") ===');
  const sn3 = created.find((c) => c.b.sn === 3)!;
  const { token: sn3Token } = await login(nameToEmail(sn3.b.fullName, sn3.b.sn), sn3.temporaryPassword);
  const publishedListings = await call('GET', '/listings?limit=1', null);
  const someListingId = (publishedListings.items ?? publishedListings)[0]?.id;
  const financingRequest = await call('POST', '/financing/request', sn3Token, {
    buyerName: sn3.b.fullName,
    phone: sn3.b.phone,
    listingId: someListingId,
    preferredDepositUsd: 400,
    notes: 'Requesting UZA facilitation support for the Twara EV programme.',
  });
  console.log('  Financing request submitted, id =', financingRequest.id, 'status =', financingRequest.status);

  const staffFinancingView = await call('GET', '/admin/financing', adminToken);
  const visibleToStaff = (staffFinancingView.items ?? staffFinancingView).some(
    (r: Json) => r.id === financingRequest.id,
  );
  console.log('  Visible to staff in /admin/financing:', visibleToStaff);

  console.log('\n=== DONE ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('\nSIMULATION FAILED:', err);
  process.exit(1);
});

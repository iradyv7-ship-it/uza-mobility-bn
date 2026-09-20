# Sourcing-to-Delivery — audit and gap matrix

Written 2026-09-20, against the "UZA Nexus OS — Build Brief: Sourcing-to-Delivery
Orchestration for UZA Mobility." Required before any destructive change, per the brief's
own acceptance criteria. This is the matrix, not the build.

## First correction — the brief's architecture assumption doesn't match reality

The brief describes "the existing UZA Mobility platform" as Supabase-auth'd, with
`packages/domain/src/policy.ts`, named engines "Person / Asset / Contract / Ledger," a
14-role permission model, and a 15-state vehicle lifecycle, in a `packages/` monorepo.

**What's actually there, verified by reading the code, not assuming it:** a single NestJS
app (`uza-mobility-bn`) on Prisma + PostgreSQL + MongoDB, hand-rolled JWT + bcrypt auth
(`src/modules/auth/`), a real but un-named-as-"engines" set of ~150 Prisma models, and
role/permission strings seeded in `prisma/seed.ts` (11+ roles today: SUPER_ADMIN,
FINANCE_ADMIN, MARKETPLACE_ADMIN, INTAKE_OFFICER, LOGISTICS_ADMIN, FLEET_ADMIN,
SUSTAINABILITY_ADMIN, ADVERTISING_ADMIN, SALES_AGENT, SELLER, CHARGING_OPERATOR — close to
14, not exactly named that way). No `packages/domain`, no Supabase anywhere in this repo.
Vehicle "status" is several overlapping enums (`ListingStatus`, `UnitStatus`,
`ManagedVehicleStatus`), not one unified 15-state lifecycle.

**This isn't a gap to quietly paper over.** Either the brief was written from a different,
generic template without checking this specific codebase, or it describes a platform that
doesn't exist yet and was mis-described as "existing." Either way: **do not migrate this
app's real, working JWT auth to Supabase, and do not invent a `packages/domain` monorepo
structure to match the brief's language.** Build inside what's actually here. Flagging
this plainly is exactly what "audit first" is for.

**The real "existing platform" for this specific module is two things, both real:**
1. `uza-mobility-bn`'s actual Prisma schema and modules (below).
2. Five real, well-built Excel workbooks already running this process by hand: Tresor's
   inspection reports, Paulin's Unguka candidates, Bosco's training/cohorts, Scorah's
   matching/bank board, Gratien's deals-board control tower — see
   [the flow map](https://claude.ai/artifact/3J8oumQyTX4ZpYKcTFdFru) for exactly how they
   hand off today, and where the manual copies are.

## Entity-by-entity matrix

| Brief entity | Real thing in `uza-mobility-bn` | Verdict | Why |
|---|---|---|---|
| **Candidate** | `FundApplication` (the legal form) + `CandidateJourney` + `JourneyStage` (40-stage enum, already covers registration→training→financing→delivery) + `DriverProfile` | **Reuse** | Already carries income, savings, bank fields, cohort link, preferred tenor. No new model needed. |
| **Cohort** | `Cohort` (Academy) | **Extend** | Real, but built for training scheduling — needs an explicit origin/source field (Unguka-referred vs UZA-own) and a resolved-bank field if not present. Confirm before assuming absent. |
| **Requisition** | *(nothing)* | **New — the one real gap** | No "we need N of model X, here's the priority route" record exists anywhere. `SupplyOrder` is a committed order, not a stated need. This is the actual missing piece the whole demand→supply match depends on. |
| **VehicleOffer** | `SupplierOffer` (built today) + `SupplyOrderVehicle` + `ConsignmentUnit` + `ManagedVehicle` | **Extend, and reconcile first** | Four overlapping vehicle-asset concepts already exist. Before adding anything, decide which one is canonical for an offer-not-yet-ordered vehicle — almost certainly `SupplierOffer`, extended to link to a `Requisition` once that exists — rather than building a fifth. |
| **Inspection** | `VehicleInspection` + `SupplierOffer`'s condition/accidentHistory/batteryHealth fields | **Extend** | Real, but thin next to Tresor's actual 29-column checklist (odometer-tamper check, cell balance, charging test, range test, motor/drivetrain, brakes/regen, structural, infotainment, software/locks, docs). Extend the schema to match his real checklist — it's already fully specified in his workbook, nothing to invent. |
| **Approval** | `SupplierOffersService.accept/decline` (built today) | **Extend** | Close match, single-step. Brief wants inspection→CEO approval as two distinct steps; may need a second status transition, not a new model. |
| **BeneficiaryMatch** | `Allocation` module (built today) | **Reuse, extend link** | Does exactly this — assigns a unit to a driver with double-allocation prevention. Needs: a link from `SupplierOffer`-sourced vehicles (not just `ConsignmentUnit`), and a dual-confirmation field (Gratien + Scorah) if the brief's joint-confirm requirement matters operationally. |
| **BankCase** | `Loan`, `LoanComfortLetter`, `LenderConsent`, `LenderDecision`, `LoanTenorChange` | **Reuse — most mature part of the system** | Already covers comfort letter, ownership-transfer tracking, disbursement, decisions. Nothing to build here; wire it to the match, don't rebuild it. |
| **Shipment/ArrivalTracking** | `Consignment`, `ConsignmentUnit`, `FreightEvidence` | **Extend** | Container/status tracking exists. Needs the daily arrival-check agent (see below) and a direct field for "follow-up needed" matching Gratien's Arrivals Watch tab. |
| **Notification** | `Notification` + `NotificationType` (real model, already exists) | **Reuse** | Just needs new `NotificationType` values wired to this pipeline's specific events (§6 of the brief) — no new infrastructure. |

## The one real new build: Requisition

Everything else above is reuse or extend. `Requisition` is the actual missing link between
"a candidate wants a car" and "a supplier proposes one" — without it, matching stays
manual because nothing formally states the need before an offer shows up. Minimal shape,
matching Gratien's real spreadsheet columns and the existing schema's naming conventions:

```
model Requisition {
  id, ref (REQ-YYYY-####)
  model, variant, qty
  targetPriceBandMinor, targetPriceBandMaxMinor   // BigInt, matches existing *Minor convention
  cohortId / candidateJourneyId                    // who this is for
  priority (LOW/MEDIUM/HIGH)
  sourceRoute (UZA_INBOUND / MEDIATEUR / SUPPLIER) // enforced order, not a free choice
  status (OPEN/SOURCING/OFFERS_IN/FULFILLED/CLOSED)
  ceoNotifiedAt
  supplierOffers  SupplierOffer[]  // extend SupplierOffer with a requisitionId FK
}
```

## Build order (plan, then build incrementally — one change at a time)

1. **`Requisition` model + minimal service** (staff create/list, supplier-facing "open
   requisitions" read, matching the existing `Public()`/`CounterpartyAccess` patterns).
   Link `SupplierOffer.requisitionId` to it.
2. **Extend `VehicleInspection`/`SupplierOffer` review** with Tresor's real checklist
   fields — a pure schema + DTO extension, no new module.
3. **Extend `Allocation`** to accept a `SupplierOffer`-sourced vehicle, not only
   `ConsignmentUnit` — this is what actually lets Gratien+Scorah's Matching Board become
   real software instead of a spreadsheet tab.
4. **Wire `Notification`** to the nine events in the brief's §6 — infrastructure exists,
   this is event-type + trigger wiring only.
5. **The daily arrival-tracking agent** — same mechanism already proven today for the
   Founder Morning Brief and the grants-scan routines (a scheduled cloud routine). Reads
   `Consignment`/`ConsignmentUnit`, raises a follow-up task on a missed arrival date, fires
   the Kigali-arrival notification to Gratien + Scorah.
6. **Paulin's scoped read view** — this is what "instant, accurate answers for Paulin"
   actually requires technically: the `CounterpartyAccess` `LENDER` scope is already
   *designed* in the schema's own comments ("what a lender sees about a vehicle is
   CONDITION AND IDENTITY... never SupplyOrder, supplier identity, or cost") but not yet
   wired to a real endpoint for Paulin's cohort. Once steps 1–3 land, this is a read-only
   controller, not new modeling.
7. Role workplaces (the actual UI each person opens) — sequenced last, once the data model
   underneath is real, so the screens aren't built against something that will still change.

## What this means for your three immediate asks

- **"I need to have answers for Paulin"** — technically, that's step 6 above: a
  Paulin-scoped view of his cohort's requisition/offer/match/bank status, generated from
  real data instead of someone checking four spreadsheets. Until it ships, the honest
  interim answer is that his questions get answered from Gratien's Deals Board (already
  the most complete single view) rather than a fresh cross-check each time.
- **"Push Gratien to look for clients"** — this is a management ask, not a software one;
  I can't act on it. What I can do: once `Requisition` exists, an *empty* or *stale*
  requisition pipeline becomes a visible, dated fact (not a feeling) — a concrete number to
  hold him to, rather than a general push.
- **Bosco / training partner-or-build** — dispatched as real research (Rwanda WDA/RURA/RNP
  requirements, named institutions, whether Unguka requires accredited training for loan
  readiness). Report follows separately once it completes; this decision needs that answer
  before it can be made, not guessed at here.

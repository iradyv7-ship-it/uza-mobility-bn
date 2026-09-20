# The Twara EV driver journey — master plan

Written 2026-09-20, from a full cross-repo audit (uza-mobility-bn, uza-mobility-fn,
uza-mobility-admin, uza-nexus) plus external benchmarking. This is the single source of
truth for "is the driver journey ready to deploy" until it goes stale — re-audit before
trusting it blindly.

## The journey, stage by stage — what's real vs. missing

| # | Stage | Backend | Frontend | Verdict |
|---|---|---|---|---|
| 1 | Welcome/marketing | n/a | Real home page + new `/drive-with-us` journey page (built 2026-09-20) | Ready |
| 2 | Registration | `src/modules/auth/*` — full, production-grade | None needed (staff-assisted, see below) | Ready, by design |
| 3 | Training | `src/modules/academy/*` — real. **But**: a second, separate `TrainingCourse`/workshop concept exists too — reconcile the naming overlap | Admin: yes. Driver-facing: none | Needs reconciling |
| 4 | Funding partner | `src/modules/financing/*` — the deepest, most complete module in the codebase | Admin: yes (fund-applications). Driver: none (deliberate) | Ready, by design |
| 5 | Vehicle allocation | Schema-only before 2026-09-20 (`Allocation`, `AllocationQueue`, `Consignment*`) — module built this session, see Build Log | None | Backend built; frontend still open |
| 6 | Charging stations | `src/modules/charging-stations/*` — real, working, driver-facing (`/nearby`, `/cities`, `/:slug`) | fn: operator portal only, no customer discovery map | Backend ready; customer map missing |
| 7 | Garages (finder) | `Mechanic` model is internal-only (dispatch, not discovery) | None | Does not exist — real gap |
| 8 | Maintenance support | `src/modules/workshop/*` (JobCard, RescueCall) — real but staff/internal-dispatch oriented | Workshop staff portal only | Not driver-self-service |
| 9 | Monthly inspections | `src/modules/inspections/*` — real | None public | Ready, admin-only today |
| 10 | Wallet | `src/modules/wallet/*` — real, sophisticated (SweepMandate, DailySplit) | **fn has a full working wallet screen** (`my/wallet`) | Ready |
| 11 | Driver-facing daily app | Does not exist in uza-mobility-bn. **A separate embryonic app exists**: `uza-nexus/apps/uza-move` ("UZA Move / Drive & Earn") — Lovable-built, has driver/rider/wallet/ads/ops routes and real ride-hailing tariff/commission/Save2Own policy logic | uza-move has real routes | Real seed exists in the wrong repo — needs a decision on where this lives long-term |
| 12 | Kigali/tourism | Does not exist anywhere | None | Genuinely new — see Benchmark below |

**Vendor/supplier marketplace** (not one of the 12 stages, but explicitly requested): `Supplier`,
`SupplyOrder`, `SupplyOrderVehicle`, `SupplyPayment`, `CounterpartyAccess` models existed,
fully migrated, with zero service/controller code — confirmed safe to build without
duplicating anything. Built this session, see Build Log.

## A deliberate design decision, not a gap

`fund-application.controller.ts` is staff-only **on purpose**: "the programme is designed
for oral-first delivery in Kinyarwanda, so in practice a member of staff sits with the
applicant, reads the questions aloud... That is a deliberate design choice rather than a
limitation." This matters for anyone tempted to "just add a public registration form" —
doing so would override a considered, culturally-grounded decision, not fill an oversight.
The comment explicitly anticipates a *future, additive* self-service route that still
writes `completionMode: SELF_SERVICE` so the two are distinguishable in evidence.

The `/drive-with-us` page built this session respects this: it captures a lightweight
**interest lead** (name, phone, district), not the legal application — staff still call
the driver and complete the real form in person. See Build Log for the exact contract.

## A real governance risk, flagged not fixed

`uza-nexus/apps/uza-move/src/config/policy.ts` contains several ride-hailing/vehicle
economics constants explicitly marked `UNVERIFIED — invented by the Lovable build agent,
not a real founder decision`, despite being originally mislabeled `CONFIRMED`:
`UZA_VEHICLE_SELLING_PRICE` (22,500,000 RWF), `MIN_CLIENT_CONTRIBUTION` (500,000 RWF),
`BANK_DEPOSIT_BPS`, `LANDING_COST_DISCOUNT_BPS`, `INVESTOR_MARGIN_SHARE_BPS`,
`INVESTOR_RETURN_MIN/MAX_BPS`. **Nothing should be built or decided on top of these numbers
as if they were real** until Yves confirms each one and `POLICY_VERSION` is bumped from
`2026-09-02`. Any UI (Nexus or otherwise) that surfaces them must show them as unverified.

## Benchmark — 5 highest-leverage moves for Kigali (full sources in market-scout's memory)

1. **Battery-swap-as-a-service bolted onto the existing loan** (Ampersand/Spiro precedent)
   to lower the effective deposit without breaking UZA's 30% floor — price transparently;
   M-KOPA riders reportedly pay ~40% over sticker once interest compounds, a reputational
   trap to avoid explicitly.
2. **Ship Save2Own as a real-time, visible ownership-progress screen** — the policy logic
   already exists in `uza-move`; no named competitor has shipped this. Risk is under-shipping
   a real UZA advantage, not building something new.
3. **A financial-literacy/savings curriculum inside training** — no competitor publishes one;
   genuine first-mover gap.
4. **Offline-first app + live charging-queue indicator** — Kenya is already reporting
   peak-hour battery-swap queues; build ahead of Kigali hitting the same congestion.
5. **A "Twara Ambassador" dual-credential tourism tier** (top graduates get a
   tourism-board-adjacent credential, LEFA/Namibia precedent) — culturally distinct, requires
   a partnership UZA doesn't have yet (Rwanda Development Board or similar).

## Build log — what was actually done this session (2026-09-20), vs. designed-only

**Built, typechecked, and verified live in-browser:**
- `uza-mobility-fn`: `/drive-with-us` page — hero, 8-step journey explainer, interest-lead
  capture form (`POST /driver-interest`, separate from the legal `/financing/fund-applications`).
  Nav + footer updated. Zero typecheck/lint errors.

**Built by background agents, typechecked (see each module's own commit/diff for exact
verification output before trusting further) — NOT committed, review before merging:**
- `src/modules/allocation/` — vehicle-to-driver allocation, activating the previously-idle
  `Allocation`/`AllocationQueue`/`Consignment*` tables.
- `src/modules/suppliers/` — supplier CRUD, self-registration, and a new `SupplierOffer`
  model/migration for pre-order catalog submissions, activating the previously-idle
  `Supplier`/`SupplyOrder`/`SupplyOrderVehicle` tables, partitioned via `CounterpartyAccess`.

**Designed, not built — real work still ahead:**
- The `POST /driver-interest` backend endpoint itself (frontend built against this contract;
  backend needs a small `DriverInterestLead` model + module — natural next step, blocked
  only on not colliding with the two schema edits above while they were in flight).
- Nexus OS "Mobility journey overview" + vendor inbox: full design exists (extend the
  existing `EmpowerClientService` pattern with a new proxy module; a `StageNote` model for
  commenting, module-local, no `packages/contracts` change needed for CEO-only use; a
  contract-request already drafted at `uza-nexus/docs/contract-requests/2026-09-20-stage-note-role-grants.md`
  for extending it to other roles later).
- Garage/mechanic public discovery (map or list) — no backend model exists yet.
- Driver-facing charging/garage map UI in `uza-mobility-fn` — no map library in the
  dependency tree yet.
- Reconciling Academy vs. Workshop `TrainingCourse` naming overlap. **A third candidate
  surfaced this session**: `uza-nexus/apps/empower-academy` is a separate, substantial
  Lovable-built training/certification app (learn modules, final assessment, certificate,
  a partner portal, a public certificate-verification page) — not yet compared against
  uza-mobility-bn's own Academy module to determine if it's the same programme, a
  duplicate, or a genuinely different one (branding suggests "UZA Empower" as a broader
  workforce programme, possibly not Twara-EV-specific). Needs a dedicated audit before
  either is built on further.
- A decision on where `uza-move` (the ride-hailing app) belongs long-term — it's real,
  working code sitting in the wrong repo relative to everything else in this plan.
- The Kigali tourism layer — nothing built, benchmark-only (see item 5 above).

## Recommended next build order

1. `DriverInterestLead` backend endpoint (small, unblocks the already-shipped frontend).
2. Review and commit the Allocation and Supplier-marketplace modules from this session
   (real code exists, needs a human or a follow-up conformance pass before merging).
3. Nexus OS Phase 1 (mobility-journey read-only proxy — no mobility-bn changes needed,
   the admin controllers it proxies already exist).
4. Garage/maintenance driver-facing discovery (new ground — schema and UI both needed).
5. The `uza-move` repo-placement decision, then Save2Own UI (benchmark item 2 — an
   existing advantage, ship it visibly).
6. Everything else (tourism layer, financial-literacy curriculum, battery-swap financing
   structure) — real, but sequenced after the above.

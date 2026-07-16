# Audit Log — Security Compliance & No-Blind-Spot Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. This is a 🔒 SECURITY plan touching the authoritative audit trail — every task is TDD, `quality_gate action=security-ok` with written justification, and `w6d-security-audit` before commit. Invariant: **never remove or weaken an existing emit; only add coverage/integrity.** jinbe gate = `npm run typecheck && npm run lint && npm test`.

**Goal:** Make the audit log a trustworthy security record with **no blind spots**: every privileged mutation and every auth/access decision is recorded, with enough context to answer "who did what to whom, when, from where, and was it allowed" — and the record is tamper-evident, durable, and complete-by-construction (emit cannot be silently skipped).

**Scope of "compliance" here (define before building):** the control objectives we commit to. Each maps to tasks below.
- **C1 Completeness** — every state-changing action on a privileged resource emits a dedicated audit event (not just a generic access line).
- **C2 Sufficiency** — each event identifies actor (who+ip+session), target entity (type+id), action, result, and reason on denial.
- **C3 Auth decisions (within jinbe's boundary)** — every authZ decision jinbe makes is recorded: 401 unauthenticated, 403 not-admin/not-service-admin, privilege-escalation blocks, MFA-gate refusals. NOTE (verified): **login/logout/MFA-enrolment happen in Kratos, not jinbe** — jinbe only validates sessions. Those primary auth events live in Kratos's own audit trail; this plan documents that boundary and (C3.b) decides whether to ingest Kratos events for a unified log, rather than pretending jinbe emits them.
- **C4 Integrity** — the record is tamper-evident (append-only + hash chain) so silent edits/deletes are detectable.
- **C5 Durability/Retention** — events survive process restart and MAXLEN trimming per a stated retention policy; export path exists.
- **C6 Reliability** — a mutation that succeeds but whose audit emit fails is detectable (no silent audit loss).

**Architecture:** Centralize emission so coverage is structural, not per-handler discipline. Introduce an `auditableMutation()` wrapper / `onResponse` enrichment that guarantees a dedicated event for every mutating `/api/admin/*` and resource route, backed by a per-route audit descriptor (category, verb, target-resolver). Add a hash chain for tamper-evidence. Keep the existing rich-event schema; extend additively.

**Tech Stack:** jinbe (Fastify 4, Redis Streams, Prometheus, Vitest). Review: `bin/dev-local.sh` (seeded audit + OPA).

---

## Evidence — the blind-spot map (verified against source 2026-07-15)

Mutation surface: **~48 mutating endpoints across 11 route files.** Dedicated audit
emit exists in only **4 files** (`rbac.service.ts`, `admin.controller.ts`,
`user-groups.service.ts`, `rbac-bundle.service.ts`, `api-key.controller.ts`,
`organization-user`). Confirmed gaps:

| Area | Endpoints | Dedicated audit? | Risk |
|---|---|---|---|
| **Session revocation** | `DELETE /users/:id/sessions`, `DELETE /sessions/:sessionId` | ❌ NONE | 🔴 Force-logout leaves only "DELETE /sessions/x 204" — no target identity, no actor intent |
| **Clusters** | `POST/PUT/DELETE /clusters`, `/:id/databases`, `/:id/backups`, `/verify` | ❌ NONE | 🔴 Infra mutations unrecorded |
| **Databases / DB-API** | `POST/PUT/DELETE /databases*`, `/:id/api` | ❌ NONE | 🔴 Credential-bearing resources unrecorded |
| **Backups / backup-items** | `POST/DELETE /backups`, `PUT/DELETE items` | ❌ NONE | 🟠 Data-export actions unrecorded |
| **Jobs** | `POST /clusters/:id/jobs` | ❌ NONE | 🟠 Execution unrecorded |
| **Auth/authz denials** (401/403/not-admin/priv-esc/MFA-gate) | middleware | ✅ (require-auth/admin/service-admin all emit `deny`) | ok — verified complete within jinbe |
| RBAC (groups/services/roles/routes/rules/org-map) | many | ✅ via `invalidateBundle` | ok (categorization fixed by audit-refactor plan) |
| Users (create/update/delete/state/metadata/org) | admin.controller | ✅ | ok |
| User groups (privilege change) | user-groups.service | ✅ | ok |
| API keys, org-users, bundle import | ✅ | ok |

Additional systemic findings:
- **Integrity: NONE.** Plain Redis stream, `MAXLEN ~100000` (trimmable), no signing/hash-chain/append-only proof → silent tampering undetectable (**C4 fail**).
- **Reliability: emit is fire-and-forget** (`.emit(...).catch(()=>{})`). A mutation can succeed while its audit event is silently lost (**C6 fail**).
- **Sufficiency: the generic access-logger records `target = "METHOD path"` only** — no changed fields, no resolved target-entity id → the "coverage" it provides for the gap areas above is not audit-sufficient (**C2 partial**).
- **Cross-system boundary (C3):** primary authentication (login/logout/MFA enrolment) is owned by **Kratos**, not jinbe (verified: no login/logout/mfa emit in jinbe; jinbe validates sessions only). A truly unified "no blind spot" auth log must either (a) accept jinbe covers only authZ + session-validation and reference Kratos's audit for authN, or (b) ingest Kratos audit/webhook events into this stream. Decide in Phase 0.
- **Categorization** (separate concern) is handled by `2026-07-15-audit-refactor.md`; this plan depends on that being done first or in tandem (shared `audit-event.service.ts`).

---

## Phase 0 — Agree the compliance contract (brainstorm gate, no code)

### Task 0.1: Ratify control objectives + retention policy

**Files:** `kuma/docs/audit-compliance-contract.md` (create)

**Step 1:** With the user, confirm C1–C6, the **retention policy** (how long / how many events, and whether trimmed events are exported to durable storage first), the **actor identity source of truth** (Kratos session), and whether integrity must be **verifiable by a third party** (HMAC with a managed key) or just internally tamper-evident (hash chain). Document explicitly — compliance is meaningless undefined.
**Step 2:** Commit `docs(audit): compliance contract (C1-C6, retention, integrity model)`.

> Gate: do not proceed to code until the contract is signed off.

---

## Phase 1 — Completeness by construction (C1, C6)

Make it impossible to add a privileged mutation without an audit event.

### Task 1.1: Central `auditableMutation` wrapper + per-route audit descriptors

**Files:**
- Create: `jinbe/src/middleware/audit-mutation.ts` (wrapper + descriptor type)
- Create: `jinbe/src/__tests__/**/audit-mutation.test.ts`
- Modify: `audit-event.service.ts` (support synchronous, awaited emit — see 1.2)

**Step 1 (test):** A route wrapped with an audit descriptor `{ category, verb, resource, targetFrom(req,res) }` emits exactly one dedicated event on 2xx with the resolved target id, and an event with `result:'failed'`/`reason` on 4xx/5xx. Missing descriptor on a mutating route → a startup assertion fails (structural completeness check).
**Step 2:** FAIL. **Step 3:** Implement wrapper; add a test-only registry check that every `POST/PUT/PATCH/DELETE` under `/api/admin` and resource routers has a descriptor (fails CI otherwise → no future blind spots). **Step 4:** PASS + gate. **Step 5:** Commit `feat(audit): auditableMutation wrapper + completeness assertion`.

### Task 1.2: Make audit emit reliable (C6)

**Files:** `audit-event.service.ts`, wrapper

**Step 1 (test):** When the mutation succeeded, a failed audit emit is surfaced — either (a) the request returns a header/log marking `audit_degraded`, or (b) emit retries then increments a `jinbe_audit_emit_failures_total` counter and logs at error. Decide (a)/(b) in contract. Prove emit failure is never silent.
**Step 2:** FAIL. **Step 3:** Implement awaited emit inside the wrapper with bounded retry + failure metric; keep `MAXLEN`. **Step 4:** PASS + gate. **Step 5:** Commit `fix(audit): detectable emit failures (no silent loss)`.

---

## Phase 2 — Close the specific gaps (C1, C2)

Each task = descriptor + emit for one gap area, TDD, with target-entity resolution.

### Task 2.0: Kratos authN boundary decision (C3.b)

**Files:** `kuma/docs/audit-compliance-contract.md`
Decide (a) reference Kratos audit for login/logout/MFA, or (b) ingest Kratos
admin/webhook events into jinbe's stream for a unified trail. If (b): design a
kratos-webhook → audit emit path (separate task, 🔒). If (a): document that
authN evidence lives in Kratos and how to correlate by session id. No jinbe
code until decided.

### Task 2.1: 🔴 Session revocation

**Files:** `admin.controller.ts` (`revokeSession`, `revokeAllUserSessions`), route wiring
**Emit:** category `auth`, verb `revoke`, target `session:<id>` / `user:<email>`, actor, kind `auth`. Resolve the target identity (email) before revoking so the record names who was logged out.
**Steps:** test (revoke emits with target identity + actor) → FAIL → implement → PASS + gate → commit `feat(audit): record session revocation`.

### Task 2.2: 🔴 Clusters (create/update/delete/verify/nested)
### Task 2.3: 🔴 Databases + DB-API (create/update/delete)
### Task 2.4: 🟠 Backups + backup-items (create/delete)
### Task 2.5: 🟠 Jobs (execute)

Each: add audit descriptors via the 1.1 wrapper; TDD proving category/verb/target/actor/result; gate green; one commit per area (`feat(audit): record <area> mutations`).

### Task 2.6: Enrich change-events with changed-field summary (C2)

**Files:** wrapper + emitters
**Step 1 (test):** mutation events carry a compact `changes` summary (e.g. `{added:[...],removed:[...]}` for group roles) without logging secrets (redact credential fields). **Step 3:** implement redaction allowlist (never audit passwords/keys/DSNs in cleartext). Gate. Commit `feat(audit): changed-field summaries with secret redaction`.

---

## Phase 3 — Integrity & durability (C4, C5)

### Task 3.1: Tamper-evident hash chain

**Files:** `audit-event.service.ts`, tests
**Step 1 (test):** each event stores `prevHash` + `hash = H(prevHash || canonical(event))`; a verify routine detects any insertion/edit/deletion (broken chain). Optional HMAC with a Vault-managed key if the contract requires third-party verifiability.
**Step 2:** FAIL. **Step 3:** implement chained hashing at emit (single-writer ordering via the stream); add `GET /admin/audit/verify` (admin-only) returning chain-intact + first-broken-id. **Step 4:** PASS + gate. **Step 5:** commit `feat(audit): tamper-evident hash chain + verify endpoint`.

### Task 3.2: Durable retention / export before trim (C5)

**Files:** `audit-event.service.ts` (or a small sink), contract
**Step 1 (test):** events are exported/persisted beyond the Redis `MAXLEN` window per the retention policy (e.g. periodic append to object storage / separate long-stream), and trimming never loses an un-exported event. If out of scope for now, explicitly document the residual risk in the contract instead of silently accepting it.
**Step 2–5:** implement per contract; gate; commit `feat(audit): durable retention/export`.

---

## Phase 4 — Surfacing & verification (ties to audit-refactor + UX-1)

### Task 4.1: kuma surfaces integrity + completeness

**Files:** `kuma/src/pages/Audit.tsx` (via the audit-refactor server-side query)
**Step 1:** Audit page shows chain-verified status and can filter the now-complete categories (sessions/clusters/etc. now appear). Pixel rules from the audit-refactor Phase C still apply — additions use existing styles only.
**Step 2:** build PASS + dev-local. **Step 3:** commit `feat(audit): surface integrity status and full coverage`.

### Task 4.2: End-to-end blind-spot audit (verification)

**Step 1 (dev-local):** Script-exercise EVERY mutating endpoint from the map; assert each produces a dedicated, sufficient audit event (completeness test made executable). Record results.
**Step 2:** Any endpoint without a compliant event = defect → fix before done.
**Step 3:** commit `test(audit): executable no-blind-spot coverage matrix`.

---

## Dependencies & ordering

1. **Do `2026-07-15-audit-refactor.md` Phase A first (or fused):** both edit `audit-event.service.ts`; categorization + `kind` should land before/with completeness so new events are categorized right.
2. This plan is **jinbe-heavy and 🔒** — each phase is security-reviewed; nothing ships to shared dev without sign-off and `bin/dev-local.sh` verification.

## Definition of Done

- [ ] Contract C1–C6 ratified and documented; retention + integrity model explicit.
- [ ] Structural completeness: CI fails if a mutating `/api/admin` route lacks an audit descriptor (no future blind spots).
- [ ] Every gap area (sessions, clusters, databases, backups, jobs) emits dedicated, sufficient events (actor+target+action+result+reason).
- [ ] All authZ denials jinbe makes (401/403/not-admin/priv-esc/MFA-gate) recorded (already verified complete in middleware); Kratos authN boundary (C3) documented and the ingest-vs-reference decision made.
- [ ] Emit failures are detectable (metric/marker) — no silent audit loss.
- [ ] Tamper-evident hash chain + admin verify endpoint; secrets redacted from event bodies.
- [ ] Retention/export policy implemented or residual risk explicitly documented and accepted.
- [ ] Executable coverage matrix (Task 4.2) passes for all ~48 mutating endpoints.
- [ ] 🔒 security-ok + w6d-security-audit on every jinbe task; no existing emit weakened.

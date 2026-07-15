# Audit Subsystem Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Every kuma task ends `npm run build` green. Every jinbe task ends `npm run typecheck && npm run lint && npm test` green (quality gate). 🔒 audit changes touch a security-relevant record path — never drop or weaken an event; only change categorization/query/surfacing. `quality_gate action=security-ok` on jinbe tasks with a written justification.

**Goal:** Make the audit log usable and truthful: correct categorization at emit time, server-side filtering/pagination, separation of high-volume access-logs from change-events, and a kuma Audit page that renders the real stream **pixel-for-pixel identical** to the current UX-1 design (no visual regression) while actually reaching the right events.

**Architecture:** Two coordinated sides. (1) **jinbe** — fix categorization so events land in the categories the UI already models (auth/access/rbac/policy/service/route/secret/system), split noisy access-logs from change-events via a queryable dimension, and keep the Redis-Streams contract additive/back-compatible. (2) **kuma** — the Audit page queries jinbe **server-side** (category/kind/pagination) instead of fetching newest-200 and filtering client-side, rendered through the *exact* existing markup/classes.

**Tech Stack:** jinbe (Fastify 4, Redis Streams, Prometheus, Vitest), kuma (React 19, TanStack Query, Vite). Review: `bin/dev-local.sh` (OPA + real audit history wired).

**References:**
- Emit path: `jinbe/src/services/audit-event.service.ts`, `jinbe/src/middleware/audit-logger.ts`, `require-auth.ts`, `require-admin.ts`, `require-service-admin.ts`, `rbac.service.ts` (`invalidateBundle`).
- Query path: `jinbe/src/routes/audit.routes.ts` → `auditEventService.query`.
- Render (pixel target): `kuma/src/pages/Audit.tsx`, transforms `kuma/src/api/transforms.ts` (`normalizeAuditEvents`/`fetchAuditEvents`), client `kuma/src/api/client.ts` `getAuditEvents`.
- Parent plan item: **AUDIT-1** in `2026-07-15-kuma-store-and-hardening.md`.

---

## Findings that drive this plan (from live investigation 2026-07-15)

1. **Every `/api/admin/*` request emits an `access.allow` event** (`audit-logger.ts` onResponse). Legitimate, but high-volume; in dev-local kuma's own polling floods the stream.
2. **The UI models 8 categories** (auth/access/rbac/policy/service/route/secret/system) **but jinbe emits only 3** (access, rbac, system). So `service`/`route`/`policy`/`secret`/`auth` pills are ~always empty.
3. **All RBAC mutations collapse to `rbac.*`** via `invalidateBundle`, even service/route/access-rule/org-map changes that have their own UI pills. `roles.updated` emits category `roles` — **not even in the UI's 8** → renders as unknown/system.
4. **kuma filters client-side** over a flat newest-200 fetch (`Audit.tsx:40`), so category pills can't reach older events even though **jinbe's `query()` already supports server-side `category`/`since`/`until`**.
5. **`total` = `xlen`** (whole stream) while the page shows ≤200 — the "N total" is misleading vs what's filterable.

**Non-negotiable invariants (🔒):**
- No emit site is removed; no event silently dropped. Access-logging of admin traffic continues.
- Emitted fields are a **superset** of today (additive). The `normalizeAuditEvents` legacy branch keeps working for old stream entries (MAXLEN ~100k retains history across the change).
- Categorization changes are **display/query** semantics, not authz decisions.

---

## Phase A — jinbe: correct categorization at emit time (🔒)

Goal: events land in the category the UI already models, and change-events are distinguishable from access-logs by a queryable `kind`.

### Task A1: Add a `kind` dimension to the event schema (additive)

**Files:**
- Modify: `jinbe/src/services/audit-event.service.ts` (AuditEvent, redisFields, query, FrontendAuditEvent)
- Test: `jinbe/src/__tests__/**/audit-event.service.test.ts` (create)

**Step 1 (test first):** Write a failing test asserting `emit()` writes a `kind` field (`'access' | 'change' | 'auth' | 'system'`) into the stream and `query({ kind: 'change' })` returns only change-events. Include a legacy-entry test (entry without `kind`) proving it still parses and is treated as `kind` inferred from category (access→access, rbac/service/route/policy/secret→change, auth→auth, else system).
**Step 2:** Run → FAIL.
**Step 3:** Implement: add optional `kind` to `AuditEvent`/`FrontendAuditEvent`; `redisFields` writes it; `query()` accepts `kind?` and filters (server-side, same pattern as `category`); when absent on a stream entry, **infer** from category (back-compat). Keep `MAXLEN ~100000`.
**Step 4:** Run → PASS. `npm run typecheck && npm run lint && npm test`.
**Step 5:** Commit `feat(audit): add queryable kind dimension (access|change|auth|system)`.

### Task A2: Categorize change-events correctly (stop collapsing to `rbac.*`)

**Files:**
- Modify: `jinbe/src/services/rbac.service.ts` (`invalidateBundle` call sites / event types), `audit-event.service.ts` (`VERB_MAP`, `upgradeLegacy` category mapping)
- Test: extend audit-event tests

**Step 1 (test):** Assert that a service create emits category `service` (not `rbac`), route-map update → `route`, access-rule change → `rbac` (gateway) or a dedicated category per the UI vocab, org-service-map → `rbac`, `roles.updated` → `rbac` with verb `update` (never category `roles`). Each also `kind: 'change'`.
**Step 2:** FAIL.
**Step 3:** Implement a single categorization map used by `upgradeLegacy` (so existing `type: 'rbac.service_created'` etc. map to the right category+verb+kind). Do NOT change call sites' behavior beyond the type string if avoidable — prefer fixing the mapping centrally. Ensure every UI category that should be reachable can be produced.
**Step 4:** PASS + gate green.
**Step 5:** Commit `fix(audit): map change-events to correct UI categories`.

### Task A3: Tag access/auth middleware emits with `kind`

**Files:** `jinbe/src/middleware/audit-logger.ts`, `require-auth.ts`, `require-admin.ts`, `require-service-admin.ts`

**Step 1 (test):** access.allow / access.deny carry `kind:'access'`; unauthenticated/ not_admin denials carry `kind:'access'` (they're access decisions) with correct `reason`. Login/logout/mfa (if emitted) → `kind:'auth'`.
**Step 2:** FAIL. **Step 3:** Add `kind` to each emit. No logic change. **Step 4:** PASS + gate. **Step 5:** Commit `feat(audit): tag middleware emits with kind`.

### Task A4: Query API exposes `kind` + accurate totals

**Files:** `jinbe/src/routes/audit.routes.ts`, `audit-event.service.ts` (`count`)

**Step 1 (test):** `GET /admin/audit/events?kind=change&limit=50` returns only change-events; response includes a `total` that reflects the **filtered** count semantics (document: `total` = stream length; add `filteredEstimate` or make `total` honest for the filter — pick one and test it). Backward compat: no-param call behaves as today.
**Step 2:** FAIL. **Step 3:** Thread `kind` through the route; fix the misleading total (either rename to `streamTotal` + add filtered count, or scope). Keep response back-compatible for kuma's current caller until Phase B swaps it. **Step 4:** PASS + gate. **Step 5:** Commit `feat(audit): kind filter + honest totals in query API`.

---

## Phase B — kuma: server-side querying (AUDIT-1)

### Task B1: Client + hook support category/kind/pagination

**Files:** `kuma/src/api/client.ts` (`getAuditEvents` params), `kuma/src/api/hooks.ts` (`useAudit`), `kuma/src/api/transforms.ts` (`fetchAuditEvents`)

**Step 1:** `getAuditEvents({ limit, category, kind, since, until })` already typed for limit/category/since — add `kind`, `until`. `useAudit(params)` becomes parameterized with a stable query key `['audit', params]`.
**Step 2:** `npm run build` PASS. **Step 3:** Commit `feat(api): audit query supports kind/category/pagination`.

### Task B2: Audit page queries server-side (no visual change)

**Files:** `kuma/src/pages/Audit.tsx`

**Step 1:** Replace the client-side `audit.filter(...)` category filtering with server-side params: category pill → `category` query; a new "Changes vs Access" toggle → `kind`; keep search client-side over the fetched page. Default view: `kind=change` OR all — decide with UX (see Phase C). Pagination via `since`/`until` cursors instead of slicing an in-memory array.
**Step 2:** **PIXEL RULE:** do not touch markup, class names, or inline styles — only the data source feeding the same rows. Diff the rendered DOM structure against `main` (same `audit-row`, `audit-col-*`, `audit-cat`, `audit-detail` classes). Build PASS + dev-local visual check.
**Step 3:** Commit `feat(audit): server-side category/kind filtering + cursor pagination`.

---

## Phase C — Pixel-match & UX parity pass (matches UX-1)

> Purpose: guarantee the refactored Audit page is visually identical to the current UX-1 design, and that the new controls (kind toggle) fit the existing visual language.

### Task C1: Snapshot the current UX-1 render as the pixel baseline

**Files:** `kuma/docs/audit-ux1-baseline.md` (create) + screenshots via dev-local

**Step 1:** From `main` (pre-refactor), capture the Audit page states: empty, populated, expanded row, each category pill active, Success/Denied segment, day-group headers. Record exact classes and computed styles for `audit-head`, `audit-row`, `audit-cat`, `audit-col-time/who/what/meta/status`, `audit-detail-grid`. This is the acceptance reference.
**Step 2:** Commit `docs(audit): UX-1 pixel baseline`.

### Task C2: Diff refactored page against baseline; fix any drift

**Files:** `kuma/src/pages/Audit.tsx`, `kuma/src/styles/index.css` (only if drift)

**Step 1:** Side-by-side in dev-local (refactor branch vs baseline screenshots). Verify: identical row height/columns/spacing, category tag icons+labels (all 8 now actually reachable), verb tone colors (`verbTone`), status chips, day grouping ("Today"/"Yesterday"), expand detail grid, IP/UA/rt/mfa context cells, "Export CSV" button position.
**Step 2:** The ONLY intended visual addition: a "Changes / Access / All" segmented control in the existing `.seg` style (mirrors the existing Success/Denied `seg`), placed in the existing filter row — no new layout regions. Verify it uses the same `.seg`/`.audit-cats` classes.
**Step 3:** Any pixel drift = fix to match baseline exactly. Build PASS.
**Step 4:** Commit `fix(audit): pixel-match UX-1 baseline; add kind segment in existing seg style`.

### Task C3: Verify the categories light up correctly end-to-end

**Step 1 (dev-local):** With OPA + seeded audit history: trigger a service create, route update, group update, access-rule edit, a denied request. Confirm each lands under the correct UI pill (Service/Route/RBAC/Access) — previously all showed as RBAC/Access. Confirm "Changes" kind hides the access-log flood; "Access" shows it.
**Step 2:** Confirm counts/totals read honestly.
**Step 3:** No commit (verification task) — or commit a short `docs(audit): dev-local verification notes`.

---

## Phase D — Optional hardening (only if agreed)

### Task D1: Sampling/suppression for read access-logs (discuss first)

**Files:** `jinbe/src/middleware/audit-logger.ts`

Brainstorm gate with user: should high-frequency GET access-logs be sampled or moved to a separate stream/retention, so the change-audit stream stays legible long-term? This changes what's persisted → 🔒 security review; do NOT implement without explicit sign-off. Default: leave as-is (Phase A `kind` already lets the UI hide them).

---

## Definition of Done

- [ ] jinbe emits every UI category correctly; change-events no longer collapse to `rbac`; `roles.updated` no longer produces an unknown category.
- [ ] Events carry a `kind` (access|change|auth|system); legacy entries infer it (back-compat proven by test).
- [ ] No emit site removed; access-logging intact; fields additive; gate green (typecheck+lint+test).
- [ ] kuma Audit page filters **server-side** by category/kind with cursor pagination; search stays client-side over the page.
- [ ] Audit page is **pixel-identical** to the UX-1 baseline except one added segmented control in the existing `.seg` style; verified against C1 screenshots.
- [ ] dev-local: triggering service/route/group/access-rule/denial changes lights up the correct pills; "Changes" hides the access flood.
- [ ] 🔒 security-ok recorded on jinbe tasks; backend authoritative; no authz behavior changed.

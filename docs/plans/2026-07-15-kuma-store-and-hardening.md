# Kuma Store Consolidation & Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Every task MUST end with `npm run build` green (the kuma quality gate). Sensitive tasks (marked 🔒) additionally require `quality_gate action=security-ok` before commit.

**Goal:** Collapse kuma's dual state system into a single TanStack Query store with scoped queries, optimistic mutations, a real router, hardened jinbe API contracts, and remove dead/garbage code — without regressing auth safety.

**Architecture:** TanStack Query becomes the *only* store. `AppContext.state` mirror is deleted. Each page reads scoped queries (`['users']`, `['groups']`, `['services']`, `['roles',svc]`, `['routes',svc]`, `['rules']`, `['audit']`). Mutations do optimistic `onMutate` + rollback and invalidate only the touched key. Navigation moves to per-entity URLs. The jinbe user-directory N+1 is addressed separately behind a security review.

**Tech Stack:** React 19, Vite 8, @tanstack/react-query v5, TypeScript ~6. Backend: jinbe (Fastify 4, Node 22). Review: `bin/dev-local.sh`.

**Reference:** `kuma/PROBLEM-MAP.md` (item IDs like STORE-1 map to sections here).

---

## AUDIT-1 (kuma) — audit page uses server-side filtering (found during review)

Symptom seen in dev-local: the Audit page shows ~200 events, all `access` /
"Dev User", burying real change history. Root cause is legitimate jinbe
behavior (the `auditLogger` onResponse hook emits an `access.allow` event for
every `/api/admin/*` request), amplified by kuma's mega-query + aggressive
refetch traffic (PERF-1/STORE-2). kuma fetches a flat `limit:200` newest-first
and filters **client-side** (`Audit.tsx:40`), so the category pills only filter
within the newest 200 — real `rbac.*`/`service.*` change events are never
reached.

Fix (kuma, safe-ish, do with the audit page work): use jinbe's existing
server-side `category` + `since`/`until` query params (client already types
them in `getAuditEvents`), and paginate server-side. Consider a default view
that de-emphasises `access` read-logs vs change events. Reduces once the store
re-architecture cuts kuma's self-traffic. Note: this is display/query only, no
authz impact.

---

## ⚠️ DEFERRED — jinbe changes (do these LAST, after all kuma-only work)

Investigation (2026-07-15, against live cluster redis) confirmed these require
coordinated **jinbe** edits and MUST NOT be started until the kuma-only safe
fixes are done and the API-3/API-4 contract approach is explicitly approved.
Each touches the RBAC backend → quality-gate flags jinbe sensitive → needs
`quality_gate action=security-ok` + verification on dev-local.

- **API-3 (jinbe) — rule→service field.** kuma CANNOT derive this client-side:
  real rule ids use `-` while service names use `_` (`stairwage-studio` rule vs
  `stairwage_studio` service); services own multiple rules (`kuma-api`,
  `kuma-settings`, `kuma-app`); bootstrap rules (`kratos-public`,
  `selfservice-root`) map to no service; existing rules carry no
  `authorizer.config.payload.app`. jinbe must add a nullable `service` field to
  each rule in the `/access-rules` response (set at read time). Then kuma drops
  `id.split('-')[0]`. Consumers today: Rules page display + route preview,
  Services upstream enrichment, Services drawer edit-rule lookup.
- **API-4 (jinbe) — authDomain.** Replace kuma's regex-scrape of a kratos rule
  match URL with a real `meta.authDomain` on the whoami response (jinbe has
  AUTH_DOMAIN env). Additive, low risk.
- **API-2 — create-service description.** kuma now plumbs `description`→
  `displayName` through `apiCreateService` (done, safe-fixes phase). BUT jinbe's
  `createService` accepts `displayName` and then **drops it** — `addService(name)`
  never calls `setServiceMetadata`, so the description is not persisted and
  `getServices` returns none. jinbe change (deferred): persist
  displayName/description via setServiceMetadata in createService so it round-
  trips. Low risk (metadata only, not authz).
- **🔒 PERF-2 (jinbe) — user-directory N+1.** `enrichWithRbac` per-identity ×
  uncached `resolveUserRbac` × client `page_size=1000`. This is fail-closed
  authz resolution — its own TDD + `w6d-security-audit` pass, bundled with
  nothing else, done LAST.

---

## Ground rules (read before starting)

- **Build-green invariant:** after every task, `cd kuma && npm run build` must pass. This is the gate; never commit red.
- **No shared-dev shipping until sign-off:** do NOT `bin/ship.sh kuma` to `auth-admin-ui` mid-migration. Verify locally via `bin/dev-local.sh`. Final ship to dev is a human-approved step (Phase F).
- **Isolation for review:** `bin/dev-local.sh` seeds a LOCAL redis from a cluster snapshot; RBAC edits stay local. Only user create/delete reaches real dev Kratos.
- **🔒 Sensitive tasks** touch authz/RBAC (jinbe) — they require an explicit security justification (`quality_gate action=security-ok`) and a `w6d-security-audit` pass before commit. Backend stays authoritative; fail closed.
- **Conventional commits**, one per task. No `stairling`/cluster identifiers in commit messages (the gate blocks them).

---

## Phase A — Foundation: one store (STORE-1, STORE-2, GHOST-1)

Adopt the already-present scoped hooks in `src/api/hooks.ts`; stop mirroring into `useState`.

### Task A1: Consolidate transforms into one module (STORE-6)

**Files:**
- Create: `kuma/src/api/transforms.ts`
- Modify: `kuma/src/api/useRbacData.ts` (remove local `kratosToUser`/`jinbeRuleToUi`/`timeAgo`), `kuma/src/api/hooks.ts` (import from transforms)

**Step 1:** Move the *richer* `kratosToUser` (mfa + organizationId), `jinbeRuleToUi` (stripPath), `timeAgo`, and the audit normalizer out of `useRbacData.ts` into `transforms.ts` as named exports.
**Step 2:** Re-export from both call sites; delete the duplicate definitions in `hooks.ts`.
**Step 3:** `npm run build` → PASS (no behavior change yet).
**Step 4:** Commit `refactor(api): single transforms module`.

### Task A2: Add scoped query hooks (adopt GHOST-1)

**Files:** Modify `kuma/src/api/hooks.ts`

**Step 1:** Ensure hooks exist and are correct: `useUsers` (paginated — see Phase B), `useGroups`/`useGroupsMap`, `useServices`, `useRoles(svc)`, `useServiceRoutes(svc)`, `useAccessRules`, `useAudit`, `useHistory`, `useSession`. Fix `useAllRoles` stable key (PERF-6): key `['roles','all']` with the service list in `queryFn`, not spread into the key.
**Step 2:** Each hook uses an explicit `staleTime` (align to 30s; see PERF-5) and returns transformed UI shapes.
**Step 3:** `npm run build` → PASS.
**Step 4:** Commit `feat(api): scoped query hooks`.

### Task A3: Derive computed state via `select`, not a blob

**Files:** Create `kuma/src/api/derived.ts`

**Step 1:** Move the derivations that pages need (issues, signals, matrix rows in Dashboard; groupsMap) into pure functions taking the scoped query results, memoized in the page.
**Step 2:** `npm run build` → PASS.
**Step 3:** Commit `feat(api): derived selectors`.

### Task A4: Migrate one page off `AppContext.state` as proof (Groups)

**Files:** Modify `kuma/src/pages/Groups.tsx`

**Step 1:** Replace `useApp().state.groups/services/roles/users` reads with `useGroups()`, `useServices()`, `useRoles`/`useAllRoles`, `useUsers()`.
**Step 2:** Keep drawer open/close in context (UI state) but source data from queries.
**Step 3:** Local review: `bin/dev-local.sh`, open Groups, confirm identical rendering + edit still works (optimistic in Phase C; for now invalidate).
**Step 4:** `npm run build` → PASS. Commit `refactor(groups): read from scoped queries`.

### Task A5: Migrate remaining pages (Users, Services, Roles, Routes, Rules, Simulator, Audit, Dashboard)

One task per page (A5a…A5h), same pattern as A4. After each: build green + local smoke test. Commit per page.

### Task A6: Delete the `state` mirror (STORE-1)

**Files:** Modify `kuma/src/contexts/AppContext.tsx`

**Step 1:** Once no page reads `state`, remove `state`/`setState`/the sync `useEffect`/the background user loader (moves to Phase B). Context keeps ONLY UI state (page, drawers, activeService, theme, tweaks, toasts, pipeline) + mutation wrappers.
**Step 2:** `npm run build` → PASS. Local full smoke test across every page.
**Step 3:** Commit `refactor(context): drop state mirror; query is the store`.

---

## Phase B — Users as a first-class paginated query (PERF-1, PERF-3, STORE-3)

### Task B1: Server-driven user pagination hook

**Files:** Modify `kuma/src/api/hooks.ts`, `kuma/src/api/client.ts`

**Step 1:** Replace the eager 100-page walk with `useInfiniteQuery` keyed `['users', {q, group}]`, `getNextPageParam` = `nextPageToken`, `page_size=100` (not 1000 — see PERF-2). Do NOT re-walk on unrelated mutations.
**Step 2:** `npm run build` → PASS.
**Step 3:** Commit `perf(users): infinite query instead of eager full walk`.

### Task B2: Users page uses infinite scroll / "load more" + memoized filter

**Files:** Modify `kuma/src/pages/Users.tsx`

**Step 1:** Wire pagination to the infinite query; memoize the client filter; keep the search box responsive.
**Step 2:** Local review with a large directory (dev Kratos has real users).
**Step 3:** `npm run build` → PASS. Commit `perf(users): paginated table`.

### Task B3: Scope all mutation invalidations (STORE-3)

**Files:** Modify `kuma/src/contexts/AppContext.tsx` mutation wrappers + `hooks.ts`

**Step 1:** Each mutation invalidates only its entity key (group edit → `['groups']`; role edit → `['roles',svc]`; user group change → `['users']` + `['groups-map']`), never `['rbac-all']`.
**Step 2:** Confirm editing a group does NOT refetch users (network tab in local review).
**Step 3:** `npm run build` → PASS. Commit `perf(mutations): scoped invalidation`.

---

## Phase C — Correct, optimistic writes (STORE-4, UX-1)

### Task C1: Optimistic mutation helper with rollback

**Files:** Create `kuma/src/api/mutations.ts`; modify page mutations

**Step 1:** Standard `onMutate` (snapshot + optimistic cache set), `onError` (rollback + error toast), `onSettled` (scoped invalidate). Remove all `setState(s => …)` local writes.
**Step 2:** Per-page adoption (C1a…): Groups, Roles, Routes, Rules, Services, Users. Build green after each.
**Step 3:** Commit per page `fix(<page>): optimistic mutation + rollback`.

### Task C2: Stop faking sync (UX-1)

**Files:** Modify `kuma/src/hooks/useApplyChange.ts`, `AppContext.tsx` (`usePipeline`), Dashboard

**Step 1:** Remove synthetic `appendAudit` "applied" rows and the 240ms fake pipeline as a *success signal*. Keep a lightweight "saving…/saved" indicator driven by mutation state. Audit view shows only real backend events.
**Step 2:** `npm run build` → PASS. Local review: edit → indicator reflects real request lifecycle.
**Step 3:** Commit `fix(ux): drive save state from real mutations, not a timer`.

---

## Phase D — Navigation & routing (NAV-1..5, STORE-5)

### Task D1: Fix the empty-services crash (STORE-5) — do this first, standalone

**Files:** Modify `kuma/src/pages/Roles.tsx:135`

**Step 1:** `const svc = activeService && state.services.some(...) ? activeService : services[0]?.name` — guard `undefined`. Render empty-state when no services.
**Step 2:** Local review with an empty tenant (or mock empty services).
**Step 3:** `npm run build` → PASS. Commit `fix(roles): guard empty services list`.

### Task D2: Introduce a real router with per-entity URLs (NAV-2/3)

**Files:** add router (evaluate `react-router` vs keep hash but structured); modify `App.tsx`, `AppContext.tsx`

**Step 1 (brainstorm gate):** Decide router approach with the user before implementing (this is a design choice). Encode: page, `activeService`, and drawer target (`/users/:id`, `/groups/:name`, `/services/:name`) in the URL.
**Step 2:** Migrate CmdK + "Edit" jumps to navigate URLs so Back works.
**Step 3:** `npm run build` → PASS. Local review: deep-link + back button.
**Step 4:** Commit `feat(nav): real router with per-entity URLs`.

### Task D3: Remove/clarify dead nav affordances (NAV-4/5)

**Files:** `Dashboard.tsx` (⌘⇧T hint), Sidebar/Settings labels

**Step 1:** Either implement ⌘⇧T or remove the hint. Distinguish "Account settings" (auth domain) vs "Admin settings".
**Step 2:** Build green. Commit `fix(nav): remove dead shortcut hint; clarify settings`.

---

## Phase E — API hardening + cleanup (API-1..6, GHOST-2..5, HYG-1..6, UX-3)

### Task E1: 🔒 Rule→service mapping (API-3) — coordinate with jinbe

**Files:** `jinbe/src/routes/rbac.routes.ts` access-rules response, `kuma/src/api/transforms.ts`

**Step 1:** Add a real `service` field to the access-rules API response (jinbe) instead of kuma splitting the id. 🔒 authz-adjacent → security review of the jinbe change; `quality_gate action=test repo=jinbe` + `action=security-ok`.
**Step 2:** kuma consumes the field; delete id-parsing.
**Step 3:** jinbe gate green + kuma build green. Verify on local. Commit both repos.

### Task E2: Fix create-service dropping description (API-2)

**Files:** `kuma/src/api/hooks.ts`, `Services.tsx`

**Step 1:** Widen the create payload type; send `description`/`displayName`.
**Step 2:** Build green + local review (create service, reload, description persists).
**Step 3:** Commit `fix(services): persist description on create`.

### Task E3: authDomain + meta from jinbe (API-4)

**Files:** 🔒-adjacent (auth redirect). jinbe `meta` endpoint or whoami extension; kuma `useRbacData`/session.

**Step 1:** Prefer real `meta.authDomain`; keep regex scrape as fallback only.
**Step 2:** Build green; local review 401 redirect target correct.
**Step 3:** Commit.

### Task E4: Delete/repair `getUsersMatrix` (API-1) and dead simulate reasons (API-6)

**Files:** `client.ts`, `Simulator.tsx`

**Step 1:** Remove `getUsersMatrix` (unused, wrong shape) or repair against a real endpoint. Remove `no_rule`/`auth_failed` branches `buildDecision` never emits.
**Step 2:** Build green. Commit `chore(api): drop dead matrix client + simulate branches`.

### Task E5: Remove ghost code (GHOST-2/3/5) + console.logs (HYG-1)

**Files:** `Primitives.tsx` (Modal), `useApplyChange.ts`/SEED demo branch, `TweakDefaults` unused fields, `AppContext.tsx`/`useRbacData.ts` logs

**Step 1:** Gate SEED/demo behind `import.meta.env.DEV`. Remove `Modal` if unused (or use for UX-8 confirm). Prune tweak fields with no CSS/control. Delete `console.log`s.
**Step 2:** Build green. Commit `chore: remove dead code and debug logs`.

### Task E6: DEV-gate `simulateForbidden` + derive read-only from session (UX-3, UX-2)

**Files:** `App.tsx`, `AppContext.tsx`, `TweaksPanel`

**Step 1:** Hide `simulateForbidden` unless DEV. Replace the self-serve `persona` viewer/admin toggle with read-only derived from real session permissions.
**Step 2:** Build green + local review. Commit `fix(ux): gate dev-only toggles; derive read-only from session`.

### Task E7: Type hygiene (HYG-2/3/4)

**Files:** across `useRbacData.ts` (audit parser types), `Settings.tsx`, drawer effect deps

**Step 1:** Replace `any` with real types for audit/error contracts. Fix exhaustive-deps in UserDrawer/ServiceDrawer effects (the stale-drawer bugs). Fix fast-refresh export boundaries.
**Step 2:** `npm run build` + `npm run lint` → 0 warnings target. Commit `chore: type hygiene, fix stale-closure effects`.

### Task E8: UX polish (UX-4/7/8)

**Files:** pages + `Pagination.tsx`

**Step 1:** Add skeletons/loading states per page; make pagination reset explicit; add a confirm+summary before bundle import.
**Step 2:** Build green + local review. Commit `feat(ux): skeletons, import confirm, pagination clarity`.

---

## Phase F — 🔒 jinbe user-directory performance (PERF-2) — SEPARATE, security-reviewed

> This changes fail-closed authz resolution. It is NOT bundled with UI work.

### Task F1: 🔒 Cache/batch group resolution in `resolveUserRbac`

**Files:** `jinbe/src/services/rbac-resolver.service.ts`, `jinbe/src/controllers/admin.controller.ts`

**Step 1 (brainstorm + security-audit gate):** Design with the user + `w6d-security-audit`. Options: per-request memo of group/role defs (fetched once, not per-identity); optional `enrich=false` lite listing for the directory; short-TTL cache with explicit invalidation on RBAC mutation. MUST preserve fail-closed semantics (on cache miss/error → deny, never default-allow).
**Step 2:** TDD — add tests proving: (a) same authz decisions as before, (b) no per-identity Kratos storm, (c) cache invalidated on group/role change.
**Step 3:** `quality_gate action=test repo=jinbe` (typecheck+lint+test) → PASS; `quality_gate action=security-ok repo=jinbe reason="…"`.
**Step 4:** Commit `perf(rbac): batch group/role resolution for directory listing`.

### Task F2: Verify end-to-end on local, then propose dev ship

**Step 1:** `bin/dev-local.sh`, load the directory, confirm dramatically fewer backend calls and identical decisions in the Simulator.
**Step 2:** Present results to the user. Only on approval: ship jinbe + kuma to dev via `bin/ship.sh`, verify rollout + logs, then `quality_gate action=verify`.

---

## Definition of Done (whole effort)

- [ ] `AppContext.state` mirror deleted; TanStack Query is the sole store.
- [ ] Editing one entity does not refetch unrelated data (verified in network tab).
- [ ] Optimistic writes with rollback; no fake pipeline/audit success signals.
- [ ] Per-entity URLs + working back button; no empty-services crash.
- [ ] API contracts corrected with jinbe (rule→service, description, authDomain).
- [ ] Dead code + debug logs removed; `npm run build` green; lint warnings → 0.
- [ ] 🔒 jinbe PERF-2 done under security review, fail-closed preserved, tests prove parity.
- [ ] Reviewed on `bin/dev-local.sh`; dev ship only after human sign-off.

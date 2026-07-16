# kuma — exhaustive problem map (pre-big-mod audit)

Audited 2026-07-15 against the live source of `kuma` and cross-referenced with the
`jinbe` API (`src/routes/*`, `src/controllers/admin.controller.ts`,
`src/services/rbac-resolver.service.ts`). Scope: data/store architecture, caching &
performance, API-contract correctness, UI/UX & navigation, ghost/dead code, hygiene.

Severity: **P0** = correctness/security/perf regression users feel now · **P1** =
significant · **P2** = polish/debt. Each item has a stable ID for the mod plan.

---

## 0. Executive summary — the one big problem

**kuma fetches everything, all the time, into a second copy of state, and re-fetches
the entire world after every mutation.** There are effectively *two* state systems
layered on top of each other:

1. TanStack Query (`useRbacData` → `['rbac-all']`) does one giant aggregate fetch.
2. `AppContext` copies that query result into a `useState` (`state`) via `useEffect`,
   and every page then reads/writes `state` — often mutating the local copy directly
   (`setState(s => …)`) *instead of* the server cache.

This is the root cause of most UX and perf pain: stale/rubber-banding data, a
full-directory re-stream on every edit, no per-entity caching, no optimistic updates,
and navigation that feels heavy because nothing is scoped per-route. The big mod
should collapse this to **one** system: TanStack Query as the single store, with
scoped query keys, `select`/derived data, and optimistic mutations. Kill the
`AppContext.state` mirror.

---

## 1. Store / state architecture (the core of the mod)

- **STORE-1 (P0) — Dual source of truth.** `useRbacData` returns data, then
  `AppContext` mirrors it into `useState` (`AppContext.tsx:165-172`). Every page reads
  `state` from context, not the query. Result: the query cache and the context copy can
  disagree, and none of TanStack Query's caching/invalidation benefits reach the UI.
  → Make Query the store; drop the `state` mirror.

- **STORE-2 (P0) — One mega-query for the whole app.** `fetchAllRbacData`
  (`useRbacData.ts:83-272`) fetches users(pg1) + groups + services + access-rules, then
  **loops every service** to fetch roles + routes (`Promise.all(servicesRaw.map…)`),
  then audit, in a single query keyed `['rbac-all']`. Every page mounts the same blob.
  Viewing *Users* still pays for *roles/routes/rules/audit* of every service.
  → Split into scoped queries (`['users']`, `['groups']`, `['services']`,
  `['roles', svc]`, `['routes', svc]`, `['rules']`, `['audit']`) fetched on demand per
  page. The scoped hooks **already exist in `hooks.ts`** but are unused (see GHOST-1).

- **STORE-3 (P0) — Mutations invalidate the entire world.** All `api*` mutations in
  `AppContext` call `invalidateRbac()` = invalidate `['rbac-all']`
  (`AppContext.tsx:243-320`), which re-runs the whole mega-fetch *including a full
  re-stream of the user directory* (see PERF-1). Toggling one role on one group
  re-downloads every user, every service's roles/routes, and the audit log.
  → Scope invalidations to the touched entity (e.g. only `['groups']`).

- **STORE-4 (P1) — Local writes bypass the server cache.** 17 call sites do
  `setState(s => …)` to mutate the mirror directly (Roles/Routes/Rules/Services/Groups/
  Users). In `isLive` mode some do both (mutateAsync **then** setState, e.g.
  `Roles.tsx:139`, `Routes.tsx:92`), double-writing; the demo branch only writes local.
  This is why edits sometimes "stick" visually but revert on next refetch.
  → Single path: optimistic `onMutate` cache update + rollback on error.

- **STORE-5 (P1) — `activeService` is a bare string, unvalidated.**
  `AppContext` seeds `activeService="jinbe"` (`:157`). `RolesPage` does
  `const svc = activeService || state.services[0].name` (`Roles.tsx:135`) — **crashes**
  if `state.services` is empty (loading/403/empty tenant): `state.services[0]` is
  `undefined`. Routes guards this (`activeService && state.routeMaps[activeService] ? … : "jinbe"`),
  Roles does not.
  → Guard against empty services; derive default from loaded data.

- **STORE-6 (P2) — Two divergent `kratosToUser` + `jinbeRuleToUi` implementations.**
  `hooks.ts` and `useRbacData.ts` each define their own `kratosToUser`,
  `jinbeRuleToUi`, `timeAgo`. They differ: `useRbacData`'s versions handle `mfa`,
  `organizationId`, `stripPath`, and `service = id.split('-')[0]`; `hooks.ts`'s
  `jinbeRuleToUi` uses `id.replace(/-authenticated$|-health$/, '')`. Whichever path a
  future refactor picks changes behavior silently.
  → One transforms module.

---

## 2. Caching & performance

- **PERF-1 (P0) — Full directory re-stream on every mutation.** The background loader
  (`AppContext.tsx:177-206`) walks the Kratos keyset (up to 100 pages / 100k users) and
  is keyed on `[liveData]`. Because every mutation invalidates `['rbac-all']`, `liveData`
  changes, so the whole directory re-streams from page 1 after *any* edit anywhere.
  On a large tenant this is minutes of background traffic per click.
  → Users should be their own paginated/virtualized query, server-driven, not re-walked.

- **PERF-2 (P0) — Backend N+1 amplified by client page_size=1000.** Client requests
  `page_size=1000` (`client.ts:41`). jinbe's `listUsers` calls `enrichWithRbac` **per
  identity** (`admin.controller.ts:74-77`), and each `resolveUserRbac`
  (`rbac-resolver.service.ts`) does a Kratos `getUserGroups` call + Redis reads **with no
  cache**. So one page = up to 1000 × (Kratos round-trip + several Redis reads). This is
  the single most expensive call in the product and the client maximizes its blast
  radius by asking for the biggest page and then walking *all* pages eagerly.
  → Coordinate with jinbe: cache/batch group resolution; client should page lazily and
  only enrich the rows actually shown.

- **PERF-3 (P1) — Client-side fetch-all then paginate in memory.** Users
  (`Users.tsx`), Routes, Audit all load the full set and slice with `usePagination`.
  The whole dataset lives in memory and re-renders on every keystroke in the search box
  (filter runs over all rows each render, `Users.tsx:15-19`).
  → Server-side search/pagination, or at least virtualization + memoized filtering.

- **PERF-4 (P1) — Per-mount uncached side fetches.** `RolesPage` fetches
  `getServicePermissions(svc)` in a `useEffect` on every service switch with local
  `useState` (`Roles.tsx:138-146`) — outside Query, so no caching, re-fetched each visit.
  `SettingsPage` fetches `getOrgServiceMap` on every mount (`Settings.tsx:29-34`), also
  outside Query.
  → Move to Query hooks with keys.

- **PERF-5 (P2) — `staleTime` split-brain.** Global default `staleTime: 30_000`
  (`main.tsx:10`) vs `['rbac-all']` `staleTime: 60_000` (`useRbacData.ts:278`). No
  `gcTime`, no `refetchOnWindowFocus` policy set intentionally. Behavior is incidental.

- **PERF-6 (P2) — `useAllRoles` builds an unstable query key.**
  `queryKey: ['all-roles', ...serviceNames]` (`hooks.ts:104`) — key changes whenever the
  service list order changes, busting cache. (Currently unused; fix before adopting.)

---

## 3. API-contract correctness vs jinbe

Verified endpoints exist and shapes mostly match. Findings:

- **API-1 (P1) — `getUsersMatrix()` targets an endpoint that returns a different
  shape.** Client `getUsersMatrix` calls `/admin/rbac/users` expecting
  `{ users: JinbeUserMatrix[] }` (`client.ts:210`). jinbe's `/admin/rbac/users`
  (`rbac.routes.ts:31`) is the RBAC users listing, not a `groupMembership` matrix. The
  method is **currently unused** in the UI, so it's latent — but it's wrong and will
  mislead the mod. Confirm/rewrite or delete.

- **API-2 (P1) — `createService` type drops `displayName`/`description`.** The
  `useCreateService` hook types the payload as
  `{ name; upstreamUrl; matchUrl; matchMethods }` (`hooks.ts:200-201`), narrower than
  `api.createService` and the drawer's intent (description is collected but never sent
  in live mode — `Services.tsx:118-124`). Description entered on create is silently lost.

- **API-3 (P1) — Access-rule `service` derived by string-splitting the id.**
  `jinbeRuleToUi` sets `service = r.id.split('-')[0]` (`useRbacData.ts:70`) — but
  `hooks.ts` uses a regex strip. Rule ids like `opa-authz-proxy-authenticated` break
  both heuristics (`split('-')[0]` → `"opa"`). jinbe returns rules keyed by id; the UI
  should map rule→service via a real field, not id-parsing.

- **API-4 (P2) — `authDomain` scraped from a rule match URL by regex.**
  `useRbacData.ts:246-252` finds `kratos-public` and regex-extracts the host from
  `match.url`, unescaping backslashes. Fragile; breaks if the rule id or match format
  changes. Prefer a real `meta.authDomain` from jinbe (a code comment in `App.tsx:176`
  even asks for it).

- **API-5 (P2) — Audit dual-format parser is a maintenance hazard.**
  `useRbacData.ts:150-230` parses *two* audit shapes (enriched `/admin/audit/events`
  and legacy `/admin/rbac/history`) with nested `JSON.parse` of `actor`/`details`/
  `target`. Lots of `any`. Works, but brittle; pin to the enriched endpoint and delete
  the legacy branch once jinbe guarantees it.

- **API-6 (P2) — `simulate` reason strings the UI renders don't all exist.**
  `Simulator.tsx` renders branches for `no_rule`, `auth_failed` (`:395-400`) but
  `buildDecision` only ever emits `route_not_found|public|not_authorized|authorized`.
  Dead reason branches; keep the ones the backend can actually return.

---

## 4. UI / UX & navigation

- **NAV-1 (P0) — Navigation re-mounts pages against a shared blob, feels heavy.**
  `AppShell` renders pages with `{page === "x" && <XPage/>}` (`App.tsx:420-429`). Each
  page reads the whole `state`. Because there's no per-page data scoping and the mega
  query/mirror updates ripple everywhere, switching tabs re-runs heavy `useMemo`s
  (Dashboard computes issues/signals/matrix over all data) and can flash loading.
  → With scoped queries + route-level code, tab switches become cheap and data is warm.

- **NAV-2 (P1) — Hand-rolled hash router.** `AppContext` implements routing via
  `window.location.hash` + `hashchange` (`:145-163`). No nested routes, no per-entity
  URLs (can't deep-link to a user/group/service/rule; drawers aren't URL-addressable).
  CmdK and "Edit" jumps set context state, not URLs, so back-button doesn't undo them.
  → Adopt a real router (or at least encode drawer/service selection in the URL).

- **NAV-3 (P1) — Selection state lost on navigation.** `activeService` lives in context
  and is shared by Roles/Routes/Rules but not URL-encoded; deep-linking to
  `#/roles` always resets to `jinbe` or crashes (STORE-5). Rules page `selectedId`,
  Roles `selectedRole`, Audit `openId` are all local `useState`, reset on remount.

- **NAV-4 (P1) — Two different "Settings" destinations.** Sidebar footer opens the
  *auth domain* `/settings` in a new tab (`App.tsx:106-115`), while the nav "Settings"
  item and `ForbiddenPage` fallback open the in-app admin settings. Same word, two
  meanings — confusing. Account vs admin settings should be labeled distinctly.

- **NAV-5 (P2) — `⌘⇧T` shortcut advertised but not implemented.** Dashboard shows a
  `⌘⇧T` kbd hint on "Simulate access" (`Dashboard.tsx:186`) but only `⌘K` is wired
  (`App.tsx:382-389`). Dead affordance.

- **UX-1 (P1) — Optimistic "Applied" toast + fake pipeline animation can lie.**
  `useApplyChange` + `usePipeline` (`AppContext.tsx:120-137`) run a 4-stage
  config→opal→opa→oathkeeper animation on a **240ms timer with no backend signal**, and
  `appendAudit` inserts a synthetic "applied" row (`useApplyChange.ts:66-80`). For async
  mutations the toast fires in `.then()` (ok), but the *audit row and pipeline* imply a
  verified sync that never happened. (PR #16 fixed the Rules false-success; the pattern
  persists elsewhere.) This is dangerous in an auth console.
  → Drive pipeline/audit from real backend state (OPAL/OPA sync), or clearly label as
  local echo.

- **UX-2 (P1) — Persona "viewer" is a client-side toggle in Tweaks.** `persona` gates
  writes in `useApplyChange` (`:8-11`) and is flipped in the Tweaks panel by anyone.
  It's UX-only (backend is authoritative), but presenting a self-serve "viewer/admin"
  switch in an RBAC console invites confusion about what's enforced.
  → Derive read-only from real session permissions, not a local toggle.

- **UX-3 (P1) — `simulateForbidden` tweak ships in production.** A Tweaks switch fakes a
  403 across the app (`App.tsx`, `Dashboard.tsx`, `Sidebar`). Useful in dev, but it's a
  user-facing toggle in the real console that blanks the UI.
  → Gate behind `import.meta.env.DEV`.

- **UX-4 (P2) — No real loading/skeleton states per page.** Only a top-bar "loading…"
  pill (`App.tsx:200-205`). Pages render against empty `state` (or SEED in dev) so they
  flash empty tables → filled, with no skeletons and occasional layout shift.

- **UX-5 (P2) — Error handling is toast-only + full-screen Forbidden.** 401 triggers a
  hard `window.location` redirect from a `useEffect` in `Topbar` (`App.tsx:169-181`);
  network errors surface only as an "offline" pill. No inline retry, no per-panel error.

- **UX-6 (P2) — Search filters recompute over full arrays each render** (Users, Audit,
  Simulator route filter). Fine at small N, janky at large N (ties to PERF-3).

- **UX-7 (P2) — Pagination resets are surprising.** `usePagination` silently resets to
  page 0 when `page*pageSize >= total` (`Pagination.tsx:88`), so changing a filter can
  jump the user to page 1 mid-task without explanation.

- **UX-8 (P2) — Bundle import has no confirm/diff.** `Settings` imports a full RBAC
  snapshot on file-select with only a shape check (`Settings.tsx:90-112`) — no preview of
  what changes, no confirm. High-blast-radius action, one misclick.

---

## 5. Ghost / dead code

- **GHOST-1 (P1) — ~20 unused hooks in `api/hooks.ts`.** Only `useUpdateServiceRoutes`,
  `useUpdateServiceRoles`, `useUpdateAccessRule`, `useSession` are imported. Unused:
  `useUsers, useGroups, useGroupsMap, useServices, useRoles, useAllRoles,
  useServiceRoutes, useAccessRules, useHistory, useSetUserGroups, useCreateGroup,
  useUpdateGroup, useDeleteGroup, useCreateService, useDeleteService` — plus the
  duplicate transform helpers at the top of the file. **Ironically these are exactly the
  scoped hooks the mod needs (STORE-2)** — so: adopt-or-delete, don't just delete.

- **GHOST-2 (P2) — `Modal` primitive unused.** `Primitives.tsx:57` exports `Modal`;
  no importers (only `Drawer` is used). Either use it for confirms (UX-8) or drop it.

- **GHOST-3 (P2) — `useApplyChange` sync branch increasingly vestigial.** The `!isLive`
  local-mutation paths across pages exist only for the dev/SEED demo. In production every
  path is `isLive`. This doubles every mutation's code and is a common source of
  drift (STORE-4).
  → Gate demo mode behind DEV, or remove SEED entirely.

- **GHOST-4 (P2) — Dead `simulate` reason branches** (API-6) and **NAV-5** `⌘⇧T` hint.

- **GHOST-5 (P2) — `TweakDefaults` fields with no effect.** `monoFont`, `showMotion`,
  `matrixColor`, `levelStyle`, `wildcardWarn`, `showCounts` are written as `data-*`
  attrs (`AppContext.tsx:230-240`) but several have no corresponding CSS or UI control
  in the Tweaks panel (which only exposes accent/density/persona/nav/pipeline/counts/
  forbidden). Audit against `styles/index.css` and prune.

---

## 6. Hygiene / correctness debt

- **HYG-1 (P1) — `console.log` left in hot paths.** `AppContext.tsx:168`,
  `useRbacData.ts:85` & `:270` log on every fetch/data change (the `:168` one logs user
  counts every render-ish). Noise + minor leak of shape info. `App.tsx:176`
  `console.error` is arguably legit (misconfig) but should use a real logger.

- **HYG-2 (P1) — 28 `@typescript-eslint/no-explicit-any` warnings.** Concentrated in
  `useRbacData.ts` (audit parser), `Settings.tsx` (catch blocks), `client.ts`
  (`window as any`). Lint now runs (flat config added PR #15): **0 errors, 40 warnings**.
  The `any`s hide the real audit/error contracts.

- **HYG-3 (P1) — 9 `react-hooks/exhaustive-deps` warnings.** e.g. `UserDrawer`
  effects key on `user?.id` but use `user?.groups`/`organizationId` (`Users.tsx:122-123`);
  `ServiceDrawer` effect omits `editSvc/editRule/isEdit` (`Services.tsx`). These are the
  kind of stale-closure bugs that cause "the drawer shows the previous user's data".

- **HYG-4 (P2) — 3 `react-refresh/only-export-components` warnings.** Files export both
  components and non-components (e.g. `AppContext` exports hooks+provider+types),
  breaking fast-refresh boundaries.

- **HYG-5 (P2) — Inline styles everywhere.** Nearly every element uses `style={{…}}`
  objects (new object each render). Mixed with CSS classes. Hurts readability,
  consistency, and creates needless re-renders. A design-token/class pass would shrink
  the files dramatically and fix theming gaps (GHOST-5).

- **HYG-6 (P2) — `Math.random()` ids for toasts and synthetic audit rows**
  (`AppContext.tsx:114`, `useApplyChange.ts:68`). Collisions unlikely but ids aren't
  stable/traceable.

---

## 7. Suggested mod sequencing (what to fix in what order)

1. **Foundation (unblocks everything):** STORE-1/2/3 — make TanStack Query the single
   store; adopt the scoped hooks from `hooks.ts` (GHOST-1); scope invalidations.
2. **Perf:** PERF-1/2 (users as own lazy/paginated query; coordinate jinbe enrich
   caching), PERF-3/4.
3. **Correctness of writes:** STORE-4 optimistic mutations + rollback; kill UX-1 fake
   pipeline/audit or wire it to real sync.
4. **Navigation:** NAV-1/2/3 — real router with per-entity URLs; fix STORE-5 crash.
5. **API hardening:** API-1..6 with jinbe.
6. **Cleanup:** GHOST-2..5, HYG-1..6, UX polish (skeletons, confirms, DEV-gating
   `simulateForbidden`/persona).

Open questions for jinbe owners (blocking PERF-2/API-1/API-4):
- Can `listUsers` cache/batch group resolution, or expose a lightweight list without
  full RBAC enrichment for the directory view?
- Is there (or can there be) a real `meta.authDomain` and a rule→service field, so kuma
  stops scraping ids/URLs?
- Is `/admin/rbac/users` meant to return a membership matrix (API-1)?

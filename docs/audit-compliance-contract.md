# Audit Compliance Contract — layer responsibilities & decisions

Status: RATIFIED 2026-07-15 (Phase 0 of `docs/plans/2026-07-15-audit-compliance.md`).
Grounded in source investigation 2026-07-15.

## Ratified summary (user decisions)
- **D1** three-layer model: ACCEPTED (Kratos authN / Gateway access telemetry / jinbe change+authZ record).
- **D2 + D2.a** ACCEPTED: externalize the access flood off the audit stream; keep **deny-only** access events in the audit stream for correlation, allows → logs.
- **D3** ACCEPTED = **(a) reference/correlate by `sessionId`**. The UI gets a **direct link per event → metrics/Grafana** to trace all actions for a session/user. No Kratos ingest.
- **UI** ACCEPTED: **three log tabs** surfacing the three layers — Auth (Kratos), Access (gateway telemetry), Changes (jinbe compliance record) — each event deep-links to Grafana by sessionId/actor.
- **D4** integrity: proceeding with **hash-chain baseline** (HMAC deferred unless third-party verifiability is later required).
- **D5** retention: **DEFERRED to Phase 3** — period + export target still to set; not blocking Phases 1–2.
- **D6** ACCEPTED default: allow-but-flag, with **fail-closed** for {privilege grant, bundle import, session revoke}.

## Decision D1 — WHERE each kind of audit lives (three-layer model)

Rationale is capability-based: each layer records only what it can actually see,
so the record never lies and has no blind spot when the layers are combined.

| Layer | Owns | Can see | Cannot see |
|---|---|---|---|
| **Kratos** | **authN**: login, logout, MFA enrolment, session lifecycle | credential flows, identity changes | RBAC/app authZ, request bodies |
| **Gateway** (oathkeeper + opa-authz-proxy) | **access/traffic telemetry**: per-request allow/deny, latency, ip/ua | `sub, email, groups, METHOD, PATH, app`, decision + reason | **what changed** (request body), the mutation **result**, internal/bypass calls |
| **jinbe** | **change + authZ-decision audit** (the compliance record) | resolved identity, **request body / changed fields**, **result** (applied/failed+reason), target-entity id | primary authN (Kratos owns it) |

### Verified facts driving D1
- The OPA input the gateway sees is exactly `{sub,email,groups,object=PATH,action=METHOD,app}` (chart rule generator). **No request body.** So a gateway-only audit of `PUT /admin/rbac/groups/finance` records *that* finance was touched, never *which roles changed* → insufficient for compliance.
- **Bypass exists:** OPAL polls `http://auth-jinbe.auth:8080/...` directly (service DNS), not through oathkeeper. Gateway-only logging is blind to service-to-service and any non-gateway caller. **jinbe sees every call.**
- The gateway sees the **request (intent)**, never the **outcome**. Compliance needs the effect.
- opa-authz-proxy already logs denials to stdout (`slog`); that is traffic telemetry, not the audit record.

## Decision D2 — externalize the access-log flood OFF jinbe's audit stream

The high-volume `access.allow`-per-request events (the AUDIT-1 flood) are
**traffic telemetry, not compliance audit**. They move OUT of jinbe's audit
stream:
- Keep them as structured **logs** (jinbe already Pino-logs every request; the
  gateway logs decisions). Route those to the platform log pipeline.
- jinbe's audit **stream** (`auth:audit:events`) becomes purely: change-events +
  authZ denials + security-relevant actions. This is what the Audit UI shows.
- Net effect: the Audit page stops drowning in read-traffic (resolves AUDIT-1 at
  the source), and the compliance stream stays legible and complete.

> Open sub-decision D2.a: do we keep a *sampled* or *deny-only* access entry in
> the audit stream for correlation, or rely entirely on gateway/platform logs
> for access telemetry? Default: **deny-only in the audit stream** (denials are
> security-relevant), allows → logs only. Confirm.

## Decision D3 — Kratos authN boundary (C3)

login/logout/MFA are **not** emitted by jinbe (verified) and will **stay in
Kratos**. Choose one:
- **(a) Reference** — authN evidence lives in Kratos's audit; correlate to
  jinbe's record by `sessionId` (already captured in jinbe actor). Document how
  to join them. [DEFAULT — least coupling]
- **(b) Ingest** — a kratos webhook/event → jinbe audit emit, for a single
  unified stream. More work, 🔒, only if a single pane is a hard requirement.

Decision: __________ (pending user)

## Decision D4 — integrity model (C4)

- Tamper-evident **hash chain** on jinbe's audit stream (each event carries
  `prevHash` + `hash`), with an admin `verify` endpoint. [baseline]
- Optional **HMAC with a Vault-managed key** if third-party verifiability is
  required. Decision: __________ (pending user)

## Decision D5 — retention / durability (C5)

- Redis stream `MAXLEN ~100000` is the hot window. Compliance requires events
  survive trimming.
- Options: periodic export of the audit stream to durable object storage before
  trim; or a separate long-retention sink. Retention period: __________ (pending
  user — e.g. 1y/7y per policy).

## Decision D6 — reliability (C6)

Audit emit for a mutation must not be silently lost. Baseline: the
`auditableMutation` wrapper awaits emit with bounded retry; on failure it
increments `jinbe_audit_emit_failures_total` and logs at error. Sub-decision:
does a persistent emit failure **fail the mutation** (fail-closed audit) or
**allow-but-flag**? Default: allow-but-flag for availability; fail-closed for a
defined set of high-sensitivity actions (privilege grant, bundle import, session
revoke). Confirm the fail-closed set.

---

## What this means for the existing plans
- `2026-07-15-audit-refactor.md` Phase A (categorization + `kind`) stays — but D2
  means the `access` category becomes deny-mostly in the stream; `kind` still
  separates change/auth/access.
- `2026-07-15-audit-compliance.md` Phase 1–4 execute against jinbe as the record
  owner (D1), with the access-flood externalized (D2).
- Gateway work (moving access telemetry to platform logs / enabling oathkeeper
  access log) is a **charts/infra** concern, tracked separately — it does not
  block jinbe compliance work.

## Sign-off
- [x] D1 three-layer model
- [x] D2 externalize access flood + D2.a **deny-only** in audit stream
- [x] D3 Kratos authN = **(a) reference by sessionId** + UI Grafana deep-link
- [x] UI: three log tabs (Auth / Access / Changes) with per-event Grafana trace link
- [x] D4 integrity = hash-chain baseline (HMAC deferred)
- [ ] D5 retention period + export target (DEFERRED to Phase 3)
- [x] D6 allow-but-flag + fail-closed {privilege grant, bundle import, session revoke}

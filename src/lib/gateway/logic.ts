import { getPath, isDuration } from '../sites/handlerFields';
import { secretLooking } from '../sites/validate';
import { CATALOG, handlerInfo, type HandlerInfo } from './catalog';
import { HANDLER_KINDS, type GatewayHandler, type GatewayState, type HandlerKind, type SecretValue } from './types';

/** The Gateway handlers page's pure parts: address, merge with the catalog, secrets, checks. */

// ── address ───────────────────────────────────────────────────

export type GatewayView = { kind: HandlerKind | null; name: string | null; query: Record<string, string> };

export function parseGatewayHash(hash: string): GatewayView {
  const raw = hash.replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const [, kind, name] = (q < 0 ? raw : raw.slice(0, q)).split('/');
  const query = q < 0 ? {} : Object.fromEntries(new URLSearchParams(raw.slice(q + 1)));
  const k = (HANDLER_KINDS as string[]).includes(kind ?? '') ? (kind as HandlerKind) : (HANDLER_KINDS as string[]).includes(query.kind ?? '') ? (query.kind as HandlerKind) : null;
  const n = k && name && /^[a-z0-9_]{1,40}$/.test(name) ? name : null;
  return { kind: k, name: n, query };
}

export function gatewayHref(kind?: HandlerKind | null, name?: string | null, query: Record<string, string | undefined> = {}): string {
  const path = kind && name ? `#/gateway/${kind}/${name}` : '#/gateway';
  const all: Record<string, string | undefined> = { ...(!name && kind ? { kind } : {}), ...query };
  const qs = new URLSearchParams(Object.entries(all).filter((e): e is [string, string] => !!e[1])).toString();
  return qs ? `${path}?${qs}` : path;
}

// ── catalog merge ─────────────────────────────────────────────

export interface HandlerRow extends GatewayHandler { kind: HandlerKind; info: HandlerInfo; known: boolean }

/** Every handler of a kind: what the server reports, plus catalog handlers it does not (shown off). */
export function rowsOf(state: GatewayState | undefined, kind: HandlerKind): HandlerRow[] {
  const server = state?.handlers?.[kind] ?? [];
  const names = [...new Set([...CATALOG[kind].map((h) => h.name), ...server.map((h) => h.name)])];
  return names.map((name) => {
    const s = server.find((h) => h.name === name);
    return {
      kind, name, info: handlerInfo(kind, name), known: !!s,
      enabled: s?.enabled ?? false, config: s?.config ?? {}, secrets: s?.secrets, usedBy: s?.usedBy ?? [], restart: s?.restart,
    };
  });
}

// ── secrets ───────────────────────────────────────────────────

export type SecretState = 'empty' | 'masked' | 'vault' | 'plaintext';

export function secretState(v: unknown): SecretState {
  if (v === undefined || v === null || v === '') return 'empty';
  if (typeof v === 'object' && (v as { masked?: unknown }).masked === true) return 'masked';
  if (typeof v === 'object' && typeof (v as { vault?: unknown }).vault === 'string') return 'vault';
  return 'plaintext';
}

/** `kv/path/to/secret#key` — a Vault KV path and the key inside it. */
export function vaultRefProblem(ref: string): string | null {
  if (!ref) return 'Give the Vault path and key, like kv/auth/hydrator#password.';
  if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+#[A-Za-z0-9_.-]+$/.test(ref)) return 'A Vault reference looks like kv/auth/hydrator#password (path, then # and the key).';
  return null;
}

export const vaultRef = (ref: string): SecretValue => ({ vault: ref.trim() });

/** Dotted keys holding secrets: what the server says, plus the catalog's secret fields. */
export function secretKeys(row: Pick<HandlerRow, 'secrets' | 'info'>): string[] {
  return [...new Set([...(row.secrets ?? []), ...row.info.fields.filter((f) => f.type === 'secret').map((f) => f.key)])];
}

// ── checks ────────────────────────────────────────────────────

export interface ConfigProblem { key: string; message: string; blocking: boolean }

export function configProblems(row: Pick<HandlerRow, 'info' | 'secrets'>, config: Record<string, unknown>, enabling: boolean): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  const secrets = new Set(secretKeys(row));
  for (const f of row.info.fields) {
    const v = getPath(config, f.key);
    const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
    if (f.required && enabling && empty) out.push({ key: f.key, message: `${f.label} is required once this handler is on — the gateway refuses to start without it.`, blocking: true });
    if (f.type === 'duration' && typeof v === 'string' && v && !isDuration(v)) out.push({ key: f.key, message: `${f.label}: a duration like 1s, 100ms or 5m.`, blocking: true });
    if (secrets.has(f.key)) {
      const st = secretState(v);
      if (st === 'plaintext') out.push({ key: f.key, message: `${f.label} must be a Vault reference, never a value typed here.`, blocking: true });
      if (st === 'vault' && vaultRefProblem((v as { vault: string }).vault)) out.push({ key: f.key, message: vaultRefProblem((v as { vault: string }).vault)!, blocking: true });
    } else if (typeof v === 'string' && secretLooking(v)) {
      out.push({ key: f.key, message: `${f.label} looks like a secret. Put secrets in Vault and reference them.`, blocking: true });
    }
  }
  return out;
}

/** Why a handler cannot be turned off now: the sites whose gates use it. */
export function disableBlockers(row: Pick<GatewayHandler, 'usedBy'>): string[] {
  return row.usedBy.map((u) => u.site);
}

/** What restarts, in words. */
export function restartWords(restart: GatewayHandler['restart'] | undefined): string {
  return restart === 'oathkeeper+jinbe' ? 'The gateway and jinbe restart, one pod at a time.' : 'The gateway restarts, one pod at a time.';
}

export function kindOfHandler(name: string): HandlerKind | null {
  return HANDLER_KINDS.find((k) => CATALOG[k].some((h) => h.name === name)) ?? null;
}

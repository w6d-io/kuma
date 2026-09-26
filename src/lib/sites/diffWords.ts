import { displayPath } from './paths';
import type { ArtefactDiff, Check, Risk, RiskLevel, RouteRule, Site } from './types';

/**
 * What a change does, in words (site-ux.md §9.1): one line per artefact for the collapsed Review,
 * and per-item lists when it is opened. jinbe sends before/after per artefact; the counting and the
 * wording are here so every Review reads the same.
 */

export interface ArtefactSummary { kind: string; label: string; line: string; items: Array<{ sign: '+' | '−' | '~'; text: string }> }

const LABEL: Record<string, string> = {
  rules: 'Gateway rules',
  routeMap: 'Routes (policy)',
  roles: 'Roles',
  groups: 'Groups',
  orgServiceMap: 'Organizations',
};

const asRows = (v: unknown): RouteRule[] => (Array.isArray(v) ? (v as RouteRule[]) : []);
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const rowKey = (r: RouteRule) => `${r.method} ${displayPath(r.path)}`;
const rowNeeds = (r: RouteRule) => `${r.permission ?? 'signed-in'}${r.org_param ? ` · org from :${r.org_param}` : ''}`;

function counts(items: ArtefactSummary['items']): string {
  const n = (s: string) => items.filter((i) => i.sign === s).length;
  const parts = [n('+') && `+${n('+')}`, n('−') && `−${n('−')}`, n('~') && `${n('~')} changed`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no change';
}

/** Rule ids carry a content hash suffix: `site-payroll-api-7c1e…` → `site-payroll-api`. */
export const ruleStem = (id: string) => id.replace(/-[0-9a-f]{10}$/, '');

function keyed(before: Record<string, unknown>, after: Record<string, unknown>, describe: (k: string, b: unknown, a: unknown) => string) {
  const items: ArtefactSummary['items'] = [];
  for (const k of Object.keys(after)) {
    if (!(k in before)) items.push({ sign: '+', text: describe(k, undefined, after[k]) });
    else if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) items.push({ sign: '~', text: describe(k, before[k], after[k]) });
  }
  for (const k of Object.keys(before)) if (!(k in after)) items.push({ sign: '−', text: describe(k, before[k], undefined) });
  return items;
}

export function summarizeArtefact(d: ArtefactDiff): ArtefactSummary {
  const label = LABEL[d.kind] ?? d.kind;
  let items: ArtefactSummary['items'] = [];
  if (d.kind === 'routeMap') {
    const b = new Map(asRows(d.before).map((r) => [rowKey(r), r]));
    const a = new Map(asRows(d.after).map((r) => [rowKey(r), r]));
    for (const [k, r] of a) {
      const old = b.get(k);
      if (!old) items.push({ sign: '+', text: `${k} → ${rowNeeds(r)}` });
      else if (rowNeeds(old) !== rowNeeds(r)) items.push({ sign: '~', text: `${k}: ${rowNeeds(old)} → ${rowNeeds(r)}` });
    }
    for (const k of b.keys()) if (!a.has(k)) items.push({ sign: '−', text: k });
  } else if (d.kind === 'rules') {
    // Pair renamed rules (templates changed → new hash) by their stem.
    const byStem = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([id, r]) => [ruleStem(id), { id, r }]));
    const b = byStem(asObj(d.before));
    const a = byStem(asObj(d.after));
    items = keyed(b, a, (stem, bb, aa) => {
      const bid = (bb as { id?: string } | undefined)?.id;
      const aid = (aa as { id?: string } | undefined)?.id;
      if (bid && aid && bid !== aid) return `${stem} (rule renamed: its templates or pattern changed)`;
      return stem;
    });
  } else if (d.kind === 'roles') {
    items = keyed(asObj(d.before), asObj(d.after), (role, b, a) => {
      const bs = new Set((b as string[] | undefined) ?? []);
      const as = new Set((a as string[] | undefined) ?? []);
      const plus = [...as].filter((p) => !bs.has(p));
      const minus = [...bs].filter((p) => !as.has(p));
      return [role, plus.length && `+${plus.join(', +')}`, minus.length && `−${minus.join(', −')}`].filter(Boolean).join(' ');
    });
  } else if (d.kind === 'groups') {
    const flat = (v: unknown) => ({ ...asObj(asObj(v).platform), ...asObj(asObj(v).orgGrantable) });
    items = keyed(flat(d.before), flat(d.after), (g, _b, a) => {
      const roles = Object.values(asObj(a)).flat().join(', ');
      return roles ? `${g} → ${roles}` : g;
    });
  } else if (d.kind === 'orgServiceMap') {
    items = keyed(asObj(d.before), asObj(d.after), (org) => org);
  } else {
    items = d.fields.map((f) => ({ sign: '~' as const, text: f.path }));
  }
  return { kind: d.kind, label, line: counts(items), items };
}

export const RISK_WORD: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** The one line under the risk chip: the level and the flags that set it. */
export function riskLine(risk: Risk): string {
  if (risk.flags.length === 0) return `${RISK_WORD[risk.level]} — no access widened, no gateway pattern changed.`;
  return `${RISK_WORD[risk.level]} — ${risk.flags.map((f) => f.message).join('; ')}`;
}

export function checkCounts(checks: readonly Check[]): { errors: number; warnings: number } {
  return { errors: checks.filter((c) => c.level === 'error').length, warnings: checks.filter((c) => c.level === 'warn').length };
}

/** Intent-level change count for the draft banner ("2 unapplied changes: routes, access"). */
export function intentChanges(before: Site | null, after: Partial<Site> | null): string[] {
  if (!after) return [];
  if (!before) return ['new site'];
  const areas: Array<[string, unknown, unknown]> = [
    ['address', before.address, after.address],
    ['upstream', before.upstream, after.upstream],
    ['gates', before.gates, after.gates],
    ['routes', before.routes, after.routes],
    ['access', [before.roles, before.groups, before.orgs], [after.roles, after.groups, after.orgs]],
    ['login', before.login, after.login],
    ['name', before.displayName, after.displayName],
  ];
  return areas.filter(([, b, a]) => JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)).map(([k]) => k);
}

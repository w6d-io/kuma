import type { EnforcedDocument } from '../api/client';

/**
 * Reading the edge: which rules are decided against which route table.
 *
 * The service is named in the ENGINE's authorizer payload, not in the rule. A rule that carries no
 * payload of its own therefore inherits one configured value — so with a single API the pairing is
 * invisible, and with two the second is matched against the first one's routes.
 */

/** Rules sharing one route table, keyed by the table they all name. */
export type SharedTable = { table: string; rules: string[] };

/**
 * Tables more than one rule is decided against.
 *
 * Only a count above one is reported: one rule per table is the arrangement working, and reporting
 * it would bury the case that is not.
 */
export function sharedTables(documents: readonly EnforcedDocument[]): SharedTable[] {
  const byTable = new Map<string, string[]>();
  for (const document of documents) {
    const table = document.edge?.authorizesAs;
    if (!table) continue;
    byTable.set(table, [...(byTable.get(table) ?? []), document.name]);
  }
  return [...byTable.entries()]
    .filter(([, rules]) => rules.length > 1)
    .map(([table, rules]) => ({ table, rules }));
}

/** The rules, and separately the model every one of them is decided against. */
export function splitByKind(documents: readonly EnforcedDocument[]): {
  edges: EnforcedDocument[];
  model: EnforcedDocument[];
} {
  return {
    edges: documents.filter(d => d.kind === 'Rule'),
    model: documents.filter(d => d.kind !== 'Rule'),
  };
}

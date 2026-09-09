/**
 * Where the rules this console shows are actually enforced FROM.
 *
 * Two deployments of the same console differ on this, and the difference decides whether an editor
 * here does anything at all:
 *
 *   `service`  — the engines fetch the rules from the service behind this console at runtime, so
 *                editing here changes what is enforced. The original arrangement, and the default.
 *
 *   `gitops`   — the edge is fed from `Rule` resources and the policy engine from labelled
 *                ConfigMaps, both synced from a repository. This console is no longer a rule source,
 *                so a write would land in a store nothing reads and the screen would report success.
 *                That is worse than no editor: the operator believes a change is in force.
 *
 * ANSWERED by the service, never guessed and never configured here as well. The deployment states it
 * once; two places that can disagree about whether an editor works is one place too many. And it is
 * not inferred from whether a write appears to take effect — that would mean discovering the answer
 * by making the mistake.
 */
export type RulesSource = 'service' | 'gitops';

/**
 * What the session said, read defensively.
 *
 * Unknown means the arrangement this console has always had. Failing the other way would disable the
 * editors of every deployment running an older service that does not answer the field at all.
 */
export function rulesSourceOf(session: { rules_source?: unknown } | undefined): RulesSource {
  return session?.rules_source === 'gitops' ? 'gitops' : 'service';
}

/** Whether an editor on a rules screen can change what is enforced. */
export function rulesAreEditable(session: { rules_source?: unknown } | undefined): boolean {
  return rulesSourceOf(session) === 'service';
}

/** What to tell the reader on a screen whose editor cannot change anything. */
export const NOT_ENFORCED_HERE =
  'These rules are synced from Git and enforced from the cluster. This screen shows the model this ' +
  'console keeps — editing it would not change what is in force. Open Enforced to see what is.';

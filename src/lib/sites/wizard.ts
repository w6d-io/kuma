import { buildSite, orgGrantableFor, type TemplateId } from './templates';
import { labelProblem, nameProblem, namespaceProblem, portProblem, serviceProblem } from './validate';
import type { RolesPreset, Site } from './types';

/** The Plug-a-site wizard's answers and the intent they make (site-ux.md §4). Pure. */

export interface WizardState {
  paste: string;
  label: string;
  zone: string;
  pathPrefix: string;
  service: string;
  namespace: string;
  port: string;
  name: string;
  displayName: string;
  nameTouched: boolean;
  template: TemplateId;
  shellPublic: boolean;
  roles: RolesPreset;
  groups: Record<string, string>;
  orgsOn: boolean;
  orgs: string[];
  orgGrantable: boolean;
}

export const INITIAL: WizardState = {
  paste: '', label: '', zone: '', pathPrefix: '', service: '', namespace: '', port: '8080', name: '', displayName: '', nameTouched: false,
  template: 'web-api', shellPublic: false, roles: 'standard', groups: {}, orgsOn: false, orgs: [], orgGrantable: true,
};

export const WIZARD_STORE = 'kuma.sites.wizard';

/** The answers so far, kept for the tab's life (a reload mid-wizard keeps them). */
export function loadWizard(): WizardState {
  try { return { ...INITIAL, ...JSON.parse(sessionStorage.getItem(WIZARD_STORE) ?? '{}') }; } catch { return INITIAL; }
}

export function addressProblems(s: WizardState): string[] {
  return [
    !s.zone && 'Pick a zone.',
    labelProblem(s.label),
    s.pathPrefix && !/^(\/[A-Za-z0-9._~@-]+)+$/.test(s.pathPrefix) && 'A path prefix is literal, like /payroll.',
    serviceProblem(s.service) && `Runs at — service: ${serviceProblem(s.service)}`,
    namespaceProblem(s.namespace) && `Runs at — namespace: ${namespaceProblem(s.namespace)}`,
    portProblem(s.port) && `Runs at — port: ${portProblem(s.port)}`,
    nameProblem(s.name) && `Name: ${nameProblem(s.name)}`,
  ].filter((x): x is string => !!x);
}

export function siteFrom(s: WizardState): Site {
  const base = buildSite(s.template, {
    name: s.name, displayName: s.displayName || s.name, host: `${s.label}.${s.zone}`, pathPrefix: s.pathPrefix || undefined,
    service: s.service, namespace: s.namespace, port: Number(s.port),
  }, { shellPublic: s.shellPublic });
  return {
    ...base,
    roles: s.roles,
    groups: {
      platform: Object.fromEntries(Object.entries(s.groups).filter(([, r]) => r).map(([g, r]) => [g, [r]])),
      orgGrantable: s.orgsOn && s.orgGrantable && s.roles !== 'readonly' ? orgGrantableFor(s.name, s.displayName || s.name) : s.orgsOn && s.orgGrantable ? { [`${s.name}-viewers`]: { label: `${s.displayName || s.name} viewers`, roles: ['viewer'] } } : {},
    },
    orgs: s.orgsOn ? s.orgs : [],
  };
}

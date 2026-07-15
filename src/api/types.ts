export interface Service {
  name: string;
  upstreamUrl: string | null;
  description: string;
  createdAt: string;
  routes: number;
  roles: number;
  /** True when this service is bootstrap-protected (cannot be deleted). */
  system?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  groups: string[];
  title: string;
  active: boolean;
  last: string;
  organizationId?: string;
  /** True when the identity has at least one second factor (TOTP, WebAuthn, lookup_secret). */
  mfa?: boolean;
}

export interface RouteEntry {
  method: string;
  path: string;
  permission?: string;
}

export interface AccessRule {
  id: string;
  service: string;
  match: {
    url: string;
    methods: string[];
  };
  authenticators: string[];
  authorizer: string;
  opaUrl?: string;
  mutators: string[];
  upstream?: string;
  stripPath?: string;
}

export interface AuditEvent {
  id: string;
  when: string;
  ts?: string;
  who: string;
  actorName?: string;
  /** access | change | auth | system — separates telemetry from the change record. */
  kind?: string;
  /** Kratos session id for Grafana/session correlation (contract D3). */
  sessionId?: string;
  category: string;
  verb: string;
  target: string;
  status?: string;
  service?: string;
  ip?: string;
  ua?: string;
  reason?: string;
  mfa?: boolean;
  method?: string;
  path?: string;
  statusCode?: number;
  responseTimeMs?: number;
}

export type GroupMapping = Record<string, string[]>;
export type GroupsMap = Record<string, GroupMapping>;
/** Per-group metadata side-car (system flag, description). */
export type GroupsMetaMap = Record<string, { system?: boolean; description?: string }>;
export type RolesMap = Record<string, Record<string, string[]>>;
export type RouteMapsMap = Record<string, RouteEntry[]>;

export interface AppState {
  meta: {
    jinbeApi: string;
    opalServer: string;
    kratosAdmin: string;
    lastSync: string;
    authDomain?: string;
  };
  services: Service[];
  roles: RolesMap;
  groups: GroupsMap;
  /** Per-group metadata (system flag, description). Indexed by group name. */
  groupsMeta: GroupsMetaMap;
  users: User[];
  /** Keyset token for the next unfetched users page. Set when the directory is
   *  still streaming in the background; undefined once fully loaded. */
  usersNextPageToken?: string;
  /** True while remaining user pages load in the background after first paint. */
  usersLoading?: boolean;
  routeMaps: RouteMapsMap;
  accessRules: AccessRule[];
  audit: AuditEvent[];
}

export type PageId = 'dashboard' | 'simulator' | 'users' | 'groups' | 'services' | 'roles' | 'routes' | 'rules' | 'audit' | 'settings';

export interface TweakDefaults {
  theme: string;
  persona: string;
  density: string;
  accent: string;
  monoFont: string;
  showPipeline: boolean;
  showCounts: boolean;
  showMotion: boolean;
  navCollapsed: boolean;
  matrixColor: boolean;
  levelStyle: string;
  wildcardWarn: boolean;
  simulateForbidden: boolean;
}

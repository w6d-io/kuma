export interface Service {
  name: string;
  upstreamUrl: string | null;
  description: string;
  createdAt: string;
  routes: number;
  roles: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  groups: string[];
  title: string;
  active: boolean;
  last: string;
  tenantId?: string;
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
  users: User[];
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

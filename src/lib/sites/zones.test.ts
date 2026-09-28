import { describe, expect, it } from 'vitest';
import { entryOf, gatewayProblem, nextStep, protectionOf } from './zones';
import type { GatewayInfo } from './types';

const eg = (protectedByWaf = true): GatewayInfo => ({
  key: 'envoy-gateway-system/eg', namespace: 'envoy-gateway-system', name: 'eg', exists: true, className: 'eg',
  addresses: ['envoy.elb.amazonaws.com'], programmed: true, message: '',
  listeners: [{ name: 'dev-example-https', hostname: '*.dev.example.com', port: 443, protocol: 'HTTPS', tls: true, routesFromAll: true, programmed: true, attachedRoutes: 3 }],
  protection: {
    waf: { policy: 'envoy-gateway-system/waf-coraza', modules: ['coraza-waf'], accepted: protectedByWaf },
    ipReputation: { policy: 'envoy-gateway-system/eg-edge', backend: 'crowdsec/envoy-bouncer', failOpen: true, accepted: true },
    denylist: { policy: 'envoy-gateway-system/eg-edge' },
    protected: protectedByWaf,
    summary: protectedByWaf ? 'Every route is inspected by the WAF' : 'Not protected: WAF policy waf-coraza not accepted',
  },
});

describe('zone exposure', () => {
  it('nginx only, migrating, Gateway only', () => {
    expect(entryOf({})).toBe('ingress');
    expect(entryOf({ ingress: 'per-site', gateway: 'envoy-gateway-system/eg' })).toBe('both');
    expect(entryOf({ ingress: 'none', gateway: 'envoy-gateway-system/eg' })).toBe('gateway');
  });

  it('says "Protected by WAF" only behind a protected Gateway with no Ingress left', () => {
    expect(protectionOf({ ingress: 'per-site' }, [eg()])).toMatchObject({ tone: 'danger', label: 'No WAF' });
    expect(protectionOf({ ingress: 'per-site', gateway: 'envoy-gateway-system/eg' }, [eg()])).toMatchObject({ tone: 'warning', label: 'WAF bypassable' });
    expect(protectionOf({ ingress: 'none', gateway: 'envoy-gateway-system/eg' }, [eg()])).toMatchObject({ tone: 'success', label: 'Protected by WAF' });
    expect(protectionOf({ ingress: 'none', gateway: 'envoy-gateway-system/eg' }, [eg(false)])).toMatchObject({ tone: 'danger', label: 'Gateway not protected' });
    expect(protectionOf({ ingress: 'none', gateway: 'other/gw' }, [eg()])).toMatchObject({ tone: 'neutral', label: 'Unknown' });
  });

  it('a Gateway without a listener for the zone needs an issued certificate', () => {
    expect(gatewayProblem(eg(), 'dev.example.com', 'default')).toBeNull();
    expect(gatewayProblem(eg(), 'authdev.dev.example.com', 'default')).toMatch(/no HTTPS listener for \*\.authdev\.dev\.example\.com/);
    expect(gatewayProblem(eg(), 'authdev.dev.example.com', 'issuer')).toBeNull();
    expect(gatewayProblem({ ...eg(), exists: false, message: 'Gateway envoy-gateway-system/eg does not exist' }, 'dev.example.com', 'default')).toMatch(/does not exist/);
    expect(gatewayProblem(undefined, 'dev.example.com', 'default')).toBeNull();
  });

  it('names the next migration step', () => {
    expect(nextStep({})).toMatch(/Attach a Gateway/);
    expect(nextStep({ gateway: 'envoy-gateway-system/eg' })).toMatch(/DNS at the Gateway, then drop the Ingress/);
    expect(nextStep({ ingress: 'none', gateway: 'envoy-gateway-system/eg' })).toBeNull();
  });
});

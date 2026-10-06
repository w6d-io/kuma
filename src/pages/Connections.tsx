import { useApp } from '../contexts/AppContext';
import { useMcpStatus } from '../api/hooks';
import { Button, Callout, Card, EmptyState, I, PageHeader } from '../components/ui';
import { personalKeysOff, useMyApiKeys } from '../hooks/usePersonalKeys';
import { PERSONAL_EXPIRY_DEFAULT } from '../lib/apiKeys';
import { McpHelp } from './apikeys/McpHelp';
import { McpKeyFacts, McpTroubleshooting } from './apikeys/McpGuide';
import { SignedInApps } from './apikeys/SignedInApps';

/**
 * Connections (`#/connections`): the apps the person signed in with a browser (an AI assistant, any
 * MCP client acting as them) and how to connect one. Keys are not made here: a personal key is made
 * on API keys (My keys), the one place keys are made. On a platform without personal keys (404) — or
 * "turned off by an administrator" when Settings → AI assistants is off (GET /mcp/status) — the page
 * says so calmly, and the rail does not list it.
 */
export function ConnectionsPage() {
  const { setPage } = useApp();
  const q = useMyApiKeys();
  const status = useMcpStatus();
  const header = <PageHeader title="Connections" sub="Apps you signed in, so an AI assistant or another MCP client can act as you" />;

  if (personalKeysOff(q.error) || status.data?.off === 'administrator') {
    const byAdmin = status.data?.off === 'administrator';
    return (
      <>
        {header}
        <Card>
          {byAdmin ? (
            <EmptyState icon={I.info} title="AI assistants are turned off by an administrator">
              Assistants cannot connect for now; your keys and signed-in apps are kept and work again when an
              administrator turns AI assistants back on. Nothing is wrong with your account.
            </EmptyState>
          ) : (
            <EmptyState icon={I.info} title="Personal keys aren’t enabled on this platform">
              An administrator of the platform can switch them on. Nothing is wrong with your account.
            </EmptyState>
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="stack gap-16">
        {status.data?.allowed === false && (
          <Callout tone="info" icon={I.info} title="AI assistants are not enabled for your groups">
            <div className="small">An administrator limited AI assistants to some groups, and you are in none of them. Your keys are kept but refused until you are.</div>
          </Callout>
        )}
        <SignedInApps />
        <Callout tone="neutral" icon={I.key} title="Your keys are on API keys">
          <div className="row wrap gap-8">
            <span className="small">A client that cannot sign in with a browser uses a personal key: create and revoke it on API keys, under My keys.</span>
            <Button size="sm" onClick={() => setPage('apikeys', null)}>Open API keys</Button>
          </div>
        </Callout>
        <McpHelp />
        <McpKeyFacts maxDays={status.data?.personalKeys?.maxDays ?? PERSONAL_EXPIRY_DEFAULT} />
        <McpTroubleshooting />
      </div>
    </>
  );
}

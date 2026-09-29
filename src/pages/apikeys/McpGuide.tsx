import { Card, Table, Th } from '../../components/ui';
import { MCP_ALWAYS_REFUSED, MCP_KEY_ENV, MCP_TROUBLESHOOTING } from '../../lib/mcpGuide';

/**
 * The rest of the MCP guide, under "Connect an MCP client": what a key may do and for how long, how
 * to keep it safe, and what each refusal of the server means.
 */
export function McpKeyFacts({ maxDays }: { maxDays: number }) {
  return (
    <Card title="What a key can do" sub="It acts as you — never as more than you">
      <div className="mcp-facts small">
        <section>
          <h3 className="fw-medium">Your permissions, checked on every call</h3>
          <p className="muted">
            <strong>All my permissions</strong>: whatever you can do, now and as your access changes.
            {' '}<strong>Chosen permissions</strong>: only the ones ticked, among those you hold. Either way the
            platform asks again on each call — when you lose a permission or a group, the key loses it at once.
            The assistant sees only the tools your permissions cover.
          </p>
        </section>
        <section>
          <h3 className="fw-medium">Never through a key</h3>
          <ul className="muted">{MCP_ALWAYS_REFUSED.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
        <section>
          <h3 className="fw-medium">Expiry and revocation</h3>
          <p className="muted">
            A key always expires — {maxDays} days at most on this platform. Revoke one above and clients using it
            are refused from their next call. Create one key per client, so each can be revoked alone.
          </p>
        </section>
        <section>
          <h3 className="fw-medium">Keep it secret</h3>
          <p className="muted">
            The key is shown once. Keep it in <span className="mono">{MCP_KEY_ENV}</span> or a secret manager, never in a
            repository, a ticket or a chat. If it leaks, revoke it and create another. Calls made with it are
            recorded in the audit trail under your name, with the key they came through.
          </p>
        </section>
      </div>
    </Card>
  );
}

export function McpTroubleshooting() {
  return (
    <Card title="When the client cannot connect" sub="What the MCP server answered, and what to do" pad="none">
      <Table aria-label="MCP server answers">
        <thead><tr><Th>Answer</Th><Th>Meaning</Th><Th>What to do</Th></tr></thead>
        <tbody>
          {MCP_TROUBLESHOOTING.map((t) => (
            <tr key={t.answer}>
              <td className="mono small">{t.answer}</td>
              <td className="small">{t.meaning}</td>
              <td className="small muted">{t.fix}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

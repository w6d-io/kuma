import { useQueryClient } from '@tanstack/react-query';
import { leave, identityBaseUrl } from '../auth/leave';
import { Forbidden } from './Forbidden';
import { Button } from './ui';

/**
 * The console is for platform staff. An account that holds no platform permission — a customer who
 * signed up through a site and owns their organization — gets this instead of the shell: where to go
 * (their sites, and their account on the sign-in domain) and how to leave. Only what is drawn: jinbe
 * refuses every staff call either way. Drawn like every other refusal (Forbidden).
 */
export function StaffOnly({ email }: { email?: string | null }) {
  const qc = useQueryClient();
  const base = identityBaseUrl();
  return (
    <div className="blocked-page">
      <Forbidden
        title="This console is for platform staff"
        detail={<>
          {email ? <>You’re signed in as <b>{email}</b>, which has no staff access here. </> : null}
          Your sites, your organization and its members are on your account page.
        </>}
        nextStep={<>
          {base && <Button variant="primary" onClick={() => { window.location.href = `${base}/welcome`; }}>Go to my sites</Button>}
          <Button onClick={() => void leave(() => qc.clear())}>Sign out</Button>
        </>}
      />
    </div>
  );
}

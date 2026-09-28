import { useId, useMemo, useState } from 'react';
import type { Me } from '../../api/home';
import { accessRequestText } from '../../lib/home/briefing';
import { useUserSearch } from '../../api/hooks';
import { searchedToUser } from '../../api/transforms';
import { useApp } from '../../contexts/AppContext';
import { ButtonBase, Button, EmptyHint, I, Input } from '../../components/ui';

/** The modules that are about the viewer: support's person finder, and the no-rights page. */

/**
 * "Find a person" — support's first module: type a name or an email, open the person. Searched on
 * the server, so it finds anyone in the directory, not only a loaded page.
 */
export function FindPerson() {
  const { setUserDrawer } = useApp();
  const [q, setQ] = useState('');
  const search = useUserSearch(q);
  const users = useMemo(() => (search.data ?? []).map(searchedToUser).slice(0, 6), [search.data]);
  const listId = useId();
  const term = q.trim();
  return (
    <section id="home-find" className="panel home-module home-find" aria-labelledby="home-find-title">
      <header className="home-module-head"><h2 id="home-find-title">Find a person</h2></header>
      <div className="home-module-body">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or email…"
          aria-label="Find a person by name or email"
          aria-controls={listId}
          autoComplete="off"
        />
        <div id={listId} aria-live="polite">
          {term.length >= 2 && search.isFetching && users.length === 0 && <EmptyHint>Searching…</EmptyHint>}
          {term.length >= 2 && search.isError && <EmptyHint>Couldn't search people right now.</EmptyHint>}
          {term.length >= 2 && search.isSuccess && users.length === 0 && <EmptyHint>Nobody matches “{term}”.</EmptyHint>}
          {users.length > 0 && (
            <ul className="plain-list home-rows">
              {users.map((u) => (
                <li key={u.id}>
                  <ButtonBase className="home-row find-row" onClick={() => setUserDrawer({ mode: 'edit', user: u })}>
                    <span className="home-row-main truncate">{u.name}</span>
                    <span className="home-row-meta truncate">{u.email}</span>
                    <span className="home-row-chev" aria-hidden="true">{I.caretRight}</span>
                  </ButtonBase>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** Signed in, no rights: say so, and give them something to send. */
export function NoRights({ me }: { me: Me | undefined }) {
  const { pushToast } = useApp();
  const copy = async () => {
    if (!me) return;
    try {
      await navigator.clipboard.writeText(accessRequestText(me));
      pushToast('Access request copied', { sub: 'Paste it to a platform administrator.' });
    } catch {
      pushToast("Couldn't copy the request", { err: true, sub: 'Your browser refused the clipboard.' });
    }
  };
  return (
    <section className="panel home-module home-none" aria-labelledby="home-none-title">
      <div className="home-module-body">
        <h2 id="home-none-title" className="text-lg fw-semibold m-0">You don't have access to anything here yet</h2>
        <p className="muted">
          You're signed in as <b>{me?.name ?? 'an unnamed account'}</b>, but you don't have access to anything in this console yet.
          Ask a platform administrator to add you to a group.
        </p>
        <Button variant="primary" icon={I.copy} onClick={copy} disabled={!me}>Copy an access request</Button>
      </div>
    </section>
  );
}

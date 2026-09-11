import { describe, it, expect, beforeEach } from 'vitest';
import { rememberPendingChange, takePendingChange } from './pendingChange';

const NOW = Date.parse('2026-09-11T16:00:00Z');

describe('pendingChange', () => {
  beforeEach(() => sessionStorage.clear());

  it('carries the refused change back so it need not be composed again', () => {
    rememberPendingChange({ kind: 'user-groups', email: 'a@b.c', groups: ['platform-admin', 'users'] });
    expect(takePendingChange()).toMatchObject({ email: 'a@b.c', groups: ['platform-admin', 'users'] });
  });

  it('is consumed by the read, so coming back twice does not re-propose it', () => {
    rememberPendingChange({ kind: 'user-groups', email: 'a@b.c', groups: ['users'] });
    expect(takePendingChange()).not.toBeNull();
    expect(takePendingChange()).toBeNull();
  });

  it('expires, so a tab left open does not re-propose an old intent', () => {
    rememberPendingChange({ kind: 'user-groups', email: 'a@b.c', groups: ['users'] });
    expect(takePendingChange(NOW + 60 * 60_000)).toBeNull();
  });

  it('answers nothing when nothing was interrupted', () => {
    expect(takePendingChange()).toBeNull();
  });

  it('refuses a stored value that is not the shape it wrote', () => {
    for (const bad of ['not json', '{}', '{"kind":"other","email":"a","groups":[],"at":1}',
                       '{"kind":"user-groups","groups":[],"at":1}',
                       '{"kind":"user-groups","email":"a","groups":"all","at":1}',
                       '{"kind":"user-groups","email":"a","groups":[1,2],"at":1}']) {
      sessionStorage.setItem('strada.pendingChange', bad);
      expect(takePendingChange()).toBeNull();
    }
  });

  it('survives a browser that refuses storage, costing a retype and never a wrong write', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('denied'); };
    try {
      expect(takePendingChange()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

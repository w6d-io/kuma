import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DirectoryUnavailableError,
  listOrganisations,
  readDirectorySettings,
  selectOrganisation,
} from './directory';

const settings = {
  audience: 'directory-audience',
  listUrl: 'https://auth.test/api/organisations',
  selectUrl: 'https://auth.test/api/consent/choice',
} as const;

describe('readDirectorySettings', () => {
  it('reads all three', () => {
    expect(
      readDirectorySettings({
        __ORG_DIRECTORY_AUDIENCE__: 'a',
        __ORG_DIRECTORY_URL__: 'https://l',
        __ORG_SELECTION_URL__: 'https://s',
      }),
    ).toEqual({ audience: 'a', listUrl: 'https://l', selectUrl: 'https://s' });
  });

  it('refuses half a configuration', () => {
    // Half of it would sign somebody in against an audience that opens nothing, and leave them on a
    // console that cannot say why.
    expect(readDirectorySettings({ __ORG_DIRECTORY_AUDIENCE__: 'a', __ORG_DIRECTORY_URL__: 'https://l' }))
      .toBeNull();
    expect(readDirectorySettings({})).toBeNull();
  });

  it('reads an unsubstituted placeholder as unset', () => {
    expect(
      readDirectorySettings({
        __ORG_DIRECTORY_AUDIENCE__: '${ORG_DIRECTORY_AUDIENCE}',
        __ORG_DIRECTORY_URL__: 'https://l',
        __ORG_SELECTION_URL__: 'https://s',
      }),
    ).toBeNull();
  });
});

describe('listOrganisations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the token and keeps what it can read', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { id: 'org-a', name: 'Business' },
        { id: 'org-b' },
        { name: 'no id at all' },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const answered = await listOrganisations(settings, 'the-token');

    expect(fetchMock).toHaveBeenCalledWith(settings.listUrl, {
      headers: { Authorization: 'Bearer the-token', Accept: 'application/json' },
    });
    // An entry with no id cannot be chosen, so it is dropped rather than rendered as a dead row.
    expect(answered).toEqual([
      { id: 'org-a', name: 'Business' },
      { id: 'org-b', name: 'org-b' },
    ]);
  });

  it('treats an empty directory as an answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
    await expect(listOrganisations(settings, 't')).resolves.toEqual([]);
  });

  it('treats an unreachable directory as a failure, not as an empty one', async () => {
    // The two look identical on screen and mean opposite things.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => [] })));
    await expect(listOrganisations(settings, 't')).rejects.toThrow(DirectoryUnavailableError);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(listOrganisations(settings, 't')).rejects.toThrow(DirectoryUnavailableError);
  });

  it('refuses an answer that is not a list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ oops: true }) })));
    await expect(listOrganisations(settings, 't')).rejects.toThrow(DirectoryUnavailableError);
  });
});

describe('selectOrganisation', () => {
  it('posts the choice with the token', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await selectOrganisation(settings, 'the-token', 'org-a');

    expect(fetchMock).toHaveBeenCalledWith(settings.selectUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer the-token',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ organisationId: 'org-a' }),
    });
  });

  it('reports a refused choice instead of carrying on', async () => {
    // Carrying on would ask for a token the authority refuses, and the console would look broken
    // at a point where nobody could connect it to the choice.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    await expect(selectOrganisation(settings, 't', 'org-outside')).rejects.toThrow(
      DirectoryUnavailableError,
    );
  });
});

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { PUBLISHABLE_CONTENT_FIELDS, fetchContentVersions, publishContent } from './content-publish';

/*
 * P0-4 client publish wrapper. The load-bearing behaviors: only publishable
 * fields are ever sent, a version conflict is reported as a conflict (so the
 * admin reloads rather than clobbering newer content), and a transport failure
 * is never mistaken for a successful publish.
 */

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const { status = 200, body } = handler(String(url), init);
        return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }) as typeof fetch;
    return calls;
}

describe('fetchContentVersions', () => {
    it('flattens the server shape into field → version', async () => {
        stubFetch(() => ({ body: { ok: true, fields: { creatorJutsus: { version: 4 }, creatorItems: { version: 2 } } } }));
        assert.deepEqual(await fetchContentVersions('pw'), { creatorJutsus: 4, creatorItems: 2 });
    });

    it('returns no versions when the server is unreachable (publish then runs unversioned)', async () => {
        globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
        assert.deepEqual(await fetchContentVersions('pw'), {});
    });
});

describe('publishContent', () => {
    it('sends only publishable fields, with the admin header and base versions', async () => {
        const calls = stubFetch(() => ({ body: { ok: true, published: { creatorJutsus: 5 } } }));
        const result = await publishContent(
            { creatorJutsus: [{ id: 'j1' }], ryo: 999, character: { name: 'x' } } as never,
            { adminPw: 'secret', slot: 'admin1', baseVersions: { creatorJutsus: 4 } },
        );
        assert.equal(result.ok, true);
        const body = JSON.parse(String(calls[0].init?.body));
        assert.deepEqual(Object.keys(body.fields), ['creatorJutsus'], 'player state is never sent to the content endpoint');
        assert.deepEqual(body.baseVersions, { creatorJutsus: 4 });
        assert.equal(body.slot, 'admin1');
        assert.equal((calls[0].init?.headers as Record<string, string>)['x-admin-password'], 'secret');
    });

    it('advances the tracked versions on success', async () => {
        stubFetch(() => ({ body: { ok: true, published: { creatorJutsus: 5 } } }));
        const result = await publishContent({ creatorJutsus: [] }, { adminPw: 'pw', baseVersions: { creatorJutsus: 4, creatorItems: 9 } });
        assert.ok(result.ok);
        assert.deepEqual(result.versions, { creatorJutsus: 5, creatorItems: 9 });
    });

    it('reports a stale publish as a conflict instead of success', async () => {
        stubFetch(() => ({ status: 409, body: { ok: false, conflicts: [{ field: 'creatorJutsus' }], error: 'Someone else published newer content. Reload before saving.' } }));
        const result = await publishContent({ creatorJutsus: [] }, { adminPw: 'pw', baseVersions: { creatorJutsus: 1 } });
        assert.equal(result.ok, false);
        assert.ok(!result.ok && result.conflict);
        assert.deepEqual(!result.ok && result.conflict ? result.fields : [], ['creatorJutsus']);
    });

    it('never reports success when the request fails', async () => {
        globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
        const result = await publishContent({ creatorJutsus: [] }, { adminPw: 'pw' });
        assert.equal(result.ok, false);
    });

    it('skips the request entirely when there is nothing publishable', async () => {
        const calls = stubFetch(() => ({ body: {} }));
        const result = await publishContent({ ryo: 1 } as never, { adminPw: 'pw' });
        assert.equal(result.ok, true);
        assert.equal(calls.length, 0);
    });

    it('mirrors the server field list', () => {
        assert.deepEqual([...PUBLISHABLE_CONTENT_FIELDS], [
            'creatorJutsus', 'creatorItems', 'creatorAis', 'creatorEvents',
            'creatorMissions', 'creatorRaids', 'creatorCards',
            'editablePets', 'petEncounterVn', 'ancientChestVn', 'hollowGateEventConfig',
        ]);
    });
});

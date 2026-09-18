import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'kage-story-local-test-secret-32-bytes';

test('first and later personal finales report only the shared change each actually caused', async () => {
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const handler = (await import('./kage.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const village = 'Ashen Leaf Village';
    const key = 'village:kage:ashen-leaf-village';
    const chat = 'chat:village:ashen-leaf-village';
    async function unlock(player: string) {
        const out = { status: 200, body: {} as Record<string, unknown> };
        const res = {
            setHeader: () => res, status: (value: number) => { out.status = value; return res; },
            json: (body: Record<string, unknown>) => { out.body = body; return res; }, end: () => res,
        };
        await handler({ method: 'POST', query: {}, body: { action: 'unlock', village, playerName: player }, headers: { 'x-player-token': issuePlayerToken(player), 'x-forwarded-for': '198.51.100.88' }, socket: { remoteAddress: '198.51.100.88' } } as never, res as never);
        assert.equal(out.status, 200);
        return out.body;
    }
    for (const name of ['firstfixture', 'laterfixture']) await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, storyVillage: village, level: 100, storyProgress: 9 } });
    const first = await unlock('firstfixture');
    assert.equal(first.firstLiberator, 'firstfixture');
    assert.equal(first.seatedKage, 'firstfixture');
    const announcements = await kv.get<unknown[]>('game:announcements');
    assert.equal(announcements?.length, 1);
    await kv.set(key, { ...await kv.get<Record<string, unknown>>(key), seatedKage: 'currentchampion' });
    const later = await unlock('laterfixture');
    assert.equal(later.firstLiberator, 'firstfixture');
    assert.equal(later.seatedKage, 'currentchampion');
    assert.deepEqual(await kv.get('game:announcements'), announcements);
    const messages = await kv.get<{ text: string }[]>(chat);
    const personal = messages!.filter(row => row.text.includes('A Village Story Completed'));
    assert.equal(personal.length, 2);
    assert.ok(personal.every(row => /Root Liberator/.test(row.text)));
    assert.ok(personal.every(row => !/seat stands open|first to|seated Kage/.test(row.text)));
    await unlock('laterfixture');
    assert.deepEqual(await kv.get(chat), messages, 'rereading the confirmed grant emits no new achievement');
});

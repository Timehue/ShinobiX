import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Lobby } from './_lobby-core.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coop-warfront-test-secret-at-least-32-bytes';
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let token = '';
const name = 'coopwarfrontprobe';
const roster = (level = 20) => [1, 2].map((index) => ({ id: `coop-${index}`, name: `Coop ${index}`, rarity: 'rare',
    level, hp: level * 25, attack: level * 3, defense: level * 2, speed: level,
    role: index === 1 ? 'sage' : 'tracker', subRole: index === 1 ? 'support' : 'kite',
    jutsus: [{ name: 'Trained technique', kind: index === 1 ? 'heal' : 'burn', power: level + 80, cooldown: 2 }],
}));

before(async () => {
    ({ kv } = await import('../_storage.js'));
    token = (await import('../_auth.js')).issuePlayerToken(name)!;
    handler = (await import('./lobby.js')).default as unknown as typeof handler;
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; delete process.env.SESSION_SECRET; });

async function post(body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader() { return res; }, status(status: number) { out.status = status; return res; },
        json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { name, ...body }, headers: { 'x-player-token': token }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}

test('co-op start seals current earned stats and techniques, then polling preserves the same match', async () => {
    await kv.set(`save:${name}`, { character: { name, level: 20, pets: roster() } });
    const created = await post({ action: 'create' });
    assert.equal(created.status, 200);
    const code = String(created.body.code);
    assert.equal((await post({ action: 'pets', code, petIds: ['coop-1', 'coop-2'] })).status, 200);
    await kv.set(`save:${name}`, { character: { name, level: 20, pets: roster(60) } });
    const started = await post({ action: 'start', code });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const match = (started.body.lobby as Lobby).match!;
    assert.deepEqual(match.blue.slice(0, 2).map((slot) => [slot.pet.level, slot.pet.hp, slot.pet.jutsus?.[0].power]), [[60, 1500, 140], [60, 1500, 140]]);
    assert.ok([...match.blue, ...match.red].every((slot) => slot.pet.jutsus?.length && slot.pet.role === slot.role));
    await kv.set(`save:${name}`, { character: { name, level: 20, pets: roster(100) } });
    const polled = await post({ action: 'poll', code });
    assert.deepEqual((polled.body.lobby as Lobby).match, match, 'a running match must not be rewritten by later training');
    await post({ action: 'leave', code });
});

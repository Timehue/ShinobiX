import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import type { TowerPartyBinding } from './_party.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tower-route-integration-admin';
delete process.env.SESSION_SECRET;

let handler: (req: never, res: never) => Promise<unknown>;
let parties: typeof import('./_party.js');
let kv: typeof import('../_storage.js').kv;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    parties = await import('./_party.js');
    handler = (await import('./start.js')).default as unknown as typeof handler;
});

async function start(body: Record<string, unknown>) {
    const output: { status: number; body?: Record<string, any> } = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (value: number) => { output.status = value; return res; },
        json: (value: Record<string, any>) => { output.body = value; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return output;
}

for (const mode of ['story', 'spire'] as const) {
    for (const routeChoice of ['rest-shrine', 'focused-assault', 'elite-shortcut'] as const) {
        test(`${mode}: ready room launches and retries its sealed ${routeChoice} route`, async () => {
            const host = `${mode}-${routeChoice}`;
            const members = [host, `${host}-b`, `${host}-c`, `${host}-d`];
            for (const name of members) await kv.set(`save:${name}`, {
                character: { name, level: 100, ryo: 100000, hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
                    stats: { taijutsuOffense: 2000, taijutsuDefense: 2000, speed: 2000 }, specialty: 'Taijutsu', jutsu: [], inventory: [], equipped: {}, battleTowerAscension: 1 },
            });
            const binding: TowerPartyBinding = mode === 'story' ? { mode, floor: 1, routeChoice } : { mode, ascensionTier: 1, routeChoice };
            const created = await parties.createTowerParty({ hostSlug: host, binding });
            assert.equal(created.ok, true);
            if (!created.ok) return;
            let party = created.party;
            for (const member of members.slice(1)) {
                const joined = await parties.joinTowerParty({ partyId: party.id, actor: member, requestId: `join-${member}`, expectedVersion: party.version, fingerprint: `join-${member}` });
                assert.equal(joined.ok, true);
                if (!joined.ok) return;
                party = joined.party;
            }
            for (const member of members) {
                const ready = await parties.setTowerPartyReady({ partyId: party.id, actor: member, ready: true, requestId: `ready-${member}`, expectedVersion: party.version, fingerprint: `ready-${member}` });
                assert.equal(ready.ok, true);
                if (!ready.ok) return;
                party = ready.party;
            }
            const body = { hostName: host, mode, floor: 1, ascensionTier: 1, partyId: party.id, requestId: `launch-${host}`, expectedVersion: party.version,
                routeChoice: routeChoice === 'elite-shortcut' ? 'rest-shrine' : 'elite-shortcut' };
            const first = await start(body);
            assert.equal(first.status, 200, JSON.stringify(first.body));
            assert.equal(first.body?.session.routeChoice.id, routeChoice, 'launch body cannot override the ready-room route');
            const committed = await kv.get(`save:${host}`);
            const replay = await start(body);
            assert.equal(replay.status, 200, JSON.stringify(replay.body));
            assert.equal(replay.body?.runId, first.body?.runId);
            assert.equal(replay.body?.session.routeChoice.id, routeChoice);
            assert.deepEqual(await kv.get(`save:${host}`), committed, 'lost-response replay must not charge again');
        });
    }
}

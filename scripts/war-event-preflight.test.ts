import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * The war-event preflight is the operators' go/no-go read before a staffed
 * event. It must find the states that would hurt the event (an unreadable
 * contest row, a battle wedged by a token for another sector, a sector owned by
 * the wrong village, the kill switch in the wrong position), and it must never
 * write: it runs against production storage.
 */

const SECTOR = 23;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';

let kv: typeof import('../api/_storage.js').kv;
let war: typeof import('../api/_sector-war.js');
let preflight: typeof import('./war-event-preflight.js');

before(async () => {
    ({ kv } = await import('../api/_storage.js'));
    war = await import('../api/_sector-war.js');
    preflight = await import('./war-event-preflight.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function healthyWar() {
    const now = Date.now();
    const session = { ...war.newSectorWarSession({ sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: now - 60_000 }), declarationGeneration: 1 };
    await kv.set(war.sectorWarKey(session.id), session);
    await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: DEFENDER, hp: 20_000, updatedAt: now });
    return session;
}

async function everything(): Promise<Record<string, unknown>> {
    const keys = (await kv.keys('*')).sort();
    const values = keys.length ? await kv.mget<unknown[]>(...keys) : [];
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function codes(report: import('./war-event-preflight.js').PreflightReport, level: string): string[] {
    return report.findings.filter((finding) => finding.level === level).map((finding) => finding.code);
}

describe('war event preflight', { concurrency: false }, () => {
    it('reports a healthy live contest as ready, with the baselines for the event record', async () => {
        const session = await healthyWar();
        const report = await preflight.runWarEventPreflight({ env: { WAR_EVENT_ID: 'war-dry-run' } });
        assert.equal(report.ready, true, JSON.stringify(report.findings));
        assert.equal(report.eventId, 'war-dry-run');
        assert.deepEqual(report.contests.map((c) => [c.id, c.status, c.instance]), [[session.id, 'active', war.sectorWarInstanceTag(session)]]);
        assert.deepEqual(report.counts, { resolutionReceipts: 0, battleReceipts: 0, sectorAuditEntries: 0 });
        assert.match(preflight.formatPreflightReport(report), /RESULT: no blocker found\./);
    });

    it('blocks on an unreadable contest row, a wedged battle and a sector owned by the wrong village', async () => {
        const session = await healthyWar();
        await kv.set('shared:sector-war:30:stormveilvillage-vs-frostfangvillage', {
            ...war.newSectorWarSession({ sector: 30, attackerVillage: 'Stormveil Village', defenderVillage: DEFENDER, winCondition: 'combat', now: Date.now() }),
            appliedBattles: [{ battleId: 'x', attackerWon: 'yes', points: 1, at: 1 }],
        });
        // The token the old {attack} route minted for a battle fought elsewhere.
        await kv.set(war.sectorWarTokenKey('pvp-wedged'), war.newSectorWarBattleToken({
            battleId: 'pvp-wedged', sectorWarId: session.id, sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER,
            registeredBy: 'raider', winCondition: 'combat', p1Name: 'raider', p2Name: 'holdout',
            p1Village: ATTACKER, p2Village: DEFENDER, biome: 'central', now: Date.now() - 1000,
        }));
        await kv.set('pvp:pvp-wedged', { battleId: 'pvp-wedged', rewardSector: 24, p1: { name: 'raider' }, p2: { name: 'holdout' } });
        await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: 'Stormveil Village', hp: 20_000, updatedAt: Date.now() });

        const report = await preflight.runWarEventPreflight({});
        assert.equal(report.ready, false);
        assert.deepEqual(codes(report, 'blocker').sort(), ['contest-row-unreadable', 'territory-owner-mismatch', 'wedged-battle']);
        assert.deepEqual(report.tokens, { total: 1, wedged: ['pvp-wedged'] });
        const text = JSON.stringify(report);
        assert.ok(!text.includes('raider') && !text.includes('holdout'), 'the report never names a player');
        assert.match(preflight.formatPreflightReport(report), /RESULT: BLOCKED/);
    });

    it('probes the live kill switch without authentication, and blocks when it is in the wrong position', async () => {
        await healthyWar();
        const calls: Array<{ url: string; method: string; body: string | null }> = [];
        const live = (warStatus: number) => (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
            if (String(url).endsWith('/health')) return new Response('{"ok":true}', { status: 200 });
            const error = warStatus === 400 ? 'Missing playerName.' : 'Not found.';
            return new Response(JSON.stringify({ error }), { status: warStatus });
        }) as typeof fetch;

        const on = await preflight.runWarEventPreflight({ baseUrl: 'https://game.test/', expectWar: 'on', fetchImpl: live(400) });
        assert.equal(on.ready, true, JSON.stringify(on.findings));
        assert.deepEqual(on.http, { baseUrl: 'https://game.test', health: 200, warRoute: 'enabled' });
        assert.deepEqual(calls.map((call) => [call.method, call.url, call.body]), [
            ['GET', 'https://game.test/health', null],
            ['POST', 'https://game.test/api/village/sector-war', '{}'],
        ]);

        const off = await preflight.runWarEventPreflight({ baseUrl: 'https://game.test', expectWar: 'on', fetchImpl: live(404) });
        assert.equal(off.http?.warRoute, 'disabled');
        assert.deepEqual(codes(off, 'blocker'), ['kill-switch-mismatch']);

        // A 400 that is not the route's own refusal proves nothing either way.
        const proxy = (async (url: string | URL | Request) => new Response('bad request', { status: String(url).endsWith('/health') ? 200 : 400 })) as typeof fetch;
        const unknown = await preflight.runWarEventPreflight({ baseUrl: 'https://game.test', expectWar: 'on', fetchImpl: proxy });
        assert.equal(unknown.http?.warRoute, 'unknown');
        assert.deepEqual(codes(unknown, 'warn'), ['war-route-unknown']);
    });

    it('the probe it sends is one the real war route refuses before touching anything', async () => {
        const loaded = await import('../api/village/sector-war.js');
        type Handler = (req: never, res: never) => Promise<unknown>;
        const handler = ((loaded.default as unknown as { default?: Handler })?.default ?? loaded.default) as unknown as Handler;
        const probe = async () => {
            const out: { statusCode: number } = { statusCode: 200 };
            const res = {
                setHeader: () => res,
                status: (code: number) => { out.statusCode = code; return res; },
                json: () => res,
                end: () => res,
            };
            await handler({ method: 'POST', body: {}, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
            return out.statusCode;
        };
        await healthyWar();
        const before = await everything();
        delete process.env.DISABLE_VILLAGE_WAR;
        assert.equal(await probe(), 400, 'war on: refused for the missing player name');
        process.env.DISABLE_VILLAGE_WAR = '1';
        try {
            assert.equal(await probe(), 404, 'war off: the route does not exist');
        } finally {
            delete process.env.DISABLE_VILLAGE_WAR;
        }
        assert.deepEqual(await everything(), before, 'and neither answer wrote anything');
    });

    describe('with an event plan', () => {
        const PLAN_SECTOR = 27; // a Frostfang home sector; 26 is its gate
        const plan = (overrides: Partial<import('./war-event-preflight.js').WarEventPlan['accounts']> = {}, sectors = [PLAN_SECTOR]) => ({
            attackerVillage: ATTACKER,
            defenderVillage: DEFENDER,
            sectors,
            accounts: { attackerKage: 'kageatk', defenderKage: 'kagedef', attackerFighters: ['atkone', 'atktwo'], defenderFighters: ['defone', 'deftwo'], ...overrides },
        });

        async function seedEvent(warResources = 600) {
            for (const [name, village] of [['kageatk', ATTACKER], ['atkone', ATTACKER], ['atktwo', ATTACKER], ['kagedef', DEFENDER], ['defone', DEFENDER], ['deftwo', DEFENDER]] as const) {
                await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 50 } });
            }
            await kv.set('village:kage:moonshadow-village', { seatedKage: 'kageatk' });
            await kv.set('village:kage:frostfang-village', { seatedKage: 'kagedef' });
            await kv.set('shared:village-war:moonshadowvillage', { warResources });
            await kv.set(`world:territory:${PLAN_SECTOR}`, { sector: PLAN_SECTOR, ownerVillage: DEFENDER, hp: 20_000, updatedAt: Date.now() });
        }

        it('passes a staffed plan whose accounts, sectors and War Resources are ready, naming no account', async () => {
            await seedEvent();
            const report = await preflight.runWarEventPreflight({ plan: plan() });
            assert.equal(report.ready, true, JSON.stringify(report.findings));
            assert.deepEqual(codes(report, 'warn'), []);
            assert.ok(report.plan?.roles.every((role) => role.ok), JSON.stringify(report.plan?.roles));
            assert.equal(report.plan?.roles.length, 6);
            assert.equal(report.plan?.sectors[0]?.ownerVillage, DEFENDER);
            assert.equal(report.plan?.declarationCost, 250);
            const text = JSON.stringify(report) + preflight.formatPreflightReport(report);
            for (const name of ['kageatk', 'kagedef', 'atkone', 'atktwo', 'defone', 'deftwo']) {
                assert.ok(!text.includes(name), `the report names ${name}`);
            }
        });

        it('blocks on an unseated Kage, a missing account, a fighter in the wrong village and an unconquerable sector', async () => {
            await seedEvent();
            await kv.set('world:territory:28', { sector: 28, ownerVillage: 'Stormveil Village', hp: 20_000, updatedAt: Date.now() });
            const report = await preflight.runWarEventPreflight({
                plan: plan({ attackerKage: 'atkone', attackerFighters: ['atktwo', 'defone', 'ghostplayer'] }, [26, 28]),
            });
            assert.equal(report.ready, false);
            const blockers = codes(report, 'blocker');
            for (const code of ['plan-kage-not-seated', 'plan-account-missing', 'plan-account-village', 'plan-sector-invalid', 'plan-sector-owner']) {
                assert.ok(blockers.includes(code), `${code} missing from ${JSON.stringify(blockers)}`);
            }
            assert.ok(!JSON.stringify(report).includes('ghostplayer'), 'a missing account is named by its role only');
        });

        it('warns on thin War Resources, a battle in flight and too few fighters', async () => {
            await seedEvent(100);
            await kv.set('pvp:pending-session:atkone', { battleId: 'pvp-in-flight', role: 'p1', phase: 'active' });
            const report = await preflight.runWarEventPreflight({ plan: plan({ defenderFighters: ['defone'] }) });
            assert.equal(report.ready, true, 'warnings do not block');
            assert.deepEqual(codes(report, 'warn').sort(), ['plan-account-in-battle', 'plan-too-few-fighters', 'plan-war-resources']);
        });

        it('refuses a malformed plan file', () => {
            assert.throws(() => preflight.parseWarEventPlan({ attackerVillage: ATTACKER }), /Invalid war event plan/);
            assert.throws(() => preflight.parseWarEventPlan({ ...plan(), sectors: [] }), /sectors/);
            assert.throws(() => preflight.parseWarEventPlan({ ...plan(), accounts: { attackerKage: 'kageatk', attackerFighters: 'atkone', defenderFighters: [] } }), /attackerFighters/);
            assert.deepEqual(preflight.parseWarEventPlan(plan()), plan());
        });
    });

    it('writes nothing to storage, with or without a plan', async () => {
        await healthyWar();
        await kv.set('shared:sector-war:30:stormveilvillage-vs-frostfangvillage', { attackerVillage: 'Stormveil Village', defenderVillage: DEFENDER, appliedBattles: 'bad' });
        await kv.set('save:kageatk', { _saveVersion: 1, character: { name: 'kageatk', village: ATTACKER } });
        await kv.set('village:kage:moonshadow-village', { seatedKage: 'kageatk' });
        const before = await everything();
        await preflight.runWarEventPreflight({});
        await preflight.runWarEventPreflight({
            plan: { attackerVillage: ATTACKER, defenderVillage: DEFENDER, sectors: [27], accounts: { attackerKage: 'kageatk', attackerFighters: ['kageatk'], defenderFighters: [] } },
        });
        assert.deepEqual(await everything(), before);
    });
});

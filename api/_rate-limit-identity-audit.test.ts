import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'isolated-audit-session-secret-only';

type Handler = (req: never, res: never) => Promise<unknown>;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let resetLimits: typeof import('./_ratelimit.js').__resetRateLimitsForTest;

before(async () => {
    const storage = await import('./_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa', 'never run adversarial probes against a persistent store');
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ __resetRateLimitsForTest: resetLimits } = await import('./_ratelimit.js'));
});

async function call(handler: Handler, body: Record<string, unknown>, token?: string, method = 'POST', attackerHeader = false) {
    let status = 200;
    const res = {
        setHeader: () => res,
        status: (code: number) => { status = code; return res; },
        json: () => res,
        end: () => res,
    };
    await handler({
        method, body, query: body,
        headers: token ? { 'x-player-token': token, ...(attackerHeader ? { 'x-player-name': 'audit-attacker' } : {}) } : {},
        socket: { remoteAddress: token ? '198.51.100.22' : '203.0.113.66' },
    } as never, res as never);
    return status;
}

const routes: Array<{ path: string; limit: number; body: Record<string, unknown>; method?: string }> = [
    { path: './player/heartbeat.js', limit: 180, body: { name: 'audit-victim', sector: 40 } },
    { path: './battle/lock.js', limit: 10, body: { playerName: 'audit-victim', action: 'status' } },
    { path: './weapon/apply-elemental-core.js', limit: 1, body: { playerName: 'audit-victim', weaponId: 'rustfang-kunai', element: 'fire' } },
    { path: './pet/evolve.js', limit: 1, body: { playerName: 'audit-victim', petId: 'owned-pet' } },
    { path: './missions/report-raid.js', limit: 6, body: { playerName: 'audit-victim' } },
    { path: './missions/claim-mission.js', limit: 5, body: { playerName: 'audit-victim', missionType: 'academy-checklist' } },
    { path: './training/start.js', limit: 6, body: { playerName: 'audit-victim', stat: 'strength', tierId: '15m' } },
    { path: './training/complete.js', limit: 8, body: { playerName: 'audit-victim', token: 'sealedtoken' } },
    { path: './missions/expedition-start.js', limit: 6, body: { playerName: 'audit-victim', petId: 'owned-pet', expType: 'scout' } },
    { path: './missions/queue-combat-claim.js', limit: 10, body: { playerName: 'audit-victim', missionId: 'unknown-mission' } },
    { path: './missions/record-progress.js', limit: 30, body: { playerName: 'audit-victim', missionId: 'unknown-mission', kind: 'field-explore' } },
    { path: './missions/report-pet-event.js', limit: 12, body: { playerName: 'audit-victim', event: 'pet-train' } },
    { path: './clan/war/pvp-2v2.js', limit: 40, body: { playerName: 'audit-victim', challengeId: 'audit-challenge' } },
    { path: './clan-boss/assault-start.js', limit: 10, body: { hostName: 'audit-victim', requestId: 'audit-request' } },
    { path: './clan-boss/party.js', limit: 45, body: { playerName: 'audit-victim', action: 'status' } },
    { path: './endless/wave-start.js', limit: 40, body: { playerName: 'audit-victim' } },
    { path: './hollow-gate/combat-settle.js', limit: 30, body: { playerName: 'audit-victim', token: 'audit-token', runId: 'audit-run' } },
    { path: './hollow-gate/combat-start.js', limit: 20, body: { playerName: 'audit-victim', token: 'audit-token', nodeId: 'floor:1:tile:1', floor: 1, kind: 'battle' } },
    { path: './hollow-gate/descend.js', limit: 15, body: { playerName: 'audit-victim', token: 'audit-token', fromFloor: 1 } },
    { path: './hollow-gate/use-consumable.js', limit: 30, body: { playerName: 'audit-victim', token: 'audit-token', requestId: 'audit-request', action: 'reignite' } },
    { path: './missions/combat-start.js', limit: 12, body: { playerName: 'audit-victim' } },
    { path: './player/activity-spine.js', limit: 45, method: 'GET', body: { player: 'audit-victim' } },
    { path: './pvp/ranked-2v2.js', limit: 60, body: { playerName: 'audit-victim', action: 'status' } },
    { path: './story/boss-start.js', limit: 12, body: { playerName: 'audit-victim' } },
    { path: './story/spar-start.js', limit: 12, body: { playerName: 'audit-victim' } },
    { path: './towers/action.js', limit: 120, body: { playerName: 'audit-victim', runId: 'audit-run' } },
    { path: './towers/join.js', limit: 12, body: { playerName: 'audit-victim', runId: 'audit-run' } },
    { path: './towers/my-run.js', limit: 120, method: 'GET', body: { playerName: 'audit-victim' } },
    { path: './towers/party.js', limit: 45, body: { playerName: 'audit-victim', action: 'status' } },
    { path: './towers/pvp-action.js', limit: 120, body: { playerName: 'audit-victim', matchId: 'tpvp-' + 'a'.repeat(32) } },
    { path: './towers/pvp-queue.js', limit: 40, body: { playerName: 'audit-victim', action: 'status' } },
    { path: './towers/pvp-settle.js', limit: 30, body: { playerName: 'audit-victim', matchId: 'tpvp-' + 'a'.repeat(32) } },
    { path: './towers/pvp-state.js', limit: 180, method: 'GET', body: { playerName: 'audit-victim', matchId: 'tpvp-' + 'a'.repeat(32) } },
    { path: './towers/settle.js', limit: 30, body: { playerName: 'audit-victim', runId: 'audit-run' } },
    { path: './towers/start.js', limit: 6, body: { hostName: 'audit-victim' } },
    { path: './towers/state.js', limit: 240, method: 'GET', body: { playerName: 'audit-victim', runId: 'audit-run' } },
];

for (const route of routes) test(`${route.path}: rejected identities cannot spend another player's rate budget`, async () => {
    resetLimits();
    const handler = (await import(route.path)).default as Handler;
    for (let index = 0; index <= route.limit; index += 1) {
        assert.equal(await call(handler, route.body, undefined, route.method), 401, `unauthenticated request ${index + 1}`);
    }
    const attackerToken = issuePlayerToken('audit-attacker')!;
    for (let index = 0; index <= route.limit; index += 1) {
        assert.equal(await call(handler, route.body, attackerToken, route.method), 401, `another account cannot charge the named victim (${index + 1})`);
    }
    // An explicit authenticated name may take precedence over the route hint.
    // Routes that use it as the real actor must charge THAT actor's quota.
    for (let index = 0; index <= route.limit; index += 1) {
        await call(handler, route.body, attackerToken, route.method, true);
    }
    const victimStatus = await call(handler, route.body, issuePlayerToken('audit-victim')!, route.method);
    assert.notEqual(victimStatus, 429, 'the victim still has their own quota');
    assert.notEqual(victimStatus, 401, 'the victim authenticates successfully');
    assert.notEqual(victimStatus, 500, 'the accepted path completes without an internal error');
});

for (const route of routes) test(`${route.path}: the authenticated account still exhausts its own allowance`, async () => {
    resetLimits();
    const handler = (await import(route.path)).default as Handler;
    const token = issuePlayerToken('audit-victim')!;
    for (let index = 0; index < route.limit; index += 1) {
        const status = await call(handler, route.body, token, route.method);
        assert.notEqual(status, 429, `request ${index + 1} remains inside the account allowance`);
        assert.notEqual(status, 401, 'the account authenticates');
    }
    assert.equal(await call(handler, route.body, token, route.method), 429, 'the next request is rate limited');
});

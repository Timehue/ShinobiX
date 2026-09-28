import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'usage-test-full';
process.env.ADMIN_CONTENT_PASSWORD = 'usage-test-content';

import type { PvpSession } from './pvp/session.js';
import type { SoloPveSession } from './solo-pve/_session.js';

let kv: typeof import('./_storage.js').kv;
let usage: typeof import('./_combat-usage.js');
let handler: typeof import('./admin/combat-usage.js').default;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    usage = await import('./_combat-usage.js');
    handler = (await import('./admin/combat-usage.js')).default as unknown as typeof handler;
});

let clockWindow = 0;
beforeEach(async (context) => {
    if (!('mock' in context)) throw new Error('needs a per-test clock');
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() + (++clockWindow) * 60_001 });
    for (const mode of usage.COMBAT_USAGE_MODES) await kv.del(usage.usageKey(mode));
});

function character(jutsu: string[], extra: Record<string, unknown> = {}) {
    return {
        jutsu: jutsu.map((id) => ({ id })),
        pvpItems: [{ id: 'iron-kunai', slot: 'thrown' }, { id: 'chakra-pill', slot: 'item' }],
        equippedBloodlineId: 'bl-ember',
        ...extra,
    };
}

function pvpSession(overrides: Partial<PvpSession> = {}): PvpSession {
    return {
        battleId: 'b1',
        status: 'done',
        winner: 'p1',
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        p1: { name: 'A', character: character(['fireball', 'palm']) },
        p2: { name: 'B', character: character(['water-wall'], { equippedBloodlineId: undefined, bloodline: 'Iron Fang' }) },
        jutsuUsed: { p1: ['fireball', 'weapon:iron-kunai'], p2: [] },
        ...overrides,
    } as unknown as PvpSession;
}

test('a PvP win counts equipped, cast and outcome per content id; items that are not weapons are ignored', () => {
    const extracted = usage.pvpCombatUsage(pvpSession());
    assert.ok(extracted);
    assert.equal(extracted.mode, 'pvp');
    const agg = usage.emptyAggregate('pvp', 0);
    for (const f of extracted.fighters) usage.applyFighterUsage(agg, f);
    assert.deepEqual(agg.jutsu.fireball, { equipped: 1, used: 1, win: 1, loss: 0, draw: 0, fled: 0 });
    assert.deepEqual(agg.jutsu.palm, { equipped: 1, used: 0, win: 1, loss: 0, draw: 0, fled: 0 });
    assert.deepEqual(agg.jutsu['water-wall'], { equipped: 1, used: 0, win: 0, loss: 1, draw: 0, fled: 0 });
    assert.equal(agg.jutsu['weapon:iron-kunai'], undefined, 'a cast that is not an equipped jutsu is not a jutsu');
    assert.deepEqual(agg.weapon['iron-kunai'], { equipped: 2, used: 0, win: 1, loss: 1, draw: 0, fled: 0 });
    assert.equal(agg.weapon['chakra-pill'], undefined);
    assert.equal(agg.bloodline['bl-ember'].win, 1);
    assert.equal(agg.bloodline['starter:Iron Fang'].loss, 1);
});

test('ranked, fled, draw, NPC sides and uncountable fights', () => {
    assert.equal(usage.pvpCombatUsage(pvpSession({ ranked: true }))?.mode, 'ranked');
    const fled = usage.pvpCombatUsage(pvpSession({ winner: 'p2', fleedBy: 'p1' }))!;
    assert.deepEqual(fled.fighters.map((f) => f.outcome), ['fled', 'win']);
    const draw = usage.pvpCombatUsage(pvpSession({ winner: 'draw' }))!;
    assert.deepEqual(draw.fighters.map((f) => f.outcome), ['draw', 'draw']);
    const npc = usage.pvpCombatUsage(pvpSession({ realFighters: { p1: true, p2: false } }))!;
    assert.equal(npc.fighters.length, 1, 'the NPC side is not counted');

    assert.equal(usage.pvpCombatUsage(pvpSession({ winner: null } as never)), null);
    assert.equal(usage.pvpCombatUsage(pvpSession({ status: 'active' } as never)), null);
    assert.equal(usage.pvpCombatUsage(pvpSession({ rankedKind: 'pet' })), null);
    assert.equal(usage.pvpCombatUsage(pvpSession({ joined: { p1: true, p2: false } } as never)), null);
});

test('Solo PvE counts the player loadout and the AI profile from the AI side', () => {
    const session = {
        sessionId: 's1', status: 'done', outcome: 'win',
        encounter: { kind: 'generic-ai', id: 'ai-rogue' },
        player: { character: character(['fireball']) },
        enemy: { character: {} },
        events: [
            { actor: 'player', action: 'jutsu', actionId: 'fireball' },
            { actor: 'enemy', action: 'jutsu', actionId: 'fireball' },
        ],
    } as unknown as SoloPveSession;
    const fighters = usage.soloPveCombatUsage(session)!;
    const agg = usage.emptyAggregate('pve', 0);
    for (const f of fighters) usage.applyFighterUsage(agg, f);
    assert.deepEqual(agg.jutsu.fireball, { equipped: 1, used: 1, win: 1, loss: 0, draw: 0, fled: 0 });
    assert.deepEqual(agg.ai['generic-ai:ai-rogue'], { equipped: 1, used: 0, win: 0, loss: 1, draw: 0, fled: 0 });
    assert.equal(usage.soloPveCombatUsage({ ...session, status: 'active' } as SoloPveSession), null);
});

test('recording accumulates, and a PvE session is counted once however often it is reported', async () => {
    const session = {
        sessionId: `s-${Date.now()}`, status: 'done', outcome: 'loss',
        encounter: { kind: 'generic-ai', id: 'ai-rogue' },
        player: { character: character(['palm']) }, enemy: { character: {} }, events: [],
    } as unknown as SoloPveSession;
    usage.recordSoloPveCombatUsage(session);
    usage.recordSoloPveCombatUsage(session);
    await new Promise((r) => setImmediate(r));
    for (let i = 0; i < 20 && !(await usage.readCombatUsage('pve')); i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 30));
    const agg = await usage.readCombatUsage('pve');
    assert.equal(agg?.fights, 1);
    assert.equal(agg?.jutsu.palm.loss, 1);
    assert.equal(agg?.ai['generic-ai:ai-rogue'].win, 1);

    await usage.recordCombatUsage('pvp', usage.pvpCombatUsage(pvpSession())!.fighters);
    await usage.recordCombatUsage('pvp', usage.pvpCombatUsage(pvpSession({ winner: 'p2' }))!.fighters);
    const pvp = await usage.readCombatUsage('pvp');
    assert.equal(pvp?.fights, 2);
    assert.deepEqual(pvp?.jutsu.fireball, { equipped: 2, used: 2, win: 1, loss: 1, draw: 0, fled: 0 });
});

test('Solo PvE records usage on the active -> done edge, after the session persists', async () => {
    // Same source-shape pin the lifecycle telemetry uses (solo-pve/_telemetry.test.ts).
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const service = readFileSync(join(process.cwd(), 'api', 'solo-pve', '_action-service.ts'), 'utf8');
    const edge = service.indexOf("session.status === 'active' && next.status === 'done'");
    const write = service.indexOf('await write(next)');
    const call = service.indexOf('recordSoloPveCombatUsage(next)');
    assert.ok(edge !== -1 && write !== -1 && call !== -1, 'the service no longer has the shape this pin checks');
    assert.ok(call > write && call > edge, 'usage must be recorded inside the completion edge, after the write');
    assert.ok(call - edge < 800, 'the call must sit inside the completion block');
});

function towerRun(winner: string | null, runId = `run-${Date.now()}`) {
    return {
        runId, status: 'done', winner,
        actors: [
            { side: 'squad', name: 'A', ownerSlug: 'a', ai: false, character: character(['fireball']) },
            { side: 'squad', name: 'Ally', ownerSlug: null, ai: true, character: character(['palm']) },
            { side: 'enemy', name: 'Raijū, the Storm-Hound', ownerSlug: null, ai: true, character: {} },
            { side: 'enemy', name: 'Raijū, the Storm-Hound', ownerSlug: null, ai: true, character: {} },
            { side: 'npc', name: 'Caravan', ownerSlug: null, ai: true, character: {} },
        ],
    };
}

test('a tower or Clan Boss run counts human squad loadouts and each distinct enemy once', () => {
    const fighters = usage.towerCombatUsage(towerRun('squad'))!;
    const agg = usage.emptyAggregate('tower', 0);
    for (const f of fighters) usage.applyFighterUsage(agg, f);
    assert.deepEqual(agg.jutsu.fireball, { equipped: 1, used: 0, win: 1, loss: 0, draw: 0, fled: 0 });
    assert.equal(agg.jutsu.palm, undefined, 'an AI-driven ally is not a player loadout');
    assert.deepEqual(agg.ai['tower:Raijū, the Storm-Hound'], { equipped: 1, used: 0, win: 0, loss: 1, draw: 0, fled: 0 });
    assert.equal(Object.keys(agg.ai).length, 1, 'NPCs are not enemies');
    assert.deepEqual(usage.towerCombatUsage(towerRun('enemy'))!.map((f) => f.outcome), ['loss', 'win']);
    assert.deepEqual(usage.towerCombatUsage(towerRun('draw'))!.map((f) => f.outcome), ['draw', 'draw']);
    assert.equal(usage.towerCombatUsage({ ...towerRun('squad'), status: 'active' }), null);
});

test('a tower run is recorded once however often its settlement replays', async () => {
    const run = towerRun('squad');
    usage.recordTowerCombatUsage(run, 'clan-boss');
    usage.recordTowerCombatUsage(run, 'clan-boss');
    for (let i = 0; i < 50 && !(await usage.readCombatUsage('clan-boss')); i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await usage.readCombatUsage('clan-boss'))?.fights, 1);
});

test('the tower, Clan Boss, abandon and lapse edges all record usage (source pins)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = (...p: string[]) => readFileSync(join(process.cwd(), 'api', ...p), 'utf8');
    const tower = src('towers', 'settle.ts');
    assert.ok(tower.indexOf("recordTowerCombatUsage(authoritativeSession, 'tower')") > tower.indexOf('await recordTowerRunSettled(authoritativeSession)'),
        'tower usage is recorded alongside the settled-run telemetry');
    assert.match(src('clan-boss', 'assault-settle.ts'), /recordTowerCombatUsage\(session, 'clan-boss'\)/);
    const abandon = src('solo-pve', '_abandon.ts');
    assert.equal(abandon.match(/recordSoloPveCombatUsage\(next\)/g)?.length, 2, 'both the abandon and the lapse edge');
});

test('bad ids are skipped and each table is bounded', () => {
    const agg = usage.emptyAggregate('pvp', 0);
    usage.applyFighterUsage(agg, { outcome: 'win', equippedJutsu: ['ok', '', 'x'.repeat(200), '<script>'], usedJutsu: [], weapons: [] });
    assert.deepEqual(Object.keys(agg.jutsu), ['ok']);
    for (let i = 0; i < usage.MAX_ENTRIES_PER_KIND + 50; i++) {
        usage.applyFighterUsage(agg, { outcome: 'win', equippedJutsu: [`j${i}`], usedJutsu: [], weapons: [] });
    }
    assert.equal(Object.keys(agg.jutsu).length, usage.MAX_ENTRIES_PER_KIND);
});

async function request(method: string, query: Record<string, string>, headers: Record<string, string>) {
    const out = { status: 200, body: {} as any };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
    await handler({ method, query, headers, socket: { remoteAddress: '127.0.0.93' } } as never, res as never);
    return out;
}

test('admin endpoint: either tier reads, only full admin resets', async () => {
    await usage.recordCombatUsage('ranked', usage.pvpCombatUsage(pvpSession({ ranked: true }))!.fighters);
    assert.equal((await request('GET', { mode: 'ranked' }, {})).status, 403);
    const read = await request('GET', { mode: 'ranked' }, { 'x-admin-password': 'usage-test-content' });
    assert.equal(read.status, 200);
    assert.equal(read.body.usage.fights, 1);
    assert.equal((await request('GET', { mode: 'nope' }, { 'x-admin-password': 'usage-test-full' })).status, 400);
    assert.equal((await request('DELETE', { mode: 'ranked' }, { 'x-admin-password': 'usage-test-content' })).status, 403);
    assert.equal((await request('DELETE', { mode: 'ranked' }, { 'x-admin-password': 'usage-test-full' })).status, 200);
    assert.equal((await request('GET', { mode: 'ranked' }, { 'x-admin-password': 'usage-test-full' })).body.usage, null);
});

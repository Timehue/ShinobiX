import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sector-pet-table-secret-32-bytes-long';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * The Sector War Pet table (api/village/sector-pet.ts), through the real
 * handler on the memory store:
 *
 *   - only the war's two villages read its duels, and neither side sees the
 *     other's team before the duel resolves (a defender used to be able to
 *     scout the attacker's whole team before choosing what to answer with);
 *   - each viewer is told which seat is theirs, so the defender gets a picker;
 *   - a war that is OVER opens and answers no duels;
 *   - a duel that ends after the war did scores nothing and writes no receipt;
 *   - a retried answer fights the duel the war already scored.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };
type ProjectedPet = {
    status: string; viewerSide: string | null; canAnswer: boolean; seed?: number; winner?: string;
    p1: { name: string; pet?: unknown; team?: unknown[] }; p2?: { name: string; team?: unknown[] };
    createdAt?: number; appliedToContest?: boolean; engine?: string; warResult?: { scored: boolean; reason?: string };
};

const SECTOR = 43;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const RAIDER = 'petraider';
const HOLDOUT = 'petholdout';
const BYSTANDER = 'petbystander';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let war: typeof import('../_sector-war.js');
let villageWarKey: typeof import('../_war-state.js').villageWarKey;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    ({ villageWarKey } = await import('../_war-state.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    const pet = await import('./sector-pet.js');
    handler = ((pet.default as unknown as { default?: Handler })?.default ?? pet.default) as unknown as Handler;
});

function pet(id: string, name: string) {
    return { id, name, rarity: 'common', hp: 60, attack: 20, defense: 15, speed: 12, level: 5, element: 'None' };
}

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
    for (const [slug, village, pets] of [
        [RAIDER, ATTACKER, [pet('atk1', 'Ashfang'), pet('atk2', 'Emberpaw')]],
        [HOLDOUT, DEFENDER, [pet('def1', 'Frostmaw'), pet('def2', 'Glaciertail')]],
        [BYSTANDER, 'Sunscar Village', [pet('by1', 'Dunehound')]],
    ] as const) {
        await kv.set(`save:${slug}`, { character: { name: slug, village, pets, activePetId: pets[0].id } });
    }
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function call(body: Record<string, unknown>): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; },
        end: () => res,
    };
    const playerName = String(body.playerName ?? '');
    const req = {
        method: 'POST',
        body,
        headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res as never);
    return out;
}

async function seedContest(overrides: Record<string, unknown> = {}) {
    const contest = { ...war.newSectorWarSession({
        sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'pet', now: Date.now() - 60 * 60 * 1000,
    }), ...overrides };
    await kv.set(war.sectorWarKey(contest.id), contest);
    return contest;
}

const session = (out: ResponseOut) => out.body?.session as ProjectedPet;
const receipts = async (id: string) => {
    const row = war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(id))) as never)!;
    return { count: row.battleLedger?.count ?? (row.appliedBattles?.length ?? 0), row };
};

describe('Sector War pet table — who sees what', { concurrency: false }, () => {
    it('the defender sees who opened the duel, never the team they sent, and may answer it', async () => {
        const contest = await seedContest();
        const opened = await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        assert.equal(session(opened).viewerSide, 'p1');
        assert.ok(session(opened).p1.team?.length, 'the opener sees their own team');

        const scouted = await call({ action: 'state', playerName: HOLDOUT, sectorWarId: contest.id });
        assert.equal(scouted.statusCode, 200, JSON.stringify(scouted.body));
        const view = session(scouted);
        assert.equal(view.status, 'awaiting-defender');
        assert.deepEqual(view.p1, { name: RAIDER }, 'no pet, no team before the duel resolves');
        assert.doesNotMatch(JSON.stringify(scouted.body), /Ashfang|Emberpaw/);
        assert.equal(view.viewerSide, null);
        assert.equal(view.canAnswer, true, 'a defender of the sector may answer — the screen shows them the picker');
    });

    it('a village outside the war cannot read its duels at all', async () => {
        const contest = await seedContest();
        await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        const peek = await call({ action: 'state', playerName: BYSTANDER, sectorWarId: contest.id });
        assert.equal(peek.statusCode, 403);
        await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, petId: 'def1' });
        const watch = await call({ action: 'watch', playerName: BYSTANDER, sectorWarId: contest.id });
        assert.equal(watch.statusCode, 403);
    });

    it('once the duel resolves both sides see it whole, and each is told its own seat', async () => {
        const contest = await seedContest();
        await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        const answered = await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, petId: 'def1' });
        assert.equal(answered.statusCode, 200, JSON.stringify(answered.body));
        const decided = session(answered);
        assert.equal(decided.status, 'done');
        assert.equal(decided.viewerSide, 'p2');
        assert.equal(decided.appliedToContest, true);
        assert.equal(decided.engine, 'showdown');
        assert.ok(decided.p1.team?.length && decided.p2?.team?.length);
        const attackerView = session(await call({ action: 'state', playerName: RAIDER, sectorWarId: contest.id }));
        assert.equal(attackerView.viewerSide, 'p1');
        const watched = await call({ action: 'watch', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(watched.statusCode, 200, JSON.stringify(watched.body));
    });
});

describe('Sector War pet table — wars that are over', { concurrency: false }, () => {
    it('a defended war (its row still lingering) opens no duel', async () => {
        const contest = await seedContest({ expiredAt: Date.now() - 60_000, expiredReason: 'defended' });
        const out = await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(out.statusCode, 409);
        assert.equal(await kv.get(`sector-pet:${contest.id}`), null);
    });

    it('a war past its 72 hours answers no open duel', async () => {
        const contest = await seedContest();
        await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        const row = await kv.get<Record<string, unknown>>(war.sectorWarKey(contest.id));
        await kv.set(war.sectorWarKey(contest.id), { ...row, endsAt: Date.now() - 1 });
        const out = await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, petId: 'def1' });
        assert.equal(out.statusCode, 409);
        assert.equal((await kv.get<{ status: string }>(`sector-pet:${contest.id}`))?.status, 'awaiting-defender');
        assert.equal((await receipts(contest.id)).count, 0);
    });
});

describe('Sector War pet table — the whistle and the retry', { concurrency: false }, () => {
    it('a duel that ends after the war did scores nothing and writes no receipt', async () => {
        const contest = await seedContest();
        await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        // The war's clock runs out while the answer is being resolved: the
        // contest row moves past its end between the join's gate and the score.
        const realGet = kv.get.bind(kv);
        let fired = false;
        kv.get = (async (key: string) => {
            if (!fired && key === villageWarKey(DEFENDER)) {
                fired = true;
                const row = await realGet<Record<string, unknown>>(war.sectorWarKey(contest.id));
                // A minute in the past: before the answer's own timestamp.
                await kv.set(war.sectorWarKey(contest.id), { ...row, endsAt: Date.now() - 60_000 });
            }
            return realGet(key);
        }) as typeof kv.get;
        let out: ResponseOut;
        try {
            out = await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, petId: 'def1' });
        } finally {
            kv.get = realGet;
        }
        assert.ok(fired, 'the clock ran out mid-answer');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.deepEqual(session(out).warResult, { scored: false, reason: 'superseded' });
        const { count, row } = await receipts(contest.id);
        assert.equal(count, 0, 'no 0-point receipt: it used to log battle-scored and credit the winner');
        assert.equal(row.attackerPoints + row.defenderPoints, 0);
    });

    it('a retried answer fights the very duel the war scored', async () => {
        const contest = await seedContest();
        await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        const open = await kv.get<Record<string, unknown>>(`sector-pet:${contest.id}`);
        const first = session(await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, petId: 'def1' }));
        assert.equal(first.status, 'done');

        // The contest commit landed, the session write did not: the table still
        // reads as open, and the defender's client tries again a moment later.
        await kv.set(`sector-pet:${contest.id}`, open);
        await new Promise((resolve) => setTimeout(resolve, 15));
        const retried = session(await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, petId: 'def1' }));
        assert.equal(retried.seed, first.seed, 'the seed belongs to the table, not to the request');
        assert.equal(retried.winner, first.winner);

        const { count, row } = await receipts(contest.id);
        assert.equal(count, 1, 'scored once');
        const receipt = (row.appliedBattles ?? [])[0]!;
        assert.equal(receipt.attackerWon, retried.winner === 'p1', 'the duel on screen is the duel the war counted');
    });
});

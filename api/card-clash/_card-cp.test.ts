/* Card-battle Chronicle Points (api/card-clash/_card-cp.ts): the dials, the
 * free-play participation gate, the per-pair day decay shared by every PvP card
 * mode, the reciprocal-win gate, and exactly-once payment under retries and
 * concurrent claims. Runs on the isolated memory store. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type CardCp = typeof import('./_card-cp.js');
let cp: CardCp;
let kv: typeof import('../_storage.js').kv;
let drainBackgroundWork: () => Promise<void>;
let CARD_CHRONICLE_POINTS_DEFAULTS: typeof import('../../shared/card-chronicle-points.js').CARD_CHRONICLE_POINTS_DEFAULTS;
let legacy: typeof import('./_freeplay-legacy.js');

const DIALS = ['CARD_PVP_WIN_CP', 'CARD_PVP_LOSS_CP', 'CARD_PVE_DUNGEON_CP', 'CARD_PVE_GATE_CP', 'CARD_PVE_GARRISON_CP'];
const DAY_MS = 86_400_000;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ drainBackgroundWork } = await import('../_background-work.js'));
    ({ CARD_CHRONICLE_POINTS_DEFAULTS } = await import('../../shared/card-chronicle-points.js'));
    cp = await import('./_card-cp.js');
    legacy = await import('./_freeplay-legacy.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const dial of DIALS) delete process.env[dial];
});

afterEach(() => {
    for (const dial of DIALS) delete process.env[dial];
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function seed(name: string, chroniclePoints = 0, extra: Record<string, unknown> = {}) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, chroniclePoints, ...extra } });
}

async function pointsOf(name: string): Promise<number> {
    const row = await kv.get<{ character: { chroniclePoints?: number } }>(`save:${name}`);
    return Number(row?.character.chroniclePoints ?? 0);
}

type Ending = 'play' | 'forfeit' | 'timeout';

/** A finished duel session, as every PvP card host stores one. */
function duel(o: {
    winner?: 'p1' | 'p2' | 'draw';
    p1?: string; p2?: string;
    seconds?: number; p1Actions?: number; p2Actions?: number; turn?: number;
    endedBy?: Ending; endedAt?: number; status?: 'complete' | 'active';
}): import('./_card-cp.js').CardPvpCpSession {
    const endedAt = o.endedAt ?? Date.now();
    return {
        p1Name: o.p1 ?? 'alpha',
        p2Name: o.p2 ?? 'bravo',
        state: { status: o.status ?? 'complete', winner: o.winner ?? 'p1', turnNumber: o.turn ?? 4 },
        participation: {
            startedAt: endedAt - (o.seconds ?? 60) * 1000,
            p1Actions: o.p1Actions ?? 3,
            p2Actions: o.p2Actions ?? 3,
            endedBy: o.endedBy ?? 'play',
        },
        updatedAt: endedAt,
    };
}

describe('card Chronicle Point dials', () => {
    it('default to the owner amounts and the shared client defaults', () => {
        assert.deepEqual(
            [cp.cardPvpWinCp(), cp.cardPvpLossCp(), cp.cardPveDungeonCp(), cp.cardPveGateCp(), cp.cardPveGarrisonCp()],
            [20, 8, 10, 10, 15],
        );
        assert.deepEqual({ ...CARD_CHRONICLE_POINTS_DEFAULTS }, { pvpWin: 20, pvpLoss: 8, dungeon: 10, gate: 10, garrison: 15 });
    });

    it('read the env inside 0-100 and fall back on a bad value', () => {
        process.env.CARD_PVP_WIN_CP = '35';
        process.env.CARD_PVP_LOSS_CP = '0';
        process.env.CARD_PVE_DUNGEON_CP = '101';
        process.env.CARD_PVE_GATE_CP = 'lots';
        process.env.CARD_PVE_GARRISON_CP = '12.9';
        assert.deepEqual(
            [cp.cardPvpWinCp(), cp.cardPvpLossCp(), cp.cardPveDungeonCp(), cp.cardPveGateCp(), cp.cardPveGarrisonCp()],
            [35, 0, 10, 10, 12],
        );
    });
});

describe('a PvP card duel credit', () => {
    it('is pending only for a duel that would earn the free-play Legacy credit', () => {
        const id = 'card-pvp:t1';
        assert.equal(cp.prepareCardPvpCpCredit(duel({}), id)?.status, 'pending');
        const skipped: Array<[string, Parameters<typeof duel>[0]]> = [
            ['under 45 s', { seconds: 44 }],
            ['loser played 2 actions', { p2Actions: 2 }],
            ['winner played 2 actions', { p1Actions: 2 }],
            ['before turn 3', { turn: 2 }],
            ['a forfeit', { endedBy: 'forfeit' }],
            ['the walk-out clock', { endedBy: 'timeout' }],
        ];
        for (const [label, input] of skipped) {
            const credit = cp.prepareCardPvpCpCredit(duel(input), id);
            assert.equal(credit?.status, 'skipped', label);
            assert.equal(credit?.reason, 'participation', label);
        }
        assert.equal(cp.prepareCardPvpCpCredit(duel({ winner: 'draw' }), id), null, 'a draw pays nobody');
        assert.equal(cp.prepareCardPvpCpCredit(duel({ status: 'active' }), id), null, 'an unfinished duel pays nobody');
        assert.equal(cp.prepareCardPvpCpCredit(duel({ p2: 'Alpha' }), id), null, 'a player never pays themselves');
        const swapped = cp.prepareCardPvpCpCredit(duel({ winner: 'p2' }), id);
        assert.equal(swapped?.winnerName, 'bravo');
        assert.equal(swapped?.targetName, 'alpha');
    });

    it('the shared participation rule is the one the Legacy credit applies', () => {
        for (const input of [{}, { seconds: 44 }, { turn: 2 }, { p2Actions: 1 }, { endedBy: 'forfeit' as const }]) {
            const session: Record<string, unknown> = { matchId: 'x', ...duel(input) };
            legacy.ensureFreePlayLegacyCredit(session as never);
            const points = cp.prepareCardPvpCpCredit(duel(input), 'card-pvp:x');
            assert.equal(points?.status, (session.legacyCredit as { status?: string } | undefined)?.status, JSON.stringify(input));
        }
    });

    it('pays 20 / 8 and decays 1, 1, .5, .25, 0 per pair per UTC day across every PvP card mode', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 22, 12) });
        await seed('alpha');
        await seed('bravo');
        const receipts = [
            ['card-pvp:m1', 'free-play'], ['card-pvp:cw:c1:1', 'war'], ['card-pvp:sector:s1:1', 'war'],
            ['card-pvp:sector-open:o1', 'war'], ['card-pvp:m5', 'free-play'],
        ] as const;
        const paid: Array<[number, number]> = [];
        for (const [receiptId, history] of receipts) {
            const credit = cp.prepareCardPvpCpCredit(duel({}), receiptId, history)!;
            const before = [await pointsOf('alpha'), await pointsOf('bravo')];
            await cp.settleCardCpCredit(credit);
            assert.equal(credit.status, 'done', receiptId);
            paid.push([await pointsOf('alpha') - before[0], await pointsOf('bravo') - before[1]]);
        }
        assert.deepEqual(paid, [[20, 8], [20, 8], [10, 4], [5, 2], [0, 0]]);

        // The next UTC day starts the pair over.
        t.mock.timers.setTime(Date.UTC(2026, 9, 23, 0, 5));
        const tomorrow = cp.prepareCardPvpCpCredit(duel({}), 'card-pvp:m6')!;
        await cp.settleCardCpCredit(tomorrow);
        assert.equal(tomorrow.pairOrdinal, 1);
        assert.equal(await pointsOf('alpha'), 55 + 20);
        assert.equal(await pointsOf('bravo'), 22 + 8);
    });

    it('another opponent has its own day count', async () => {
        await seed('alpha');
        await seed('bravo');
        await seed('charlie');
        for (const id of ['a', 'b', 'c', 'd', 'e']) {
            await cp.settleCardCpCredit(cp.prepareCardPvpCpCredit(duel({}), `card-pvp:${id}`)!);
        }
        const fresh = cp.prepareCardPvpCpCredit(duel({ p2: 'charlie' }), 'card-pvp:charlie-1')!;
        await cp.settleCardCpCredit(fresh);
        assert.equal(fresh.pairOrdinal, 1);
        assert.equal(await pointsOf('charlie'), 8);
    });

    it('follows the PvP established-account rule: 72 h old OR level 20', async () => {
        const fresh = { createdAt: Date.now() - 3_600_000, level: 19 };
        // A fresh loser pays nobody.
        await seed('alpha');
        await seed('fresh-loser', 0, fresh);
        const alt = cp.prepareCardPvpCpCredit(duel({ p2: 'fresh-loser' }), 'card-pvp:alt-loser')!;
        await cp.settleCardCpCredit(alt);
        assert.equal(alt.status, 'skipped');
        assert.equal(alt.reason, 'too-young');
        assert.equal(await pointsOf('alpha'), 0);
        assert.equal(await pointsOf('fresh-loser'), 0);
        assert.equal(cp.cardCpView(alt, 'alpha')?.reason, 'too-young');
        // A fresh winner earns the win, but the established loser gets no loss pay.
        await seed('fresh-winner', 0, fresh);
        await seed('veteran', 0, { createdAt: Date.now() - 30 * 86_400_000, level: 60 });
        const main = cp.prepareCardPvpCpCredit(duel({ p1: 'fresh-winner', p2: 'veteran' }), 'card-pvp:alt-winner')!;
        await cp.settleCardCpCredit(main);
        assert.equal(main.status, 'done');
        assert.equal(await pointsOf('fresh-winner'), 20);
        assert.equal(await pointsOf('veteran'), 0);
        assert.equal(cp.cardCpView(main, 'veteran')?.reason, 'too-young');
        // At level 20 the same fresh account is established.
        await seed('new-l20', 0, { createdAt: Date.now() - 3_600_000, level: 20 });
        const ok = cp.prepareCardPvpCpCredit(duel({ p1: 'veteran', p2: 'new-l20' }), 'card-pvp:l20')!;
        await cp.settleCardCpCredit(ok);
        assert.equal(ok.status, 'done');
        assert.equal(await pointsOf('veteran'), 20);
        assert.equal(await pointsOf('new-l20'), 8);
    });

    it('a reciprocal win pays neither duelist', async () => {
        await seed('alpha');
        await seed('bravo');
        await cp.settleCardCpCredit(cp.prepareCardPvpCpCredit(duel({}), 'card-pvp:r1')!);
        const back = cp.prepareCardPvpCpCredit(duel({ winner: 'p2' }), 'card-pvp:r2')!;
        const result = await cp.settleCardCpCredit(back);
        assert.equal(result.changed, true);
        assert.equal(back.status, 'skipped');
        assert.equal(back.reason, 'reciprocal');
        assert.equal(await pointsOf('alpha'), 20, 'only the first, non-reciprocal win paid');
        assert.equal(await pointsOf('bravo'), 8);
        assert.deepEqual(cp.cardCpView(back, 'bravo'), { earned: 0, status: 'none', reason: 'reciprocal' });
    });

    it('war duels keep their own reciprocal history, so a free-play Legacy decision never moves', async () => {
        await seed('alpha');
        await seed('bravo');
        // A clan-war win, then the reverse result in a sector-war duel: reciprocal among war duels.
        await cp.settleCardCpCredit(cp.prepareCardPvpCpCredit(duel({}), 'card-pvp:cw:w1:1', 'war')!);
        const warBack = cp.prepareCardPvpCpCredit(duel({ winner: 'p2' }), 'card-pvp:sector:w2:1', 'war')!;
        await cp.settleCardCpCredit(warBack);
        assert.equal(warBack.reason, 'reciprocal');
        // The same reverse result in free play reads the free-play history, which saw no war duel.
        assert.equal(await kv.get(`${legacy.FREEPLAY_PAIR_HISTORY_PREFIX}:alpha:bravo`), null, 'war duels never write the free-play history');
        const freeBack = cp.prepareCardPvpCpCredit(duel({ winner: 'p2' }), 'card-pvp:f1', 'free-play')!;
        await cp.settleCardCpCredit(freeBack);
        assert.equal(freeBack.status, 'done');
        assert.equal(freeBack.pairOrdinal, 2, 'the day count is still shared with the war duel that paid');
        assert.equal(await pointsOf('bravo'), 8 + 20);
        assert.equal(await pointsOf('alpha'), 20 + 8);
    });

    it('pays exactly once under replays, a lost outbox write and concurrent claims', async () => {
        await seed('alpha', 100);
        await seed('bravo', 3);
        const credit = cp.prepareCardPvpCpCredit(duel({}), 'card-pvp:once')!;
        // Two requests that each read the session before the other saved it.
        const twin = structuredClone(credit);
        await Promise.all([cp.settleCardCpCredit(credit), cp.settleCardCpCredit(twin)]);
        // A retry after the session write was lost re-prepares from scratch.
        const lost = cp.prepareCardPvpCpCredit(duel({}), 'card-pvp:once')!;
        await cp.settleCardCpCredit(lost);
        await cp.settleCardCpCredit(credit);
        assert.equal(await pointsOf('alpha'), 120);
        assert.equal(await pointsOf('bravo'), 11);
        assert.equal(lost.pairOrdinal, credit.pairOrdinal, 'the pair slot is assigned once per duel');
        const receipts = (await kv.get<{ character: { serverSettlementReceipts: Array<{ requestId: string }> } }>('save:alpha'))!
            .character.serverSettlementReceipts;
        assert.equal(receipts.filter((r) => r.requestId === cp.cardCpRequestId('card-pvp:once:winner')).length, 1);

        await drainBackgroundWork();
        const txns = (await kv.get<Array<{ txnId: string; source: string; delta: number; currency: string }>>('econ:txns')) ?? [];
        const mine = txns.filter((txn) => txn.txnId.startsWith('card-cp:card-pvp:once'));
        assert.deepEqual(mine.map((txn) => [txn.source, txn.delta, txn.currency]).sort(),
            [['card.pvp.loss', 8, 'chroniclePoints'], ['card.pvp.win', 20, 'chroniclePoints']]);
    });

    it('a deleted account is nobody to pay and does not hold the outbox open', async () => {
        await seed('alpha');
        const credit = cp.prepareCardPvpCpCredit(duel({}), 'card-pvp:ghost')!;
        await cp.settleCardCpCredit(credit);
        assert.equal(credit.status, 'done');
        assert.equal(await pointsOf('alpha'), 20);
    });

    it('a share that cannot be paid stays pending and is paid by the next request', async () => {
        await seed('alpha');
        await seed('bravo');
        const realGet = kv.get.bind(kv);
        let refuse = true;
        (kv as unknown as { get: typeof kv.get }).get = (async (key: string) => {
            if (refuse && key === 'save:bravo') throw new Error('injected save outage');
            return realGet(key);
        }) as typeof kv.get;
        const credit = cp.prepareCardPvpCpCredit(duel({}), 'card-pvp:retry')!;
        try {
            await cp.settleCardCpCredit(credit);
        } finally {
            refuse = false;
            (kv as unknown as { get: typeof kv.get }).get = realGet;
        }
        assert.equal(credit.status, 'pending');
        assert.equal(credit.paid?.winner, true);
        await cp.settleCardCpCredit(credit);
        assert.equal(credit.status, 'done');
        assert.equal(await pointsOf('alpha'), 20);
        assert.equal(await pointsOf('bravo'), 8);
    });

    it('tells each duelist what they earned and hands their save back once', async () => {
        await seed('alpha');
        await seed('bravo');
        const credit = cp.prepareCardPvpCpCredit(duel({}), 'card-pvp:view')!;
        const { committed } = await cp.settleCardCpCredit(credit);
        const winner = await cp.cardCpReply(credit, 'alpha', { committed, deliver: true });
        assert.deepEqual(winner.body.chroniclePoints, { earned: 20, status: 'paid', pairWeight: 1 });
        assert.equal((winner.body.character as { chroniclePoints: number }).chroniclePoints, 20);
        assert.equal(typeof winner.body._saveVersion, 'number');
        assert.equal(winner.changed, true);
        const again = await cp.cardCpReply(credit, 'alpha', { deliver: true });
        assert.equal(again.body.character, undefined, 'the save is handed back once');
        // The loser's save was written by the winner's request; their own poll reads it.
        const loser = await cp.cardCpReply(credit, 'bravo', { deliver: true });
        assert.equal((loser.body.character as { chroniclePoints: number }).chroniclePoints, 8);
        assert.deepEqual(loser.body.chroniclePoints, { earned: 8, status: 'paid', pairWeight: 1 });
        assert.deepEqual((await cp.cardCpReply(credit, 'onlooker', { deliver: true })).body, {}, 'a watcher learns nothing');
        const admin = await cp.cardCpReply(structuredClone(credit), 'alpha', { deliver: false });
        assert.equal(admin.body.character, undefined);

        const short = cp.prepareCardPvpCpCredit(duel({ seconds: 10 }), 'card-pvp:short')!;
        assert.deepEqual(cp.cardCpView(short, 'alpha'), {
            earned: 0, status: 'none', reason: 'participation',
            rules: { minSeconds: 45, minActionsPerSide: 3, minTurn: 3 },
        });
    });

    it('says when the pair has used up the day', async () => {
        await seed('alpha');
        await seed('bravo');
        let last: import('./_card-cp.js').CardCpCredit | undefined;
        for (const id of ['1', '2', '3', '4', '5']) {
            last = cp.prepareCardPvpCpCredit(duel({}), `card-pvp:day-${id}`)!;
            await cp.settleCardCpCredit(last);
        }
        assert.deepEqual(cp.cardCpView(last, 'alpha'), { earned: 0, status: 'none', reason: 'repeat', pairWeight: 0 });
    });
});

describe('a garrison credit', () => {
    it('pays a won assault once and nothing for a loss', async () => {
        await seed('raider');
        assert.equal(cp.prepareCardGarrisonCpCredit({ receiptId: 'g0', attackerName: 'raider', won: false, endedAt: Date.now() }), null);
        const credit = cp.prepareCardGarrisonCpCredit({ receiptId: 'card-pve:g1', attackerName: 'raider', won: true, endedAt: Date.now() })!;
        await cp.settleCardCpCredit(credit);
        await cp.settleCardCpCredit(structuredClone({ ...credit, status: 'pending' as const, paid: undefined }));
        assert.equal(await pointsOf('raider'), 15);
        assert.deepEqual(cp.cardCpView(credit, 'raider'), { earned: 15, status: 'paid' });
        await drainBackgroundWork();
        const txns = (await kv.get<Array<{ txnId: string; source: string }>>('econ:txns')) ?? [];
        assert.deepEqual(txns.filter((txn) => txn.txnId === 'card-cp:card-pve:g1:winner').map((txn) => txn.source), ['card.pve.garrison']);
    });
});

describe('the Chronicle guide states the rules the server applies', () => {
    it('names the participation thresholds', () => {
        const guide = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'data', 'guides-content.json'), 'utf8');
        const rules = cp.cardPvpCpRules();
        assert.match(guide, new RegExp(`reaches turn ${rules.minTurn}, lasts ${rules.minSeconds} seconds, has three plays from each side`));
        assert.equal(rules.minActionsPerSide, 3, 'the guide spells the action count as "three"');
    });
});

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { SectorWarBattleReceipt, SectorWarSession } from '../_sector-war.js';

/*
 * The sector-war purse (2026-10 rebalance, framework #7): ryo for the battles a
 * fighter WON in a sector war, at 20 points a credited win, paid at
 * min(points, 200) x 0.3 x A(L) to the side that captured or held and x 0.12 to
 * the side that failed, from 30 points (two wins).
 */

const HOUR = 60 * 60 * 1000;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';

let kv: typeof import('../_storage.js').kv;
let war: typeof import('../_sector-war.js');
let purse: typeof import('./_sector-purse.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    purse = await import('./_sector-purse.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

function session(over: Partial<SectorWarSession> = {}): SectorWarSession {
    const startedAt = Date.now() - 80 * HOUR;
    return {
        ...war.newSectorWarSession({ sector: 26, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: startedAt }),
        declarationGeneration: 2,
        ...over,
    };
}

let seq = 0;
function receipt(by: string, attackerWon: boolean, over: Partial<SectorWarBattleReceipt> = {}): SectorWarBattleReceipt {
    return { battleId: `battle-${++seq}`, attackerWon, points: 5, by, at: Date.now() - 10 * HOUR, ...over };
}

describe('the purse ledger', () => {
    it('counts credited wins per fighter and side: 20 a win, a quarter for a merc, half for a garrison assault', () => {
        const s = session({ flipped: true });
        const dup = receipt('raider', true, { battleId: 'dup' });
        const ledger = purse.buildSectorWarPurseLedger(s, [
            receipt('raider', true), receipt('raider', true), dup, dup,
            receipt('raider', true, { battleId: 'merc:x:raider:1' }),
            receipt('raider', true, { garrison: true }),
            receipt('holder', false),
            receipt('', false),                         // a merc band won: no player
            receipt('', false, { garrison: false }),    // the garrison held: no player
            receipt('zero', true, { points: 0 }),       // a battle that scored nothing
        ]);
        assert.ok(ledger);
        assert.equal(ledger!.outcome, 'captured');
        assert.equal(ledger!.winnerVillage, ATTACKER);
        assert.equal(ledger!.loserVillage, DEFENDER);
        assert.deepEqual(ledger!.entries, {
            raider: { points: 3 * 20 + 5 + 10, side: ATTACKER },
            holder: { points: 20, side: DEFENDER },
        });
    });

    it('a defended war pays the defence at the hold rate; an abandon after 48 h does too; before 48 h nobody', () => {
        const defended = purse.buildSectorWarPurseLedger(session({ expiredAt: Date.now(), expiredReason: 'defended' }), []);
        assert.equal(defended?.outcome, 'defended');
        assert.equal(defended?.winnerVillage, DEFENDER);
        const s = session();
        const late = purse.buildSectorWarPurseLedger({ ...s, expiredAt: s.startedAt + 70 * HOUR, expiredReason: 'abandoned' }, []);
        assert.equal(late?.outcome, 'abandoned');
        assert.equal(late?.winnerVillage, DEFENDER, 'abandoning at hour 70 cannot cancel the defence\'s purse');
        assert.equal(purse.buildSectorWarPurseLedger({ ...s, expiredAt: s.startedAt + 47 * HOUR, expiredReason: 'abandoned' }, []), null);
        assert.equal(purse.buildSectorWarPurseLedger(session(), []), null, 'a live war has no ledger');
    });
});

describe('paying the purse', () => {
    function ledger(entries: Record<string, { points: number; side: string }>, over: Record<string, unknown> = {}) {
        return {
            version: 1 as const, contestId: '26:moonshadowvillage-vs-frostfangvillage', instance: 'g2.s1', sector: 26,
            outcome: 'captured' as const, winnerVillage: ATTACKER, loserVillage: DEFENDER,
            startedAt: 1, endedAt: NOW - HOUR, settledAt: NOW - HOUR, entries, ...over,
        };
    }
    const NOW = 50_000 * HOUR;
    const fighter = (over: Record<string, unknown> = {}) => ({ name: 'Raider', village: ATTACKER, level: 90, ryo: 0, claimedWarCrateIds: [], ...over });

    it('pays 0.3 x A(L) per point to the captor and 0.12 x A(L) to the failing side, once', () => {
        const l = ledger({ raider: { points: 100, side: ATTACKER }, holder: { points: 100, side: DEFENDER } });
        const won = purse.settleSectorWarPurses(fighter(), [l], NOW, { purseScale: 1 });
        assert.equal(won.ryo, 9_000, 'five wins at L90');
        assert.equal(won.character.ryo, 9_000);
        assert.ok((won.character.claimedWarCrateIds as string[]).includes(purse.sectorPurseMarker(l)));
        assert.equal(purse.settleSectorWarPurses(won.character, [l], NOW, { purseScale: 1 }).granted, false, 'a replay pays nothing');
        const lost = purse.settleSectorWarPurses(fighter({ name: 'Holder', village: DEFENDER }), [l], NOW, { purseScale: 1 });
        assert.equal(lost.ryo, 3_600);
    });

    it('needs two wins, caps at ten, and scales with WAR_PURSE_SCALE', () => {
        assert.equal(purse.settleSectorWarPurses(fighter(), [ledger({ raider: { points: 20, side: ATTACKER } })], NOW, { purseScale: 1 }).ryo, 0);
        assert.equal(purse.settleSectorWarPurses(fighter(), [ledger({ raider: { points: 500, side: ATTACKER } })], NOW, { purseScale: 1 }).ryo, 18_000);
        assert.equal(purse.settleSectorWarPurses(fighter(), [ledger({ raider: { points: 100, side: ATTACKER } })], NOW, { purseScale: 0.5 }).ryo, 4_500);
        assert.equal(purse.settleSectorWarPurses(fighter(), [ledger({ raider: { points: 100, side: ATTACKER } })], NOW, { purseScale: 0 }).granted, false);
    });

    it('pays nothing to a fighter who changed village, after the 7-day window, or to a fresh alt', () => {
        const l = ledger({ raider: { points: 100, side: ATTACKER } });
        assert.equal(purse.settleSectorWarPurses(fighter({ village: DEFENDER }), [l], NOW, { purseScale: 1 }).granted, false);
        assert.equal(purse.settleSectorWarPurses(fighter(), [l], NOW + 8 * 24 * HOUR, { purseScale: 1 }).granted, false);
        assert.equal(purse.settleSectorWarPurses(fighter({ createdAt: NOW - 10 * HOUR, level: 19 }), [l], NOW, { purseScale: 1 }).granted, false);
        assert.equal(purse.settleSectorWarPurses(fighter({ createdAt: NOW - 10 * HOUR, level: 20 }), [l], NOW, { purseScale: 1 }).granted, true, 'a fresh L20 account is established (owner A14)');
    });

    it('pays nothing for a war that ended before the purse epoch, like the village purse', async () => {
        const l = ledger({ raider: { points: 100, side: ATTACKER } });
        assert.equal(purse.settleSectorWarPurses(fighter(), [l], NOW, { purseScale: 1, epochMs: l.endedAt + 1 }).granted, false);
        assert.equal(purse.settleSectorWarPurses(fighter(), [l], NOW, { purseScale: 1, epochMs: l.endedAt }).granted, true);
        // The claim route's defaults read the same epoch the village purse uses.
        const { WAR_PURSE_EPOCH_DEFAULT_MS } = await import('./_reward.js');
        assert.equal(purse.settleSectorWarPurses(fighter(), [l], NOW).granted, false, `${new Date(l.endedAt).toISOString()} is before the default epoch`);
        const live = ledger({ raider: { points: 100, side: ATTACKER } }, { endedAt: WAR_PURSE_EPOCH_DEFAULT_MS + HOUR, settledAt: WAR_PURSE_EPOCH_DEFAULT_MS + HOUR });
        assert.equal(purse.settleSectorWarPurses(fighter(), [live], WAR_PURSE_EPOCH_DEFAULT_MS + 2 * HOUR).ryo, 9_000);
    });
});

describe('writing the ledger', { concurrency: false }, () => {
    async function storeExternal(s: SectorWarSession, r: SectorWarBattleReceipt) {
        await kv.set(war.sectorWarBattleReceiptKey(s, r.battleId), {
            version: 1, contestId: s.id, generation: 2, startedAt: s.startedAt, receipt: r, tally: { attackerPoints: 0, defenderPoints: 0 },
        });
    }

    it('reads the in-row and external receipts once, skips an unreadable one, and never writes twice', async () => {
        const s = session({ flipped: true, appliedBattles: [receipt('raider', true, { battleId: 'row-1' })] });
        await storeExternal(s, receipt('raider', true, { battleId: 'ext-1' }));
        await storeExternal(s, receipt('raider', true, { battleId: 'row-1' }));
        await kv.set(war.sectorWarBattleReceiptKey(s, 'broken'), { junk: true });
        assert.equal(await purse.recordSectorWarPurseLedger(s), 'written');
        const stored = purse.parseSectorWarPurseLedger(await kv.get(purse.sectorWarPurseKey(s.id, war.sectorWarInstanceTag(s))));
        assert.deepEqual(stored?.entries, { raider: { points: 40, side: ATTACKER } });
        assert.equal(await purse.recordSectorWarPurseLedger(s), 'exists');
        assert.equal((await purse.listSectorWarPurseLedgers()).length, 1);
    });

    it('the sweep writes the ledger of an abandoned war, which settles outside the settlement pass', async () => {
        const base = session();
        const abandoned = { ...base, expiredAt: base.startedAt + 70 * HOUR, expiredReason: 'abandoned' as const, appliedBattles: [
            receipt('holder', false, { battleId: 'h1' }), receipt('holder', false, { battleId: 'h2' }),
        ] };
        await kv.set(war.sectorWarKey(abandoned.id), abandoned);
        assert.equal(await purse.sweepSectorWarPurseLedgers(), 1);
        const [ledger] = await purse.listSectorWarPurseLedgers();
        assert.equal(ledger.outcome, 'abandoned');
        assert.deepEqual(ledger.entries, { holder: { points: 40, side: DEFENDER } });
        assert.equal(await purse.sweepSectorWarPurseLedgers(), 0, 'nothing left to write');
    });
});

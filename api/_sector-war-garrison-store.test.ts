import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isDeepStrictEqual } from 'node:util';
import {
    settleGarrisonFight,
    garrisonRunKey,
    garrisonActiveRunKey,
    type GarrisonRun,
    type GarrisonKv,
    type GarrisonLock,
} from './_sector-war-garrison-store.js';
import { buildGarrisonEncounter } from './_sector-war-garrison-encounter.js';

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);
const now = () => NOW;
const SECTOR = 12;
const CONTEST_ID = '12:moonshadowvillage-vs-frostfangvillage';

function fakeKv(): GarrisonKv & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
        store,
        async get<T>(key: string) { return (store.has(key) ? store.get(key) : null) as T | null; },
        async set(key, value) { store.set(key, value); return 'OK'; },
        async compareSet(key, expected, value) {
            const current = store.has(key) ? store.get(key) : null;
            if (!isDeepStrictEqual(current, expected)) return false;
            store.set(key, value);
            return true;
        },
        async del(...keys: string[]) { let n = 0; for (const k of keys) if (store.delete(k)) n++; return n; },
    };
}
const passLock: GarrisonLock = async (_t, fn) => fn();
function deps(kv: GarrisonKv) { return { kv, lock: passLock, now }; }

function seedSave(kv: ReturnType<typeof fakeKv>, slug: string, char: Record<string, unknown> = {}) {
    kv.store.set(`save:${slug}`, {
        _saveVersion: 5,
        character: { name: slug, level: 100, maxHp: 9000, itemStacks: [{ itemId: 'potion', count: 3 }], ...char },
    });
}
const charOf = (kv: ReturnType<typeof fakeKv>, slug: string) =>
    (kv.store.get(`save:${slug}`) as { character: Record<string, unknown> }).character;

function makeRun(over: Partial<GarrisonRun> = {}): GarrisonRun {
    return {
        runId: 'garrison-r1', attackerName: 'attacker', attackerVillage: 'Moonshadow Village',
        sector: SECTOR, contestId: CONTEST_ID, defenderVillage: 'Frostfang Village',
        anbuSlug: 'anbu-one', anbuName: 'The Frostfang Anbu', terrain: 'snow',
        createdAt: NOW,
        ...over,
    };
}

function terminalSession(outcome: 'win' | 'loss' = 'win') {
    const session = buildGarrisonEncounter({
        runId: 'garrison-r1', now: NOW, sector: SECTOR, contestId: CONTEST_ID, terrain: 'snow',
        attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
        attacker: {
            slug: 'attacker', name: 'attacker', itemCharges: { potion: 1 },
            character: { level: 100, maxHp: 9000, maxChakra: 100, maxStamina: 100, stats: {}, jutsu: [], pvpItems: [], equipment: {} },
        },
        anbu: {
            slug: 'anbu-one', name: 'The Frostfang Anbu',
            character: { level: 100, maxHp: 9000, maxChakra: 100, maxStamina: 100, stats: {}, jutsu: [], pvpItems: [], equipment: {} },
        },
    });
    session.status = 'done';
    session.winner = outcome === 'win' ? 'player' : 'enemy';
    session.outcome = outcome;
    session.player.hp = outcome === 'win' ? 4321 : 0;
    session.itemsUsed = { potion: 1 };
    return session;
}

describe('settleGarrisonFight', () => {
    it('a win consumes proven item usage and carries surviving HP onto the save', async () => {
        const kv = fakeKv();
        seedSave(kv, 'attacker');
        const out = await settleGarrisonFight(makeRun(), terminalSession('win'), deps(kv));
        assert.equal(out.ok, true);
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.character.hp, 4321);
        const stacks = out.character.itemStacks as Array<{ itemId: string; count: number }>;
        assert.equal(stacks.find(s => s.itemId === 'potion')?.count, 2);
        // No currency/reward is minted here — garrison pays nothing of its own;
        // it only settles the fight's physical cost.
        assert.equal(out.character.ryo, undefined);
        assert.ok(Array.isArray(out.character.serverSettlementReceipts));
    });

    it('a loss hospitalizes the attacker at 0 HP, same as any other AI fight', async () => {
        const kv = fakeKv();
        seedSave(kv, 'attacker');
        const out = await settleGarrisonFight(makeRun(), terminalSession('loss'), deps(kv));
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.character.hp, 0);
        assert.equal(out.character.hospitalized, true);
        assert.equal(out.character.hospitalizedUntil, NOW + 60_000);
    });

    it('is idempotent: a retried resolve does not double-apply item usage', async () => {
        const kv = fakeKv();
        seedSave(kv, 'attacker');
        const run = makeRun();
        const session = terminalSession('win');
        const first = await settleGarrisonFight(run, session, deps(kv));
        const second = await settleGarrisonFight(run, session, deps(kv));
        if (!first.ok || !second.ok) throw new Error('unexpected');
        assert.equal(first.alreadySettled, false);
        assert.equal(second.alreadySettled, true);
        const stacks = charOf(kv, 'attacker').itemStacks as Array<{ itemId: string; count: number }>;
        assert.equal(stacks.find(s => s.itemId === 'potion')?.count, 2, 'a replay must not burn the item twice');
    });

    it('fails closed on a missing save', async () => {
        const kv = fakeKv();
        const out = await settleGarrisonFight(makeRun(), terminalSession('win'), deps(kv));
        assert.equal(out.ok, false);
        if (out.ok) throw new Error('unexpected');
        assert.equal(out.error, 'no-save');
    });

    it('rejects a receipt fingerprint conflict (same runId claimed under a different contest binding)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'attacker');
        const first = await settleGarrisonFight(makeRun(), terminalSession('win'), deps(kv));
        assert.equal(first.ok, true);
        const conflicting = makeRun({ contestId: '13:x-vs-y' });
        const out = await settleGarrisonFight(conflicting, terminalSession('win'), deps(kv));
        assert.equal(out.ok, false);
        if (out.ok) throw new Error('unexpected');
        assert.equal(out.error, 'receipt-conflict');
    });
});

describe('garrison key scheme', () => {
    it('scopes the run and active-assault keys distinctly from other combat surfaces', () => {
        assert.equal(garrisonRunKey('r1'), 'sector-war-garrison:r1');
        assert.equal(garrisonActiveRunKey('attacker', 12), 'sector-war-garrison-active:attacker:12');
    });
});

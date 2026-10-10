import { after, before, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { GarrisonRun } from './_sector-war-garrison-store.js';

// settleGarrisonFight commits the attacker's save through mutatePlayerSave, on
// the shared KV, so these run against its in-memory backend (chosen on first
// use, so the flag only has to be set before a test touches storage).
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);
const now = () => NOW;
const SECTOR = 12;
const CONTEST_ID = '12:moonshadowvillage-vs-frostfangvillage';
const SAVE_KEY = 'save:attacker';

let kv: typeof import('./_storage.js').kv;
let store: typeof import('./_sector-war-garrison-store.js');
let buildGarrisonEncounter: typeof import('./_sector-war-garrison-encounter.js').buildGarrisonEncounter;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    store = await import('./_sector-war-garrison-store.js');
    ({ buildGarrisonEncounter } = await import('./_sector-war-garrison-encounter.js'));
});

beforeEach(async () => {
    await kv.del(SAVE_KEY);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function seedSave(char: Json = {}, record: Json = {}) {
    await kv.set(SAVE_KEY, {
        _saveVersion: 5,
        ...record,
        character: { name: 'attacker', level: 100, maxHp: 9000, itemStacks: [{ itemId: 'potion', count: 3 }], ...char },
    });
}
const stored = async () => (await kv.get<{ _saveVersion: number; character: Json }>(SAVE_KEY))!;
const potions = (character: Json) =>
    (character.itemStacks as Array<{ itemId: string; count: number }>).find(s => s.itemId === 'potion')?.count;

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

describe('settleGarrisonFight', { concurrency: false }, () => {
    it('a win consumes proven item usage and carries surviving HP onto the save', async () => {
        await seedSave();
        const out = await store.settleGarrisonFight(makeRun(), terminalSession('win'), { now });
        assert.equal(out.ok, true);
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.character.hp, 4321);
        assert.equal(potions(out.character), 2);
        // No currency/reward is minted here — garrison pays nothing of its own;
        // it only settles the fight's physical cost.
        assert.equal(out.character.ryo, undefined);
        assert.ok(Array.isArray(out.character.serverSettlementReceipts));
        const committed = await stored();
        assert.equal(committed.character.hp, 4321, 'the committed save carries the same consequence');
        assert.equal(committed._saveVersion, out.saveVersion, 'the reply echoes the committed version');
        assert.ok(out.saveVersion > 5);
    });

    it('a loss hospitalizes the attacker at 0 HP, same as any other AI fight', async () => {
        await seedSave();
        const out = await store.settleGarrisonFight(makeRun(), terminalSession('loss'), { now });
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.character.hp, 0);
        assert.equal(out.character.hospitalized, true);
        assert.equal(out.character.hospitalizedUntil, NOW + 60_000);
    });

    it('keeps the chakra and stamina the attacker recovered while the assault ran', async () => {
        // The fight writes HP only. A raw version bump fenced the regeneration
        // cursor to the write, so every point of chakra and stamina recovered
        // since the last save was gone for good.
        const at = Date.now() - 30_000;
        await seedSave({ chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 }, { _saveAt: at, _regenAt: at });
        const out = await store.settleGarrisonFight(makeRun(), terminalSession('win'), { now });
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        for (const [where, character] of [['reply', out.character], ['committed save', (await stored()).character]] as const) {
            assert.ok(Number(character.chakra) >= 50, `${where}: chakra ${character.chakra} lost the idle recovery`);
            assert.ok(Number(character.stamina) >= 30, `${where}: stamina ${character.stamina} lost the idle recovery`);
            assert.equal(character.hp, 4321, `${where}: HP is the fight's, not idle recovery`);
        }
    });

    it('is idempotent: a retried resolve does not double-apply item usage', async () => {
        await seedSave();
        const run = makeRun();
        const session = terminalSession('win');
        const first = await store.settleGarrisonFight(run, session, { now });
        const second = await store.settleGarrisonFight(run, session, { now });
        if (!first.ok || !second.ok) throw new Error('unexpected');
        assert.equal(first.alreadySettled, false);
        assert.equal(second.alreadySettled, true);
        assert.equal(second.saveVersion, first.saveVersion, 'a replay writes nothing and echoes the stored version');
        assert.equal(potions((await stored()).character), 2, 'a replay must not burn the item twice');
    });

    it('a lost compare-and-set re-runs once on the fresh save and still burns the item once', async () => {
        await seedSave();
        const original = kv.compareSet;
        let raced = false;
        kv.compareSet = async (key, expected, value, options) => {
            if (!raced && key === SAVE_KEY) {
                // Another writer commits between this settle's read and its write.
                raced = true;
                const current = (await kv.get<Json>(SAVE_KEY))!;
                await kv.set(SAVE_KEY, {
                    ...current,
                    _saveVersion: Number(current._saveVersion) + 1,
                    character: { ...(current.character as Json), ryo: 777 },
                });
            }
            return original.call(kv, key, expected, value, options);
        };
        let out: Awaited<ReturnType<typeof store.settleGarrisonFight>>;
        try {
            out = await store.settleGarrisonFight(makeRun(), terminalSession('win'), { now });
        } finally {
            kv.compareSet = original;
        }
        assert.ok(raced, 'the race was injected');
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        const committed = (await stored()).character;
        assert.equal(committed.ryo, 777, "the other writer's commit survives");
        assert.equal(potions(committed), 2, 'the item is burned once, from the fresh save');
        // One receipt for this settle, plus the generic /api/pve/fight-outcome
        // fence it stamps so that path can never write the same body twice.
        const receipts = committed.serverSettlementReceipts as Array<{ requestId: string }>;
        assert.equal(receipts.length, 2);
        assert.equal(receipts.filter((r) => r.requestId === 'sector-war-garrison-garrison-r1').length, 1);
    });

    it('fails closed on a missing save', async () => {
        const out = await store.settleGarrisonFight(makeRun(), terminalSession('win'), { now });
        assert.equal(out.ok, false);
        if (out.ok) throw new Error('unexpected');
        assert.equal(out.error, 'no-save');
    });

    it('rejects a receipt fingerprint conflict (same runId claimed under a different contest binding)', async () => {
        await seedSave();
        const first = await store.settleGarrisonFight(makeRun(), terminalSession('win'), { now });
        assert.equal(first.ok, true);
        const conflicting = makeRun({ contestId: '13:x-vs-y' });
        const out = await store.settleGarrisonFight(conflicting, terminalSession('win'), { now });
        assert.equal(out.ok, false);
        if (out.ok) throw new Error('unexpected');
        assert.equal(out.error, 'receipt-conflict');
        assert.equal(potions((await stored()).character), 2, 'the refused settle wrote nothing');
    });
});

describe('settleGarrisonFight shares ONE body with the generic fight-outcome path', { concurrency: false }, () => {
    // /api/pve/fight-outcome and the lapse reconciler write a Solo-PvE fight's
    // HP/hospital too, under their own receipt. Each path SETS HP to the
    // fight's end value, so the second of two writes heals a player who has
    // been hurt since. Whichever lands first writes the body; the other must not.
    async function hurtTo(hp: number) {
        const save = await stored();
        await kv.set(SAVE_KEY, { ...save, character: { ...save.character, hp } });
    }
    // The generic path also leaves a legacy per-run KV marker that it honours
    // as a replay; one left by another case would make these pass for the
    // wrong reason.
    beforeEach(async () => { await kv.del('pve-outcome:garrison-r1'); });

    it('after the generic path wrote the body, the garrison settle burns the items and leaves HP alone', async () => {
        const { settlePveFightOutcome } = await import('./pve/_fight-outcome-settlement.js');
        await seedSave({ hp: 9000 });
        const session = terminalSession('win'); // ends at 4 321
        const generic = await settlePveFightOutcome(session, 'attacker');
        assert.equal(generic.ok, true, JSON.stringify(generic));
        assert.equal((await stored()).character.hp, 4321);

        await hurtTo(1000);
        const out = await store.settleGarrisonFight(makeRun(), session, { now });
        if (!out.ok || out.alreadySettled) throw new Error(`unexpected ${JSON.stringify(out)}`);
        assert.equal(out.character.hp, 1000, 'a late settle must not heal back up to the fight\'s end HP');
        assert.equal(potions(out.character), 2, 'the item cost only this path owns still lands, once');
    });

    it('after the garrison settle, the generic path is a replay', async () => {
        const { settlePveFightOutcome } = await import('./pve/_fight-outcome-settlement.js');
        await seedSave({ hp: 9000 });
        const session = terminalSession('win');
        const out = await store.settleGarrisonFight(makeRun(), session, { now });
        assert.equal(out.ok, true);
        await hurtTo(1000);
        const generic = await settlePveFightOutcome(session, 'attacker');
        assert.equal(generic.ok && generic.replayed, true, JSON.stringify(generic));
        assert.equal((await stored()).character.hp, 1000);
    });
});

describe('garrison key scheme', () => {
    it('scopes the run and active-assault keys distinctly from other combat surfaces', () => {
        assert.equal(store.garrisonRunKey('r1'), 'sector-war-garrison:r1');
        assert.equal(store.garrisonActiveRunKey('attacker', 12), 'sector-war-garrison-active:attacker:12');
    });
});

/*
 * END-TO-END wiring test for the pet bond decay.
 *
 * The unit tests in _happiness.test.ts prove the arithmetic. This one proves the
 * arithmetic is actually REACHED and PERSISTED by the two seams that carry it:
 *
 *   1. settleSaveRecordForRead(persist) — the owner's own save GET, which is the
 *      once-a-day tick. It has to survive the under-lock re-settle AND the
 *      mergePreservingImages write, which seeds from the STORED record and could
 *      silently resurrect the pre-decay happiness.
 *   2. sealCompanionFromSave — the combat seal, which must PROJECT the decay
 *      (a fight resolving against happiness the player no longer has is the whole
 *      failure this feature is meant to prevent) without writing anything.
 *
 * Both were reasoned about when the feature was written; this pins them, because
 * a future refactor of either seam would break the mechanic with every unit test
 * still green.
 */

// Same preamble every KV-backed test here uses: the in-memory backend refuses to
// attach unless NODE_ENV says test, and _storage.ts reads both at import time —
// so these must be set before the dynamic imports in `before`.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
    PET_HAPPINESS_DAILY_DECAY,
    PET_HAPPINESS_OBEDIENT,
    utcDayIndex,
} from '../../shared/pet-happiness.js';

type Kv = typeof import('../_storage.js')['kv'];
type SettleForRead = typeof import('../_elapsed-state.js')['settleSaveRecordForRead'];
type SealCompanion = typeof import('../combat-core/companion.js')['sealCompanionFromSave'];

let kv: Kv;
let settleSaveRecordForRead: SettleForRead;
let sealCompanionFromSave: SealCompanion;

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 31, 9, 30);
const daysAgo = (n: number) => utcDayIndex(NOW) - n;

/** A level-50+ companion, which is the floor for being summonable at all. */
const companion = (over: Record<string, unknown> = {}) => ({
    id: 'pet-1',
    name: 'Kuro',
    level: 60,
    maxLevel: 100,
    hp: 400,
    attack: 100,
    defense: 40,
    speed: 50,
    jutsus: [{ name: 'Bite', kind: 'damage', power: 60 }],
    happiness: 100,
    happinessDay: daysAgo(3),
    happinessPets: 0,
    ...over,
});

const saveRecord = (pet: Record<string, unknown>) => ({
    _saveVersion: 4,
    _saveAt: NOW,
    character: {
        name: 'Ren',
        hp: 100,
        maxHp: 100,
        activePetId: 'pet-1',
        pets: [pet],
    },
});

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ settleSaveRecordForRead } = await import('../_elapsed-state.js'));
    ({ sealCompanionFromSave } = await import('../combat-core/companion.js'));
});

describe('pet bond decay — owner save read (the durable tick)', () => {
    it('decays, RETURNS the decayed value, and PERSISTS it to KV', async () => {
        await kv.set('save:ren', saveRecord(companion()));

        const settled = await settleSaveRecordForRead('Ren', await kv.get('save:ren') as Record<string, unknown>, {
            persist: true,
            now: NOW,
        });

        const returnedPet = ((settled.record.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
        assert.equal(returnedPet.happiness, 100 - 3 * PET_HAPPINESS_DAILY_DECAY, 'the read must return the decayed value');
        assert.equal(returnedPet.happinessDay, utcDayIndex(NOW), 'and re-stamp today');

        // The write is what actually matters: mergePreservingImages seeds from the
        // STORED record, so a badly-shaped settle would hand back 70 and store 100.
        const stored = await kv.get('save:ren') as Record<string, unknown>;
        const storedPet = ((stored.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
        assert.equal(storedPet.happiness, 70, 'the decay must survive the image-preserving merge');
        assert.equal(storedPet.happinessDay, utcDayIndex(NOW));
        assert.equal(storedPet.happinessPets, 0, 'a new day refills the free-petting budget');
    });

    it('is idempotent — a second read the same day changes nothing', async () => {
        await kv.set('save:idem', saveRecord(companion()));
        const first = await settleSaveRecordForRead('idem', await kv.get('save:idem') as Record<string, unknown>, { persist: true, now: NOW });
        const versionAfterFirst = Number(first.record._saveVersion);

        const second = await settleSaveRecordForRead('idem', await kv.get('save:idem') as Record<string, unknown>, { persist: true, now: NOW });
        const secondPet = ((second.record.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
        assert.equal(secondPet.happiness, 70, 'the same day must not decay twice');
        assert.equal(
            Number(second.record._saveVersion),
            versionAfterFirst,
            'a settled pet must not bump the save version on every read',
        );
    });

    it('leaves the OTHER pet fields untouched', async () => {
        await kv.set('save:fields', saveRecord(companion({ nickname: 'Ash', xp: 240, loadout: { pve: 'gear', pveDurability: 9 } })));
        await settleSaveRecordForRead('fields', await kv.get('save:fields') as Record<string, unknown>, { persist: true, now: NOW });
        const stored = await kv.get('save:fields') as Record<string, unknown>;
        const pet = ((stored.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
        assert.equal(pet.nickname, 'Ash');
        assert.equal(pet.xp, 240);
        assert.deepEqual(pet.loadout, { pve: 'gear', pveDurability: 9 });
        assert.equal(pet.level, 60);
    });

    it('STAMPS a pre-decay save instead of retro-decaying it (live-save safety)', async () => {
        const legacy = companion();
        delete (legacy as Record<string, unknown>).happinessDay;
        delete (legacy as Record<string, unknown>).happinessPets;
        await kv.set('save:legacy', saveRecord(legacy));

        await settleSaveRecordForRead('legacy', await kv.get('save:legacy') as Record<string, unknown>, { persist: true, now: NOW });
        const stored = await kv.get('save:legacy') as Record<string, unknown>;
        const pet = ((stored.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
        assert.equal(pet.happiness, 100, 'nobody logs in after the deploy to a companion that lost happiness');
        assert.equal(pet.happinessDay, utcDayIndex(NOW), 'the clock starts now');
    });

    it('does NOT write on a foreign read (persist: false), but still projects nothing stale', async () => {
        await kv.set('save:foreign', saveRecord(companion()));
        const before = JSON.stringify(await kv.get('save:foreign'));
        await settleSaveRecordForRead('foreign', await kv.get('save:foreign') as Record<string, unknown>, { persist: false, now: NOW });
        assert.equal(JSON.stringify(await kv.get('save:foreign')), before, 'a profile view must never write another player\'s save');
    });
});

describe('pet bond decay — combat seal (projection, no write)', () => {
    it('seals the DECAYED happiness even when the save has not been re-read', () => {
        const record = saveRecord(companion());
        const seal = sealCompanionFromSave(record.character as unknown as Record<string, unknown>, NOW);
        assert.ok(seal);
        assert.equal(seal.happiness, 70, 'three missed daily resets cost 30 points at seal time');
    });

    it('crosses the obedience line as the decay bites', () => {
        const stillObedient = sealCompanionFromSave(
            saveRecord(companion({ happinessDay: daysAgo(2) })).character as unknown as Record<string, unknown>,
            NOW,
        );
        assert.ok(stillObedient && stillObedient.happiness >= PET_HAPPINESS_OBEDIENT, '100 - 20 = 80 still obeys');

        const nowRestless = sealCompanionFromSave(
            saveRecord(companion({ happinessDay: daysAgo(3) })).character as unknown as Record<string, unknown>,
            NOW,
        );
        assert.ok(nowRestless && nowRestless.happiness < PET_HAPPINESS_OBEDIENT, '100 - 30 = 70 has slipped below the cliff');
    });

    it('applies the neglect damage malus to the sealed strike', () => {
        const healthy = sealCompanionFromSave(
            saveRecord(companion({ happiness: 100, happinessDay: utcDayIndex(NOW) })).character as unknown as Record<string, unknown>,
            NOW,
        );
        const neglected = sealCompanionFromSave(
            saveRecord(companion({ happiness: 10, happinessDay: utcDayIndex(NOW) })).character as unknown as Record<string, unknown>,
            NOW,
        );
        assert.ok(healthy && neglected);
        assert.equal(neglected.damage, Math.floor(healthy.damage * 0.8));
    });

    it('does not mutate the pet it seals', () => {
        const record = saveRecord(companion());
        sealCompanionFromSave(record.character as unknown as Record<string, unknown>, NOW);
        assert.equal(record.character.pets[0].happiness, 100, 'the seal is a projection, not a write');
        assert.equal(record.character.pets[0].happinessDay, daysAgo(3));
    });
});

describe('pet bond decay — the Sanctuary suspends the clock', () => {
    // A stored pet is OUT of character.pets, so api/pet/progress.ts 404s every
    // action against it — it cannot be petted, fed or trained. Charging decay for
    // storage time would punish a player who had no way to respond.
    it('banks the decay owed at deposit, then stops the clock', async () => {
        const { storePetInSanctuary, getPetFromSanctuary } = await import('./_sanctuary.js');
        // 3 days owed at deposit: 100 -> 70, and then the stamp is dropped.
        await storePetInSanctuary('Vault', companion(), 'roster', NOW);
        const stored = await getPetFromSanctuary('Vault', 'pet-1');
        assert.ok(stored);
        assert.equal(stored.pet.happiness, 70, 'decay owed BEFORE the deposit is still charged');
        assert.equal(stored.pet.happinessDay, undefined, 'the clock stops at the Sanctuary door');
        assert.equal(stored.pet.happinessPets, undefined);
    });

    it('a pet withdrawn after a long storage loses NOTHING for the time it sat there', async () => {
        const { storePetInSanctuary, getPetFromSanctuary } = await import('./_sanctuary.js');
        await storePetInSanctuary('Vault2', companion({ happiness: 90, happinessDay: utcDayIndex(NOW) }), 'roster', NOW);
        const stored = await getPetFromSanctuary('Vault2', 'pet-1');
        assert.ok(stored);
        assert.equal(stored.pet.happiness, 90, 'nothing owed at deposit, nothing charged');

        // Withdraw a year later: the missing stamp makes the first settle a stamp,
        // not a decay — exactly the path that grandfathers pre-decay saves.
        const aYearLater = NOW + 365 * DAY;
        await kv.set('save:vault2', saveRecord(stored.pet as Record<string, unknown>));
        await settleSaveRecordForRead('vault2', await kv.get('save:vault2') as Record<string, unknown>, { persist: true, now: aYearLater });
        const back = await kv.get('save:vault2') as Record<string, unknown>;
        const pet = ((back.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
        assert.equal(pet.happiness, 90, 'a year in storage costs nothing');
        assert.equal(pet.happinessDay, utcDayIndex(aYearLater), 'and the clock restarts on withdrawal');
    });
});

describe('pet bond decay — PvE summon ONLY', () => {
    // Owner ruling 2026-08-31: happiness affects a companion the player SUMMONS in
    // PvE and nothing else. It must never reach a pet-vs-pet duel — those are
    // decided by build and play, not by daily upkeep (the balanced-PvP pillar).
    const DUEL_SOURCES = [
        'api/_pet-sim/pet-duel-sim.ts',
        'api/_pet-sim/pet-warfront-sim.ts',
        'api/_pet-sim/pet-board-sim.ts',
        'api/_pet-showdown/engine.ts',
        'api/pet/_pvp-duel.ts',
        'api/pet/_ranked-engine.ts',
        'api/pet/_wanderer-duel.ts',
        'api/pet/_dungeon-battle.ts',
        'api/pet/warfront-start.ts',
    ];

    /** Walk up from cwd to the repo root. `import.meta` is unavailable here —
     *  api/** compiles to CommonJS (tsconfig.cpanel.json), which rejects it. */
    async function repoRoot(): Promise<string> {
        const { access } = await import('node:fs/promises');
        const { dirname, resolve } = await import('node:path');
        let dir = process.cwd();
        for (let hop = 0; hop < 8; hop += 1) {
            try {
                await access(resolve(dir, 'api', 'pet', 'warfront-start.ts'));
                return dir;
            } catch { /* not this level — keep walking */ }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        // Never skip: a guard that silently passes when it cannot find the files
        // it guards is worse than no guard at all.
        throw new Error(`could not locate the repo root from ${process.cwd()}`);
    }

    it('no pet-vs-pet engine reads happiness, and the Warfront snapshot does not carry it', async () => {
        const { readFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const root = await repoRoot();
        for (const rel of DUEL_SOURCES) {
            const source = await readFile(join(root, ...rel.split('/')), 'utf8').catch(() => null);
            if (source === null) continue; // a renamed/removed engine is not this test's business
            const live = source
                .split('\n')
                .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
                .join('\n');
            assert.equal(
                /happiness/i.test(live),
                false,
                `${rel} references happiness — the bond must not reach a pet-vs-pet duel`,
            );
        }
    });
});

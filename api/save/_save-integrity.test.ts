import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { adminSaveTargetAllowed, sanitizeCharacterSave } from './[name].js';
import { activeCarriedPetIds } from '../_entitlements.js';
import {
    CHRONICLE_FIXED_FALLBACK_DECK,
    CHRONICLE_RULES_VERSION,
} from '../../shared/chronicle-duel.js';

const wrap = (character: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...extra, character });

function withStrictLedger<T>(enabled: boolean, run: () => T): T {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    if (enabled) process.env.STRICT_RAW_SAVE_LEDGER = '1';
    else process.env.STRICT_RAW_SAVE_LEDGER = '0';
    try {
        return run();
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
}

const sanitizeStrict = (
    incoming: Record<string, unknown>,
    existing: Record<string, unknown> | null,
) => withStrictLedger(true, () => sanitizeCharacterSave(incoming, existing));

const sanitizeCompatible = (
    incoming: Record<string, unknown>,
    existing: Record<string, unknown> | null,
) => withStrictLedger(false, () => sanitizeCharacterSave(incoming, existing));

describe('Activity Spine mastery focus persistence', () => {
    it('round-trips a valid player-selected focus', () => {
        const first = sanitizeCompatible(wrap({ name: 'Focus', masteryFocus: 'towers-spire' }), wrap({ name: 'Focus' })).character as Record<string, unknown>;
        assert.equal(first.masteryFocus, 'towers-spire');
        const second = sanitizeCompatible(wrap({ ...first }), wrap(first)).character as Record<string, unknown>;
        assert.equal(second.masteryFocus, 'towers-spire');
    });

    it('normalizes unknown values to Auto and keeps older saves sparse', () => {
        const unknown = sanitizeCompatible(wrap({ name: 'Focus', masteryFocus: 'invented-mode' }), wrap({ name: 'Focus' })).character as Record<string, unknown>;
        assert.equal(unknown.masteryFocus, 'auto');
        const older = sanitizeCompatible(wrap({ name: 'Focus' }), wrap({ name: 'Focus' })).character as Record<string, unknown>;
        assert.equal('masteryFocus' in older, false);
    });
});

// Stat-derived leveling (docs/leveling-without-xp-map.md). The sanitizer is the
// ONLY thing standing between a forged body and a minted level, and the
// recompute is rise-only — so anything it gets wrong is permanent.
describe('stat-derived level: sanitizer authority', () => {
    const heldSave = (over: Record<string, unknown> = {}) => ({
        name: 'Holder', level: 20, xp: 0, ryo: 0,
        stats: {
            strength: 10, speed: 10, intelligence: 10, willpower: 10,
            bukijutsuOffense: 10, bukijutsuDefense: 10, taijutsuOffense: 10, taijutsuDefense: 10,
            genjutsuOffense: 10, genjutsuDefense: 10, ninjutsuOffense: 10, ninjutsuDefense: 10,
        },
        unspentStats: 12_000, // far past the L20 hold's 3,933 threshold
        examsPassed: [] as string[],
        levelLedgerMigrated: true,
        ...over,
    });

    it('a forged examsPassed cannot lift the level past an unpassed exam hold', () => {
        // examsPassed is not validated until ~440 lines after the level is
        // derived, so the derive MUST read the stored list, not the body.
        const stored = heldSave();
        const forged = heldSave({ examsPassed: ['genin', 'chunin'], level: 51 });
        const out = sanitizeCompatible(wrap(forged), wrap(stored)).character as Record<string, unknown>;
        assert.equal(out.level, 20, 'forged exam list must not mint levels past the hold');
        assert.deepEqual(out.examsPassed, [], 'the honest stored exam list is what persists');
    });

    it('an honestly-passed exam still releases the hold', () => {
        const stored = heldSave({ examsPassed: ['genin'] });
        const out = sanitizeCompatible(wrap(heldSave({ examsPassed: ['genin'] })), wrap(stored)).character as Record<string, unknown>;
        assert.equal(out.level, 39, 'banked points leap to the next hold once the exam is real');
    });

    it('ignores a client-written level in both directions', () => {
        // Stored L15 with exactly the L15 ledger (2,800 earned), both exams passed
        // so no hold is in play — the only thing that could move the level is the
        // body, and it must not.
        const settled = { examsPassed: ['genin', 'chunin'], unspentStats: 2_800, level: 15 };
        const stored = heldSave(settled);
        const tooHigh = sanitizeCompatible(wrap(heldSave({ ...settled, level: 99 })), wrap(stored)).character as Record<string, unknown>;
        assert.equal(tooHigh.level, 15, 'level derives from the ledger (2,800 earned = L15), not the body');
        const tooLow = sanitizeCompatible(wrap(heldSave({ ...settled, level: 1 })), wrap(stored)).character as Record<string, unknown>;
        assert.equal(tooLow.level, 15, 'and a lowball level cannot de-level either');
    });

    it('strict-ledger mode applies and latches the one-time migration', () => {
        const stored = heldSave({ unspentStats: 20, levelLedgerMigrated: undefined });
        const out = sanitizeStrict(wrap(heldSave({ unspentStats: 20, levelLedgerMigrated: undefined })), wrap(stored)).character as Record<string, unknown>;
        assert.equal(out.unspentStats, 3_933);
        assert.equal(out.levelLedgerMigrated, true);
    });

    it('migrates an XP-era save up to its stored level exactly once', () => {
        const stored = heldSave({ level: 30, unspentStats: 20, levelLedgerMigrated: undefined });
        const first = sanitizeCompatible(wrap(heldSave({ level: 30, unspentStats: 20, levelLedgerMigrated: undefined })), wrap(stored)).character as Record<string, unknown>;
        assert.equal(first.unspentStats, 6_200, 'topped up to earnedForLevel(30)');
        assert.equal(first.level, 30, 'and holds the level it already had');
        assert.equal(first.levelLedgerMigrated, true);
        // Re-running against the migrated save must not top up a second time.
        const second = sanitizeCompatible(wrap(first), wrap(first)).character as Record<string, unknown>;
        assert.equal(second.unspentStats, 6_200, 'migration is one-time');
    });

    it('a brand-new first save gets no spurious top-up', () => {
        const out = sanitizeCompatible(wrap(heldSave({ level: 1, unspentStats: 20, levelLedgerMigrated: undefined })), null).character as Record<string, unknown>;
        assert.equal(out.level, 1);
        assert.equal(out.unspentStats, 20, 'earnedForLevel(1) is 0 — nothing to top up');
    });
});

describe('Chronicle Showdown save validation', () => {
    it('accepts a legal owned 40-card deck', () => {
        const deck = [...CHRONICLE_FIXED_FALLBACK_DECK];
        const out = sanitizeCompatible(
            wrap({ tileCards: [], cardClashDeck: deck }),
            wrap({ tileCards: [] }),
        ).character as Record<string, unknown>;
        assert.deepEqual(out.cardClashDeck, deck);
    });

    it('preserves the stored deck when a client submits forged card ids', () => {
        const storedDeck = [...CHRONICLE_FIXED_FALLBACK_DECK];
        const out = sanitizeCompatible(
            wrap({ tileCards: [], cardClashDeck: Array(40).fill('forged-card') }),
            wrap({ tileCards: [], cardClashDeck: storedDeck }),
        ).character as Record<string, unknown>;
        assert.deepEqual(out.cardClashDeck, storedDeck);
    });

    it('bounds the acknowledged tutorial version to current rules', () => {
        const out = sanitizeCompatible(
            wrap({ cardClashTutorialVersion: 999 }),
            wrap({}),
        ).character as Record<string, unknown>;
        assert.equal(out.cardClashTutorialVersion, CHRONICLE_RULES_VERSION);
    });
});

describe('jutsu loadout persistence', () => {
    const learnedIds = Array.from({ length: 15 }, (_, index) => `trained-${index + 1}`);
    const slotOrder = [...learnedIds].reverse();
    const storedSave = (subscriberActive: boolean) => wrap({
        patreon: { active: subscriberActive },
        jutsuMastery: learnedIds.map((jutsuId) => ({ jutsuId, level: 1, xp: 0 })),
        equippedJutsuIds: [],
    });
    const incomingSave = wrap({
        // Deliberately forged true; the stored entitlement remains authoritative.
        patreon: true,
        equippedJutsuIds: [...slotOrder, slotOrder[0]],
    });

    it('preserves slot order while enforcing the base 12-slot cap', () => {
        const out = sanitizeCompatible(incomingSave, storedSave(false)).character as Record<string, unknown>;
        assert.deepEqual(out.equippedJutsuIds, slotOrder.slice(0, 12));
    });

    it('preserves all 15 ordered slots for a stored subscriber entitlement', () => {
        const out = sanitizeCompatible(incomingSave, storedSave(true)).character as Record<string, unknown>;
        assert.deepEqual(out.equippedJutsuIds, slotOrder);
    });

    it('rejects newly injected slot ids in both ledger modes but accepts a level-0 mastery row', () => {
        const existing = wrap({
            jutsuMastery: [
                { jutsuId: 'learned-zero', level: 0, xp: 0 },
                { jutsuId: 'learned-one', level: 1, xp: 0 },
            ],
            equippedJutsuIds: [],
        });
        const incoming = wrap({
            jutsuMastery: [
                { jutsuId: 'learned-zero', level: 0, xp: 0 },
                { jutsuId: 'learned-one', level: 1, xp: 0 },
            ],
            equippedJutsuIds: ['learned-zero', 'forged-catalog-id', 'learned-one'],
        });

        for (const sanitize of [sanitizeCompatible, sanitizeStrict]) {
            const out = sanitize(incoming, existing).character as Record<string, unknown>;
            assert.deepEqual(out.equippedJutsuIds, ['learned-zero', 'learned-one']);
        }
    });

    it('preserves an already-stored legacy slot preference without treating it as a new grant', () => {
        const stored = wrap({ jutsuMastery: [], equippedJutsuIds: ['legacy-slot'] });
        const out = sanitizeCompatible(stored, stored).character as Record<string, unknown>;
        assert.deepEqual(out.equippedJutsuIds, ['legacy-slot']);
    });

    it('freezes the deprecated character.jutsu snapshot in both ledger modes', () => {
        const storedSnapshot = [{ id: 'starter-nin-fire-1', effectPower: 25 }];
        for (const sanitize of [sanitizeCompatible, sanitizeStrict]) {
            const preserved = sanitize(
                wrap({ jutsu: [{ id: 'starter-nin-fire-2', effectPower: 9999 }] }),
                wrap({ jutsu: storedSnapshot }),
            ).character as Record<string, unknown>;
            assert.deepEqual(preserved.jutsu, storedSnapshot);

            const rejected = sanitize(
                wrap({ jutsu: [{ id: 'starter-nin-fire-2', effectPower: 9999 }] }),
                wrap({}),
            ).character as Record<string, unknown>;
            assert.equal('jutsu' in rejected, false);
        }
    });
});

describe('saved bloodline identity boundary', () => {
    const authoredJutsu = (id: string) => ({
        id,
        name: id,
        type: 'Ninjutsu',
        element: 'Crystal',
        ap: 60,
        range: 4,
        effectPower: 40,
        cooldown: 7,
        target: 'OPPONENT',
        method: 'SINGLE',
        tags: [],
    });

    it('keeps only the first incoming row for a duplicated bloodline id', () => {
        const existingBloodline = {
            id: 'owned-bl', rank: 'B Rank', specialElement: 'Crystal', jutsus: [],
        };
        const incoming = wrap(
            { jutsuMastery: [], equippedJutsuIds: [] },
            { savedBloodlines: [
                { ...existingBloodline, jutsus: [authoredJutsu('first-jutsu')] },
                { ...existingBloodline, jutsus: [authoredJutsu('second-jutsu')] },
            ] },
        );
        const existing = wrap(
            { jutsuMastery: [], equippedJutsuIds: [] },
            { savedBloodlines: [existingBloodline] },
        );

        const out = sanitizeCompatible(incoming, existing);
        const saved = out.savedBloodlines as Array<Record<string, unknown>>;
        assert.equal(saved.length, 1);
        assert.deepEqual(
            (saved[0]?.jutsus as Array<Record<string, unknown>>).map((jutsu) => jutsu.id),
            ['first-jutsu'],
        );
        assert.deepEqual(
            ((out.character as Record<string, unknown>).jutsuMastery as Array<Record<string, unknown>>).map((row) => row.jutsuId),
            ['first-jutsu'],
            'the duplicate row cannot mint a second set of learned jutsu',
        );
    });
});

describe('carried-pet entitlement authority', () => {
    const pet = (index: number) => ({
        id: `pet-${index}`,
        hp: 20,
        attack: 20,
        defense: 20,
        speed: 20,
    });

    it('does not let an incoming forged Patreon flag raise a base account from five to six pets', () => {
        const incoming = wrap({
            name: 'PetCap',
            patreon: { active: true },
            pets: Array.from({ length: 6 }, (_, index) => pet(index + 1)),
        });
        const stored = wrap({ name: 'PetCap', patreon: { active: false }, pets: [] });
        const out = sanitizeCompatible(incoming, stored).character as Record<string, unknown>;

        assert.deepEqual(out.patreon, { active: false });
        assert.equal((out.pets as unknown[]).length, 5);
    });

    it('preserves an already-stored six-pet roster non-destructively after a supporter lapse', () => {
        const pets = Array.from({ length: 6 }, (_, index) => pet(index + 1));
        const stored = wrap({ name: 'PetLapse', patreon: { active: false }, pets });
        const out = sanitizeCompatible(stored, stored).character as Record<string, unknown>;

        assert.deepEqual(out.pets, pets);
    });

    it('preserves all six stored pets when a stale base client submits only four', () => {
        const pets = Array.from({ length: 6 }, (_, index) => pet(index + 1));
        const storedCharacter = {
            name: 'PetSubset',
            patreon: { active: false },
            activePetId: 'pet-1',
            activePetId2v2: 'pet-2',
            pets,
        };
        const out = sanitizeCompatible(
            wrap({ ...storedCharacter, pets: pets.slice(0, 4) }),
            wrap(storedCharacter),
        ).character as Record<string, unknown>;

        assert.deepEqual((out.pets as Array<{ id: string }>).map(({ id }) => id), pets.map(({ id }) => id));
    });

    it('preserves all six authoritative pets when a generic save omits the pets field', () => {
        const pets = Array.from({ length: 6 }, (_, index) => pet(index + 1));
        const storedCharacter = {
            name: 'PetOmitted',
            patreon: { active: false },
            activePetId: 'pet-1',
            activePetId2v2: 'pet-2',
            pets,
        };

        for (const sanitize of [sanitizeCompatible, sanitizeStrict]) {
            const out = sanitize(
                wrap({ name: storedCharacter.name }),
                wrap(storedCharacter),
            ).character as Record<string, unknown>;

            assert.deepEqual((out.pets as Array<{ id: string }>).map(({ id }) => id), pets.map(({ id }) => id));
            assert.equal(out.activePetId, 'pet-1');
            assert.equal(out.activePetId2v2, 'pet-2');
        }
    });

    it('does not let a generic save reorder or activate lapsed overflow', () => {
        const pets = Array.from({ length: 6 }, (_, index) => pet(index + 1));
        const storedCharacter = {
            name: 'PetReorder',
            patreon: { active: false },
            activePetId: 'pet-4',
            activePetId2v2: 'pet-3',
            pets,
        };
        const incomingCharacter = {
            ...storedCharacter,
            activePetId: 'pet-6',
            activePetId2v2: 'pet-5',
            pets: [...pets].reverse(),
        };
        const out = sanitizeCompatible(wrap(incomingCharacter), wrap(storedCharacter)).character as Record<string, unknown>;

        assert.deepEqual((out.pets as Array<{ id: string }>).map(({ id }) => id), pets.map(({ id }) => id));
        assert.equal(out.activePetId, 'pet-4');
        assert.equal(out.activePetId2v2, 'pet-5');
        assert.deepEqual(activeCarriedPetIds(out), ['pet-4', 'pet-5', 'pet-1', 'pet-2', 'pet-3']);
    });
});

describe('raw save server-ledger boundary', () => {
    it('pins every audited economic/progression field to the stored value', () => {
        const stored = {
            level: 20, xp: 42, ryo: 500, bankRyo: 900,
            honorSeals: 1, fateShards: 2, boneCharms: 3, auraStones: 4,
            auraDust: 5, mythicSeals: 6, hollowShards: 7,
            stats: { strength: 25, speed: 30 }, unspentStats: 8, totalStatsTrained: 444,
            maxHp: 2400, maxChakra: 3000, maxStamina: 3000,
            rankTitle: 'Genin', professionXp: 123, professionRank: 2,
            auraSphereLevel: 3, rankedRating: 1111, petRankedRating: 1222,
            levelLedgerMigrated: true,
        };
        const forged: Record<string, unknown> = Object.fromEntries(Object.keys(stored).map((key) => [key, 999_999]));
        forged.stats = { strength: 999_999, speed: 999_999 };

        const out = sanitizeStrict(wrap(forged), wrap(stored)).character as Record<string, unknown>;
        for (const [field, value] of Object.entries(stored)) {
            assert.deepEqual(out[field], value, `${field} must come from the stored ledger`);
        }
    });

    it('keeps bounded core progression writable until every reward path is server-settled', () => {
        const existing = wrap({
            level: 20, xp: 40, ryo: 500, bankRyo: 900,
            rankedRating: 1111, petRankedRating: 1222,
            profession: 'vanguard', professionXp: 123, professionRank: 2,
            stats: { strength: 20, speed: 20 }, unspentStats: 5,
            jutsuMastery: [{ jutsuId: 'known', level: 4, xp: 10 }],
            equippedJutsuIds: ['known'],
            inventory: ['sword'], itemStacks: [], pets: [], equipment: {},
        }, {
            activeTraining: { token: 'server-training', endsAt: 12345 },
            activeWandererQuestSeal: { id: 'wq-cull', baseline: 4, at: 10 },
            activeStoryReckoningSeal: { id: 'story-reckoning-mira-marker', stage: 'task', baseline: 8, at: 11 },
        });
        const incoming = wrap({
            level: 21, xp: 65, ryo: 575, bankRyo: 9_999_999,
            rankedRating: 9999, petRankedRating: 9999,
            profession: 'vanguard', professionXp: 999999, professionRank: 99,
            stats: { strength: 22, speed: 20 }, unspentStats: 3,
            jutsuMastery: [{ jutsuId: 'known', level: 4, xp: 30 }],
            equippedJutsuIds: ['known'],
            inventory: ['sword', 'story-loot'], itemStacks: [],
            pets: [{ id: 'story-pet', rarity: 'Common', hp: 10, attack: 10, defense: 10, speed: 10 }],
            equipment: {},
        }, { activeTraining: null });

        const result = sanitizeCompatible(incoming, existing);
        const out = result.character as Record<string, unknown>;
        // Stat-derived leveling: the client's level/xp writes are IGNORED —
        // xp is frozen from the stored save and level derives from the
        // validated stat ledger. The one-time migration tops the pool up to
        // cover the stored level (earnedForLevel(20) = 3,933; earned was
        // 22 allocated + 3 pool = 25 → +3,908 pool), so the derived level
        // lands exactly back on the stored 20 (also the genin exam hold).
        assert.equal(out.level, 20, 'client level writes are ignored; level derives from the ledger');
        assert.equal(out.xp, 40, 'xp is frozen from the stored save (retired currency)');
        assert.equal(out.levelLedgerMigrated, true, 'one-time ledger migration stamps the save');
        assert.equal(out.ryo, 500, 'generic saves cannot originate ryo, even within the old bounded gain window');
        assert.deepEqual(out.stats, { strength: 22, speed: 20 }, 'earned/allocated stats must persist');
        assert.equal(out.unspentStats, 3 + 3908, 'the spend persists and the migration top-up lands in the pool');
        assert.deepEqual(out.jutsuMastery, [{ jutsuId: 'known', level: 4, xp: 30 }], 'battle mastery must persist');
        assert.deepEqual(out.inventory, ['sword'], 'net-new items require an authoritative server write even before the wider strict cutover');
        assert.equal((out.pets as Array<Record<string, unknown>>)[0]?.id, 'story-pet', 'bounded pet progression must persist');
        assert.equal(out.bankRyo, 900, 'server bank balance stays locked');
        assert.equal(out.rankedRating, 1111, 'player rating stays locked');
        assert.equal(out.petRankedRating, 1222, 'pet rating stays locked');
        assert.equal(out.professionXp, 123, 'server-issued profession XP stays locked');
        assert.equal(out.professionRank, 2, 'derived profession rank stays locked');
        assert.deepEqual(result.activeTraining, { token: 'server-training', endsAt: 12345 }, 'top-level active training stays locked');
        assert.deepEqual(result.activeWandererQuestSeal, { id: 'wq-cull', baseline: 4, at: 10 }, 'wanderer claim authority stays locked');
        assert.deepEqual(result.activeStoryReckoningSeal, { id: 'story-reckoning-mira-marker', stage: 'task', baseline: 8, at: 11 }, 'story claim authority stays locked');
    });

    it('uses the exact canonical starter economy/loadout on first save', () => {
        const out = sanitizeCompatible(wrap({
            name: 'newbie', level: 100, xp: 9e9, ryo: 9e9, bankRyo: 9e9,
            bloodline: 'Ashen Eyes',
            fateShards: 999, honorSeals: 999, unspentStats: 999,
            stats: { strength: 999_999 },
            inventory: ['mythic-admin-blade'],
            itemStacks: [{ itemId: 'dungeon-key', count: 9999 }],
            jutsuMastery: [
                { jutsuId: 'ashen-eyes-blood-gaze', level: 50, xp: 999999 },
                { jutsuId: 'starter-nin-fire-1', level: 50, xp: 999999 },
                { jutsuId: '../../bad', level: 50 },
            ],
            equippedJutsuIds: ['ashen-eyes-blood-gaze', 'starter-nin-fire-1', '../../bad'],
            pets: [{ id: 'forged', attack: 999999 }],
            equipment: { hand: 'mythic-admin-blade' },
        }, { creatorItems: [{ id: 'forged-item', weaponEp: 999999 }] }), null);
        const char = out.character as Record<string, unknown>;

        assert.equal(char.level, 1);
        assert.equal(char.xp, 0);
        assert.equal(char.ryo, 100);
        assert.equal(char.bankRyo, 0);
        assert.equal(char.unspentStats, 20);
        assert.deepEqual(char.stats, {
            strength: 10, speed: 10, intelligence: 10, willpower: 10,
            bukijutsuOffense: 10, bukijutsuDefense: 10,
            taijutsuOffense: 10, taijutsuDefense: 10,
            genjutsuOffense: 10, genjutsuDefense: 10,
            ninjutsuOffense: 10, ninjutsuDefense: 10,
        });
        assert.deepEqual(char.inventory, ['rustfang-kunai', 'shinobi-vest']);
        assert.deepEqual(char.itemStacks, []);
        assert.deepEqual(char.jutsuMastery, [{ jutsuId: 'ashen-eyes-blood-gaze', level: 1, xp: 0 }]);
        assert.deepEqual(char.equippedJutsuIds, ['ashen-eyes-blood-gaze']);
        assert.deepEqual(char.pets, []);
        assert.deepEqual(char.equipment, {});
        assert.deepEqual(out.creatorItems, []);
    });

    it('permits consumption/re-equipping but rejects new inventory, pets, creator items, and unowned equipment', () => {
        const existing = wrap({
            inventory: ['sword'],
            itemStacks: [{ itemId: 'pill', count: 2 }],
            pets: [{ id: 'pet-1', attack: 10, name: 'Stored' }],
            activePetId: 'pet-1',
            equipment: { body: 'armor', item1: 'pill' },
        }, { creatorItems: [{ id: 'named-1', weaponEp: 50 }] });
        const incoming = wrap({
            inventory: ['armor', 'armor', 'forged-blade'],
            itemStacks: [{ itemId: 'pill', count: 999 }, { itemId: 'forged-stack', count: 5 }],
            pets: [{ id: 'pet-1', attack: 999999 }, { id: 'pet-2', attack: 999999 }],
            activePetId: 'pet-2',
            equipment: { hand: 'sword', body: 'armor', item1: 'pill', item2: 'pill', head: 'forged-blade' },
        }, { creatorItems: [{ id: 'named-1', weaponEp: 999999 }, { id: 'forged', weaponEp: 999999 }] });

        const out = sanitizeStrict(incoming, existing);
        const char = out.character as Record<string, unknown>;
        assert.deepEqual(char.inventory, ['armor']);
        assert.deepEqual(char.itemStacks, [{ itemId: 'pill', count: 2 }]);
        assert.deepEqual(char.pets, [{ id: 'pet-1', attack: 10, name: 'Stored' }]);
        assert.equal(char.activePetId, 'pet-1');
        assert.deepEqual(char.equipment, { hand: 'sword', item1: 'pill' });
        assert.deepEqual(out.creatorItems, [{ id: 'named-1', weaponEp: 50 }]);
    });

    it('pins payout and idempotency state against clear/decrease/replacement tampering', () => {
        const stored = {
            lastBankInterestAt: 1000,
            lastLoginRewardDate: '2026-07-10', loginStreak: 4,
            academyChecklistClaimed: true, academyTrialClaimed: true,
            cardClashDailyWinDate: '2026-07-10',
            claimedWarCrateIds: ['war-1'],
            claimedVillageAgendaDate: '2026-07-10', claimedMapControlDate: '2026-07-10',
            lastExpeditionClaimDate: '2026-07-10', expeditionsClaimedToday: 3,
            dailyHonorSealsEarned: 20, dailyHonorSealsByTarget: { bob: 5 },
            vanguardDailyResetDate: '2026-07-10',
            dailyDonatedSeals: 10, dailyDonationDate: '2026-07-10',
        };
        const cleared: Record<string, unknown> = Object.fromEntries(Object.keys(stored).map((key) => [key, null]));
        cleared.claimedWarCrateIds = [];
        cleared.dailyHonorSealsByTarget = {};

        const out = sanitizeCompatible(wrap(cleared), wrap(stored)).character as Record<string, unknown>;
        for (const [field, value] of Object.entries(stored)) {
            assert.deepEqual(out[field], value, `${field} latch must not be client mutable`);
        }
    });

    it('pins jutsu mastery power while allowing only learned loadout ids', () => {
        const out = sanitizeStrict(
            wrap({
                jutsuMastery: [
                    { jutsuId: 'known', level: 50, xp: 999999 },
                    { jutsuId: 'forged', level: 50, xp: 999999 },
                ],
                equippedJutsuIds: ['known', 'forged'],
            }),
            wrap({
                jutsuMastery: [{ jutsuId: 'known', level: 4, xp: 12 }],
                equippedJutsuIds: ['known'],
            }),
        );
        const char = out.character as Record<string, unknown>;
        assert.deepEqual(char.jutsuMastery, [{ jutsuId: 'known', level: 4, xp: 12 }]);
        assert.deepEqual(char.equippedJutsuIds, ['known']);
    });

    it('allows exact stat-point allocation from the stored unspent pool', () => {
        const out = sanitizeStrict(
            wrap({
                level: 20,
                stats: { strength: 13, speed: 12 },
                unspentStats: 0,
            }),
            wrap({
                level: 20,
                stats: { strength: 10, speed: 10 },
                unspentStats: 5,
                levelLedgerMigrated: true,
            }),
        );
        const char = out.character as Record<string, unknown>;
        assert.deepEqual(char.stats, { strength: 13, speed: 12 });
        assert.equal(char.unspentStats, 0);
    });

    it('rejects stat growth unless the same request spends stored points', () => {
        const out = sanitizeStrict(
            wrap({
                level: 20,
                stats: { strength: 15, speed: 15 },
                unspentStats: 5,
            }),
            wrap({
                level: 20,
                stats: { strength: 10, speed: 10 },
                unspentStats: 5,
                levelLedgerMigrated: true,
            }),
        );
        const char = out.character as Record<string, unknown>;
        assert.deepEqual(char.stats, { strength: 10, speed: 10 });
        assert.equal(char.unspentStats, 5);
    });

    it('applies only the available known-stat budget and preserves unknown stored fields', () => {
        const out = sanitizeStrict(
            wrap({
                level: 1,
                stats: { strength: 999_999, speed: 999_999, internalPower: 999_999, forgedStat: 999_999 },
                unspentStats: 0,
            }),
            wrap({
                level: 1,
                stats: { strength: 349, speed: 10, internalPower: 7 },
                unspentStats: 5,
            }),
        );
        const char = out.character as Record<string, unknown>;
        assert.deepEqual(char.stats, { strength: 350, speed: 14, internalPower: 7 });
        assert.equal(char.unspentStats, 0);
    });

    it('does not burn unspent points when requested growth cannot be applied', () => {
        const out = sanitizeStrict(
            wrap({ level: 1, stats: { strength: 10 }, unspentStats: 0 }),
            wrap({ level: 1, stats: { strength: 10 }, unspentStats: 5 }),
        );
        const char = out.character as Record<string, unknown>;
        assert.deepEqual(char.stats, { strength: 10 });
        assert.equal(char.unspentStats, 5);
    });

    it('pins trusted top-level receipt ledgers', () => {
        const storedReceipts = ['training-1'];
        const out = sanitizeCompatible(
            wrap({}, { _trainingReceipts: [] }),
            wrap({}, { _trainingReceipts: storedReceipts }),
        );
        assert.deepEqual(out._trainingReceipts, storedReceipts);

        const minted = sanitizeCompatible(wrap({}, { _trainingReceipts: ['forged'] }), wrap({}));
        assert.equal('_trainingReceipts' in minted, false);
    });

    it('prevents player saves from creating admin content catalogs', () => {
        const storedJutsus = [{ id: 'admin-jutsu', effectPower: 40 }];
        const out = sanitizeCompatible(
            wrap({}, { creatorJutsus: [{ id: 'forged', effectPower: 999999 }], creatorCards: [{ id: 'forged-card' }] }),
            wrap({}, { creatorJutsus: storedJutsus }),
        );
        assert.deepEqual(out.creatorJutsus, storedJutsus);
        assert.equal('creatorCards' in out, false);
    });
});

describe('save-route admin capability boundary', () => {
    it('allows full admin for every target', () => {
        assert.equal(adminSaveTargetAllowed('alice', true, true), true);
        assert.equal(adminSaveTargetAllowed('clan-leaf', true, true), true);
    });

    it('limits content admin to explicit admin content records', () => {
        assert.equal(adminSaveTargetAllowed('admin1', false, true), true);
        assert.equal(adminSaveTargetAllowed('admin2', false, true), true);
        assert.equal(adminSaveTargetAllowed('alice', false, true), false);
        assert.equal(adminSaveTargetAllowed('clan-leaf', false, true), false);
    });

    it('rejects unauthenticated callers', () => {
        assert.equal(adminSaveTargetAllowed('admin2', false, false), false);
    });
});

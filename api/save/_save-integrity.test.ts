import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { adminSaveTargetAllowed, sanitizeCharacterSave } from './[name].js';
import {
    CHRONICLE_FIXED_FALLBACK_DECK,
    CHRONICLE_RULES_VERSION,
} from '../../shared/chronicle-duel.js';

const wrap = (character: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...extra, character });

function withStrictLedger<T>(enabled: boolean, run: () => T): T {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    if (enabled) process.env.STRICT_RAW_SAVE_LEDGER = '1';
    else delete process.env.STRICT_RAW_SAVE_LEDGER;
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

describe('Chronicle Duel save validation', () => {
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
        assert.equal(out.level, 21, 'normal level-up must persist');
        assert.equal(out.xp, 65, 'AI/story XP must persist');
        assert.equal(out.ryo, 575, 'bounded PvE ryo must persist');
        assert.deepEqual(out.stats, { strength: 22, speed: 20 }, 'earned/allocated stats must persist');
        assert.equal(out.unspentStats, 3, 'level-up allocation pool must persist');
        assert.deepEqual(out.jutsuMastery, [{ jutsuId: 'known', level: 4, xp: 30 }], 'battle mastery must persist');
        assert.deepEqual(out.inventory, ['sword', 'story-loot'], 'world loot must persist');
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

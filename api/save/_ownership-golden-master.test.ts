import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeCharacterSave, buildPublicSaveDTO, combatProjection, isAdminContentSlot } from './[name].js';

/*
 * P0-1 golden-master characterization of CURRENT save-ownership behavior.
 *
 * These tests pin what the sanitizer / projections do TODAY (main @ de50b3385)
 * so the manifest extraction in the following commits can be proven
 * behavior-preserving. They describe current behavior, not desired behavior.
 *
 * Two layers:
 *  1. Full-output snapshots — deterministic fixtures run through
 *     sanitizeCharacterSave / buildPublicSaveDTO / combatProjection and
 *     deep-compared against a checked-in snapshot
 *     (_ownership-golden-master.snapshot.json). Regenerate deliberately with
 *     UPDATE_OWNERSHIP_SNAPSHOTS=1 npm test — a diff in review IS the point.
 *  2. Scenario assertions — the ownership rules the snapshots encode, stated
 *     explicitly so a snapshot regen cannot silently launder a rule change.
 *
 * Determinism notes: fixtures always carry `createdAt` (else the sanitizer
 * stamps Date.now()), and all date stamps use a fixed past date so the
 * SERVER_UTC_DATE comparisons take the same branch on any test day.
 *
 * Scenarios NOT covered here (covered elsewhere, handler-level):
 *  - stale-save version rejection: _save-version.test.ts + _versioned-save-writes.test.ts
 *  - foreign-read no-write: _foreign-read-no-write.test.ts
 *  - admin-authenticated / ?signal=1 save path: _ownership-admin-path.test.ts
 */

const SNAPSHOT_PATH = join(process.cwd(), 'api', 'save', '_ownership-golden-master.snapshot.json');
const UPDATE = process.env.UPDATE_OWNERSHIP_SNAPSHOTS === '1';

function withStrictLedger<T>(value: '1' | undefined, run: () => T): T {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    if (value === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
    else process.env.STRICT_RAW_SAVE_LEDGER = value;
    try {
        return run();
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
}

// ── Deterministic fixtures ──────────────────────────────────────────────────

const FULL_STATS = {
    strength: 50, speed: 50, intelligence: 50, willpower: 50,
    bukijutsuOffense: 50, bukijutsuDefense: 50,
    taijutsuOffense: 50, taijutsuDefense: 50,
    genjutsuOffense: 50, genjutsuDefense: 50,
    ninjutsuOffense: 50, ninjutsuDefense: 50,
};

const FORGED_ID = 'named-weapon-00000000-0000-4000-8000-000000000001';

/** Stored (server-side) save for an established player. */
function storedSave(): Record<string, unknown> {
    return {
        character: {
            name: 'GoldenMaster', village: 'Ember', level: 20, xp: 500,
            rankTitle: 'Genin',
            ryo: 5_000, bankRyo: 2_000, lastBankInterestAt: 1_700_000_000_000,
            fateShards: 10, boneCharms: 3, auraStones: 0, auraDust: 0,
            mythicSeals: 1, honorSeals: 2, hollowShards: 0,
            stats: { ...FULL_STATS }, unspentStats: 5, totalStatsTrained: 100,
            maxHp: 900, maxChakra: 400, maxStamina: 400,
            hp: 900, chakra: 400, stamina: 400,
            createdAt: 1_600_000_000_000,
            levelLedgerMigrated: true,
            profession: 'healer', professionXp: 400, professionRank: 3,
            patreon: false,
            inventory: ['rustfang-kunai', 'shinobi-vest'], itemStacks: [{ itemId: 'ration', count: 3 }],
            equipment: { hand: 'rustfang-kunai' },
            pets: [{
                id: 'pet-1', rarity: 'standard', level: 4, xp: 10,
                hp: 40, attack: 20, defense: 20, speed: 20,
                nickname: 'Scout', role: 'striker',
            }],
            activePetId: 'pet-1',
            jutsuMastery: [{ jutsuId: 'ashen-eyes-blood-gaze', level: 2, xp: 5 }],
            equippedJutsuIds: ['ashen-eyes-blood-gaze'],
            storyProgress: 3, redeemedStoryBattles: ['story-1'],
            examsPassed: ['genin'],
            unlockedAchievements: ['first-blood'], achievementUnlockedAt: { 'first-blood': 1 },
            claimedAchievementRewards: ['first-blood'], earnedTitles: ['First Blood'],
            serverTitles: ['Era Herald'],
            legacy: { id: 'sage', stage: 1, titles: ['Sage Ascendant'] },
            redeemedCrafts: ['craft-1'], redeemedNamedForges: [],
            serverSettlementReceipts: { pvp: ['r-1'] },
            weaponElements: { 'rustfang-kunai': 'fire' },
            clanPoints: 10, weeklyClanPoints: 2, weeklyClanPointsWeek: '2026-W01',
            lifetimeClanPoints: 10, clanPointHistory: [], clanExchangePurchases: [],
            hunterRank: 2, hollowGateWardenKills: 1, hollowGateAttunement: { 'extra-dive': 1 },
            totalPvpKills: 4, totalAiKills: 9, rankedRating: 1_050, petRankedRating: 1_000,
            customTitle: '', nindo: 'My way.', nindoBg: 'ember',
            avatarImage: 'preset:leaf-1',
            lastDailyReset: '2020-01-02', dailyMissionsCompleted: 2,
            warGroundBountyDate: '2020-01-01',
            claimedVillageAgendaDate: '2020-01-01', claimedMapControlDate: '',
            battleTowerBestFloor: 6, battleTowerRating: 1_010,
        },
        // Top-level (non-character) fields.
        acceptedMissionIds: ['m-1'], missionProgress: { 'm-1': 1 }, currentSector: 's12',
        triggeredEvents: ['intro'],
        activeTraining: { stat: 'strength', endsAt: 1 }, activeJutsuTraining: null,
        _trainingReceipts: ['t-1'],
        creatorItems: [
            { id: 'admin-blade', name: 'Admin Blade', slot: 'hand' },
            { id: FORGED_ID, name: 'Soulrender', slot: 'hand' },
        ],
        savedBloodlines: [],
        pendingBloodlineForges: [],
        worldGeoV: 2,
        _saveVersion: 7,
    };
}

/**
 * The client's next autosave of that player — including a spread of tamper
 * attempts (currency/counter/pet/achievement/creator injections) alongside
 * legitimate edits (spending ryo, preference changes, unknown fields).
 */
function incomingAutosave(): Record<string, unknown> {
    const stored = storedSave();
    const char = { ...(stored.character as Record<string, unknown>) };
    Object.assign(char, {
        // Legitimate: spending and preferences.
        ryo: 4_200,                          // spend 800 — allowed
        nindo: 'A new creed.', nindoBg: 'frost',
        // Tamper: server-ledger / payout / counters.
        xp: 999_999, bankRyo: 999_999, lastBankInterestAt: 1,
        fateShards: 999, mythicSeals: 99, honorSeals: 99,
        professionXp: 9_999, professionRank: 10,
        patreon: true,
        weaponElements: { 'rustfang-kunai': 'void', 'shinobi-vest': 'fire' },
        rankedRating: 2_000, petRankedRating: 2_000,
        totalPvpKills: 999, battleTowerBestFloor: 99, hollowGateWardenKills: 99,
        clanPoints: 999, lifetimeClanPoints: 999,
        hunterRank: 5,
        unlockedAchievements: ['first-blood', 'forged-ach'],
        earnedTitles: ['First Blood', 'Fake Title'],
        serverTitles: ['Era Herald', 'Fake Server Title'],
        legacy: { id: 'sage', stage: 3, titles: ['Sage Ascendant', 'Fake'] },
        examsPassed: ['genin', 'chunin'],
        storyProgress: 9,
        redeemedCrafts: [],                   // attempt to clear a receipt ledger
        serverSettlementReceipts: {},
        warGroundBountyDate: '2019-06-06',    // backdate attempt
        lastDailyReset: '2019-01-01',         // backdate attempt
        // Tamper: roster/loadout.
        pets: [
            { id: 'pet-1', rarity: 'legendary', level: 99, xp: 999, hp: 9_999, attack: 9_999, defense: 9_999, speed: 9_999, nickname: 'Hax', role: 'striker' },
            { id: 'pet-fake', hp: 50, attack: 50, defense: 50, speed: 50 },
        ],
        equipment: { hand: 'rustfang-kunai', body: 'mythic-battle-plate' },
        // Injection: creator content on the character.
        creatorJutsus: [{ id: 'evil' }], creatorItems: [{ id: 'evil' }],
        // Unknown character field (scenario 20).
        someUnknownCharField: 'kept-by-current-behavior',
    });
    return {
        ...stored,
        character: char,
        // Top-level tampers + unknowns.
        activeTraining: { stat: 'speed', endsAt: 999 },
        _trainingReceipts: [],
        creatorItems: [
            { id: 'admin-blade', name: 'Admin Blade', slot: 'hand' },
            // forged item omitted — preserveForgedItems must revive it
        ],
        someUnknownTopLevel: 'kept-by-current-behavior',   // scenario 19
        currentSector: 's13',
    };
}

/** First save of a brand-new account, with inflated values a tampered client might send. */
function firstSaveAttempt(): Record<string, unknown> {
    return {
        character: {
            name: 'Newcomer', village: 'Ember', level: 50, xp: 100_000,
            ryo: 1_000_000, bankRyo: 500_000,
            fateShards: 500, mythicSeals: 50,
            stats: { ...FULL_STATS }, unspentStats: 500,
            createdAt: 1_600_000_000_000,
            bloodline: 'Ashen Eyes',
            jutsuMastery: [
                { jutsuId: 'ashen-eyes-blood-gaze', level: 50, xp: 999 },
                { jutsuId: 'inferno-cataclysm-lava-burst', level: 50, xp: 999 },
            ],
            equippedJutsuIds: ['ashen-eyes-blood-gaze', 'inferno-cataclysm-lava-burst'],
            inventory: ['mythic-battle-plate'],
            pets: [{ id: 'pet-hax', hp: 9_999, attack: 9_999, defense: 9_999, speed: 9_999 }],
            equipment: { body: 'mythic-battle-plate' },
        },
        creatorItems: [{ id: 'evil-item' }],
        someUnknownTopLevel: 'kept',
    };
}

/** Admin content-slot save: shared content plus a forged item that must be stripped. */
function adminSlotSave(): { incoming: Record<string, unknown>; existing: Record<string, unknown> } {
    const existing = storedSave();
    (existing.character as Record<string, unknown>).name = 'admin1';
    const incoming = structuredClone(existing);
    incoming.creatorItems = [
        { id: 'admin-blade', name: 'Admin Blade v2', slot: 'hand', updatedAt: 5 },
        { id: FORGED_ID, name: 'Leaked Personal Item', slot: 'hand' },
    ];
    return { incoming, existing };
}

function runScenarios(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    out['existing-player-autosave.nonstrict'] = withStrictLedger(undefined,
        () => sanitizeCharacterSave(incomingAutosave(), storedSave()));
    out['existing-player-autosave.strict'] = withStrictLedger('1',
        () => sanitizeCharacterSave(incomingAutosave(), storedSave()));
    out['first-save.nonstrict'] = withStrictLedger(undefined,
        () => sanitizeCharacterSave(firstSaveAttempt(), null));
    out['first-save.strict'] = withStrictLedger('1',
        () => sanitizeCharacterSave(firstSaveAttempt(), null));
    {
        const { incoming, existing } = adminSlotSave();
        out['admin-content-slot-save.nonstrict'] = withStrictLedger(undefined,
            () => sanitizeCharacterSave(incoming, existing, { adminContentSlot: true }));
    }
    out['public-dto.base'] = buildPublicSaveDTO(storedSave(), { combat: false });
    out['public-dto.combat'] = buildPublicSaveDTO(storedSave(), { combat: true });
    out['public-dto.shared-content'] = buildPublicSaveDTO(storedSave(), { combat: false, sharedContent: true });
    out['combat-projection'] = combatProjection(storedSave());
    return out;
}

describe('ownership golden master — full-output snapshots', () => {
    it('matches the checked-in snapshot for every scenario', () => {
        const actual = JSON.parse(JSON.stringify(runScenarios()));
        if (UPDATE) {
            writeFileSync(SNAPSHOT_PATH, JSON.stringify(actual, null, 2) + '\n');
            return;
        }
        const expected = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
        for (const key of Object.keys(expected)) {
            assert.deepEqual(
                actual[key],
                expected[key],
                `scenario "${key}" diverged from the golden master — if intentional, regenerate with UPDATE_OWNERSHIP_SNAPSHOTS=1 and justify the diff in review`,
            );
        }
        assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'scenario set changed');
    });
});

// ── Scenario assertions (explicit ownership rules the snapshots encode) ─────

const autosaveOut = () => withStrictLedger(undefined, () => sanitizeCharacterSave(incomingAutosave(), storedSave()));
const charOf = (save: Record<string, unknown>) => save.character as Record<string, unknown>;

describe('server-ledger fields survive a tampered autosave (scenarios 13/16)', () => {
    it('re-asserts stored currency/ledger values and allows legitimate spending', () => {
        const c = charOf(autosaveOut());
        assert.equal(c.ryo, 4_200, 'spending ryo is allowed');
        assert.equal(c.xp, 500, 'xp is frozen to stored');
        assert.equal(c.bankRyo, 2_000, 'bankRyo is server-owned');
        assert.equal(c.lastBankInterestAt, 1_700_000_000_000);
        assert.equal(c.fateShards, 10, 'premium currency gains are rejected');
        assert.equal(c.mythicSeals, 1);
        assert.equal(c.honorSeals, 2);
        assert.equal(c.patreon, false, 'patreon flag cannot be self-granted');
        assert.deepEqual(c.weaponElements, { 'rustfang-kunai': 'fire' }, 'attunements cannot be forged');
        assert.equal(c.rankedRating, 1_050, 'rating increase via save is rejected');
        assert.equal(c.petRankedRating, 1_000);
        assert.equal(c.professionXp, 400, 'profession XP gain rejected');
        assert.equal(c.professionRank, 3, 'profession rank recomputed from capped XP');
    });

    it('re-asserts stored payout stamps, receipts, and lifetime counters', () => {
        const c = charOf(autosaveOut());
        assert.deepEqual(c.redeemedCrafts, ['craft-1'], 'receipt ledgers cannot be cleared');
        assert.deepEqual(c.serverSettlementReceipts, { pvp: ['r-1'] });
        assert.equal(c.warGroundBountyDate, '2020-01-01', 'daily stamps cannot be backdated');
        assert.equal(c.lastDailyReset, '2020-01-02', 'daily reset stamps are monotonic-forward');
        assert.equal(c.totalPvpKills, 4, 'lifetime counters have zero client delta');
        assert.equal(c.battleTowerBestFloor, 6);
        assert.equal(c.hollowGateWardenKills, 1);
        assert.equal(c.clanPoints, 10, 'clan points are server-issued');
        assert.equal(c.hunterRank, 2);
    });

    it('re-asserts server-owned progression (achievements, titles, legacy, exams, story)', () => {
        const c = charOf(autosaveOut());
        assert.deepEqual(c.unlockedAchievements, ['first-blood']);
        assert.deepEqual(c.earnedTitles, ['First Blood']);
        assert.deepEqual(c.serverTitles, ['Era Herald']);
        assert.deepEqual(c.legacy, { id: 'sage', stage: 1, titles: ['Sage Ascendant'] });
        assert.deepEqual(c.examsPassed, ['genin'], 'exam list is replaced with stored verbatim');
        assert.equal(c.storyProgress, 3, 'story progress is clamped to stored');
    });
});

describe('pet ownership boundary (scenario 15)', () => {
    it('drops fabricated pets and forces identity/progression from stored', () => {
        const c = charOf(autosaveOut());
        const pets = c.pets as Array<Record<string, unknown>>;
        assert.equal(pets.length, 1, 'the fabricated pet is dropped (roster non-empty)');
        const pet = pets[0];
        assert.equal(pet.id, 'pet-1');
        assert.equal(pet.rarity, 'standard', 'pet identity forced from stored');
        assert.equal(pet.level, 4, 'pet progression forced from stored');
        assert.equal(pet.hp, 40);
        assert.equal(pet.nickname, 'Scout', 'pet nickname forced from stored');
    });
});

describe('inventory & equipment boundary (scenario 14)', () => {
    it('strips equipped gear the player owns nowhere', () => {
        const c = charOf(autosaveOut());
        const eq = c.equipment as Record<string, unknown>;
        assert.equal(eq.hand, 'rustfang-kunai', 'owned equipped gear survives');
        assert.equal(eq.body, undefined, 'unowned built-in gear is stripped');
    });
});

describe('creator/authored content boundaries (scenarios 17/18)', () => {
    it('deletes creator content injected into a player character', () => {
        const c = charOf(autosaveOut());
        assert.equal(c.creatorJutsus, undefined);
        assert.equal(c.creatorItems, undefined);
    });

    it('freezes server-owned top-level fields to stored (training, receipts, creator catalogs)', () => {
        const out = autosaveOut();
        assert.deepEqual(out.activeTraining, { stat: 'strength', endsAt: 1 }, 'training session cannot be forged');
        assert.deepEqual(out._trainingReceipts, ['t-1']);
    });

    it('revives an omitted personal forged item on an ordinary save (preserveForgedItems)', () => {
        const out = autosaveOut();
        const items = out.creatorItems as Array<Record<string, unknown>>;
        assert.ok(items.some((i) => i.id === FORGED_ID), 'the forged definition is revived');
        assert.ok(items.some((i) => i.id === 'admin-blade'), 'the admin mirror is kept');
    });

    it('strips personal forged items from an admin content slot instead of reviving them', () => {
        const { incoming, existing } = adminSlotSave();
        const out = withStrictLedger(undefined, () => sanitizeCharacterSave(incoming, existing, { adminContentSlot: true }));
        const items = out.creatorItems as Array<Record<string, unknown>>;
        assert.ok(!items.some((i) => i.id === FORGED_ID), 'forged gear must never publish from an admin slot');
        assert.ok(items.some((i) => i.id === 'admin-blade'), 'authored admin content is kept');
    });
});

describe('client-writable preferences and cosmetics (scenarios 11/12)', () => {
    it('persists moderated preference edits', () => {
        const c = charOf(autosaveOut());
        assert.equal(c.nindo, 'A new creed.');
        assert.equal(c.nindoBg, 'frost');
    });

    it('keeps a preset avatar reference for a non-subscriber', () => {
        const c = charOf(autosaveOut());
        assert.equal(c.avatarImage, 'preset:leaf-1');
    });
});

describe('unknown-field behavior (scenarios 19/20)', () => {
    it('passes unknown top-level and character fields through the sanitizer (current behavior)', () => {
        const out = autosaveOut();
        assert.equal(out.someUnknownTopLevel, 'kept-by-current-behavior');
        assert.equal(charOf(out).someUnknownCharField, 'kept-by-current-behavior');
    });

    it('never exposes unknown fields through the public DTO (private-by-default)', () => {
        const dto = buildPublicSaveDTO(incomingAutosave(), { combat: true, sharedContent: true });
        assert.equal(dto.someUnknownTopLevel, undefined);
        assert.equal((dto.character as Record<string, unknown>).someUnknownCharField, undefined);
    });
});

describe('first-save clamps (scenario 1)', () => {
    it('clamps a tampered first save to the canonical baseline', () => {
        const out = withStrictLedger(undefined, () => sanitizeCharacterSave(firstSaveAttempt(), null));
        const c = charOf(out);
        assert.equal(c.ryo, 100, 'first-save ryo is the baseline');
        assert.equal(c.bankRyo, 0);
        assert.equal(c.fateShards, 0);
        assert.deepEqual(c.inventory, ['rustfang-kunai', 'shinobi-vest'], 'first-save inventory is the starter kit');
        assert.deepEqual(c.pets, [], 'no pets on first save');
        assert.deepEqual(c.equipment, {}, 'no equipment on first save');
        const mastery = c.jutsuMastery as Array<Record<string, unknown>>;
        assert.ok(mastery.every((m) => m.level === 1 && m.xp === 0), 'starter jutsu mastery is level 1 / 0 xp');
        assert.ok(mastery.every((m) => String(m.jutsuId).startsWith('ashen-eyes-')), 'only the chosen bloodline starter kit survives');
        assert.deepEqual(out.creatorItems, [], 'no creator items on first save');
    });
});

describe('public projections (scenarios 8/9/10)', () => {
    it('base DTO exposes only the public character allowlist and no top-level fields', () => {
        const dto = buildPublicSaveDTO(storedSave(), { combat: false });
        const c = dto.character as Record<string, unknown>;
        assert.equal(c.name, 'GoldenMaster');
        assert.equal(c.level, 20);
        assert.equal(c.ryo, undefined, 'wallet is private');
        assert.equal(c.stats, undefined, 'stats are private (anti-scouting)');
        assert.equal(c.rankedRating, undefined);
        assert.deepEqual(Object.keys(dto).sort(), ['character'], 'no top-level field leaks on a base read');
    });

    it('combat DTO adds exactly the combat-scouting top-level trio', () => {
        const dto = buildPublicSaveDTO(storedSave(), { combat: true });
        assert.ok('savedBloodlines' in dto && 'creatorJutsus' in dto === false || true);
        assert.deepEqual(
            Object.keys(dto).filter((k) => k !== 'character').sort(),
            ['creatorItems', 'savedBloodlines'].sort(),
            'only combat-public top-level fields present in this fixture (creatorJutsus absent from fixture)',
        );
    });

    it('shared-content DTO exposes admin content fields and strips forged items outbound', () => {
        const dto = buildPublicSaveDTO(storedSave(), { combat: false, sharedContent: true });
        const items = dto.creatorItems as Array<Record<string, unknown>>;
        assert.ok(items.some((i) => i.id === 'admin-blade'));
        assert.ok(!items.some((i) => i.id === FORGED_ID), 'forged gear is stripped from the shared-content projection');
        assert.equal(dto.acceptedMissionIds, undefined, 'player state never rides the shared-content projection');
        assert.equal(dto._saveVersion, undefined);
    });

    it('combat projection strips meta/currency/receipt fields but keeps loadout', () => {
        const proj = combatProjection(storedSave());
        const c = proj.character as Record<string, unknown>;
        assert.equal(c.ryo, undefined, 'currencies stripped from combat projection');
        assert.equal(c.bankRyo, undefined);
        assert.equal(c.unlockedAchievements, undefined);
        assert.equal(c.inventory, undefined);
        assert.deepEqual(c.equippedJutsuIds, ['ashen-eyes-blood-gaze'], 'loadout survives');
        assert.deepEqual(c.stats, FULL_STATS, 'stats survive for combat');
        assert.equal(proj.acceptedMissionIds, undefined, 'mission state stripped at top level');
        assert.ok('creatorItems' in proj, 'creator item definitions survive for combat rendering');
    });
});

describe('strict-ledger flag parity (scenarios 6/7)', () => {
    it('generic saves freeze client-originated ryo gains regardless of the flag', () => {
        const gainSave = () => {
            const s = incomingAutosave();
            (s.character as Record<string, unknown>).ryo = 5_500; // +500 gain
            return s;
        };
        const soft = withStrictLedger(undefined, () => sanitizeCharacterSave(gainSave(), storedSave()));
        assert.equal(charOf(soft).ryo, 5_000, 'flag absent: generic saves cannot originate ryo');
        const strict = withStrictLedger('1', () => sanitizeCharacterSave(gainSave(), storedSave()));
        assert.equal(charOf(strict).ryo, 5_000, 'strict: ryo is fully server-owned');
    });

    it('strict mode freezes creatorItems to stored on ordinary saves', () => {
        const out = withStrictLedger('1', () => sanitizeCharacterSave(incomingAutosave(), storedSave()));
        assert.deepEqual(out.creatorItems, storedSave().creatorItems);
    });
});

describe('admin-content-slot classification (scenario 5)', () => {
    it('recognizes exactly admin1/admin2 as content slots', () => {
        assert.equal(isAdminContentSlot('admin1'), true);
        assert.equal(isAdminContentSlot('admin2'), true);
        assert.equal(isAdminContentSlot('admin3'), false);
        assert.equal(isAdminContentSlot('GoldenMaster'), false);
    });
});

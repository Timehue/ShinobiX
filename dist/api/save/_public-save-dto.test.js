"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
// Regression for the non-owner save-projection leak: the old projection
// allowlisted the `character` sub-object but spread the entire top-level save
// into the response, leaking every root-level field (savedBloodlines, creator
// content, training/mission state, current sector, triggered events, internal
// _-metadata, and any field added later) to any logged-in player. The fix is an
// explicit ROOT + CHARACTER allowlist that is PRIVATE BY DEFAULT.
// A save salted with sentinels in every place a secret could hide.
function sentinelSave() {
    return {
        character: {
            // Public-safe fields (should survive).
            name: 'Rival', level: 42, village: 'Leaf', rank: 'Jonin',
            avatarImage: 'data:image/png;base64,AAAA', specialty: 'Ninjutsu', storyProgress: 3,
            hp: 900, maxHp: 1000, chakra: 50, maxChakra: 100, stamina: 40, maxStamina: 80,
            customTitle: 'Wanderer', hospitalized: false, hospitalizedUntil: 0,
            profession: 'healer', professionRank: 4, professionXp: 1200,
            // Private character fields (must NOT survive).
            ryo: 999999, bankRyo: 555, inventory: ['secret-item'], itemStacks: [{ itemId: 'x', count: 9 }],
            stats: { strength: 2500, ninjutsuOffense: 2500 },
            jutsu: [{ id: 'secret-jutsu', effectPower: 50 }],
            equipment: { hand: 'legendary-blade' },
            equippedJutsuIds: ['secret-jutsu'],
            bloodlineMult: 3, itemDamagePct: 200,
            missions: ['secret-mission'], missionLog: ['log'], completedMissions: ['m1'],
            clanPoints: 5000, weeklyClanPoints: 100,
            fateShards: 77, honorSeals: 88, auraDust: 99,
            rankedRating: 1850, petRankedRating: 1700,
            futureSecretCharField: 'LEAK_CHAR_FUTURE',
        },
        // Top-level private fields (must NOT survive on a base read).
        savedBloodlines: [{ name: 'Secret Bloodline', jutsus: [{ id: 'bl-jutsu', effectPower: 50 }] }],
        creatorJutsus: [{ id: 'my-secret-jutsu' }],
        creatorItems: [{ id: 'my-secret-item' }],
        creatorAis: [{ id: 'my-private-ai' }],
        creatorEvents: [{ id: 'ev' }], creatorMissions: [{ id: 'mi' }],
        creatorRaids: [{ id: 'ra' }], creatorCards: [{ id: 'ca' }],
        activeTraining: { stat: 'strength', endsAt: 123 },
        activeJutsuTraining: { jutsuId: 'x' },
        missionProgress: { m1: 3 }, acceptedMissionIds: ['m1'],
        triggeredEvents: ['ev1'], currentSector: 17, currentBiome: 'volcano',
        pendingAiProfileId: 'ai-1',
        _saveVersion: 88, _saveAt: 1700000000, _trainingReceipts: ['r1'],
        // A property nobody has invented yet — must be private by default.
        futureSecretSentinel: 'LEAK_TOPLEVEL_FUTURE',
    };
}
const PUBLIC_CHAR_KEYS = new Set([
    'name', 'level', 'village', 'rank', 'avatarImage', 'specialty', 'storyProgress',
    'hp', 'maxHp', 'chakra', 'maxChakra', 'stamina', 'maxStamina',
    'customTitle', 'hospitalized', 'hospitalizedUntil',
    'profession', 'professionRank', 'professionXp',
]);
(0, node_test_1.describe)('buildPublicSaveDTO — non-owner allowlist', () => {
    (0, node_test_1.it)('base read exposes ONLY the public character allowlist and no top-level fields', () => {
        const dto = (0, _name__js_1.buildPublicSaveDTO)(sentinelSave(), { combat: false });
        // Exactly two shapes: a `character` object and nothing else at the root.
        strict_1.default.deepEqual(Object.keys(dto), ['character']);
        const char = dto.character;
        for (const k of Object.keys(char)) {
            strict_1.default.ok(PUBLIC_CHAR_KEYS.has(k), `leaked private character field "${k}"`);
        }
        // Public fields present and correct.
        strict_1.default.equal(char.name, 'Rival');
        strict_1.default.equal(char.level, 42);
        strict_1.default.equal(char.professionRank, 4);
        // Private character fields gone.
        for (const k of ['ryo', 'bankRyo', 'inventory', 'stats', 'jutsu', 'equipment',
            'equippedJutsuIds', 'bloodlineMult', 'missions', 'clanPoints', 'fateShards',
            'rankedRating', 'futureSecretCharField']) {
            strict_1.default.ok(!(k in char), `private character field "${k}" leaked`);
        }
    });
    (0, node_test_1.it)('base read leaks NO top-level field — including a never-before-seen one', () => {
        const dto = (0, _name__js_1.buildPublicSaveDTO)(sentinelSave(), { combat: false });
        for (const k of ['savedBloodlines', 'creatorJutsus', 'creatorItems', 'creatorAis',
            'creatorEvents', 'creatorMissions', 'creatorRaids', 'creatorCards',
            'activeTraining', 'activeJutsuTraining', 'missionProgress', 'acceptedMissionIds',
            'triggeredEvents', 'currentSector', 'currentBiome', 'pendingAiProfileId',
            '_saveVersion', '_saveAt', '_trainingReceipts', 'futureSecretSentinel']) {
            strict_1.default.ok(!(k in dto), `top-level field "${k}" leaked to a non-owner`);
        }
        // Serialize and assert no sentinel string survived anywhere.
        const json = JSON.stringify(dto);
        strict_1.default.ok(!json.includes('LEAK_TOPLEVEL_FUTURE'), 'future top-level secret leaked');
        strict_1.default.ok(!json.includes('LEAK_CHAR_FUTURE'), 'future character secret leaked');
        strict_1.default.ok(!json.includes('secret-jutsu'), 'loadout leaked on a base read');
        strict_1.default.ok(!json.includes('999999'), 'wallet leaked');
    });
    (0, node_test_1.it)('combatOnly widens ONLY to the minimal combat-scouting fields — nothing else', () => {
        const dto = (0, _name__js_1.buildPublicSaveDTO)(sentinelSave(), { combat: true });
        strict_1.default.deepEqual(Object.keys(dto).sort(), ['character', 'creatorItems', 'creatorJutsus', 'savedBloodlines']);
        // The bloodlines the live client's fetchPlayerCombatSave consumes are present.
        strict_1.default.ok(Array.isArray(dto.savedBloodlines));
        // But combatOnly still does NOT widen to the rest.
        for (const k of ['creatorAis', 'activeTraining', 'missionProgress', 'currentSector',
            'triggeredEvents', '_saveVersion', 'futureSecretSentinel']) {
            strict_1.default.ok(!(k in dto), `combatOnly leaked "${k}"`);
        }
        // Character stays the public projection even under combatOnly — no stats/jutsu.
        const char = dto.character;
        for (const k of Object.keys(char)) {
            strict_1.default.ok(PUBLIC_CHAR_KEYS.has(k), `combatOnly leaked private character field "${k}"`);
        }
    });
    (0, node_test_1.it)('handles a save with a non-object character without crashing or leaking', () => {
        const dto = (0, _name__js_1.buildPublicSaveDTO)({ character: null, secretTop: 'nope' }, { combat: true });
        strict_1.default.deepEqual(dto.character, {});
        strict_1.default.ok(!('secretTop' in dto));
    });
});

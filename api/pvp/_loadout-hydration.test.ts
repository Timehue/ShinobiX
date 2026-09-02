import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hydrateCharacterFromSave, resolveEquippedLoadout } from './session.js';
import type { AdminCombatContent } from '../_admin-content.js';

const equippedOrder = [
    'starter-tai-fire-2',
    'custom-moon-thread',
    'missing-stale-jutsu',
    'starter-nin-fire-1',
    'starter-tai-fire-2',
];

const customJutsu = {
    id: 'custom-moon-thread',
    name: 'Moon Thread',
    type: 'Genjutsu',
    element: 'None',
    ap: 60,
    range: 4,
    effectPower: 36,
    cooldown: 7,
    chakraCost: 250,
    staminaCost: 250,
    target: 'OPPONENT',
    method: 'SINGLE',
    tags: [{ name: 'Wound', percent: 30 }],
};

describe('authoritative equipped-jutsu hydration', () => {
    const save = { savedBloodlines: [], creatorJutsus: [customJutsu] };
    const saveCharacter = {
        equippedJutsuIds: equippedOrder,
        // A mastery row is the server-owned learning receipt. Level 0 is a
        // legitimate freshly learned/equipped technique and must remain usable.
        jutsuMastery: [
            { jutsuId: 'starter-tai-fire-2', level: 0 },
            { jutsuId: 'custom-moon-thread', level: 0 },
            { jutsuId: 'starter-nin-fire-1', level: 0 },
        ],
        stats: {},
        maxHp: 100,
        maxChakra: 100,
        maxStamina: 100,
        equipment: {},
    };

    it('resolves built-in and creator jutsu in saved slot order', () => {
        const resolved = resolveEquippedLoadout(saveCharacter, save, {}) as Array<{ id: string }>;
        assert.deepEqual(resolved.map((jutsu) => jutsu.id), [
            'starter-tai-fire-2',
            'custom-moon-thread',
            'starter-nin-fire-1',
        ]);
    });

    it('places that resolved loadout on the sealed combat character', () => {
        const hydrated = hydrateCharacterFromSave(saveCharacter, {}, save);
        assert.deepEqual((hydrated.jutsu as Array<{ id: string }>).map((jutsu) => jutsu.id), [
            'starter-tai-fire-2',
            'custom-moon-thread',
            'starter-nin-fire-1',
        ]);
    });
});

// `creatorJutsus` is a SERVER_LEDGER_TOPLEVEL_FIELD, so a regular player's save
// NEVER carries admin-authored jutsu — they live on save:admin1/admin2 only.
// The hydrator therefore has to be handed them (loadAdminJutsuObjects) or the
// loadout falls back to the CLIENT-supplied body for e.g. "Overload".
describe('admin-authored jutsu resolve from authored content, not the client', () => {
    const AUTHORED = {
        id: 'starter-universal-blitz',
        name: 'Overload',
        type: 'Ninjutsu',
        element: 'None',
        ap: 60,
        range: 3,
        effectPower: 40,
        cooldown: 7,
        chakraCost: 200,
        staminaCost: 200,
        target: 'OPPONENT',
        method: 'SINGLE',
        tags: [{ name: 'Wound', percent: 20 }],
    };
    // What a cheating client would send for the same id.
    const FORGED = { ...AUTHORED, effectPower: 9999, tags: [{ name: 'Wound', percent: 400 }] };
    const saveCharacter = {
        equippedJutsuIds: [AUTHORED.id],
        jutsuMastery: [{ jutsuId: AUTHORED.id, level: 0 }],
        stats: {},
        equipment: {},
    };
    const save = { savedBloodlines: [], creatorJutsus: [] };
    const adminJutsu: AdminCombatContent = { jutsu: new Map([[AUTHORED.id, AUTHORED]]), items: new Map() };

    it('takes the authored object over the client body', () => {
        const resolved = resolveEquippedLoadout(saveCharacter, save, { jutsu: [FORGED] }, adminJutsu) as Array<Record<string, unknown>>;
        assert.deepEqual(resolved.map((jutsu) => jutsu.id), [AUTHORED.id]);
        assert.equal(resolved[0].effectPower, AUTHORED.effectPower);
    });

    it('resolves the authored jutsu even when the client sends nothing', () => {
        const resolved = resolveEquippedLoadout(saveCharacter, save, {}, adminJutsu) as Array<Record<string, unknown>>;
        assert.deepEqual(resolved.map((jutsu) => jutsu.id), [AUTHORED.id]);
    });

    it('reaches the sealed combat character through the hydrator', () => {
        const hydrated = hydrateCharacterFromSave(saveCharacter, { jutsu: [FORGED] }, save, adminJutsu);
        const jutsu = (hydrated.jutsu as Array<Record<string, unknown>>)[0];
        assert.equal(jutsu.id, AUTHORED.id);
        assert.equal(jutsu.effectPower, AUTHORED.effectPower);
    });

    it('leaves the save\'s own bloodline jutsu authoritative over an id-colliding authored one', () => {
        const blSave = { savedBloodlines: [{ id: 'owned-bl', rank: 'B Rank', jutsus: [{ ...AUTHORED, effectPower: 40 }] }], creatorJutsus: [] };
        const resolved = resolveEquippedLoadout({ ...saveCharacter, equippedBloodlineId: 'owned-bl' }, blSave, {}, adminJutsu) as Array<Record<string, unknown>>;
        assert.equal(resolved[0].effectPower, 40);
    });

    it('drops a forged explicit catalog id with no learned/mastery entitlement', () => {
        const forgedSlots = {
            ...saveCharacter,
            equippedJutsuIds: ['starter-nin-fire-2'],
            jutsuMastery: [],
        };
        const resolved = resolveEquippedLoadout(forgedSlots, save, {}) as Array<Record<string, unknown>>;
        assert.deepEqual(resolved, []);
    });

    it('does not trust a client definition for a persisted player when no server definition exists', () => {
        const resolved = resolveEquippedLoadout(saveCharacter, save, { jutsu: [FORGED] }) as Array<Record<string, unknown>>;
        assert.deepEqual(resolved, []);
    });

    it('treats a legacy saved jutsu snapshot as IDs only when equipped IDs are empty', () => {
        const legacyCharacter = {
            ...saveCharacter,
            equippedJutsuIds: [],
            jutsuMastery: [
                ...saveCharacter.jutsuMastery,
                { jutsuId: 'starter-nin-fire-1', level: 0 },
            ],
            jutsu: [
                { ...FORGED, id: 'starter-nin-fire-1' },
                FORGED,
            ],
        };
        const resolved = resolveEquippedLoadout(legacyCharacter, save, {}) as Array<Record<string, unknown>>;
        assert.deepEqual(resolved.map((jutsu) => jutsu.id), ['starter-nin-fire-1']);
        assert.equal(resolved[0]?.effectPower, 0, 'built-in values come from the authoritative catalog');

        const hydrated = hydrateCharacterFromSave(legacyCharacter, { jutsu: [FORGED] }, save);
        assert.deepEqual((hydrated.jutsu as Array<Record<string, unknown>>).map((jutsu) => jutsu.id), ['starter-nin-fire-1']);
    });

    it('drops a forged legacy snapshot catalog id with no learned/mastery entitlement', () => {
        const forgedLegacy = {
            ...saveCharacter,
            equippedJutsuIds: [],
            jutsuMastery: [],
            jutsu: [{ id: 'starter-nin-fire-2', effectPower: 9999 }],
        };
        const resolved = resolveEquippedLoadout(forgedLegacy, save, {}) as Array<Record<string, unknown>>;
        assert.deepEqual(resolved, []);
    });

    it('never falls back to persisted or request-body definitions when no saved IDs resolve', () => {
        const emptyCharacter = { ...saveCharacter, equippedJutsuIds: [], jutsu: [FORGED] };
        const hydrated = hydrateCharacterFromSave(emptyCharacter, { jutsu: [FORGED] }, save);
        assert.deepEqual(hydrated.jutsu, []);
    });

    it('hydrates only the first row from duplicate carried bloodline ids', () => {
        const first = { ...AUTHORED, id: 'owned-first', name: 'First', element: 'Crystal' };
        const second = { ...AUTHORED, id: 'owned-second', name: 'Second', element: 'Crystal' };
        const duplicateSave = {
            savedBloodlines: [
                { id: 'owned-bl', rank: 'B Rank', specialElement: 'Crystal', jutsus: [first] },
                { id: 'owned-bl', rank: 'B Rank', specialElement: 'Crystal', jutsus: [second] },
            ],
            creatorJutsus: [],
        };
        const duplicateCharacter = {
            ...saveCharacter,
            equippedBloodlineId: 'owned-bl',
            equippedJutsuIds: [first.id, second.id],
            jutsuMastery: [
                { jutsuId: first.id, level: 0 },
                { jutsuId: second.id, level: 0 },
            ],
        };
        const resolved = resolveEquippedLoadout(duplicateCharacter, duplicateSave, {}) as Array<Record<string, unknown>>;
        assert.deepEqual(resolved.map((jutsu) => jutsu.id), [first.id]);
    });

    // A repeated tag is a legitimate authoring choice — the live "Overload" is
    // two independent Increase Damage Given pulses — but ONLY when the definition
    // came from the trusted admin catalog. A client-supplied payload keeps the
    // one-tag-per-name defense, or anyone could ship ten copies of an amp tag.
    it('keeps an authored repeated tag only on the trusted admin definition', () => {
        const overload = {
            id: 'admin-99c8efb8-8fa2-4b28-98d1-b95ad81af554',
            name: 'Overload',
            type: 'Ninjutsu',
            element: 'None',
            ap: 40,
            range: 1,
            effectPower: 0,
            cooldown: 7,
            target: 'SELF',
            method: 'SINGLE',
            isUtility: true,
            tags: [
                { name: 'Increase Damage Given', percent: 30 },
                { name: 'Increase Damage Given', percent: 30 },
            ],
        };
        const overloadSaveCharacter = {
            equippedJutsuIds: [overload.id],
            jutsuMastery: [{ jutsuId: overload.id, level: 8 }],
            stats: {},
            equipment: {},
        };
        const overloadSave = { savedBloodlines: [], creatorJutsus: [] };
        const overloadAdmin: AdminCombatContent = {
            jutsu: new Map([[overload.id, overload]]),
            items: new Map(),
        };

        const trusted = hydrateCharacterFromSave(overloadSaveCharacter, {}, overloadSave, overloadAdmin);
        const trustedTags = ((trusted.jutsu as Array<Record<string, unknown>>)[0]?.tags ?? []) as Array<Record<string, unknown>>;
        assert.equal(trustedTags.filter((tag) => tag.name === 'Increase Damage Given').length, 2);

        const clientOnly = hydrateCharacterFromSave(
            { ...overloadSaveCharacter, jutsu: [overload] },
            { jutsu: [overload] },
            null,
            null,
        );
        const clientOnlyTags = ((clientOnly.jutsu as Array<Record<string, unknown>>)[0]?.tags ?? []) as Array<Record<string, unknown>>;
        assert.equal(clientOnlyTags.filter((tag) => tag.name === 'Increase Damage Given').length, 1);
    });
});

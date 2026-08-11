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
        jutsuMastery: [],
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

describe('supporter loadout cap at combat sealing', () => {
    const jutsus = Array.from({ length: 15 }, (_, index) => ({
        id: `supporter-slot-${index + 1}`,
        name: `Supporter Slot ${index + 1}`,
        type: 'Ninjutsu',
        element: 'None',
        ap: 60,
        range: 4,
        effectPower: 40,
        cooldown: 7,
        chakraCost: 100,
        staminaCost: 0,
        target: 'OPPONENT',
        method: 'SINGLE',
        tags: [],
    }));
    const ids = jutsus.map(({ id }) => id);
    const save = { savedBloodlines: [], creatorJutsus: jutsus };
    const character = (patreon: Record<string, unknown>) => ({
        name: 'LoadoutCap',
        patreon,
        equippedJutsuIds: [...ids],
        jutsuMastery: [],
        stats: {},
        equipment: {},
    });

    it('seals only 12 jutsu for a Base account without mutating its persisted 15-slot preference', () => {
        const base = character({ active: false });
        const resolved = resolveEquippedLoadout(base, save, {}) as Array<{ id: string }>;
        assert.deepEqual(resolved.map(({ id }) => id), ids.slice(0, 12));
        assert.deepEqual(base.equippedJutsuIds, ids);
    });

    it('seals all 15 for an active Shinobi Supporter', () => {
        const supporter = character({ active: true });
        const resolved = resolveEquippedLoadout(supporter, save, {}) as Array<{ id: string }>;
        assert.deepEqual(resolved.map(({ id }) => id), ids);
    });

    it('immediately falls back to 12 when a comp entitlement is expired', () => {
        const expired = character({ active: true, expiresAt: Date.now() - 1 });
        const hydrated = hydrateCharacterFromSave(expired, {}, save);
        assert.deepEqual((hydrated.jutsu as Array<{ id: string }>).map(({ id }) => id), ids.slice(0, 12));
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
    const saveCharacter = { equippedJutsuIds: [AUTHORED.id], jutsuMastery: [], stats: {}, equipment: {} };
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
        const blSave = { savedBloodlines: [{ rank: 'B Rank', jutsus: [{ ...AUTHORED, effectPower: 12 }] }], creatorJutsus: [] };
        const resolved = resolveEquippedLoadout(saveCharacter, blSave, {}, adminJutsu) as Array<Record<string, unknown>>;
        assert.equal(resolved[0].effectPower, 12);
    });

    it('is unchanged when no admin catalog is passed (old callers)', () => {
        const resolved = resolveEquippedLoadout(saveCharacter, save, { jutsu: [FORGED] }) as Array<Record<string, unknown>>;
        assert.equal(resolved[0].effectPower, FORGED.effectPower);
    });
});

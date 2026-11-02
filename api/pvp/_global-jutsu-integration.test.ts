import assert from 'node:assert/strict';
import { test } from 'node:test';
import { v2JutsuCosts } from '../_combat-resources.js';
import type { AdminCombatContent } from '../_admin-content.js';
import { JUTSU_CATALOG } from './_jutsu-catalog.js';
import { hydrateCharacterFromSave, resolveEquippedLoadout, type PvpSession } from './session.js';
import { creditPvpJutsuMastery } from './_jutsu-mastery-reward.js';

const additions = Object.values(JUTSU_CATALOG).filter(j =>
    /^starter-(?:nin|gen|tai|buki)-[a-z]+-[56]$/.test(j.id) || j.id.startsWith('starter-any-'));
const specialties = ['Ninjutsu', 'Genjutsu', 'Taijutsu', 'Bukijutsu'];

test('all new jutsu seal from authoritative definitions and retain normal learning and slot restrictions', () => {
    assert.equal(additions.length, 45);
    for (const jutsu of additions) for (const specialty of jutsu.type === 'Any' ? specialties : [jutsu.type]) {
        const forged = { ...jutsu, ap: 1, effectPower: 9999, cooldown: 0, chakraCost: 0, staminaCost: 0,
            tags: [{ name: 'Stun', percent: 100 }] };
        const character = { name: 'global-integration', level: 50, specialty,
            element: jutsu.element, elements: [jutsu.element], equippedJutsuIds: [jutsu.id, jutsu.id],
            jutsuMastery: [{ jutsuId: jutsu.id, level: 1, xp: 0 }] };
        const save = { character, savedBloodlines: [], creatorJutsus: [forged] };
        const admin: AdminCombatContent = { jutsu: new Map([[jutsu.id, forged]]), items: new Map() };
        const resolved = resolveEquippedLoadout(character, save, { jutsu: [forged] }, admin);
        assert.deepEqual(resolved, [jutsu], `${jutsu.id}: catalog wins over every stale or forged copy`);
        const hydrated = hydrateCharacterFromSave(character, { jutsu: [forged] }, save, admin);
        const sealed = hydrated.jutsu as Array<typeof jutsu>;
        assert.equal(sealed.length, 1, `${jutsu.id}: duplicate slots do not create duplicate actions`);
        assert.deepEqual(sealed[0], { ...jutsu, ...v2JutsuCosts(jutsu, 50, specialty) }, `${jutsu.id}/${specialty}: live sealed values`);
        assert.deepEqual(resolveEquippedLoadout({ ...character, equippedJutsuIds: [] }, save, {}), []);
        assert.deepEqual(resolveEquippedLoadout({ ...character, jutsuMastery: [] }, save, {}), [],
            `${jutsu.id}: an equipment preference is not a learning receipt`);
    }
    const ids = additions.map(j => j.id);
    for (const supporter of [false, true]) {
        const character = { name: 'slot-integration', level: 100, patreon: { active: supporter },
            equippedJutsuIds: ids, jutsuMastery: ids.map(jutsuId => ({ jutsuId, level: 1, xp: 0 })) };
        const resolved = resolveEquippedLoadout(character, { character }, {}) as Array<{ id: string }>;
        assert.deepEqual(resolved.map(j => j.id), ids.slice(0, supporter ? 15 : 12));
        assert.deepEqual(character.equippedJutsuIds, ids, 'sealing preserves stored slot preferences');
    }
});

test('all new attacks and utilities earn ordinary used-jutsu mastery and respect the normal cap', () => {
    for (const jutsu of additions) {
        const session = { winner: 'p1', rewardSector: 12, realFighters: { p1: true, p2: true },
            p1: { character: { jutsu: [jutsu] } }, p2: { character: { jutsu: [] } },
            jutsuUsed: { p1: [jutsu.id, jutsu.id, 'unowned-test-id'], p2: [] } } as unknown as PvpSession;
        const character = { level: 100, jutsuMastery: [{ jutsuId: jutsu.id, level: 1, xp: 49 }] };
        const credited = creditPvpJutsuMastery(character, session, 1);
        assert.equal(credited.awarded, 10, jutsu.id);
        assert.deepEqual(credited.character.jutsuMastery, [{ jutsuId: jutsu.id, level: 2, xp: 9 }]);
        const capped = { level: 100, jutsuMastery: [{ jutsuId: jutsu.id, level: 50, xp: 0 }] };
        assert.equal(creditPvpJutsuMastery(capped, session, 1).character, capped);
        assert.equal(creditPvpJutsuMastery(character, { ...session, ranked: true }, 1).awarded, 0);
    }
});

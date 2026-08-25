import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import type { CombatJutsu } from '../combat-core/types.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { JUTSU_CATALOG } from '../pvp/_jutsu-catalog.js';
import { LEGACY_JUTSU_CATALOG } from '../pvp/_legacy-jutsu-catalog.js';
import {
    SOLO_PVE_SUPPORTED_METHODS,
    SOLO_PVE_SUPPORTED_TARGETS,
    soloPveItemCompatibility,
    soloPveJutsuCompatibility,
} from './_compatibility.js';

describe('solo-PvE published content compatibility', () => {
    it('supports every published and legacy jutsu without an unsupported branch', () => {
        const jutsu = [...Object.values(JUTSU_CATALOG), ...Object.values(LEGACY_JUTSU_CATALOG)];
        const issues = jutsu.flatMap(soloPveJutsuCompatibility);
        assert.deepEqual(issues, []);
        assert.equal(jutsu.length, 217, 'update the compatibility report when the generated catalogs change');
    });

    it('supports every published item combat field', () => {
        const items = Object.values(ITEM_CATALOG);
        assert.deepEqual(items.flatMap(soloPveItemCompatibility), []);
        // 164 → 172: the 8 wild relics (open-world RNG drops for the relic slot).
        // 172 → 173: `ration-pack` (Village Stores cooked rations) on this branch,
        // and 172 → 173: profession change approval on main — both landed, so the
        // merged catalog carries BOTH: 174.
        assert.equal(items.length, 174, 'update the compatibility report when the generated catalog changes');
    });

    it('resolves every catalog AI loadout to compatible server-sealed jutsu', () => {
        for (const profile of Object.values(AI_PROFILE_CATALOG)) {
            const resolved = resolveAiProfileJutsu(profile.jutsuIds, null);
            assert.equal(resolved.length, profile.jutsuIds.length, `${profile.id} has an unresolved jutsu`);
            assert.deepEqual(resolved.flatMap(soloPveJutsuCompatibility), [], profile.id);
        }
    });

    it('covers the complete authoring vocabulary, including the historical line alias', () => {
        const targetFixtures = SOLO_PVE_SUPPORTED_TARGETS.map((target, index): CombatJutsu => ({
            id: `target-${index}`, name: target, type: 'Ninjutsu', target, method: 'SINGLE', ap: 40, effectPower: target === 'SELF' ? 0 : 10,
        }));
        const methodFixtures: CombatJutsu[] = [
            { id: 'single', name: 'Single', type: 'Ninjutsu', target: 'OPPONENT', method: 'SINGLE' },
            { id: 'all', name: 'All', type: 'Ninjutsu', target: 'OPPONENT', method: 'ALL' },
            { id: 'circle', name: 'Circle', type: 'Ninjutsu', target: 'EMPTY_GROUND', method: 'AOE_CIRCLE', tags: [{ name: 'Move' }] },
            { id: 'instant', name: 'Instant', type: 'Ninjutsu', target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT', tags: [{ name: 'Poison' }] },
            { id: 'spiral', name: 'Spiral', type: 'Ninjutsu', target: 'EMPTY_GROUND', method: 'AOE_SPIRAL', tags: [{ name: 'Move' }, { name: 'Poison' }] },
            { id: 'burst', name: 'Burst', type: 'Ninjutsu', target: 'OPPONENT', method: 'AOE_BURST' },
            { id: 'line-alias', name: 'Line', type: 'Ninjutsu', target: 'EMPTY_GROUND', method: 'AOE_LINE', tags: [{ name: 'Poison' }] },
        ];
        assert.deepEqual([...targetFixtures, ...methodFixtures].flatMap(soloPveJutsuCompatibility), []);
        assert.equal(methodFixtures.length, SOLO_PVE_SUPPORTED_METHODS.length);
    });
});

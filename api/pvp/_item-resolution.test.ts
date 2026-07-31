/*
 * Server-authoritative equipped-ITEM resolution.
 *
 * An equipped id that resolves to nothing is dropped, and the fighter enters the
 * match without that gear. Before the admin item catalog, the only definition
 * sources were the built-in ITEM_CATALOG and the fighter's OWN `creatorItems` —
 * a client-written mirror of the admin slots — so an erased/never-synced mirror
 * silently disarmed admin-authored gear. These tests pin the resolution order and
 * the drop-with-a-log-line behaviour.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hydrateCharacterFromSave } from './session.js';
import { deriveCombatMultipliers, buildItemLookup } from './_multipliers.js';
import { buildAdminItemCatalog } from '../_admin-item-catalog.js';
import type { AdminCombatContent } from '../_admin-content.js';

const adminItems = buildAdminItemCatalog([
    {
        creatorItems: [
            { id: 'custom-storm-tanto', name: 'Storm Tanto', slot: 'hand', rarity: 'legendary', weaponEp: 40 },
            { id: 'custom-ash-mantle', name: 'Ash Mantle', slot: 'body', rarity: 'legendary', armorQuality: 'Legendary', bonuses: { absorbPercent: 2 } },
            // an id that ALSO exists in the built-in catalog (the synced-copy case)
            { id: 'bulwark-chest', name: 'Impostor Mantle', slot: 'body', rarity: 'legendary' },
        ],
    },
]);

const namedWeapon = { id: 'named-weapon-abc', name: 'Ashfall', slot: 'hand', rarity: 'legendary', weaponEp: 30 };

function saveCharacter(equipment: Record<string, string>) {
    return { name: 'Tester', equipment, stats: {}, jutsuMastery: [], maxHp: 100, maxChakra: 100, maxStamina: 100 };
}

function itemIds(hydrated: Record<string, unknown>): string[] {
    return (hydrated.pvpItems as Array<{ id?: string }>).map((i) => String(i.id));
}

// hydrateCharacterFromSave takes the COMBINED admin content (jutsu + items);
// the buildItemLookup tests below still use the raw item map directly.
const adminContent: AdminCombatContent = { jutsu: new Map(), items: adminItems };

describe('equipped-item resolution against the admin catalog', () => {
    it('resolves an admin-authored item whose definition the player save lacks', () => {
        const hydrated = hydrateCharacterFromSave(
            saveCharacter({ hand: 'custom-storm-tanto' }),
            {},
            { creatorItems: [] },
            adminContent,
        );
        assert.deepEqual(itemIds(hydrated), ['custom-storm-tanto']);
    });

    it('drops that same item when no admin catalog is supplied (the old behaviour)', () => {
        const hydrated = hydrateCharacterFromSave(saveCharacter({ hand: 'custom-storm-tanto' }), {}, { creatorItems: [] });
        assert.deepEqual(itemIds(hydrated), []);
    });

    it("still resolves a player's own forged named weapon (only their array has it)", () => {
        const hydrated = hydrateCharacterFromSave(
            saveCharacter({ hand: 'named-weapon-abc' }),
            {},
            { creatorItems: [namedWeapon] },
            adminContent,
        );
        assert.deepEqual(itemIds(hydrated), ['named-weapon-abc']);
        assert.equal((hydrated.pvpItems as Array<{ name?: string }>)[0].name, 'Ashfall');
    });

    it('keeps the built-in definition for a built-in id', () => {
        const getItem = buildItemLookup([{ id: 'bulwark-chest', name: 'Player Copy' }], adminItems);
        assert.equal((getItem('bulwark-chest') as Record<string, unknown>).name, "Eternal Bulwark's Mantle");
    });

    it("prefers the admin definition over the player's mirrored copy", () => {
        const getItem = buildItemLookup([{ id: 'custom-storm-tanto', name: 'Stale Copy', slot: 'hand' }], adminItems);
        assert.equal((getItem('custom-storm-tanto') as Record<string, unknown>).name, 'Storm Tanto');
    });

    it('logs (and still drops) an equipped id nothing can resolve', () => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
        try {
            const hydrated = hydrateCharacterFromSave(
                saveCharacter({ hand: 'ghost-item-42', body: 'custom-ash-mantle' }),
                {},
                { creatorItems: [] },
                adminContent,
            );
            assert.deepEqual(itemIds(hydrated), ['custom-ash-mantle']);
        } finally {
            console.warn = original;
        }
        assert.equal(warnings.length, 1);
        assert.ok(warnings[0].includes('ghost-item-42'), warnings[0]);
        assert.ok(!warnings[0].includes('custom-ash-mantle'), 'only the unresolved id is named');
    });

    it('feeds admin gear into the derived multiplier layer (armor DR + passives)', () => {
        const character = saveCharacter({ body: 'custom-ash-mantle' });
        const withAdmin = deriveCombatMultipliers(character, { creatorItems: [] }, adminItems);
        assert.equal(withAdmin.itemAbsorbPct, 2);
        assert.ok(withAdmin.armorRawDR > 0, 'Legendary armorQuality contributes DR');
        // Without the catalog the piece resolves to nothing — the pre-fix state.
        const withoutAdmin = deriveCombatMultipliers(character, { creatorItems: [] });
        assert.equal(withoutAdmin.itemAbsorbPct, 0);
        assert.equal(withoutAdmin.armorRawDR, 0);
    });

    it('budgets an over-budget admin item exactly like a player creator item', () => {
        const forged = buildAdminItemCatalog([
            { creatorItems: [{ id: 'forged-admin', slot: 'body', bonuses: { reflectPercent: 50, shield: 5000 } }] },
        ]);
        const getItem = buildItemLookup([], forged);
        assert.deepEqual((getItem('forged-admin') as Record<string, unknown>).bonuses, { reflectPercent: 2, shield: 150 });
    });
});

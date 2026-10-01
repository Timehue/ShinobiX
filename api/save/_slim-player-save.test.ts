import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let slim: typeof import('./_slim-player-save.js');
let checkSlimParity: typeof import('./_slim-parity.js').checkSlimParity;
let buildAdminItemCatalog: typeof import('../_admin-item-catalog.js').buildAdminItemCatalog;
let buildAdminJutsuCatalog: typeof import('../_admin-jutsu-catalog.js').buildAdminJutsuCatalog;

before(async () => {
    slim = await import('./_slim-player-save.js');
    ({ checkSlimParity } = await import('./_slim-parity.js'));
    ({ buildAdminItemCatalog } = await import('../_admin-item-catalog.js'));
    ({ buildAdminJutsuCatalog } = await import('../_admin-jutsu-catalog.js'));
});

const FORGED = 'named-weapon-1234abcd-12ab-34cd-56ef-1234567890ab';
const FORGED_ARMOR = 'named-armor-aaaabbbb-cccc-dddd-eeee-ffff00001111';
const ADMIN_ARMOR = { id: 'admin-tidewall-plate', name: 'Tidewall Plate', slot: 'body', rarity: 'mythic', bonuses: { defense: 40 }, armorRawDR: 0.2 };
const ADMIN_BLADE = { id: 'admin-stormcutter', name: 'Stormcutter', slot: 'hand', rarity: 'mythic', weaponEp: 30, bonuses: { strength: 25 } };
const DELETED = { id: 'admin-retired-charm', name: '__ADMIN_DELETED_ITEM__' };
const ADMIN_UNHELD = { id: 'admin-gale-scroll', name: 'Gale Scroll', slot: 'waist', rarity: 'epic', bonuses: { speed: 12 } };
const ADMIN_JUTSU = { id: 'admin-tidal-lance', name: 'Tidal Lance', type: 'Ninjutsu', power: 90, chakraCost: 30, updatedAt: 5 };

function adminContent() {
    const records = [{ creatorItems: [ADMIN_ARMOR, ADMIN_BLADE, ADMIN_UNHELD, { id: 'admin-retired-charm', name: 'Old Charm', slot: 'waist' }, DELETED], creatorJutsus: [ADMIN_JUTSU] }];
    return { items: buildAdminItemCatalog(records), jutsu: buildAdminJutsuCatalog(records) };
}

/** A fighter that touches every resolution source: built-in, admin, forged, bloodline, jutsu. */
function playerSave(): Record<string, unknown> {
    return {
        _saveVersion: 12,
        character: {
            name: 'slimtester', level: 60, village: 'Ember', specialty: 'Ninjutsu',
            hp: 4000, maxHp: 4000, chakra: 800, maxChakra: 800, stamina: 800, maxStamina: 800,
            stats: { strength: 300, speed: 280, intelligence: 260, willpower: 240, ninjutsuOffense: 320, ninjutsuDefense: 200, taijutsuOffense: 150, taijutsuDefense: 150, bukijutsuOffense: 180, bukijutsuDefense: 160, genjutsuOffense: 90, genjutsuDefense: 90 },
            equipment: { hand: FORGED, body: ADMIN_ARMOR.id, head: 'bulwark-crown', feet: 'bulwark-feet' },
            inventory: ['ashen-dragon-katana', ADMIN_BLADE.id, FORGED_ARMOR, 'mystery-relic'],
            itemStacks: [{ itemId: 'elemental-core', count: 1 }],
            equippedJutsuIds: [ADMIN_JUTSU.id],
            equippedBloodlineId: 'bl-tide',
            pets: [],
        },
        savedBloodlines: [{ id: 'bl-tide', name: 'Tidecaller', rank: 'A', jutsus: [{ id: 'bl-tide-1', name: 'Undertow', type: 'Ninjutsu', power: 70 }] }],
        creatorJutsus: [{ ...ADMIN_JUTSU, power: 75, updatedAt: 1 }],
        creatorItems: [
            { ...ADMIN_ARMOR, bonuses: { defense: 10 } },          // stale admin copy, but HELD (equipped) — kept
            ADMIN_BLADE,                                             // admin copy, HELD (inventory) — kept
            ADMIN_UNHELD,                                            // admin copy the player does not hold — shadowed
            { id: 'bulwark-crown', name: 'Bulwark Crown (copy)', slot: 'head', rarity: 'legendary' }, // built-in copy — shadowed
            { id: FORGED, name: 'Moonfang', slot: 'hand', rarity: 'legendary', weaponEp: 26, bonuses: { strength: 30 } },
            { id: FORGED_ARMOR, name: 'Duskhide', slot: 'body', rarity: 'legendary', bonuses: { defense: 22 } },
            { id: 'mystery-relic', name: 'Mystery Relic', slot: 'waist', rarity: 'rare' }, // neither catalog knows it — kept
            { id: 'admin-retired-charm', name: 'Old Charm', slot: 'waist' },              // admin-deleted — kept
            { name: 'no id' },
        ],
        editablePets: [{ id: 'pet-1' }],
        creatorAis: [{ id: 'ai-1' }],
        creatorEvents: [{ id: 'ev-1' }],
        creatorCards: [{ id: 'card-1' }],
    };
}

describe('slimPlayerSaveRecord', () => {
    it('removes the shared-content copies and keeps creatorJutsus untouched (zero PvP change)', () => {
        const record = playerSave();
        const out = slim.slimPlayerSaveRecord(record, adminContent().items);
        assert.equal(out.changed, true);
        for (const field of ['editablePets', 'creatorAis', 'creatorEvents', 'creatorCards']) {
            assert.equal(field in out.record, false, `${field} is removed`);
        }
        assert.deepEqual(out.record.creatorJutsus, record.creatorJutsus);
        assert.deepEqual(out.record.character, record.character);
        assert.deepEqual(out.record.savedBloodlines, record.savedBloodlines);
    });

    it('drops only item copies a catalog already defines and the player does not hold; forged, unknown, held and admin-deleted ids stay', () => {
        const out = slim.slimPlayerSaveRecord(playerSave(), adminContent().items);
        const kept = (out.record.creatorItems as Array<Record<string, unknown>>).map((item) => item.id ?? item.name);
        assert.deepEqual(kept, [ADMIN_ARMOR.id, ADMIN_BLADE.id, FORGED, FORGED_ARMOR, 'mystery-relic', 'admin-retired-charm', 'no id']);
        assert.equal(out.droppedItemCopies, 2, 'the unheld admin copy and the built-in copy');
    });

    it('a held admin item survives an untombstoned admin delete (the Admin Panel just filters it out)', async () => {
        const record = playerSave();
        const slimmed = slim.slimPlayerSaveRecord(record, adminContent().items).record;
        // The admin later deletes Stormcutter outright: no tombstone, simply gone from the slot.
        const { buildAdminItemCatalog: build } = await import('../_admin-item-catalog.js');
        const afterDelete = build([{ creatorItems: [ADMIN_ARMOR, ADMIN_UNHELD] }]);
        const parity = await checkSlimParity(record, slimmed, { items: afterDelete, jutsu: adminContent().jutsu });
        assert.deepEqual(parity.diffs, [], 'the held blade still resolves from the player copy');
    });

    it('holding is judged anywhere in the save: itemStacks, bank, pet gear', () => {
        const record = playerSave();
        const character = record.character as Record<string, unknown>;
        record.character = { ...character, inventory: [], equipment: {}, bank: { items: [{ itemId: ADMIN_BLADE.id }] } };
        const kept = (slim.slimPlayerSaveRecord(record, adminContent().items).record.creatorItems as Array<Record<string, unknown>>).map((item) => item.id);
        assert.equal(kept.includes(ADMIN_BLADE.id), true, 'a banked admin item keeps its copy');
        assert.equal(kept.includes(ADMIN_ARMOR.id), false, 'an admin item no longer held is dropped');
    });

    it('never mutates the record it was given', () => {
        const record = playerSave();
        const copy = structuredClone(record);
        slim.slimPlayerSaveRecord(record, adminContent().items);
        assert.deepEqual(record, copy);
    });

    it('with no admin catalog only built-in copies are dropped (the safe direction)', () => {
        const out = slim.slimPlayerSaveRecord(playerSave(), null);
        const kept = (out.record.creatorItems as Array<Record<string, unknown>>).map((item) => item.id ?? item.name);
        assert.equal(kept.includes(ADMIN_ARMOR.id), true);
        assert.equal(kept.includes(ADMIN_BLADE.id), true);
        assert.equal(kept.includes('bulwark-crown'), false);
    });

    it('an already-slim record reports no change and returns the same object', () => {
        const once = slim.slimPlayerSaveRecord(playerSave(), adminContent().items).record;
        const twice = slim.slimPlayerSaveRecord(once, adminContent().items);
        assert.equal(twice.changed, false);
        assert.equal(twice.record, once);
    });

    it('is off unless SLIM_PLAYER_SAVES=1', () => {
        assert.equal(slim.slimPlayerSavesEnabled({}), false);
        assert.equal(slim.slimPlayerSavesEnabled({ SLIM_PLAYER_SAVES: '0' }), false);
        assert.equal(slim.slimPlayerSavesEnabled({ SLIM_PLAYER_SAVES: '1' }), true);
    });
});

describe('checkSlimParity (real fighter loaders)', () => {
    it('a slimmed save loads the identical fighter: gear, forged items, bloodline, jutsu and stats', async () => {
        const admin = adminContent();
        const record = playerSave();
        const slimmed = slim.slimPlayerSaveRecord(record, admin.items).record;
        const parity = await checkSlimParity(record, slimmed, admin);
        assert.deepEqual(parity.diffs, []);
        assert.equal(parity.equal, true);
    });

    it('catches a slim that WOULD change a fight (negative control: dropping forged gear)', async () => {
        const admin = adminContent();
        const record = playerSave();
        const broken = { ...record, creatorItems: (record.creatorItems as Array<Record<string, unknown>>).filter((item) => item.id !== FORGED) };
        const parity = await checkSlimParity(record, broken, admin);
        assert.equal(parity.equal, false);
        assert.ok(parity.diffs.includes(`item:${FORGED}`), parity.diffs.join(', '));
    });

    it('catches a slim that drops an item only the player copy defines (negative control)', async () => {
        const admin = adminContent();
        const record = playerSave();
        const broken = { ...record, creatorItems: (record.creatorItems as Array<Record<string, unknown>>).filter((item) => item.id !== 'mystery-relic') };
        const parity = await checkSlimParity(record, broken, admin);
        assert.equal(parity.equal, false);
        assert.ok(parity.diffs.includes('item:mystery-relic'), parity.diffs.join(', '));
    });
});

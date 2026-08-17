import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { characterMayUseJutsu } from './_bloodline-gate.js';
import { resolveEquippedLoadout, hydrateCharacterFromSave } from './session.js';

const BLOOD_JUTSU = { id: 'ashen-eyes-blood-gaze', element: 'Blood' };

describe('bloodline access gate (characterMayUseJutsu)', () => {
    it('universal and base-element jutsu are always usable', () => {
        const char = { name: 'Nobody' };
        assert.ok(characterMayUseJutsu(char, {}, { id: 'starter-universal-blitz', element: 'None' }));
        assert.ok(characterMayUseJutsu(char, {}, { id: 'starter-buki-fire-1', element: 'Fire' }));
        assert.ok(characterMayUseJutsu(char, {}, { id: 'some-authored-jutsu', element: '' }));
    });

    it('a built-in bloodline jutsu requires carrying that bloodline', () => {
        assert.equal(characterMayUseJutsu({ name: 'Nobody' }, {}, BLOOD_JUTSU), false);
        assert.ok(characterMayUseJutsu({ bloodline: 'Ashen Eyes' }, {}, BLOOD_JUTSU), 'starter bloodline by name');
        assert.ok(characterMayUseJutsu({ bloodline: 'Blue Blade Eyes' }, {}, BLOOD_JUTSU), 'legacy starter alias remaps');
        assert.ok(characterMayUseJutsu({ equippedBloodlineId: 'starter-bloodline-ashen-eyes' }, {}, BLOOD_JUTSU), 'equipped built-in by id');
        assert.equal(
            characterMayUseJutsu({ bloodline: 'Iron Fang' }, {}, BLOOD_JUTSU),
            false,
            'a DIFFERENT bloodline does not grant it',
        );
    });

    it('a special-element authored jutsu needs the element or a granting equipped bloodline', () => {
        const jutsu = { id: 'authored-blood-nuke', element: 'Blood' };
        assert.equal(characterMayUseJutsu({ name: 'Nobody' }, {}, jutsu), false);
        assert.ok(
            characterMayUseJutsu({ elements: ['Blood'] }, {}, jutsu),
            'an awakened special element grants access',
        );
        const save = { savedBloodlines: [{ id: 'bl-custom', specialElement: 'Blood', jutsus: [] }] };
        assert.ok(
            characterMayUseJutsu({ equippedBloodlineId: 'bl-custom' }, save, jutsu),
            'an EQUIPPED custom bloodline with the special element grants access',
        );
        assert.equal(
            characterMayUseJutsu({ name: 'NotEquipped' }, save, jutsu),
            false,
            'a stored-but-unequipped bloodline grants nothing',
        );
    });

    it('a custom bloodline jutsu is usable only while that bloodline is equipped', () => {
        const jutsu = { id: 'my-custom-strike', element: 'Shadowflame' };
        const save = { savedBloodlines: [{ id: 'bl-mine', specialElement: 'Shadowflame', jutsus: [{ id: 'my-custom-strike' }] }] };
        assert.ok(characterMayUseJutsu({ equippedBloodlineId: 'bl-mine' }, save, jutsu));
        assert.equal(characterMayUseJutsu({ equippedBloodlineId: 'bl-other' }, save, jutsu), false);
    });
});

describe('bloodline gate in loadout resolution (resolveEquippedLoadout)', () => {
    it('drops an equipped built-in bloodline jutsu the save does not carry', () => {
        const saveChar = { name: 'Cheater', equippedJutsuIds: ['ashen-eyes-blood-gaze', 'starter-buki-fire-2'] };
        const resolved = resolveEquippedLoadout(saveChar, { savedBloodlines: [] }, {}) as Array<{ id: string }>;
        const ids = resolved.map((j) => j.id);
        assert.ok(!ids.includes('ashen-eyes-blood-gaze'), 'ungranted bloodline jutsu must not seal into the fight');
        assert.ok(ids.includes('starter-buki-fire-2'), 'ordinary starters still resolve');
    });

    it('keeps the kit when the save carries the bloodline', () => {
        const saveChar = { name: 'Honest', bloodline: 'Ashen Eyes', equippedJutsuIds: ['ashen-eyes-blood-gaze'] };
        const resolved = resolveEquippedLoadout(saveChar, { savedBloodlines: [] }, {}) as Array<{ id: string }>;
        assert.ok(resolved.some((j) => j.id === 'ashen-eyes-blood-gaze'));
    });

    it('seals jutsu only from CARRIED bloodlines, not every stored one', () => {
        // A save can hold up to 5 forged bloodlines; only the EQUIPPED one (and
        // the starter) may contribute jutsu — matching getCharacterBloodlines.
        const save = {
            savedBloodlines: [
                { id: 'bl-equipped', rank: 'A Rank', specialElement: 'Frost', jutsus: [{ id: 'frost-spike', element: 'Frost', effectPower: 30, ap: 60 }] },
                { id: 'bl-stored', rank: 'S Rank', specialElement: 'Venom', jutsus: [{ id: 'venom-fang', element: 'Venom', effectPower: 30, ap: 60 }] },
            ],
        };
        const saveChar = { name: 'Collector', equippedBloodlineId: 'bl-equipped', equippedJutsuIds: ['frost-spike', 'venom-fang'] };
        const resolved = resolveEquippedLoadout(saveChar, save, {}) as Array<{ id: string }>;
        const ids = resolved.map((j) => j.id);
        assert.ok(ids.includes('frost-spike'), 'the equipped bloodline still contributes its jutsu');
        assert.ok(!ids.includes('venom-fang'), 'a stored-but-unequipped bloodline contributes nothing');
    });

    it('does not gate save-less (NPC) resolution', () => {
        const npc = { name: 'Boss AI', equippedJutsuIds: ['ashen-eyes-blood-gaze'] };
        const resolved = resolveEquippedLoadout(npc, null, {}) as Array<{ id: string }>;
        assert.ok(resolved.some((j) => j.id === 'ashen-eyes-blood-gaze'), 'NPC loadouts are server-authored, not gated');
    });
});

describe('gear specialty-stat fold (server = client Arena build)', () => {
    it('folds equipped-item stat bonuses into the sealed combat stats', () => {
        // event-kesa-storm-seal carries bonuses { ninjutsuOffense: 10 }. It moved to
        // the `relic` slot on 2026-08-16 (the aura slot is reserved for the Aura
        // Sphere) and its bonus was halved 20 -> 10 in the same pass, since the free
        // story relics are the floor of the relic pool. Its inert maxChakra 80 was
        // dropped then too — pools come from level alone, so it never applied.
        const character = {
            name: 'Geared',
            equipment: { relic: 'event-kesa-storm-seal' },
            stats: { ninjutsuOffense: 100, strength: 50 },
        };
        const hydrated = hydrateCharacterFromSave(character, {}, { character, creatorItems: [] });
        const stats = hydrated.stats as Record<string, number>;
        assert.equal(stats.ninjutsuOffense, 110, 'gear ninjutsuOffense folds into the sealed stat');
        assert.equal(stats.strength, 50, 'unrelated stats untouched');
    });

    it('does not fold for save-less (NPC) fighters', () => {
        const npc = {
            name: 'Bandit',
            equipment: { relic: 'event-kesa-storm-seal' },
            stats: { ninjutsuOffense: 100 },
        };
        const hydrated = hydrateCharacterFromSave(npc, {}, null);
        assert.equal((hydrated.stats as Record<string, number>).ninjutsuOffense, 100);
    });
});

describe('weapon attunement reaches server combat (weaponElements overlay)', () => {
    const save = (character: Record<string, unknown>) => ({ character, creatorItems: [] });

    it('stamps the attuned element onto the resolved catalog weapon', () => {
        const character = {
            name: 'Attuned',
            equipment: { hand: 'worldsplitter-katana' },
            weaponElements: { 'worldsplitter-katana': 'Fire' },
            elements: ['Fire'],
        };
        const hydrated = hydrateCharacterFromSave(character, {}, save(character));
        const items = hydrated.pvpItems as Array<Record<string, unknown>>;
        const katana = items.find((i) => i.id === 'worldsplitter-katana');
        assert.ok(katana, 'equipped weapon resolves from the catalog');
        assert.equal(katana!.weaponElement, 'Fire', 'the paid attunement must reach the sealed session');
    });

    it('drops an invalid attunement element via the sanitizer whitelist', () => {
        const character = {
            name: 'Forger',
            equipment: { hand: 'worldsplitter-katana' },
            weaponElements: { 'worldsplitter-katana': 'Blood' },
        };
        const hydrated = hydrateCharacterFromSave(character, {}, save(character));
        const items = hydrated.pvpItems as Array<Record<string, unknown>>;
        const katana = items.find((i) => i.id === 'worldsplitter-katana');
        assert.ok(katana);
        assert.equal(katana!.weaponElement, undefined, 'non-whitelisted elements are dropped, not sealed');
    });

    it('an authored weaponElement on the item definition wins over the overlay', () => {
        const character = {
            name: 'Creator',
            equipment: { hand: 'my-forged-blade' },
            weaponElements: { 'my-forged-blade': 'Fire' },
        };
        const record = {
            character,
            creatorItems: [{ id: 'my-forged-blade', name: 'Forged Blade', slot: 'hand', weaponEp: 20, weaponElement: 'Water' }],
        };
        const hydrated = hydrateCharacterFromSave(character, {}, record);
        const items = hydrated.pvpItems as Array<Record<string, unknown>>;
        const blade = items.find((i) => i.id === 'my-forged-blade');
        assert.ok(blade);
        assert.equal(blade!.weaponElement, 'Water', 'the authored definition is authoritative');
    });
});

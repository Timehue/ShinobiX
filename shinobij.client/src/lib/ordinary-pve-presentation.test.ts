import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { rollOrdinaryPveEncounter } from '../../../shared/ordinary-pve-encounter';
import { encounterLabel, namedPvePortrait, ordinaryPvePortrait } from './ordinary-pve-presentation';

test('role portraits exist and difficulty remains readable without color', () => {
    for (const archetype of ['bruiser', 'skirmisher', 'assassin', 'elementalist', 'defender'] as const) {
        const encounter = rollOrdinaryPveEncounter({ sourceId: `test-${archetype}`, playerLevel: 75, sector: 66, archetype });
        const path = ordinaryPvePortrait(encounter)!;
        assert.ok(existsSync(new URL(`../../public${path}`, import.meta.url)), path);
        assert.match(encounterLabel(encounter), new RegExp(`Lv ${encounter.level}.*opponent`));
    }
});

test('only Tsukika gets her unique nightblade portrait and authored replacements remain intact', () => {
    const nightblade = rollOrdinaryPveEncounter({ sourceId: 'night_123456', playerLevel: 75, sector: 66, archetype: 'assassin', portraitKey: 'nightblade', displayName: 'Tsukika the Quiet Blade' });
    assert.equal(ordinaryPvePortrait(nightblade), '/portraits/pve/tsukika.webp');
    assert.equal(ordinaryPvePortrait({ ...nightblade, displayName: 'Sumi of the Unlit Road' }), '/portraits/pve/nightblade.webp');
    assert.equal(ordinaryPvePortrait({ ...nightblade, portraitImage: '/portraits/authored-tsukika.webp' }), '/portraits/authored-tsukika.webp');
    assert.equal(namedPvePortrait('Kagero of the Cracked Mask'), '/portraits/pve/nemesis.webp');
    assert.equal(namedPvePortrait('Kage Kael Whitefang'), undefined);
});

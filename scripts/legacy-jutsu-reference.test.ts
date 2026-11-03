import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderLegacyJutsuReference } from './generate-legacy-jutsu-reference.mts';
import { LEGACY_BY_ID } from '../api/_legacy-defs.js';
import { LEGACY_JUTSU_DEFS } from '../shinobij.client/src/data/legacy-jutsu.js';
import { scaleJutsuTagsForDisplay } from '../shinobij.client/src/lib/jutsu-scaling.js';

test('the user-facing jutsu reference covers the actual 100 authored signatures', () => {
    const expected = renderLegacyJutsuReference();
    assert.equal((expected.match(/^\| Legacy of the /gm) ?? []).length, 100);
    assert.equal(fs.readFileSync(new URL('../docs/legacy-jutsu-reference.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), expected);
});

test('Common utility previews display their full percentage premium at each Legacy mastery stage', () => {
    const utilities = LEGACY_JUTSU_DEFS.filter(def =>
        LEGACY_BY_ID.get(def.legacyId)?.rarity === 'basic' && def.jutsu.ap === 40);
    assert.equal(utilities.length, 8);
    for (const { jutsu } of utilities) for (const mastery of [20, 30, 40, 50]) {
        const displayed = scaleJutsuTagsForDisplay(jutsu, mastery);
        assert.equal(displayed.tags.length, 2, jutsu.id);
        for (const tag of displayed.tags) {
            assert.equal(tag.percent, tag.name === 'Heal' || tag.name === 'Shield'
                ? 0 : Math.floor(32 - (50 - mastery) * 0.2), `${jutsu.id}: ${tag.name} at ${mastery}`);
        }
    }
});

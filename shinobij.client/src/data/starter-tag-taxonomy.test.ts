import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterJutsus } from './jutsu';
import { starterForbiddenTags } from '../lib/tags';
import { JUTSU_CATALOG } from '../../../api/pvp/_jutsu-catalog';

/*
 * AP-tempo (Lag / Overclock) is a deliberate bloodline-exclusive lever: a
 * built-in starter may pair Increase Generals with any ordinary buff, but never
 * with a tag that changes what an action COSTS.
 *
 * The rule existed only in prose until 2026-09-01, by which point three
 * starters had drifted onto it — Galewind Attunement, Thunderpulse Overdrive
 * and Forgeheart Temper all shipped `Overclock`. Pin it so the next drift is a
 * red test rather than a player noticing.
 *
 * Note this is NOT `bloodlineUniqueTags`, which caps a tag at one copy per
 * bloodline kit and permits starters freely (Whispering Calm's Debuff Prevent
 * is intentional).
 */
test('no built-in starter jutsu carries a reserved AP-tempo tag', () => {
    const reserved = new Set(starterForbiddenTags);
    for (const jutsu of starterJutsus) {
        for (const tag of jutsu.tags) {
            assert.ok(
                !reserved.has(tag.name),
                `${jutsu.id} (${jutsu.name}) carries starter-forbidden tag "${tag.name}"`,
            );
        }
    }
});

/*
 * The starter catalog is mirrored into the server's JUTSU_CATALOG by
 * scripts/jutsu-catalog-gen.mjs. A stale mirror would let the rule hold on the
 * client while the server still fought with the reserved tag, so assert it on
 * the generated file too — that is the copy combat actually reads. Built-in
 * BLOODLINE jutsu share the catalog and are exempt: they are the tier the
 * reservation exists for.
 */
test('the generated server catalog keeps AP-tempo tags off every starter', () => {
    const reserved = new Set(starterForbiddenTags);
    for (const jutsu of Object.values(JUTSU_CATALOG)) {
        if (jutsu.bloodlineRank) continue;
        for (const tag of jutsu.tags) {
            assert.ok(
                !reserved.has(tag.name),
                `${jutsu.id} (${jutsu.name}) carries starter-forbidden tag "${tag.name}"`,
            );
        }
    }
});

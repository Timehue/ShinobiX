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
 * bloodline kit. The 40-AP starter utility pairs separately avoid Move and
 * Debuff Prevent; the universal 20-AP Flicker still carries Move.
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

test('40-AP starter utility jutsu do not carry Move or Debuff Prevent', () => {
    const excluded = new Set(['Move', 'Debuff Prevent']);
    for (const [source, jutsus] of [
        ['client', starterJutsus],
        ['server', Object.values(JUTSU_CATALOG).filter((jutsu) => !jutsu.bloodlineRank)],
    ] as const) {
        for (const jutsu of jutsus) {
            if (jutsu.ap !== 40) continue;
            for (const tag of jutsu.tags) {
                assert.ok(!excluded.has(tag.name), `${source}: ${jutsu.id} carries ${tag.name} at 40 AP`);
            }
        }
    }
});

/**
 * Keep the road empty for a live journey that stands in a field sector.
 *
 * A sector's natural cast is shared world state, rolled per (sector, 6h bucket),
 * and its bandit archetype HUNTS: it paths to the player and opens a blocking
 * Fight/Flee encounter by itself (SectorWanderer -> onEngage), with no click
 * needed. Which sectors roll one changes every six hours, so a journey can pass
 * all morning and then fail every run until the bucket turns. On 2026-10-02 a
 * hunting "Saito the Cinder" rolled in sectors 13 and 40 for 12:00-18:00 UTC,
 * and its encounter modal sat over the Logout button in
 * daily-login-recovery-express on both projects.
 *
 * The supported way to keep an NPC off the road is its own anti-farm cooldown,
 * which the sector floor honours as real character state. Seeding the whole
 * roster for the neighbouring buckets too covers a run that straddles a
 * boundary. Don't use this in a journey that needs a wanderer to show up.
 *
 * Quiet the sector the player ACTUALLY stands in. A seeded save without
 * `worldGeoV` is renumbered on its first owner read (remapLegacySector in
 * shared/sector-geo.ts): the daily journey wrote sector 40 and stood in 13.
 * Stamp `worldGeoV: WORLD_GEO_VERSION`, or read the sector back first.
 *
 * The roster constants are mirrored as literals, not imported:
 * shared/wanderer-roster.ts reaches ./sector-geo.js, which the Playwright
 * runner's TypeScript resolution refuses. shared/wanderer-roster.test.ts pins
 * them on the source side, as for the e2e/ copies of this helper.
 */
const WANDERER_BUCKET_MS = 6 * 60 * 60 * 1000;
const WANDERER_MAX_INDEX = 1;
// The after-dark night ninja slot. Seeded too, so a run that lands on in-world
// night still finds a quiet road.
const WANDERER_NIGHT_INDEX = WANDERER_MAX_INDEX + 1;

/** `character.wandererCooldowns` entries that keep every natural wanderer of these sectors away. */
export function quietRoadCooldowns(sectors: readonly number[], now = Date.now()): Record<string, number> {
    const expiry = now + 30 * 24 * 60 * 60 * 1000;
    const cooldowns: Record<string, number> = {};
    for (const sector of sectors) {
        for (const offset of [-1, 0, 1]) {
            const bucket = Math.floor(now / WANDERER_BUCKET_MS) + offset;
            for (let index = 0; index <= WANDERER_NIGHT_INDEX; index++) {
                cooldowns[`w-${sector}-${bucket}-${index}`] = expiry;
            }
        }
    }
    return cooldowns;
}

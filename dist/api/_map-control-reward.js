"use strict";
// Pure, IO-free core for the server-authoritative Village "Map Control" daily
// reward (api/village/claim-map-control.ts). Split out so the payout math is
// unit-testable without storage — same pattern as api/_territory-supply.ts and
// the _*-validate cores.
//
// VERBATIM port of the client's claimMapControlRewards (shinobij.client/src/
// App.tsx): the per-day reward scales with the number of world sectors the
// player's VILLAGE controls (`villageOwnedTerritories(village).length`):
//
//   mapControlRyo   = sectors * 100
//   mapControlHonor = sectors * 2
//   mapControlBone  = Math.floor(sectors / 3)
//   ryo        += mapControlRyo
//   honorSeals += vanguardOnlyHonorSeals(character, mapControlHonor)
//   boneCharms += mapControlBone
//   fateShards += nonVanguardShardSubstitute(character, mapControlHonor)
//
// Honor Seals are Vanguard-only (vanguardOnlyHonorSeals); the fate-shard
// substitute (bonusFateShardsForHonor) applies to EVERY profession. Both
// helpers floor/clamp their input; we reproduce that exactly here so the test
// can assert server output == client output for any sector count.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMapControlReward = computeMapControlReward;
/** vanguardOnlyHonorSeals(character, amount) — Vanguard earns floor(amount), all
 *  others earn 0. (App.tsx:3101) */
function vanguardOnlyHonorSeals(isVanguard, amount) {
    if (!isVanguard)
        return 0;
    return Math.max(0, Math.floor(amount));
}
/** bonusFateShardsForHonor(_character, honorSealAmount) — 25:1, no minimum, for
 *  every profession. (App.tsx:3125; aliased as nonVanguardShardSubstitute) */
function bonusFateShardsForHonor(honorSealAmount) {
    const n = Math.max(0, Math.floor(honorSealAmount));
    if (n === 0)
        return 0;
    return Math.floor(n / 25);
}
/**
 * Compute the map-control daily reward for a player whose village controls
 * `sectors` world sectors. `isVanguard` is read server-side from the player's
 * own save (profession === 'vanguard'). Sectors is clamped to a non-negative
 * integer first (a count can never be fractional or negative).
 */
function computeMapControlReward(sectors, isVanguard) {
    const s = Math.max(0, Math.floor(Number(sectors) || 0));
    const mapControlHonor = s * 2;
    return {
        ryo: s * 100,
        honorSeals: vanguardOnlyHonorSeals(isVanguard, mapControlHonor),
        boneCharms: Math.floor(s / 3),
        fateShards: bonusFateShardsForHonor(mapControlHonor),
    };
}

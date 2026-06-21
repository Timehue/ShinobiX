"use strict";
/*
 * Server-side anti-tamper ceiling for pet battle stats (hp / attack / defense / speed).
 *
 * Pet stat GROWTH is uncapped-by-design — bounded only by level 100. An all-in
 * training build channels every level-up into ONE stat, reaching
 *   base * (1 + PET_LEVEL_GROWTH * 99) = base * (1 + 0.04 * 99) ≈ base * 4.96
 * (see gainPetXp in shinobij.client/src/lib/pet-balance.ts). Evolution only adds
 * the small rarity-gap delta (api/pet/_evolution.ts), so an evolved pet stays
 * inside its rarity's base*4.96 envelope, and starters cap at legendary.
 *
 * The flat 100k clamp that replaced the old per-rarity caps was ~300x a legit
 * level-100 build, so it did NOT actually stop a tampered save from sealing an
 * absurd pet into the deterministic ranked pet ladder (where it would auto-win
 * every fight). This restores a per-rarity ceiling at base*PET_STAT_CEIL_FACTOR:
 * generously above the legit all-in max (so NO legit pet — native or evolved — is
 * ever clipped) yet far below 100k, so a tampered pet is bounded to ~1.6x a legit
 * max-build instead of ~300x.
 *
 * PET_BASE_STATS is a port of balancedPetBaseStats
 * (shinobij.client/src/data/pet-stats.ts) — api/ is a separate build, so the
 * table is duplicated; the cross-build parity test guards it against drift.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PET_STAT_CEIL_FACTOR = exports.PET_BASE_STATS = void 0;
exports.petStatCeil = petStatCeil;
exports.PET_BASE_STATS = {
    standard: { hp: 320, attack: 40, defense: 28, speed: 30 },
    rare: { hp: 370, attack: 48, defense: 34, speed: 36 },
    legendary: { hp: 416, attack: 54, defense: 38, speed: 41 },
    mythic: { hp: 462, attack: 60, defense: 43, speed: 45 },
};
// Legit all-in max is ~base*4.96; 8x base is a 60%+ safety margin above that, so
// no legitimate pet is ever clamped while a tampered pet is bounded to ~1.6x a
// legit max-build (vs ~300x under the old flat 100k clamp).
exports.PET_STAT_CEIL_FACTOR = 8;
/**
 * Per-rarity, per-stat anti-tamper ceiling for a pet battle stat. An unknown /
 * tampered rarity falls back to mythic (the loosest tier) so the clamp never
 * clips a legit pet — the absolute value is still bounded to mythic*8.
 */
function petStatCeil(rarity, stat) {
    const base = exports.PET_BASE_STATS[String(rarity)] ?? exports.PET_BASE_STATS.mythic;
    return Math.round(base[stat] * exports.PET_STAT_CEIL_FACTOR);
}

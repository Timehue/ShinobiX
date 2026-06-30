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
exports.PET_JUTSU_POWER_CAP = exports.PET_STAT_CEIL_FACTOR = exports.PET_BASE_STATS = void 0;
exports.petStatCeil = petStatCeil;
exports.petJutsuPowerCeil = petJutsuPowerCeil;
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
/*
 * Per-rarity jutsu-power ceiling. Unlike hp/atk/def/speed (which grow with
 * training, hence the ×8 envelope), jutsu power has a fixed per-rarity cap that
 * the client already enforces (capPetStats → petStatCaps[*].jutsuPower). The
 * deterministic ranked duel (api/pet-ladder/_core.ts snapshotJutsu) previously
 * clamped power to a flat 1000 — ~2-3× a legit cap — letting a tampered pet seal
 * an absurd jutsu into a fight that auto-resolves server-side. This restores the
 * exact per-rarity cap, so an honest pet (already ≤ cap on the client) is
 * unaffected and a forged pet is bounded to its rarity's legit ceiling.
 *
 * Exact mirror of petStatCaps[*].jutsuPower in
 * shinobij.client/src/data/pet-stats.ts — guarded by the cross-build parity test.
 */
exports.PET_JUTSU_POWER_CAP = {
    standard: 320,
    rare: 360,
    legendary: 405,
    mythic: 450,
};
/**
 * Per-rarity anti-tamper ceiling for a pet jutsu's power. Unknown / tampered
 * rarity falls back to mythic (the loosest tier) so a legit pet is never clipped.
 */
function petJutsuPowerCeil(rarity) {
    return exports.PET_JUTSU_POWER_CAP[String(rarity)] ?? exports.PET_JUTSU_POWER_CAP.mythic;
}

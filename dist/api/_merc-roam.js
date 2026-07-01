"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROAMING_MERC_RENDER_CAP = exports.MERC_TARGET_COOLDOWN_MS = void 0;
exports.pickMercTarget = pickMercTarget;
exports.isMercTargetOnCooldown = isMercTargetOnCooldown;
exports.setMercTargetCooldown = setMercTargetCooldown;
exports.mercVillageSlug = mercVillageSlug;
exports.mercNpcId = mercNpcId;
exports.parseMercNpcId = parseMercNpcId;
exports.synthRoamingMercs = synthRoamingMercs;
/*
 * Roaming-merc shared core (Phase 5 — roaming rebuild). The pure targeting rule +
 * the server-authoritative anti-spam cooldown, shared by BOTH the autonomous cron
 * (api/_merc-auto.ts) and the player-encounter endpoint so the two never drift.
 *
 * Behaviour the Kage hires for (owner spec):
 *   - target: ANY enemy-village player a merc can reach — LOWEST-HP first (the
 *     "snipe" is just the opening pick; there is no min-health gate, mercs engage
 *     anyone). Contrast the retired snipe rule, which only hit players <= 50% HP.
 *   - per-target cooldown: once a merc fights a given player, NO merc may attack
 *     that same player again for 15 minutes ("can't spam attack the same person").
 *     Enforced server-side (keyed by the target), so neither the cron nor a
 *     hand-deploy can bypass it.
 *
 * Where a merc roams + what its win damages is the caller's job (sector war →
 * contested-sector Control-HP; village war → enemy-village war HP) — this module
 * only owns "who does it hit" and "is that player off-limits right now".
 */
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
// After a merc fights a player, that player is off-limits to ALL mercs for this
// long. Tunable. (Owner: "add a 15 min cd so they can't spam attack the same
// person trying to get fights in".)
exports.MERC_TARGET_COOLDOWN_MS = 15 * 60 * 1000;
/** Pure: the merc's mark from the players present — the LOWEST current-HP enemy
 *  (by fraction of max), or null if none. No min-health gate: a merc attacks
 *  anyone in the enemy village, it just goes for the most-hurt target first. Ties
 *  break by name so the pick is deterministic. */
function pickMercTarget(candidates, enemyVillage) {
    const eligible = candidates
        .filter((c) => c.village === enemyVillage && c.hp > 0 && c.maxHp > 0)
        .sort((a, b) => (a.hp / a.maxHp - b.hp / b.maxHp) || (a.name < b.name ? -1 : 1));
    return eligible[0] ?? null;
}
// ── per-target cooldown (server-authoritative anti-spam) ──────────────────────
// Keyed by the TARGET (not the merc), so the whole band — and the cron — respects
// one shared 15-min window per hunted player. We store the expiry timestamp and
// treat a past/absent value as "free", so a stale key is self-invalidating.
function mercTargetCdKey(targetPlayer) {
    return `merc:target-cd:${(0, _utils_js_1.safeName)(targetPlayer).toLowerCase()}`;
}
/** True if a merc fought this player within the last MERC_TARGET_COOLDOWN_MS. */
async function isMercTargetOnCooldown(targetPlayer, now) {
    const until = await _storage_js_1.kv.get(mercTargetCdKey(targetPlayer));
    return typeof until === 'number' && until > now;
}
/** Put a player off-limits to mercs until now + MERC_TARGET_COOLDOWN_MS. */
async function setMercTargetCooldown(targetPlayer, now) {
    await _storage_js_1.kv.set(mercTargetCdKey(targetPlayer), now + exports.MERC_TARGET_COOLDOWN_MS);
}
// ── Roaming-merc NPC identity + roster synthesis ──────────────────────────────
// A roaming merc renders client-side like a Sector Wanderer. Its id encodes the
// band it belongs to (attacking village + tier) so the engage endpoint can
// re-derive + validate that band against live leases server-side. The trailing
// index distinguishes the N mercs of a band (a band of count 4 shows 4 NPCs).
function mercVillageSlug(village) {
    return (0, _utils_js_1.safeName)(village).toLowerCase().replace(/[^a-z0-9]/g, '');
}
function mercNpcId(village, tierId, index) {
    return `merc-${mercVillageSlug(village)}-${tierId}-${index}`;
}
/** Parse a roaming-merc NPC id back to its band (village slug + tier), or null if it
 *  isn't a merc id. Only a CANDIDATE extraction — the caller re-validates the band
 *  against live leases, so a forged id can't conjure a merc that isn't really there. */
function parseMercNpcId(id) {
    const m = /^merc-([a-z0-9]+)-([a-z0-9]+)-\d+$/.exec(String(id));
    return m ? { villageSlug: m[1], tierId: m[2] } : null;
}
// Cap how many merc NPCs render in one sector so a stacked siege can't flood the
// board (a band's own remaining count, 3-5, is usually the real limit).
exports.ROAMING_MERC_RENDER_CAP = 6;
/** Pure: flatten the bands hostile to a viewer into individual roaming merc NPCs
 *  (one per remaining merc), capped, each with a stable id. */
function synthRoamingMercs(bands) {
    const out = [];
    for (const b of bands) {
        const n = Math.max(0, Math.floor(b.count));
        for (let i = 0; i < n; i++) {
            if (out.length >= exports.ROAMING_MERC_RENDER_CAP)
                return out;
            out.push({ id: mercNpcId(b.village, b.tierId, i), village: b.village, tierId: b.tierId, level: b.level, context: b.context });
        }
    }
    return out;
}

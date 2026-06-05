"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const session_js_1 = require("./session.js");
const _vanguard_rewards_js_1 = require("./_vanguard-rewards.js");
const online_store_js_1 = require("../_realtime/online-store.js");
// All session writes flow through here so the combat log gets capped
// + the idempotency token ring buffer is appended before it hits KV.
// Without log trim the payload bloats unbounded across a long fight;
// without the token append, retries from network blips could
// double-apply moves.
async function saveSession(key, session, opts = {}) {
    const trimmedLog = (0, session_js_1.trimPvpLog)(session.log);
    const tokens = opts.moveToken
        ? [...(session.recentMoveTokens ?? []), opts.moveToken].slice(-session_js_1.PVP_MOVE_TOKEN_HISTORY)
        : session.recentMoveTokens;
    const next = { ...session, log: trimmedLog, recentMoveTokens: tokens };
    await _storage_js_1.kv.set(key, next, { ex: opts.ex ?? SESSION_TTL });
}
// ─── Grid constants (match arena exactly) ─────────────────────────────────────
const GRID_W = 12;
const GRID_H = 10;
const MAX_ROUNDS = 25;
const MAX_ACTIONS = 5;
// Must match session.ts. 15 min covers the live fight; every move resets
// the TTL via writeSession, so an active match never expires — only
// abandoned ones (a tab closed mid-fight) decay quickly.
const SESSION_TTL = 15 * 60;
// ─── Jutsu safety bounds (re-validated at move time) ──────────────────────────
// session.ts clamps these when the fight is hydrated; we double-check at use
// time so a saved-but-tampered jutsu is rejected even if it survived hydration.
const MOVE_JUTSU_MAX_EFFECT_POWER = 600;
const MOVE_JUTSU_MAX_TAGS = 10;
const KNOWN_TAG_NAMES = new Set([
    'Heal', 'Shield', 'Barrier', 'Pierce', 'Stun', 'Poison', 'Drain', 'Absorb', 'Reflect',
    'Lifesteal', 'Increase Damage Given', 'Decrease Damage Given', 'Increase Damage Taken',
    'Decrease Damage Taken', 'Increase Heal', 'Debuff Prevent', 'Buff Prevent',
    'Cleanse Prevent', 'Clear Prevent', 'Stun Prevent', 'Copy', 'Mirror', 'Push', 'Pull',
    'Bloodline Seal', 'Seal', 'Elemental Seal', 'Wound', 'Recoil', 'Move',
    'Afterburn', 'Ignition', 'Time Compression', 'Lag', 'Time Dilation', 'Overclock',
    'Vamp', 'Siphon',
]);
function jutsuIsSane(j) {
    if (typeof j !== 'object' || !j)
        return false;
    if ((j.effectPower ?? 0) > MOVE_JUTSU_MAX_EFFECT_POWER)
        return false;
    const tags = Array.isArray(j.tags) ? j.tags : [];
    if (tags.length > MOVE_JUTSU_MAX_TAGS)
        return false;
    for (const t of tags) {
        if (!t || typeof t !== 'object')
            return false;
        if (typeof t.name !== 'string' || !KNOWN_TAG_NAMES.has(t.name))
            return false;
    }
    return true;
}
// ─── Combat formula constants (v4.3) ──────────────────────────────────────────
const MAX_STAT = 2500;
// Raw dmg = scaledEp × 32. Calibrated so a round-1 standard 60-AP jutsu
// (EP 40) at A-rank vs A-rank with full Legendary armor + Void Sovereign
// damage set lands at ~1,150 (in the ~875-1,150 target band depending on
// bloodline and armor-set pairing).
const EP_MULTIPLIER = 32;
const K_DR = 0.5; // DR pool soft cap: effDR = raw / (raw + K_DR)
// Damage-amplification soft-cap pool. Mirrors K_DR: IDG (attacker), IDT
// (defender), and Ignition (defender) all feed one pool with diminishing
// returns, so 4 stacks of 35% multiply by ~1.74× instead of ~3.32×.
const K_AMP = 0.5;
const DR_DOT_SCALE = 0.5; // DR mitigation against DoT ticks (0..1)
const HEAL_FLAT = 750; // Heal tag value at max jutsu mastery
const SHIELD_FLAT = 750; // Shield tag value at max jutsu mastery
// Drain: single-stack, scales with attacker mastery → 50..300 per tick
const DRAIN_BASE_TICK = 50;
const DRAIN_PER_LEVEL = 5;
const DRAIN_MAX_TICK = 300;
// Wound: per-instance tick amount = finalDmg × min(tag.pct, rank_cap, hard_cap) / 100
const WOUND_CAP_BY_RANK = {
    basic: 25, // basic / non-bloodline jutsus
    AB: 30, // A and B rank bloodline jutsus
    S: 35, // S rank bloodline jutsus
};
const WOUND_HARD_CAP_PCT = 60;
// AP penalty applied when a Stunned fighter starts their turn. Server-side
// this lives at the next-turn setup in endTurn (baseAp = 100 - STUN_AP_PENALTY).
// Client mirrors via shinobij.client/src/constants/game.ts STUN_AP_PENALTY.
// Pinned by the combat-formula-parity test so this can never drift again.
const STUN_AP_PENALTY = 40;
// Buff/debuff durations: amps run 4 rounds (was 2) so stacking to 2 is reliable
const STATUS_DURATIONS_OVERRIDE = {
    'Increase Damage Given': 4,
    'Increase Damage Taken': 4,
    'Decrease Damage Given': 4,
    'Decrease Damage Taken': 4,
};
function statusDurationFor(name, fallback = 2) {
    return STATUS_DURATIONS_OVERRIDE[name] ?? fallback;
}
// Statuses that allow multiple coexisting instances. Everything else replaces on re-apply.
const STACKABLE_STATUS = new Set([
    'Increase Damage Given', 'Increase Damage Taken', 'Ignition',
    'Decrease Damage Given', 'Decrease Damage Taken',
    'Wound', 'Lifesteal', 'Reflect', 'Absorb',
]);
// ─── Grid helpers (exact match to arena geometry) ─────────────────────────────
function xy(pos) { return { x: pos % GRID_W, y: Math.floor(pos / GRID_W) }; }
function posFromXY(x, y) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H)
        return -1;
    return y * GRID_W + x;
}
function axial(pos) {
    const { x, y } = xy(pos);
    return { q: x, r: y - ((x - (x & 1)) / 2) };
}
function distance(a, b) {
    const A = axial(a);
    const B = axial(b);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}
function hexNeighbors(pos) {
    const { x, y } = xy(pos);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx, y + dy)).filter(n => n >= 0);
}
function nextStepToward(from, to) {
    return hexNeighbors(from).sort((a, b) => distance(a, to) - distance(b, to))[0] ?? from;
}
function barrierTiles(...fighters) {
    return fighters.flatMap(f => f.statuses.filter(s => s.name === 'Barrier' && typeof s.amount === 'number').map(s => s.amount));
}
function tileBlocked(tile, ...fighters) {
    return barrierTiles(...fighters).includes(tile);
}
// Utility jutsu = no damage (status/buff/debuff only). Prefers the explicit
// `isUtility` flag; falls back to the legacy 40-AP convention when absent so
// existing content is unchanged (40-AP jutsu still deal zero damage).
function isZeroDamageFortyApJutsu(jutsu) {
    if (jutsu.isUtility === true)
        return true;
    if (jutsu.isUtility === false)
        return false;
    return jutsu.ap === 40 && jutsu.id !== 'basic-attack' && !jutsu.id.startsWith('item-');
}
function normalizeTagName(name) {
    if (name === 'Seal')
        return 'Bloodline Seal';
    if (name === 'Afterburn')
        return 'Ignition';
    if (name === 'Time Compression')
        return 'Lag';
    if (name === 'Time Dilation')
        return 'Overclock';
    if (name === 'Vamp')
        return 'Siphon';
    return name;
}
function normalizeJutsuMethod(method) {
    if (method === 'AOE_LINE')
        return 'INSTANT_EFFECT';
    return method ?? 'SINGLE';
}
function nameMatches(name, canonicalName) {
    return normalizeTagName(name) === canonicalName;
}
function normalizeEquipmentSlot(slot) {
    if (slot === 'weapon')
        return 'hand';
    if (slot === 'armor')
        return 'body';
    if (slot === 'accessory')
        return 'aura';
    return slot ?? '';
}
function equippedPvpItem(fighter, itemId, itemName) {
    const items = (fighter.character.pvpItems ?? []);
    const equipment = fighter.character.equipment ?? {};
    const equippedIds = new Set(Object.values(equipment).filter((id) => Boolean(id)));
    return items.find(item => Boolean(item.id) &&
        equippedIds.has(item.id) &&
        ((itemId && item.id === itemId) || (!itemId && itemName && item.name === itemName))) ?? null;
}
// ─── Stat helpers ─────────────────────────────────────────────────────────────
function getOffense(stats, type) {
    if (type === 'Taijutsu')
        return (stats.taijutsuOffense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu')
        return (stats.bukijutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu')
        return (stats.genjutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuOffense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function getDefense(stats, type) {
    if (type === 'Taijutsu')
        return (stats.taijutsuDefense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu')
        return (stats.bukijutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu')
        return (stats.genjutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuDefense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function cappedPostDamage(damage, percent) {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}
// v4.3 Wound rank caps. Bloodline rank string → max allowed Wound percent.
// Basic / non-bloodline = 25, A/B rank bloodline = 30, S rank = 35.
function woundCapForJutsu(jutsu) {
    const rank = (jutsu.bloodlineRank ?? '').trim();
    if (/^S/i.test(rank))
        return WOUND_CAP_BY_RANK.S;
    if (/^[AB]/i.test(rank))
        return WOUND_CAP_BY_RANK.AB;
    return WOUND_CAP_BY_RANK.basic;
}
// Pierce v3: stat-scaled true damage with hard cap.
// True damage bypasses DR, shield, absorb, reflect — replaces normal damage.
// Coef tuned so mid-build (composite offense ~3000) caps at 900; low builds get a floor of 100.
function pierceTrueDamage(offenseComposite, jutsuAp, masteryLevel) {
    const apFactor = Math.max(0.5, (jutsuAp || 60) / 60);
    const masteryFactor = 1 + Math.max(0, Math.min(50, masteryLevel)) * 0.005; // +25% at level 50
    const raw = offenseComposite * 0.35 * apFactor * masteryFactor;
    return Math.floor(Math.max(100, Math.min(900, raw)));
}
function weatherMultiplier(element, positiveEl, negativeEl) {
    if (!element || (!positiveEl && !negativeEl))
        return 1;
    if (positiveEl && element === positiveEl)
        return 1.05;
    if (negativeEl && element === negativeEl)
        return 0.98;
    return 1;
}
// Terrain bonuses - match the terrainEffects table on the client exactly:
//   forest  -> +10% Taijutsu
//   snow    -> +10% Bukijutsu
//   volcano -> +10% Ninjutsu
//   shadow  -> +10% Genjutsu
//   central -> no bonus
function terrainMultiplier(jutsu, biome) {
    switch (biome) {
        case 'forest': return jutsu.type === 'Taijutsu' ? 1.1 : 1;
        case 'snow': return jutsu.type === 'Bukijutsu' ? 1.1 : 1;
        case 'volcano': return jutsu.type === 'Ninjutsu' ? 1.1 : 1;
        case 'shadow': return jutsu.type === 'Genjutsu' ? 1.1 : 1;
        default: return 1;
    }
}
// ─── Fighter helpers ──────────────────────────────────────────────────────────
function isStatusActive(status, round) {
    return status.activeRound === undefined || status.activeRound <= round;
}
function activeStatuses(f, round) {
    return f.statuses.filter(status => isStatusActive(status, round));
}
function hasStatus(f, name, round = Number.POSITIVE_INFINITY) {
    return activeStatuses(f, round).some(s => nameMatches(s.name, name));
}
function addStatus(f, s) {
    // v4.3: apply duration override (IDG/IDT/DDG/DDT → 4 rounds), then either stack or replace.
    const adjusted = { ...s, rounds: statusDurationFor(s.name, s.rounds) };
    if (STACKABLE_STATUS.has(adjusted.name)) {
        return { ...f, statuses: [...f.statuses, adjusted] };
    }
    return { ...f, statuses: [...f.statuses.filter(x => !nameMatches(x.name, adjusted.name)), adjusted] };
}
function countActive(f, name, round) {
    return activeStatuses(f, round).filter(s => nameMatches(s.name, name)).length;
}
// Tags resolve next round for ALL jutsus (bloodline or not) except INSTANT_EFFECT
// ground-zone jutsus where the enemy is standing in the zone on cast.
// Mirrors the client-side fix in App.tsx — previously only bloodline jutsus were
// deferred, leaving non-bloodline tags incorrectly instant in PvP.
function bloodlineTagsResolveNextRound(jutsu) {
    return !(jutsu.target === 'EMPTY_GROUND' && normalizeJutsuMethod(jutsu.method) === 'INSTANT_EFFECT');
}
function statusForJutsu(jutsu, status, round) {
    return bloodlineTagsResolveNextRound(jutsu) ? { ...status, activeRound: round + 1 } : status;
}
function addJutsuStatus(f, jutsu, status, round) {
    return addStatus(f, statusForJutsu(jutsu, status, round));
}
function groundEffectTiles(center) {
    return [center, ...hexNeighbors(center)];
}
function groundEffectTags(tags) {
    const allowed = new Set(['Decrease Damage Given', 'Recoil', 'Poison']);
    return tags
        .map(tag => ({ ...tag, name: normalizeTagName(tag.name) }))
        .filter(tag => allowed.has(tag.name));
}
function applyGroundEffectToFighter(fighter, effect) {
    let next = { ...fighter };
    const lines = [];
    if (!effect.tiles.includes(fighter.pos))
        return { fighter: next, lines };
    if (hasStatus(next, 'Debuff Prevent')) {
        lines.push(`${next.name}'s Debuff Prevent blocks ${effect.name}.`);
        return { fighter: next, lines };
    }
    for (const tag of effect.tags) {
        const tagName = normalizeTagName(tag.name);
        const pct = Math.max(1, Math.floor(tag.percent ?? 30));
        if (tagName === 'Decrease Damage Given') {
            next = addStatus(next, { name: 'Decrease Damage Given', rounds: 2, percent: pct, kind: 'negative' });
            lines.push(`${effect.name}: ${next.name} deals ${pct}% less damage for 2 turns.`);
        }
        else if (tagName === 'Recoil') {
            next = addStatus(next, { name: 'Recoil', rounds: 2, percent: pct, kind: 'negative' });
            lines.push(`${effect.name}: ${next.name} suffers ${pct}% recoil on attacks for 2 turns.`);
        }
        else if (tagName === 'Poison') {
            const poisonPct = pct > 0 ? pct : 6;
            const dmg = Math.floor(next.maxChakra * (poisonPct / 100));
            next = addStatus(next, { name: 'Poison', rounds: 2, percent: poisonPct, kind: 'negative' });
            lines.push(`${effect.name}: ${next.name} is poisoned for ~${dmg}/round for 2 turns.`);
        }
    }
    return { fighter: next, lines };
}
function applyGroundEffects(session) {
    let p1 = session.p1;
    let p2 = session.p2;
    const lines = [];
    for (const effect of session.groundEffects ?? []) {
        const targetRole = effect.owner === 'p1' ? 'p2' : 'p1';
        if (targetRole === 'p1') {
            const applied = applyGroundEffectToFighter(p1, effect);
            p1 = applied.fighter;
            lines.push(...applied.lines);
        }
        else {
            const applied = applyGroundEffectToFighter(p2, effect);
            p2 = applied.fighter;
            lines.push(...applied.lines);
        }
    }
    return { session: { ...session, p1, p2 }, lines };
}
function tickGroundEffects(effects) {
    return (effects ?? [])
        .map(effect => ({ ...effect, rounds: effect.rounds - 1 }))
        .filter(effect => effect.rounds > 0);
}
function tickStatuses(f, round) {
    return {
        ...f,
        statuses: f.statuses
            .map(s => isStatusActive(s, round) ? { ...s, rounds: s.rounds - 1 } : s)
            .filter(s => s.rounds > 0),
    };
}
function tickCooldowns(cds) {
    const next = {};
    for (const [k, v] of Object.entries(cds))
        if (v > 1)
            next[k] = v - 1;
    return next;
}
// Raw DR contribution from defensive status effects.
// v4.3: DDT/DDG are stackable; each instance contributes its percent to the DR pool.
// Soft-capped via K_DR so stacking always helps but with diminishing returns.
function drContributionFor(attacker, defender, round) {
    let dr = 0;
    for (const s of activeStatuses(attacker, round)) {
        if (s.name === 'Decrease Damage Given')
            dr += (s.percent ?? 0) / 100;
    }
    for (const s of activeStatuses(defender, round)) {
        if (s.name === 'Decrease Damage Taken')
            dr += (s.percent ?? 0) / 100;
    }
    return dr;
}
// Amplifiers (offensive / vulnerability buffs). All amp tags feed a single
// diminishing-returns pool, mirroring K_DR for defensive stacks:
//     rawAmp     = Σ(IDG attacker) + Σ(IDT defender) + Σ(Ignition defender)
//     effective  = rawAmp / (rawAmp + K_AMP)        ← always < 1, soft-caps
//     multiplier = 1 + effective
// Stack 1 of 35% gives ~1.41×; stack 4 of 35% gives ~1.74× (was ~3.32×).
// Also stops the IDG-+-Ignition combo from compounding past the soft cap.
function ampMultiplierFor(attacker, defender, round) {
    let rawAmp = 0;
    for (const s of activeStatuses(attacker, round)) {
        if (s.name === 'Increase Damage Given')
            rawAmp += (s.percent ?? 0) / 100;
    }
    for (const s of activeStatuses(defender, round)) {
        if (s.name === 'Increase Damage Taken')
            rawAmp += (s.percent ?? 0) / 100;
        else if (nameMatches(s.name, 'Ignition'))
            rawAmp += (s.percent ?? 0) / 100;
    }
    if (rawAmp <= 0)
        return 1;
    return 1 + rawAmp / (rawAmp + K_AMP);
}
// Scale a tag percent by mastery level — mirrors the client's effectiveTagPercent logic:
//   level 50 = full stored value, each level below 50 subtracts 0.2 from the raw percent.
function scaledTagPercent(rawPct, masteryLevel) {
    const raw = rawPct > 0 ? rawPct : 30;
    return Math.max(0, raw - (50 - masteryLevel) * 0.2);
}
// ─── Jutsu application (3-bucket formula, all tags) ───────────────────────────
function applyJutsu(self, opponent, jutsu, wMult = 1, biome = 'central', round = 1) {
    // Use jutsu mastery level (0–50) for EP scaling so trained jutsus hit harder in PvP.
    // Falls back to 0 if the jutsu has never been trained (no bonus).
    const jutsuMasteries = self.character.jutsuMastery ?? [];
    const masteryEntry = jutsuMasteries.find(m => m.jutsuId === jutsu.id);
    const masteryLevel = Math.max(0, Math.min(50, masteryEntry?.level ?? 0));
    const scaledEp = isZeroDamageFortyApJutsu(jutsu) ? 0 : (jutsu.effectPower ?? 20) + masteryLevel * 0.2;
    const offStats = self.character.stats ?? {};
    const defStats = opponent.character.stats ?? {};
    // statFactor = 1 + (off - def) * 0.85 / (MAX_STAT * 2), clamped [0.35, 1.85].
    // Identity at off == def (so maxed-vs-maxed stays balanced at 1.0× exactly,
    // matching the previous v4.3 max-stat assumption). Mirrors the client's
    // calculateDamage() in App.tsx so the displayed damage preview agrees with
    // the server-resolved damage outside max-vs-max matchups.
    const offense = getOffense(offStats, jutsu.type);
    const defense = getDefense(defStats, jutsu.type);
    const statFactor = Math.max(0.35, Math.min(1.85, 1 + ((offense - defense) / (MAX_STAT * 2)) * 0.85));
    // Bloodline mult: pre-computed on the client (1.0 if absent). v4.3 keeps the seal interaction.
    const bloodlineMult = (hasStatus(self, 'Bloodline Seal', round) || hasStatus(self, 'Seal', round)) ? 1.0 : Math.max(1.0, Number(self.character.bloodlineMult ?? 1.0));
    // Item damage bonus.
    const itemDamageMult = 1 + Math.max(0, Number(self.character.itemDamagePct ?? 0)) / 100;
    // Terrain bonus: +10% when jutsu type/element matches the current biome
    const tMult = terrainMultiplier(jutsu, biome);
    // v4.3 raw damage = scaledEp × 40 (EP table). Decoupled from maxHp — all max-level players
    // have similar maxHp anyway, and this gives a tunable damage curve independent of HP scaling.
    const baseDmg = Math.max(0, Math.floor(scaledEp * EP_MULTIPLIER * statFactor * wMult * tMult * bloodlineMult * itemDamageMult));
    // ── Defensive DR pool (diminishing returns) ───────────────────────────────
    // armorRawDR: raw sum of per-piece reductions (e.g. 7×0.15 + 0.08 Guardian = 1.13).
    // Falls back to deriving from old armorFactor for sessions created before this update.
    const armorRawDR = (opponent.character.armorRawDR !== undefined && opponent.character.armorRawDR !== null)
        ? Math.min(1.5, Math.max(0, Number(opponent.character.armorRawDR)))
        : Math.max(0, 1 - Math.min(1.0, Math.max(0.25, Number(opponent.character.armorFactor ?? 1.0))));
    // Status DR feeds the same pool — every point still reduces damage, just with diminishing returns.
    const rawStatusDR = drContributionFor(self, opponent, round);
    const rawTotalDR = armorRawDR + rawStatusDR;
    // effectiveDR = rawTotal / (rawTotal + K_DR)  →  always < 1, always grows with more DR
    const effectiveDR = rawTotalDR > 0 ? rawTotalDR / (rawTotalDR + K_DR) : 0;
    const tags = jutsu.tags ?? [];
    const lines = [];
    let s = { ...self };
    let o = { ...opponent };
    let damage = baseDmg;
    let healing = 0;
    let shieldGain = 0;
    let pierce = false;
    const healBoost = s.statuses
        .filter(st => isStatusActive(st, round) && st.name === 'Increase Heal')
        .reduce((mult, st) => mult * (1 + (st.percent ?? 0) / 100), 1);
    for (const tag of tags) {
        const tagName = normalizeTagName(tag.name);
        const pct = Math.floor(scaledTagPercent(tag.percent ?? 0, masteryLevel));
        if (tag.name === 'Heal') {
            healing += Math.floor(HEAL_FLAT * healBoost);
            damage = 0;
            lines.push(`Heal: ${s.name} restores ${Math.floor(HEAL_FLAT * healBoost)} HP.`);
            continue;
        }
        if (tag.name === 'Shield') {
            shieldGain += SHIELD_FLAT;
            damage = 0;
            lines.push(`Shield: ${s.name} gains ${SHIELD_FLAT} shield.`);
            continue;
        }
        if (tag.name === 'Barrier') {
            const tile = nextStepToward(s.pos, o.pos);
            if (tile !== s.pos && tile !== o.pos) {
                s = addStatus(s, { name: 'Barrier', rounds: 2, amount: tile, kind: 'positive' });
                lines.push(`Barrier: ${s.name} blocks hex ${tile} for 2 turns.`);
            }
            else
                lines.push(`Barrier: no room to place a wall.`);
            damage = 0;
            continue;
        }
        if (tag.name === 'Pierce') {
            pierce = true;
            lines.push(`Pierce: bypasses defenses.`);
            continue;
        }
        if (tag.name === 'Stun') {
            if (!hasStatus(o, 'Debuff Prevent', round) && !hasStatus(o, 'Stun Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: 'Stun', rounds: 1, kind: 'negative' }, round);
                lines.push(`Stun: ${o.name} loses 40 AP next turn.`);
            }
            continue;
        }
        if (tag.name === 'Poison') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                const poisonPct = pct > 0 ? pct : 6;
                const dmg = Math.floor(o.maxChakra * (poisonPct / 100));
                o = addJutsuStatus(o, jutsu, { name: 'Poison', rounds: 2, percent: poisonPct, kind: 'negative' }, round);
                lines.push(`Poison: ${o.name} takes ~${dmg}/round for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Drain') {
            // v4.3: Drain is single-stack (addStatus replaces on re-apply) and scales with attacker mastery.
            // Tick = clamp(50 + masteryLevel × 5, 50, 300). At mastery 50: 300/tick.
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                const drainTick = Math.max(DRAIN_BASE_TICK, Math.min(DRAIN_MAX_TICK, DRAIN_BASE_TICK + masteryLevel * DRAIN_PER_LEVEL));
                o = addJutsuStatus(o, jutsu, { name: 'Drain', rounds: 2, amount: drainTick, kind: 'negative' }, round);
                lines.push(`Drain: ${o.name} loses ${drainTick} HP+chakra/turn for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Absorb') {
            if (!hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Absorb', rounds: 2, percent: pct, kind: 'positive' }, round);
                lines.push(`Absorb: ${s.name} converts ${pct}% incoming damage for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Reflect') {
            if (!hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Reflect', rounds: 2, percent: pct, kind: 'positive' }, round);
                lines.push(`Reflect: ${s.name} reflects ${pct}% damage for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Lifesteal') {
            if (!hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Lifesteal', rounds: 2, percent: pct, kind: 'positive' }, round);
                lines.push(`Lifesteal: ${s.name} heals on hit for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Increase Damage Given') {
            if (!hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Increase Damage Given', rounds: 2, percent: pct, kind: 'positive' }, round);
                lines.push(`+${pct}% Damage Given: ${s.name} for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Decrease Damage Given') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: 'Decrease Damage Given', rounds: 2, percent: pct, kind: 'negative' }, round);
                lines.push(`-${pct}% Damage Given: ${o.name} for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Increase Damage Taken') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: 'Increase Damage Taken', rounds: 2, percent: pct, kind: 'negative' }, round);
                lines.push(`+${pct}% Damage Taken: ${o.name} for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Decrease Damage Taken') {
            if (!hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Decrease Damage Taken', rounds: 2, percent: pct, kind: 'positive' }, round);
                lines.push(`-${pct}% Damage Taken: ${s.name} for 2 turns.`);
            }
            continue;
        }
        if (tagName === 'Ignition') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: 'Ignition', rounds: 2, percent: pct, kind: 'negative' }, round);
                lines.push(`Ignition: ${o.name} +${pct}% damage taken for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Debuff Prevent') {
            s = addJutsuStatus(s, jutsu, { name: 'Debuff Prevent', rounds: 2, kind: 'positive' }, round);
            lines.push(`Debuff Prevent: ${s.name} for 2 turns.`);
            continue;
        }
        if (tag.name === 'Buff Prevent') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: 'Buff Prevent', rounds: 2, kind: 'negative' }, round);
                lines.push(`Buff Prevent: ${o.name} cannot gain positive effects for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Cleanse Prevent') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' }, round);
                lines.push(`Cleanse Prevent: ${o.name} cannot cleanse debuffs for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Clear Prevent') {
            if (!hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Clear Prevent', rounds: 2, kind: 'positive' }, round);
                lines.push(`Clear Prevent: ${s.name}'s buffs cannot be cleared for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Stun Prevent') {
            s = addJutsuStatus(s, jutsu, { name: 'Stun Prevent', rounds: 2, kind: 'positive' }, round);
            lines.push(`Stun Prevent: ${s.name} is immune to Stun for 2 turns.`);
            continue;
        }
        if (tag.name === 'Copy') {
            const copied = activeStatuses(o, round).filter(st => st.kind === 'positive');
            copied.forEach(st => { s = addJutsuStatus(s, jutsu, { ...st }, round); });
            lines.push(`Copy: ${s.name} copied ${copied.length ? copied.map(st => st.name).join(', ') : 'nothing'} from ${o.name}.`);
            continue;
        }
        if (tag.name === 'Mirror') {
            // Copies caster's non-DoT debuffs onto the opponent. Debuffs stay
            // on the caster too — Mirror is "spread the pain", not "free
            // cleanse + transfer". Sim showed the old transfer behavior let
            // Disruption builds win 100% vs setup-heavy opponents.
            const mirrored = activeStatuses(s, round).filter(st => st.kind === 'negative'
                && st.name !== 'Wound' && !nameMatches(st.name, 'Ignition')
                && st.name !== 'Poison' && st.name !== 'Drain');
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                mirrored.forEach(st => { o = addJutsuStatus(o, jutsu, { ...st }, round); });
                lines.push(`Mirror: ${s.name} copies ${mirrored.length ? mirrored.map(st => st.name).join(', ') : 'no debuffs'} onto ${o.name}.`);
            }
            continue;
        }
        if (tagName === 'Lag') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: 'Lag', rounds: 1, percent: pct || 20, kind: 'negative' }, round);
                lines.push(`Lag: ${o.name}'s actions cost ${pct || 20}% more AP for 1 turn.`);
            }
            continue;
        }
        if (tagName === 'Overclock') {
            if (!hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Overclock', rounds: 1, percent: pct || 20, kind: 'positive' }, round);
                lines.push(`Overclock: ${s.name}'s actions cost ${pct || 20}% less AP for 1 turn.`);
            }
            continue;
        }
        if (tag.name === 'Increase Heal') {
            if (!hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Increase Heal', rounds: 2, percent: pct, kind: 'positive' }, round);
                lines.push(`Increase Heal: ${s.name}'s healing is increased by ${pct}% for 2 turns.`);
            }
            continue;
        }
        if (tag.name === 'Push') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                const dist = Math.max(1, Number(jutsu.range) || 1);
                if (bloodlineTagsResolveNextRound(jutsu)) {
                    o = addJutsuStatus(o, jutsu, { name: 'Push', rounds: 1, amount: dist, kind: 'negative' }, round);
                    lines.push(`Push: ${o.name} will be pushed ${dist} tile(s) next round.`);
                }
                else {
                    let nextPos = o.pos;
                    for (let step = 0; step < dist; step++) {
                        const away = hexNeighbors(nextPos).filter(t => distance(t, s.pos) > distance(nextPos, s.pos) && t !== s.pos && !tileBlocked(t, s, o));
                        if (!away.length)
                            break;
                        nextPos = away[0];
                    }
                    o = { ...o, pos: nextPos };
                    lines.push(`Push: ${o.name} is pushed ${dist} tile(s).`);
                }
            }
            continue;
        }
        if (tag.name === 'Pull') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                const dist = Math.max(1, Number(jutsu.range) || 1);
                if (bloodlineTagsResolveNextRound(jutsu)) {
                    o = addJutsuStatus(o, jutsu, { name: 'Pull', rounds: 1, amount: dist, kind: 'negative' }, round);
                    lines.push(`Pull: ${o.name} will be pulled ${dist} tile(s) next round.`);
                }
                else {
                    let nextPos = o.pos;
                    for (let step = 0; step < dist; step++) {
                        const toward = hexNeighbors(nextPos).filter(t => distance(t, s.pos) < distance(nextPos, s.pos) && t !== s.pos && !tileBlocked(t, s, o));
                        if (!toward.length)
                            break;
                        nextPos = toward[0];
                    }
                    o = { ...o, pos: nextPos };
                    lines.push(`Pull: ${o.name} is pulled ${dist} tile(s).`);
                }
            }
            continue;
        }
        if (tag.name === 'Bloodline Seal' || tag.name === 'Seal') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: 'Bloodline Seal', rounds: 2, kind: 'negative' }, round);
                lines.push(`Bloodline Seal: ${o.name}'s bloodline is sealed.`);
            }
            continue;
        }
        if (tag.name === 'Elemental Seal') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                o = addJutsuStatus(o, jutsu, { name: tag.name, rounds: 1, kind: 'negative' }, round);
                lines.push(`${tag.name}: ${o.name}'s elemental jutsu are sealed.`);
            }
            continue;
        }
        // Recoil is a flat-percent debuff that must apply regardless of THIS
        // jutsu's damage — a zero-damage 40-AP utility jutsu carrying Recoil
        // still seeds it (matches the client/PvE, which applies it
        // unconditionally). The self-damage from HAVING Recoil is resolved in
        // the damage block below (gated on finalDmg, which is correct). Uses the
        // raw tag percent (un-scaled), exactly as the previous in-damage path did.
        if (tag.name === 'Recoil') {
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                const rPct = (tag.percent ?? 0) || 30;
                o = addJutsuStatus(o, jutsu, { name: 'Recoil', rounds: 2, percent: rPct, kind: 'negative' }, round);
                lines.push(`Recoil: ${o.name} will suffer ${rPct}% recoil on their attacks for 2 turns.`);
            }
            continue;
        }
    }
    if (pierce) {
        // v3: replaces the old binary "900 if ap≥60 else 0" with offense-scaled true damage.
        // True damage bypasses DR, shield, absorb, reflect (handled below by skipping those paths).
        damage = pierceTrueDamage(getOffense(offStats, jutsu.type), jutsu.ap ?? 40, masteryLevel);
    }
    else {
        // Amplifiers (Increase Damage Given, Increase Damage Taken, Ignition) apply at full value.
        const ampMult = ampMultiplierFor(self, opponent, round);
        // DR is already computed above as effectiveDR ∈ [0, 1).
        // Armor, DDT, and DDG all feed the same pool — more always helps, but with diminishing returns.
        damage = Math.max(0, Math.floor(damage * (1 - effectiveDR) * ampMult));
    }
    // ── Post-damage consequence pipeline (resolution order is load-bearing) ──
    // Every consequence below reads the FINAL post-mitigation damage (finalDmg),
    // so the order is fixed and documented here to keep it auditable / drift-free:
    //   1. shield block         → finalDmg = damage − blocked
    //   2. reflect (status)      % of finalDmg back to the attacker
    //   3. absorb (status)       % of finalDmg healed to the defender
    //   4. item absorb / reflect / lifesteal (named-armor passives)
    //   5. wound                 bleed seeded from finalDmg (rank-capped)
    //   6. recoil (status)       attacker self-damage from their own hit
    //   7. lifesteal (status)    attacker heal from finalDmg
    //   8. siphon                attacker heal from finalDmg
    // All post-damage effects are capped at 60% of finalDmg via cappedPostDamage().
    // Pierce skips shield/reflect/absorb (true damage). Reordering changes outcomes.
    if (damage > 0) {
        const blocked = pierce ? 0 : Math.min(o.shield, damage);
        const finalDmg = Math.max(0, damage - blocked);
        const reflect = activeStatuses(o, round).find(st => st.name === 'Reflect');
        const reflectedDmg = reflect && !pierce ? cappedPostDamage(finalDmg, reflect.percent ?? 30) : 0;
        const defAbsorb = activeStatuses(o, round).find(st => st.name === 'Absorb');
        const absorbHeal = defAbsorb && !pierce ? cappedPostDamage(finalDmg, defAbsorb.percent ?? 30) : 0;
        // Named-armor passives (stack with status-based versions above).
        // Percentages are clamped to [0, 100] at session merge; pierce
        // jutsus bypass them all the same way they bypass DR / shield.
        const itemAbsorbPct = Math.max(0, Math.min(100, Number(o.character.itemAbsorbPct ?? 0)));
        const itemReflectPct = Math.max(0, Math.min(100, Number(o.character.itemReflectPct ?? 0)));
        const itemLifeStealPct = Math.max(0, Math.min(100, Number(s.character.itemLifeStealPct ?? 0)));
        const itemAbsorbHeal = !pierce && itemAbsorbPct > 0 ? Math.floor(cappedPostDamage(finalDmg, itemAbsorbPct)) : 0;
        const itemReflectedDmg = !pierce && itemReflectPct > 0 ? Math.floor(cappedPostDamage(finalDmg, itemReflectPct)) : 0;
        const itemLifeStealHeal = !pierce && itemLifeStealPct > 0 ? Math.floor(cappedPostDamage(finalDmg, itemLifeStealPct)) : 0;
        o = { ...o, hp: Math.max(0, o.hp - finalDmg), shield: Math.max(0, o.shield - damage) };
        if (absorbHeal > 0)
            o = { ...o, hp: Math.min(o.maxHp, o.hp + absorbHeal) };
        if (itemAbsorbHeal > 0)
            o = { ...o, hp: Math.min(o.maxHp, o.hp + itemAbsorbHeal) };
        if (blocked > 0)
            lines.push(`${blocked} absorbed by ${o.name}'s shield.`);
        if (finalDmg > 0)
            lines.push(`${finalDmg} damage to ${o.name}.`);
        if (absorbHeal > 0)
            lines.push(`${o.name} absorbs ${absorbHeal} HP.`);
        if (itemAbsorbHeal > 0)
            lines.push(`${o.name}'s armor absorbs ${itemAbsorbHeal} HP.`);
        if (reflectedDmg > 0) {
            s = { ...s, hp: Math.max(0, s.hp - reflectedDmg) };
            lines.push(`${s.name} takes ${reflectedDmg} reflected damage.`);
        }
        if (itemReflectedDmg > 0) {
            s = { ...s, hp: Math.max(0, s.hp - itemReflectedDmg) };
            lines.push(`${s.name} takes ${itemReflectedDmg} damage reflected by ${o.name}'s armor.`);
        }
        if (itemLifeStealHeal > 0) {
            s = { ...s, hp: Math.min(s.maxHp, s.hp + itemLifeStealHeal) };
            lines.push(`${s.name}'s armor steals ${itemLifeStealHeal} HP.`);
        }
        for (const tag of tags) {
            const pct = tag.percent ?? 0;
            if (tag.name === 'Wound' && !hasStatus(o, 'Debuff Prevent', round)) {
                // v4.3: Wound bleeds finalDmg × min(tag.pct, rank_cap, 60%) per tick.
                // Basic jutsus cap at 25%, A/B-rank bloodline at 30%, S-rank at 35%.
                const rankCap = woundCapForJutsu(jutsu);
                const effectivePct = Math.min(pct || 30, rankCap, WOUND_HARD_CAP_PCT);
                const amt = cappedPostDamage(finalDmg, effectivePct);
                o = addJutsuStatus(o, jutsu, { name: 'Wound', rounds: 2, amount: amt, kind: 'negative' }, round);
                lines.push(`Wound: ${o.name} bleeds ${amt}/turn for 2 turns.`);
            }
            // Recoil debuff application moved to the main tag loop above so it
            // applies even on zero-damage utility jutsu. (Self-recoil damage is
            // still resolved below, gated on finalDmg.)
            if (normalizeTagName(tag.name) === 'Siphon') {
                const h = Math.floor(cappedPostDamage(finalDmg, pct || 30) * healBoost);
                s = { ...s, hp: Math.min(s.maxHp, s.hp + h) };
                lines.push(`Siphon: ${s.name} heals ${h} HP.`);
            }
        }
        const recoilStatus = activeStatuses(s, round).find(st => st.name === 'Recoil');
        if (recoilStatus && finalDmg > 0) {
            const rc = cappedPostDamage(finalDmg, recoilStatus.percent ?? 30);
            s = { ...s, hp: Math.max(0, s.hp - rc) };
            lines.push(`Recoil: ${s.name} takes ${rc} recoil damage from their own attack.`);
        }
        const ls = activeStatuses(s, round).find(st => st.name === 'Lifesteal');
        if (ls && finalDmg > 0) {
            const h = Math.floor(cappedPostDamage(finalDmg, ls.percent ?? 30) * healBoost);
            s = { ...s, hp: Math.min(s.maxHp, s.hp + h) };
            lines.push(`Lifesteal: ${s.name} heals ${h} HP.`);
        }
    }
    if (healing > 0)
        s = { ...s, hp: Math.min(s.maxHp, s.hp + healing) };
    if (shieldGain > 0)
        s = { ...s, shield: s.shield + shieldGain };
    return { self: s, opponent: o, lines };
}
// ─── DoTs applied at start of each turn ───────────────────────────────────────
// v4.3: DoT ticks are partially mitigated by the defender's own DR pool (armor + DDT stacks),
// scaled by DR_DOT_SCALE so DoT can't be made fully invulnerable.
function applyDoTs(fighter, round) {
    const lines = [];
    let f = { ...fighter };
    // Compute own DR pool against incoming DoT.
    const ownArmor = (f.character.armorRawDR !== undefined && f.character.armorRawDR !== null)
        ? Math.min(1.5, Math.max(0, Number(f.character.armorRawDR)))
        : Math.max(0, 1 - Math.min(1.0, Math.max(0.25, Number(f.character.armorFactor ?? 1.0))));
    let ownStatusDR = 0;
    for (const s of activeStatuses(f, round)) {
        if (s.name === 'Decrease Damage Taken')
            ownStatusDR += (s.percent ?? 0) / 100;
    }
    const ownEffDR = (ownArmor + ownStatusDR) > 0 ? (ownArmor + ownStatusDR) / ((ownArmor + ownStatusDR) + K_DR) : 0;
    const dotMitigation = Math.max(0, 1 - ownEffDR * DR_DOT_SCALE);
    const mit = (raw) => Math.max(0, Math.floor(raw * dotMitigation));
    for (const s of activeStatuses(f, round)) {
        if (s.name === 'Wound' && s.amount) {
            const dmg = mit(s.amount);
            f = { ...f, hp: Math.max(0, f.hp - dmg) };
            lines.push(`${f.name} bleeds ${dmg} (Wound).`);
        }
        if (s.name === 'Poison') {
            const poisonPct = s.percent && s.percent > 0 ? s.percent : 6;
            const dmg = mit(Math.floor(f.maxChakra * (poisonPct / 100)));
            f = { ...f, hp: Math.max(0, f.hp - dmg), chakra: Math.max(0, f.chakra - dmg) };
            lines.push(`${f.name} takes ${dmg} Poison damage.`);
        }
        if (s.name === 'Drain') {
            const amt = mit(s.amount ?? DRAIN_BASE_TICK);
            f = { ...f, hp: Math.max(0, f.hp - amt), chakra: Math.max(0, f.chakra - amt) };
            lines.push(`${f.name} drained ${amt} HP+chakra.`);
        }
    }
    return { fighter: f, lines };
}
// ─── Win check ────────────────────────────────────────────────────────────────
function applyQueuedMovement(target, source, round) {
    let fighter = { ...target };
    const lines = [];
    const movementStatuses = activeStatuses(fighter, round).filter(status => status.name === 'Push' || status.name === 'Pull');
    for (const status of movementStatuses) {
        const dist = Math.max(1, status.amount ?? 1);
        let nextPos = fighter.pos;
        for (let step = 0; step < dist; step++) {
            const candidates = hexNeighbors(nextPos).filter(tile => {
                if (tile === source.pos || tileBlocked(tile, fighter, source))
                    return false;
                return status.name === 'Push'
                    ? distance(tile, source.pos) > distance(nextPos, source.pos)
                    : distance(tile, source.pos) < distance(nextPos, source.pos);
            });
            if (!candidates.length)
                break;
            nextPos = candidates[0];
        }
        fighter = { ...fighter, pos: nextPos };
        lines.push(`${status.name}: ${fighter.name} is ${status.name === 'Push' ? 'pushed' : 'pulled'} ${dist} tile(s).`);
    }
    if (movementStatuses.length) {
        fighter = { ...fighter, statuses: fighter.statuses.filter(status => !movementStatuses.includes(status)) };
    }
    return { fighter, lines };
}
function checkWinner(s) {
    if (s.status === 'done')
        return s;
    const { p1, p2 } = s;
    const lines = [];
    let status = 'active';
    let winner = null;
    if (p1.hp <= 0 && p2.hp <= 0) {
        status = 'done';
        winner = 'draw';
        lines.push('Both fighters fall! Draw!');
    }
    else if (p1.hp <= 0) {
        status = 'done';
        winner = 'p2';
        lines.push(`⚔️ ${p2.name} wins!`);
    }
    else if (p2.hp <= 0) {
        status = 'done';
        winner = 'p1';
        lines.push(`⚔️ ${p1.name} wins!`);
    }
    else if (s.round > MAX_ROUNDS) {
        status = 'done';
        if (p1.hp > p2.hp) {
            winner = 'p1';
            lines.push(`Time limit! ${p1.name} wins by HP!`);
        }
        else if (p2.hp > p1.hp) {
            winner = 'p2';
            lines.push(`Time limit! ${p2.name} wins by HP!`);
        }
        else {
            winner = 'draw';
            lines.push('Time limit! Draw!');
        }
    }
    return { ...s, status, winner, log: lines.length ? [...s.log, ...lines] : s.log };
}
// ─── End active player's turn, hand off to the other ──────────────────────────
function endTurn(session) {
    const current = session.activePlayer;
    const next = current === 'p1' ? 'p2' : 'p1';
    const newRound = current === 'p2' ? session.round + 1 : session.round;
    const lines = [];
    if (newRound > session.round)
        lines.push(`--- Round ${newRound} ---`);
    // Tick current player's statuses + cooldowns
    let s = { ...session };
    if (newRound > session.round) {
        s = { ...s, groundEffects: tickGroundEffects(s.groundEffects) };
    }
    if (current === 'p1') {
        s = { ...s, p1: tickStatuses(s.p1, session.round), cooldowns: { ...s.cooldowns, p1: tickCooldowns(s.cooldowns.p1) } };
    }
    else {
        s = { ...s, p2: tickStatuses(s.p2, session.round), cooldowns: { ...s.cooldowns, p2: tickCooldowns(s.cooldowns.p2) } };
    }
    // No chakra or stamina regen during PvP — resources are finite per fight.
    // Apply DoTs to the next player at start of their turn
    let nextFighter = next === 'p1' ? s.p1 : s.p2;
    const groundApplied = applyGroundEffects(s);
    s = groundApplied.session;
    nextFighter = next === 'p1' ? s.p1 : s.p2;
    lines.push(...groundApplied.lines);
    const otherFighter = next === 'p1' ? s.p2 : s.p1;
    const moved = applyQueuedMovement(nextFighter, otherFighter, newRound);
    nextFighter = moved.fighter;
    lines.push(...moved.lines);
    const dots = applyDoTs(nextFighter, newRound);
    nextFighter = dots.fighter;
    lines.push(...dots.lines);
    s = next === 'p1' ? { ...s, p1: nextFighter } : { ...s, p2: nextFighter };
    s = checkWinner({ ...s, round: newRound, log: lines.length ? [...s.log, ...lines] : s.log });
    if (s.status === 'done')
        return s;
    // Stun applies a flat AP penalty instead of skipping the turn entirely.
    // STUN_AP_PENALTY is pinned by the combat-formula-parity test against the
    // client's constants/game.ts so the two halves can't drift.
    const stunStatus = activeStatuses(nextFighter, newRound).find(st => st.name === 'Stun');
    const baseAp = stunStatus ? Math.max(0, 100 - STUN_AP_PENALTY) : 100;
    if (stunStatus) {
        const unstunned = { ...nextFighter, statuses: nextFighter.statuses.filter(st => st.name !== 'Stun') };
        // Append to s.log directly: `lines` was already merged into s.log above
        // (via checkWinner) before this point, so a late lines.push() here was
        // silently dropped — the stun message never reached the combat log.
        const stunMsg = `${nextFighter.name} is stunned — starts turn with ${baseAp} AP.`;
        s = next === 'p1'
            ? { ...s, p1: unstunned, log: [...s.log, stunMsg] }
            : { ...s, p2: unstunned, log: [...s.log, stunMsg] };
    }
    // Lag: next player's AP costs increase by percent
    // Overclock: next player's AP costs decrease by percent — stored on fighter, applied by canAct in handler
    // Both are status effects already applied; the handler reads them via the session
    return { ...s, activePlayer: next, ap: { ...s.ap, [next]: baseAp }, actionsThisTurn: 0 };
}
// ─── Handler ──────────────────────────────────────────────────────────────────
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Move cadence: legitimate gameplay caps at ~1 action/sec with the 45s
    // round timer + 5 actions/round; 120/min is roughly 4× that, leaving
    // headroom for retries and the AFK-fallback POSTs while blocking
    // scripted spam (which would also tank the move-lock NX path).
    //
    // Peek the body for a player name BEFORE the limiter so the budget is
    // keyed per-name when available — IP-only keys mean a NAT'd / mobile-
    // tower IP shares the 120/min budget across every real user behind it.
    // The actual auth check happens further down; this peek only feeds the
    // limiter key, it's not a trust signal.
    const moveBodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const movePeekName = typeof moveBodyPeek?.playerName === 'string' ? moveBodyPeek.playerName : undefined;
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pvp-move', 120, 60_000, movePeekName)))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        // NOTE: biome and weather* are intentionally NOT read from the body —
        // they were a trust-the-client hole. We pull them from the session
        // that was sealed at create time.
        const { battleId, role, action, tile, jutsuId, itemId, itemName, auto, moveToken } = body;
        if (!battleId || !role || !action)
            return res.status(400).json({ error: 'Missing battleId, role, or action' });
        const key = `pvp:${battleId}`;
        const sessionMaybe = await _storage_js_1.kv.get(key);
        if (!sessionMaybe)
            return res.status(404).json({ error: 'Battle session not found' });
        const session = sessionMaybe;
        // Idempotency: if the client's moveToken matches a recently
        // applied move, return the current session without re-applying.
        // Stops a retried request (network blip, double-tap) from
        // double-applying the move.
        if (moveToken && Array.isArray(session.recentMoveTokens) && session.recentMoveTokens.includes(moveToken)) {
            return res.status(200).json(session);
        }
        // Environment is read from the session — clients can't override it.
        const biome = session.biome ?? 'central';
        const weatherPositiveElement = session.weatherPositiveElement ?? '';
        const weatherNegativeElement = session.weatherNegativeElement ?? '';
        if (session.status === 'done')
            return res.status(200).json(session);
        // Out-of-turn actions are ignored — EXCEPT 'claim-afk-win', which is by
        // definition submitted by the INACTIVE player (the one claiming the
        // active player went AFK). Letting only that action through the guard;
        // the switch case re-validates that the claimant is indeed inactive.
        if (session.activePlayer !== role && action !== 'claim-afk-win') {
            return res.status(200).json(session);
        }
        // Verify the requester actually owns the role they're moving as.
        // Without this, anyone could submit moves on another player's behalf.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin) {
            const claimedFighter = role === 'p1' ? session.p1 : session.p2;
            const claimedName = (0, _utils_js_1.safeName)(String(claimedFighter.name ?? ''));
            if (claimedName !== identity.name) {
                return res.status(403).json({ error: 'Cannot move as another player.' });
            }
        }
        const lockKey = `${key}:lock`;
        const lockToken = `${role}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        // Per-session move lock, 3s TTL. The critical section is <50ms in the
        // common case; 3s is generous headroom while still releasing quickly if
        // a process dies mid-move. A contended move just returns the current
        // session (the client polls/retries). Reward idempotency does NOT rely
        // on this lock — terminal grants use a durable NX receipt keyed on the
        // battleId (see _vanguard-rewards.ts), so even a lock-expiry + replay
        // can't double-pay.
        const lockResult = await _storage_js_1.kv.set(lockKey, lockToken, { nx: true, ex: 3 });
        if (!lockResult)
            return res.status(200).json(session);
        async function finish(payload) {
            await _storage_js_1.kv.del(lockKey).catch(() => undefined);
            return res.status(200).json(payload);
        }
        const me = role === 'p1' ? session.p1 : session.p2;
        const opp = role === 'p1' ? session.p2 : session.p1;
        const myCooldowns = role === 'p1' ? session.cooldowns.p1 : session.cooldowns.p2;
        const myAp = role === 'p1' ? session.ap.p1 : session.ap.p2;
        const lines = [];
        // Apply Lag (costs more) and Overclock (costs less) to AP
        function adjustedCost(base) {
            let cost = base;
            const compression = activeStatuses(me, session.round).find(st => nameMatches(st.name, 'Lag'));
            const dilation = activeStatuses(me, session.round).find(st => nameMatches(st.name, 'Overclock'));
            if (compression)
                cost = Math.ceil(cost * (1 + (compression.percent ?? 20) / 100));
            if (dilation)
                cost = Math.floor(cost * (1 - (dilation.percent ?? 20) / 100));
            return Math.max(1, cost);
        }
        function canAct(cost) { return myAp >= adjustedCost(cost) && session.actionsThisTurn < MAX_ACTIONS; }
        function commit(updMe, updOpp, apCost, cd, extra) {
            let s = { ...session, ...extra };
            if (updMe)
                s = role === 'p1' ? { ...s, p1: updMe } : { ...s, p2: updMe };
            if (updOpp)
                s = role === 'p1' ? { ...s, p2: updOpp } : { ...s, p1: updOpp };
            s = { ...s, ap: { ...s.ap, [role]: myAp - adjustedCost(apCost) }, actionsThisTurn: s.actionsThisTurn + 1 };
            if (cd)
                s = { ...s, cooldowns: { ...s.cooldowns, [role]: { ...myCooldowns, ...cd } } };
            if (lines.length)
                s = { ...s, log: [...s.log, ...lines] };
            // Stamp lastMoveAt + reset this player's AFK counter (any real
            // action ends the streak of skipped rounds). Both are read by
            // the claim-afk-win action.
            const nextConsec = { ...(s.consecAutoWait ?? {}), [role]: 0 };
            s = { ...s, lastMoveAt: Date.now(), consecAutoWait: nextConsec };
            return checkWinner(s);
        }
        let result;
        switch (action) {
            case 'wait': {
                // Determine whether this wait counts as an AFK skip. The
                // client passes `auto: true` when the 45s round timer fired
                // it. If the player took zero real actions this turn AND it
                // was auto-fired, it's a skipped round — bump the counter.
                // Manual wait OR auto-wait after actions resets the streak.
                const isIdleAutoSkip = auto === true && session.actionsThisTurn === 0;
                const prevCount = session.consecAutoWait?.[role] ?? 0;
                const nextCount = isIdleAutoSkip ? prevCount + 1 : 0;
                const consecAutoWait = { ...(session.consecAutoWait ?? {}), [role]: nextCount };
                lines.push(`${me.name} ends their turn.`);
                if (isIdleAutoSkip && nextCount >= 2) {
                    lines.push(`⚠ ${me.name} has skipped 2 rounds in a row — opponent may claim a forfeit win.`);
                }
                result = endTurn({ ...session, log: [...session.log, ...lines], consecAutoWait });
                break;
            }
            case 'claim-afk-win': {
                // Inactive player claims the win when the active player has
                // skipped 2 consecutive rounds (let the 45s timer run out
                // twice). Falls back to a 90s "no contact" timeout for the
                // crashed-tab case where the round timer never fires.
                if (session.activePlayer === role) {
                    return finish(session); // can only claim against opponent
                }
                const oppRole = role === 'p1' ? 'p2' : 'p1';
                const oppSkipCount = session.consecAutoWait?.[oppRole] ?? 0;
                const AFK_FALLBACK_MS = 90_000;
                const lastMove = Number(session.lastMoveAt ?? session.createdAt);
                const elapsed = Date.now() - lastMove;
                const timedOut = elapsed >= AFK_FALLBACK_MS;
                if (oppSkipCount < 2 && !timedOut) {
                    const remaining = Math.max(0, Math.ceil((AFK_FALLBACK_MS - elapsed) / 1000));
                    return finish({ ...session, log: [...session.log, `${me.name}'s AFK claim rejected — opponent has skipped ${oppSkipCount}/2 rounds (or ${remaining}s of inactivity remain).`] });
                }
                const reason = oppSkipCount >= 2 ? `skipped 2 rounds` : `inactive for ${Math.floor(elapsed / 1000)}s`;
                lines.push(`${opp.name} forfeits — ${reason}. ${me.name} wins by default.`);
                result = {
                    ...session,
                    status: 'done',
                    winner: role,
                    log: [...session.log, ...lines],
                    lastMoveAt: Date.now(),
                };
                break;
            }
            case 'move': {
                if (tile === undefined || !canAct(30))
                    return finish(session);
                if (!hexNeighbors(me.pos).includes(tile) || tile === opp.pos || tileBlocked(tile, me, opp))
                    return finish(session);
                lines.push(`${me.name} moves.`);
                result = commit({ ...me, pos: tile }, null, 30);
                break;
            }
            case 'dash': {
                if (tile === undefined || !canAct(30))
                    return finish(session);
                if (distance(me.pos, tile) > 3 || tile === opp.pos || tile === me.pos || tileBlocked(tile, me, opp))
                    return finish(session);
                lines.push(`${me.name} dashes.`);
                result = commit({ ...me, pos: tile }, null, 30);
                break;
            }
            case 'basicAttack': {
                if (!canAct(40))
                    return finish(session);
                if (distance(me.pos, opp.pos) > 1) {
                    await saveSession(key, { ...session, log: [...session.log, `${me.name}: too far for basic attack — move closer.`] });
                    return finish({ ...session, log: [...session.log, `${me.name}: too far for basic attack.`] });
                }
                if (me.stamina < 10) {
                    await saveSession(key, { ...session, log: [...session.log, `${me.name}: not enough stamina.`] });
                    return finish({ ...session, log: [...session.log, `${me.name}: not enough stamina.`] });
                }
                const specialty = me.character.specialty ?? 'Ninjutsu';
                const basicJutsu = { id: 'basic-attack', name: 'Basic Attack', type: specialty, effectPower: 10, ap: 40, range: 1, tags: [] };
                lines.push(`${me.name} uses Basic Attack:`);
                const atk = applyJutsu(me, opp, basicJutsu, 1, biome, session.round);
                lines.push(...atk.lines);
                result = commit({ ...atk.self, stamina: Math.max(0, atk.self.stamina - 10) }, atk.opponent, 40);
                break;
            }
            case 'basicHeal': {
                if (!canAct(60) || (myCooldowns.basicHeal ?? 0) > 0 || me.chakra < 10)
                    return finish(session);
                const healAmt = Math.max(1, Math.floor(me.maxHp * 0.1));
                lines.push(`${me.name} uses Basic Heal, restoring ${healAmt} HP.`);
                result = commit({ ...me, hp: Math.min(me.maxHp, me.hp + healAmt), chakra: Math.max(0, me.chakra - 10) }, null, 60, { basicHeal: 5 });
                break;
            }
            case 'clear': {
                if (!canAct(60) || (myCooldowns.clear ?? 0) > 0)
                    return finish(session);
                if (hasStatus(opp, 'Clear Prevent', session.round)) {
                    lines.push(`${opp.name}'s Clear Prevent blocks the clear.`);
                    result = commit(null, null, 60, { clear: 10 });
                }
                else {
                    const removed = opp.statuses.filter(s => s.kind === 'positive').map(s => s.name);
                    lines.push(`Clear: removed ${removed.length ? removed.join(', ') : 'no positive effects'} from ${opp.name}.`);
                    result = commit(null, { ...opp, statuses: opp.statuses.filter(s => s.kind !== 'positive') }, 60, { clear: 10 });
                }
                break;
            }
            case 'cleanse': {
                if (!canAct(60) || (myCooldowns.cleanse ?? 0) > 0)
                    return finish(session);
                if (hasStatus(me, 'Cleanse Prevent', session.round)) {
                    lines.push(`${me.name}'s Cleanse Prevent blocks the cleanse.`);
                    result = commit(null, null, 60, { cleanse: 10 });
                }
                else {
                    const removed = me.statuses.filter(s => s.kind === 'negative').map(s => s.name);
                    lines.push(`Cleanse: removed ${removed.length ? removed.join(', ') : 'no negative effects'} from ${me.name}.`);
                    result = commit({ ...me, statuses: me.statuses.filter(s => s.kind !== 'negative') }, null, 60, { cleanse: 10 });
                }
                break;
            }
            case 'jutsu': {
                if (!jutsuId) {
                    await _storage_js_1.kv.del(lockKey).catch(() => undefined);
                    return res.status(400).json({ error: 'Missing jutsuId' });
                }
                const jutsuList = me.character.jutsu ?? [];
                const jutsu = jutsuList.find(j => j.id === jutsuId);
                if (!jutsu) {
                    const missingMsg = `${me.name}: selected jutsu is not available in this PvP session. Reopen the duel or re-equip your loadout.`;
                    const updated = { ...session, log: [...session.log, missingMsg] };
                    await saveSession(key, updated);
                    return finish(updated);
                }
                // jutsuIsSane re-validation removed — the jutsu comes from the
                // session's loadout list, which session.ts already sanitized at
                // fight-create time and is immutable afterwards. No code path
                // mutates the loadout mid-fight, so per-move re-validation was
                // pure overhead (~2-5ms in big loadouts).
                const apCost = jutsu.ap ?? 40;
                if (!canAct(apCost) || (myCooldowns[jutsuId] ?? 0) > 0)
                    return finish(session);
                // ── Elemental Seal enforcement ───────────────────────────────────
                // Elemental Seal blocks the five basic elements only.
                const BASIC_ELEMENTS = new Set(['Earth', 'Wind', 'Water', 'Lightning', 'Fire']);
                if (hasStatus(me, 'Elemental Seal', session.round) && jutsu.element && BASIC_ELEMENTS.has(jutsu.element)) {
                    const esMsg = `${me.name} is Elementally Sealed — cannot use ${jutsu.name} (${jutsu.element}).`;
                    const esState = { ...session, log: [...session.log, esMsg] };
                    await saveSession(key, esState);
                    return finish(esState);
                }
                const jChakraCost = jutsu.chakraCost ?? 0;
                const jStaminaCost = jutsu.staminaCost ?? 0;
                if (jChakraCost > 0 && me.chakra < jChakraCost) {
                    const msg = `${me.name}: not enough chakra for ${jutsu.name} (need ${jChakraCost}).`;
                    const updated = { ...session, log: [...session.log, msg] };
                    await saveSession(key, updated);
                    return finish(updated);
                }
                if (jStaminaCost > 0 && me.stamina < jStaminaCost) {
                    const msg = `${me.name}: not enough stamina for ${jutsu.name} (need ${jStaminaCost}).`;
                    const updated = { ...session, log: [...session.log, msg] };
                    await saveSession(key, updated);
                    return finish(updated);
                }
                const tags = jutsu.tags ?? [];
                const moveTag = tags.some(t => normalizeTagName(t.name) === 'Move');
                const groundTarget = jutsu.target === 'EMPTY_GROUND';
                const needsGroundTile = groundTarget || moveTag;
                const selfTarget = jutsu.target === 'SELF';
                const opponentAffectingTags = new Set(['Stun', 'Bloodline Seal', 'Elemental Seal', 'Buff Prevent', 'Cleanse Prevent', 'Decrease Damage Given', 'Increase Damage Taken', 'Ignition', 'Poison', 'Drain', 'Lag', 'Mirror', 'Push', 'Pull', 'Recoil']);
                const affectsOpponent = (jutsu.effectPower ?? 0) > 0 || tags.some(t => opponentAffectingTags.has(normalizeTagName(t.name)));
                if (needsGroundTile && tile === undefined) {
                    const msg = `${me.name}: ${jutsu.name} needs a ground tile target.`;
                    const updated = { ...session, log: [...session.log, msg] };
                    await saveSession(key, updated);
                    return finish(updated);
                }
                if (!selfTarget && !groundTarget && !moveTag && affectsOpponent) {
                    const range = Math.max(0, Number(jutsu.range) || 0);
                    if (range > 0 && distance(me.pos, opp.pos) > range) {
                        const outOfRangeMsg = `${jutsu.name} is out of range (need ≤${range}, distance ${Math.round(distance(me.pos, opp.pos))}).`;
                        const updated = { ...session, log: [...session.log, outOfRangeMsg] };
                        await saveSession(key, updated);
                        return finish(updated);
                    }
                }
                lines.push(`${me.name} uses ${jutsu.name}:`);
                const jWMult = weatherMultiplier(jutsu.element, weatherPositiveElement, weatherNegativeElement);
                const cd = (jutsu.cooldown ?? 0) > 0 ? { [jutsuId]: jutsu.cooldown } : undefined;
                const jutsuMethod = normalizeJutsuMethod(jutsu.method);
                // Ground-target and movement jutsus: choose an open tile in range.
                // AOE_CIRCLE resolves from the chosen tile and only hits if the opponent
                // is in the surrounding ring. Pure Move jutsus just relocate the user.
                if (moveTag && tile !== undefined) {
                    const destTile = tile;
                    const range = Math.max(1, Number(jutsu.range) || 4);
                    if (destTile < 0 || destTile >= GRID_W * GRID_H || distance(me.pos, destTile) > range || destTile === opp.pos || destTile === me.pos || tileBlocked(destTile, me, opp)) {
                        const msg = `${me.name}: ${jutsu.name} — destination out of range or occupied.`;
                        const updated = { ...session, log: [...session.log, msg] };
                        await saveSession(key, updated);
                        return finish(updated);
                    }
                    const movedSelf = { ...me, pos: destTile, chakra: Math.max(0, me.chakra - jChakraCost), stamina: Math.max(0, me.stamina - jStaminaCost) };
                    lines.push(`${me.name} dashes to hex ${destTile}.`);
                    const ring = hexNeighbors(destTile);
                    if (jutsuMethod === 'AOE_CIRCLE' && ring.includes(opp.pos)) {
                        // Strip Move tag so applyJutsu treats this as a pure damage/effect jutsu
                        const damageJutsu = { ...jutsu, tags: tags.filter(t => normalizeTagName(t.name) !== 'Move') };
                        const jr = applyJutsu(movedSelf, opp, damageJutsu, jWMult, biome, session.round);
                        lines.push(`Ring impact catches ${opp.name}!`);
                        lines.push(...jr.lines);
                        result = commit(jr.self, jr.opponent, apCost, cd);
                    }
                    else if (jutsuMethod === 'AOE_CIRCLE') {
                        lines.push(`${opp.name} is outside the impact area.`);
                        result = commit(movedSelf, null, apCost, cd);
                    }
                    else {
                        result = commit(movedSelf, null, apCost, cd);
                    }
                    break;
                }
                if (groundTarget && tile !== undefined) {
                    const targetTile = tile;
                    const range = Math.max(1, Number(jutsu.range) || 4);
                    if (targetTile < 0 || targetTile >= GRID_W * GRID_H || distance(me.pos, targetTile) > range || targetTile === opp.pos || targetTile === me.pos || tileBlocked(targetTile, me, opp)) {
                        const msg = `${me.name}: ${jutsu.name} — target tile out of range or occupied.`;
                        const updated = { ...session, log: [...session.log, msg] };
                        await saveSession(key, updated);
                        return finish(updated);
                    }
                    if (jutsuMethod === 'INSTANT_EFFECT') {
                        const zoneTags = groundEffectTags(tags);
                        if (!zoneTags.length) {
                            const msg = `${me.name}: ${jutsu.name} needs Decrease Damage Given, Recoil, or Poison for its ground effect.`;
                            const updated = { ...session, log: [...session.log, msg] };
                            await saveSession(key, updated);
                            return finish(updated);
                        }
                        const groundEffect = {
                            id: `${jutsu.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            owner: role,
                            name: jutsu.name,
                            tiles: groundEffectTiles(targetTile),
                            rounds: 2,
                            tags: zoneTags,
                        };
                        const paidSelf = { ...me, chakra: Math.max(0, me.chakra - jChakraCost), stamina: Math.max(0, me.stamina - jStaminaCost) };
                        lines.push(`${jutsu.name} creates a ground effect for 2 rounds.`);
                        const instantGround = applyGroundEffectToFighter(opp, groundEffect);
                        lines.push(...instantGround.lines);
                        result = commit(paidSelf, instantGround.fighter, apCost, cd, { groundEffects: [...(session.groundEffects ?? []), groundEffect] });
                        break;
                    }
                    const ring = hexNeighbors(targetTile);
                    const catchesOpponent = jutsuMethod === 'AOE_CIRCLE' && ring.includes(opp.pos);
                    const paidSelf = { ...me, chakra: Math.max(0, me.chakra - jChakraCost), stamina: Math.max(0, me.stamina - jStaminaCost) };
                    if (catchesOpponent) {
                        const jr = applyJutsu(paidSelf, opp, jutsu, jWMult, biome, session.round);
                        lines.push(`Area burst catches ${opp.name}!`);
                        lines.push(...jr.lines);
                        result = commit(jr.self, jr.opponent, apCost, cd);
                    }
                    else {
                        lines.push(`${opp.name} is outside the impact area.`);
                        result = commit(paidSelf, null, apCost, cd);
                    }
                    break;
                }
                const jr = applyJutsu(me, opp, jutsu, jWMult, biome, session.round);
                const jUpdatedSelf = {
                    ...jr.self,
                    chakra: Math.max(0, jr.self.chakra - jChakraCost),
                    stamina: Math.max(0, jr.self.stamina - jStaminaCost),
                };
                lines.push(...jr.lines);
                result = commit(jUpdatedSelf, jr.opponent, apCost, cd);
                break;
            }
            case 'weapon': {
                const serverItem = equippedPvpItem(me, itemId, itemName);
                if (!serverItem || !['hand', 'thrown'].includes(normalizeEquipmentSlot(serverItem.slot))) {
                    await _storage_js_1.kv.del(lockKey).catch(() => undefined);
                    return res.status(400).json({ error: 'Weapon is not equipped for this fighter' });
                }
                const weapRange = serverItem.weaponRange ?? (normalizeEquipmentSlot(serverItem.slot) === 'thrown' ? 4 : 1);
                const wApCost = serverItem.apCost ?? 40;
                if (!canAct(wApCost))
                    return finish(session);
                if (distance(me.pos, opp.pos) > weapRange) {
                    const msg = `${me.name}: ${itemName ?? 'Weapon'} is out of range (need ≤${weapRange}).`;
                    const updated = { ...session, log: [...session.log, msg] };
                    await saveSession(key, updated);
                    return finish(updated);
                }
                const wTags = [...(serverItem.weaponTags ?? [])];
                if (serverItem.weaponEffect && !wTags.find(t => t.name === serverItem.weaponEffect)) {
                    wTags.push({ name: serverItem.weaponEffect, percent: serverItem.weaponEffectValue ?? 0 });
                }
                const weaponJutsu = {
                    id: 'weapon',
                    name: serverItem.name ?? 'Weapon Attack',
                    type: 'Bukijutsu',
                    effectPower: serverItem.weaponEp ?? 15,
                    ap: wApCost,
                    range: weapRange,
                    tags: wTags,
                };
                lines.push(`${me.name} uses ${weaponJutsu.name}:`);
                const wWMult = weatherMultiplier(serverItem.weaponElement, weatherPositiveElement, weatherNegativeElement);
                const wr = applyJutsu(me, opp, weaponJutsu, wWMult, biome, session.round);
                lines.push(...wr.lines);
                result = commit(wr.self, wr.opponent, wApCost);
                break;
            }
            case 'item': {
                const serverItem = equippedPvpItem(me, itemId, itemName);
                if (!serverItem || ['hand', 'thrown'].includes(normalizeEquipmentSlot(serverItem.slot))) {
                    await _storage_js_1.kv.del(lockKey).catch(() => undefined);
                    return res.status(400).json({ error: 'Item is not equipped for this fighter' });
                }
                const iApCost = serverItem.apCost ?? 35;
                if (!canAct(iApCost))
                    return finish(session);
                const iTags = serverItem.weaponTags?.length
                    ? serverItem.weaponTags
                    : serverItem.weaponEffect
                        ? [{ name: serverItem.weaponEffect, percent: serverItem.weaponEffectValue ?? 0 }]
                        : [{ name: 'Heal' }];
                const itemJutsu = {
                    id: 'item',
                    name: serverItem.name ?? 'Item',
                    type: 'Ninjutsu',
                    target: 'SELF',
                    effectPower: serverItem.weaponEp ?? 10,
                    ap: iApCost,
                    range: 0,
                    tags: iTags,
                };
                lines.push(`${me.name} uses ${itemJutsu.name}:`);
                const ir = applyJutsu(me, opp, itemJutsu, 1, biome, session.round);
                // For "both" target items (e.g. Smoke Bomb): also apply the effect to the caster
                let irSelf = ir.self;
                if (serverItem.weaponEffectTarget === 'both' && serverItem.weaponEffect === 'Decrease Damage Given') {
                    const ddgPct = serverItem.weaponEffectValue ?? 0;
                    irSelf = addStatus(irSelf, { name: 'Decrease Damage Given', rounds: 1, percent: ddgPct, kind: 'negative' });
                    ir.lines.push(`Smoke: ${irSelf.name} also deals ${ddgPct}% less damage for 1 round.`);
                }
                lines.push(...ir.lines);
                result = commit(irSelf, ir.opponent, iApCost);
                break;
            }
            case 'flee': {
                if (!canAct(100))
                    return finish(session);
                const hpCost = Math.max(1, Math.floor(me.maxHp * 0.1));
                const escaped = Math.random() < 0.2;
                const updatedMe = { ...me, hp: Math.max(0, me.hp - hpCost) };
                if (escaped) {
                    lines.push(`${me.name} fled the battle, losing ${hpCost} HP.`);
                    result = {
                        ...session,
                        ...(role === 'p1' ? { p1: updatedMe } : { p2: updatedMe }),
                        ap: { ...session.ap, [role]: myAp - 100 },
                        actionsThisTurn: session.actionsThisTurn + 1,
                        status: 'done',
                        winner: role === 'p1' ? 'p2' : 'p1',
                        fleedBy: role,
                        log: [...session.log, ...lines],
                    };
                }
                else {
                    lines.push(`${me.name} tried to flee, lost ${hpCost} HP, but failed.`);
                    result = commit(updatedMe, null, 100);
                }
                break;
            }
            default:
                await _storage_js_1.kv.del(lockKey).catch(() => undefined);
                return res.status(400).json({ error: `Unknown action: ${action}` });
        }
        // If this commit resolved the fight, grant server-side Vanguard
        // rewards (Honor Seals + Vanguard XP) for the winner. Idempotent via
        // session.vanguardRewardsGranted, so retries don't double-grant.
        if (result.status === 'done' && result.winner && result.winner !== 'draw'
            && !result.vanguardRewardsGranted) {
            try {
                const grant = await (0, _vanguard_rewards_js_1.grantVanguardRewardsForSession)(result);
                if (grant.granted) {
                    result.vanguardRewardsGranted = true;
                    result = { ...result, log: [...result.log, `Vanguard rewards: +${grant.seals} Seals, +${grant.xp} XP`] };
                }
            }
            catch (err) {
                console.error('[pvp/move] vanguard reward grant failed', err);
            }
        }
        // Clear both fighters' inBattle + pendingAttacker flags when a battle
        // resolves. Otherwise the loser is "engaged" for ~60s after their
        // fight ends (pendingAttacker has a 60s TTL) and the cached presence
        // entry blocks third parties from attacking them. Best-effort —
        // failures don't undo the battle resolution.
        if (result.status === 'done') {
            // Clear both fighters' inBattle + pendingAttacker in the in-memory
            // store so third parties can attack them again right after the fight
            // resolves. No-ops if either has since gone offline.
            online_store_js_1.onlineStore.setInBattle(result.p1.name, false);
            online_store_js_1.onlineStore.clearPendingAttacker(result.p1.name);
            online_store_js_1.onlineStore.setInBattle(result.p2.name, false);
            online_store_js_1.onlineStore.clearPendingAttacker(result.p2.name);
        }
        // Cap log size — UI only renders the last ~20 entries anyway, and an
        // Final commit also threads the moveToken into the recent-tokens
        // ring buffer so a retry of this same request (network blip,
        // double-tap) short-circuits at the top of the handler instead
        // of re-applying the move. (Note: saveSession already trims
        // the log internally; the manual 100-line cap below was a
        // legacy guard now subsumed by trimPvpLog.)
        await saveSession(key, result, { moveToken });
        return finish(result);
    }
    catch (err) {
        console.error('[pvp/move]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import type { PvpFighter, PvpGroundEffect, PvpSession, PvpStatus } from './session.js';

// ─── Grid constants (match arena exactly) ─────────────────────────────────────
const GRID_W = 12;
const GRID_H = 10;
const MAX_ROUNDS = 25;
const MAX_ACTIONS = 5;
const SESSION_TTL = 60 * 60;

// ─── Combat formula constants ─────────────────────────────────────────────────
const MAX_STAT = 2500;
const PVP_SCALE = 0.42;    // Global PvP damage scale — tuned for ~10-round TTK in a mirror match
const K_DR = 0.5;           // Diminishing-returns constant for the DR pool: DR% = raw/(raw+K_DR)
const HEAL_FLAT = 500;
const SHIELD_FLAT = 500;
const DRAIN_AMOUNT = 250;

// ─── Grid helpers (exact match to arena geometry) ─────────────────────────────
function xy(pos: number) { return { x: pos % GRID_W, y: Math.floor(pos / GRID_W) }; }
function posFromXY(x: number, y: number): number {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return -1;
    return y * GRID_W + x;
}
function axial(pos: number) {
    const { x, y } = xy(pos);
    return { q: x, r: y - ((x - (x & 1)) / 2) };
}
function distance(a: number, b: number): number {
    const A = axial(a); const B = axial(b);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}
function hexNeighbors(pos: number): number[] {
    const { x, y } = xy(pos);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx!, y + dy!)).filter(n => n >= 0);
}
function nextStepToward(from: number, to: number): number {
    return hexNeighbors(from).sort((a, b) => distance(a, to) - distance(b, to))[0] ?? from;
}
function barrierTiles(...fighters: PvpFighter[]): number[] {
    return fighters.flatMap(f => f.statuses.filter(s => s.name === 'Barrier' && typeof s.amount === 'number').map(s => s.amount!));
}
function tileBlocked(tile: number, ...fighters: PvpFighter[]) {
    return barrierTiles(...fighters).includes(tile);
}
// ─── Jutsu types ──────────────────────────────────────────────────────────────
type JutsuTag = { name: string; percent?: number; amount?: number };
type PvpItem = {
    id?: string;
    name?: string;
    slot?: string;
    weaponEp?: number;
    weaponElement?: string;
    weaponRange?: number;
    apCost?: number;
    weaponTags?: JutsuTag[];
    weaponEffect?: string;
    weaponEffectValue?: number;
    weaponEffectTarget?: string;
};
type Jutsu = {
    id: string;
    name: string;
    type: string;
    element?: string;
    target?: string;
    range?: number;
    ap?: number;
    cooldown?: number;
    effectPower?: number;
    bloodlineRank?: string;
    method?: string;
    chakraCost?: number;
    staminaCost?: number;
    tags?: JutsuTag[];
};

function isZeroDamageFortyApJutsu(jutsu: Pick<Jutsu, 'id' | 'ap'>): boolean {
    return jutsu.ap === 40 && jutsu.id !== 'basic-attack' && !jutsu.id.startsWith('item-');
}

function normalizeTagName(name: string): string {
    if (name === 'Seal') return 'Bloodline Seal';
    if (name === 'Afterburn') return 'Ignition';
    if (name === 'Time Compression') return 'Lag';
    if (name === 'Time Dilation') return 'Overclock';
    if (name === 'Vamp') return 'Siphon';
    return name;
}

function normalizeJutsuMethod(method?: string): string {
    if (method === 'AOE_LINE') return 'INSTANT_EFFECT';
    return method ?? 'SINGLE';
}

function nameMatches(name: string, canonicalName: string): boolean {
    return normalizeTagName(name) === canonicalName;
}

function normalizeEquipmentSlot(slot?: string): string {
    if (slot === 'weapon') return 'hand';
    if (slot === 'armor') return 'body';
    if (slot === 'accessory') return 'aura';
    return slot ?? '';
}

function equippedPvpItem(fighter: PvpFighter, itemId?: string, itemName?: string): PvpItem | null {
    const items = ((fighter.character.pvpItems as PvpItem[] | undefined) ?? []);
    const equipment = (fighter.character.equipment as Record<string, string | undefined> | undefined) ?? {};
    const equippedIds = new Set(Object.values(equipment).filter((id): id is string => Boolean(id)));
    return items.find(item =>
        Boolean(item.id) &&
        equippedIds.has(item.id!) &&
        ((itemId && item.id === itemId) || (!itemId && itemName && item.name === itemName))
    ) ?? null;
}

// ─── Stat helpers ─────────────────────────────────────────────────────────────
function getOffense(stats: Record<string, number>, type: string): number {
    if (type === 'Taijutsu') return (stats.taijutsuOffense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu') return (stats.bukijutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu') return (stats.genjutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuOffense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function getDefense(stats: Record<string, number>, type: string): number {
    if (type === 'Taijutsu') return (stats.taijutsuDefense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu') return (stats.bukijutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu') return (stats.genjutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuDefense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}

function cappedPostDamage(damage: number, percent: number): number {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}
function weatherMultiplier(element: string | undefined, positiveEl: string, negativeEl: string): number {
    if (!element || (!positiveEl && !negativeEl)) return 1;
    if (positiveEl && element === positiveEl) return 1.05;
    if (negativeEl && element === negativeEl) return 0.98;
    return 1;
}
// Terrain bonuses - match the terrainEffects table on the client exactly:
//   forest  -> +10% Taijutsu
//   snow    -> +10% Bukijutsu
//   volcano -> +10% Ninjutsu
//   shadow  -> +10% Genjutsu
//   central -> no bonus
function terrainMultiplier(jutsu: Jutsu, biome: string): number {
    switch (biome) {
        case 'forest':  return jutsu.type === 'Taijutsu'  ? 1.1 : 1;
        case 'snow':    return jutsu.type === 'Bukijutsu' ? 1.1 : 1;
        case 'volcano': return jutsu.type === 'Ninjutsu'  ? 1.1 : 1;
        case 'shadow':  return jutsu.type  === 'Genjutsu'   ? 1.1 : 1;
        default:        return 1;
    }
}

// ─── Fighter helpers ──────────────────────────────────────────────────────────
function isStatusActive(status: PvpStatus, round: number) {
    return status.activeRound === undefined || status.activeRound <= round;
}
function activeStatuses(f: PvpFighter, round: number) {
    return f.statuses.filter(status => isStatusActive(status, round));
}
function hasStatus(f: PvpFighter, name: string, round = Number.POSITIVE_INFINITY) {
    return activeStatuses(f, round).some(s => nameMatches(s.name, name));
}
function addStatus(f: PvpFighter, s: PvpStatus): PvpFighter {
    return { ...f, statuses: [...f.statuses.filter(x => !nameMatches(x.name, s.name)), s] };
}
// Tags resolve next round for ALL jutsus (bloodline or not) except INSTANT_EFFECT
// ground-zone jutsus where the enemy is standing in the zone on cast.
// Mirrors the client-side fix in App.tsx — previously only bloodline jutsus were
// deferred, leaving non-bloodline tags incorrectly instant in PvP.
function bloodlineTagsResolveNextRound(jutsu: Pick<Jutsu, 'bloodlineRank' | 'target' | 'method'>) {
    return !(jutsu.target === 'EMPTY_GROUND' && normalizeJutsuMethod(jutsu.method) === 'INSTANT_EFFECT');
}
function statusForJutsu(jutsu: Pick<Jutsu, 'bloodlineRank' | 'target' | 'method'>, status: PvpStatus, round: number): PvpStatus {
    return bloodlineTagsResolveNextRound(jutsu) ? { ...status, activeRound: round + 1 } : status;
}
function addJutsuStatus(f: PvpFighter, jutsu: Pick<Jutsu, 'bloodlineRank' | 'target' | 'method'>, status: PvpStatus, round: number): PvpFighter {
    return addStatus(f, statusForJutsu(jutsu, status, round));
}
function groundEffectTiles(center: number): number[] {
    return [center, ...hexNeighbors(center)];
}
function groundEffectTags(tags: JutsuTag[]): JutsuTag[] {
    const allowed = new Set(['Decrease Damage Given', 'Recoil', 'Poison']);
    return tags
        .map(tag => ({ ...tag, name: normalizeTagName(tag.name) }))
        .filter(tag => allowed.has(tag.name));
}
function applyGroundEffectToFighter(fighter: PvpFighter, effect: PvpGroundEffect): { fighter: PvpFighter; lines: string[] } {
    let next = { ...fighter };
    const lines: string[] = [];
    if (!effect.tiles.includes(fighter.pos)) return { fighter: next, lines };
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
        } else if (tagName === 'Recoil') {
            next = addStatus(next, { name: 'Recoil', rounds: 2, percent: pct, kind: 'negative' });
            lines.push(`${effect.name}: ${next.name} suffers ${pct}% recoil on attacks for 2 turns.`);
        } else if (tagName === 'Poison') {
            const poisonPct = pct > 0 ? pct : 6;
            const dmg = Math.floor(next.maxChakra * (poisonPct / 100));
            next = addStatus(next, { name: 'Poison', rounds: 2, percent: poisonPct, kind: 'negative' });
            lines.push(`${effect.name}: ${next.name} is poisoned for ~${dmg}/round for 2 turns.`);
        }
    }
    return { fighter: next, lines };
}
function applyGroundEffects(session: PvpSession): { session: PvpSession; lines: string[] } {
    let p1 = session.p1;
    let p2 = session.p2;
    const lines: string[] = [];
    for (const effect of session.groundEffects ?? []) {
        const targetRole = effect.owner === 'p1' ? 'p2' : 'p1';
        if (targetRole === 'p1') {
            const applied = applyGroundEffectToFighter(p1, effect);
            p1 = applied.fighter;
            lines.push(...applied.lines);
        } else {
            const applied = applyGroundEffectToFighter(p2, effect);
            p2 = applied.fighter;
            lines.push(...applied.lines);
        }
    }
    return { session: { ...session, p1, p2 }, lines };
}
function tickGroundEffects(effects: PvpGroundEffect[] | undefined): PvpGroundEffect[] {
    return (effects ?? [])
        .map(effect => ({ ...effect, rounds: effect.rounds - 1 }))
        .filter(effect => effect.rounds > 0);
}
function tickStatuses(f: PvpFighter, round: number): PvpFighter {
    return {
        ...f,
        statuses: f.statuses
            .map(s => isStatusActive(s, round) ? { ...s, rounds: s.rounds - 1 } : s)
            .filter(s => s.rounds > 0),
    };
}
function tickCooldowns(cds: Record<string, number>): Record<string, number> {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(cds)) if (v > 1) next[k] = v - 1;
    return next;
}
// Raw DR contribution from defensive status effects.
// Added into the DR pool alongside armor — soft cap via K_DR so stacking always helps.
function drContributionFor(attacker: PvpFighter, defender: PvpFighter, round: number): number {
    let dr = 0;
    for (const s of activeStatuses(attacker, round)) {
        if (s.name === 'Decrease Damage Given') dr += (s.percent ?? 0) / 100;
    }
    for (const s of activeStatuses(defender, round)) {
        if (s.name === 'Decrease Damage Taken') dr += (s.percent ?? 0) / 100;
    }
    return dr;
}
// Amplifiers (offensive / vulnerability buffs) — no diminishing returns, these increase damage.
function ampMultiplierFor(attacker: PvpFighter, defender: PvpFighter, round: number): number {
    let m = 1;
    for (const s of activeStatuses(attacker, round)) {
        if (s.name === 'Increase Damage Given') m *= (1 + (s.percent ?? 0) / 100);
    }
    for (const s of activeStatuses(defender, round)) {
        if (s.name === 'Increase Damage Taken') m *= (1 + (s.percent ?? 0) / 100);
        if (nameMatches(s.name, 'Ignition')) m *= (1 + (s.percent ?? 0) / 100);
    }
    return m;
}

// Scale a tag percent by mastery level — mirrors the client's effectiveTagPercent logic:
//   level 50 = full stored value, each level below 50 subtracts 0.2 from the raw percent.
function scaledTagPercent(rawPct: number, masteryLevel: number): number {
    const raw = rawPct > 0 ? rawPct : 30;
    return Math.max(0, raw - (50 - masteryLevel) * 0.2);
}

// ─── Jutsu application (3-bucket formula, all tags) ───────────────────────────
function applyJutsu(self: PvpFighter, opponent: PvpFighter, jutsu: Jutsu, wMult = 1, biome = 'central', round = 1): { self: PvpFighter; opponent: PvpFighter; lines: string[] } {
    // Use jutsu mastery level (0–50) for EP scaling so trained jutsus hit harder in PvP.
    // Falls back to 0 if the jutsu has never been trained (no bonus).
    const jutsuMasteries = (self.character.jutsuMastery as Array<{ jutsuId: string; level: number }> | null) ?? [];
    const masteryEntry = jutsuMasteries.find(m => m.jutsuId === jutsu.id);
    const masteryLevel = Math.max(0, Math.min(50, masteryEntry?.level ?? 0));
    const scaledEp = isZeroDamageFortyApJutsu(jutsu) ? 0 : (jutsu.effectPower ?? 20) + masteryLevel * 0.2;
    const offStats = (self.character.stats as Record<string, number>) ?? {};
    const defStats = (opponent.character.stats as Record<string, number>) ?? {};
    const statFactor = Math.max(0.35, Math.min(1.85, 1 + (getOffense(offStats, jutsu.type) - getDefense(defStats, jutsu.type)) / (MAX_STAT * 2) * 0.85));
    const effectFactor = Math.max(0, scaledEp) / 100;
    // Bloodline mult: pre-computed on the client (1.0 if absent)
    const bloodlineMult = (hasStatus(self, 'Bloodline Seal', round) || hasStatus(self, 'Seal', round)) ? 1.0 : Math.max(1.0, Number((self.character.bloodlineMult as number) ?? 1.0));
    // Item damage bonus: pre-computed on the client from equipped item bonuses (0 if absent → ×1.0)
    const itemDamageMult = 1 + Math.max(0, Number((self.character.itemDamagePct as number) ?? 0)) / 100;
    // Terrain bonus: +10% when jutsu type/element matches the current biome
    const tMult = terrainMultiplier(jutsu, biome);
    // Raw base damage — scaled off attacker's maxHp so higher-level players hit harder.
    // Using opponent.maxHp caused low-level players to deal more damage against tanky targets.
    const baseDmg = Math.max(0, Math.floor(
        self.maxHp * effectFactor * statFactor * PVP_SCALE * wMult * tMult * bloodlineMult * itemDamageMult
    ));
    // ── Defensive DR pool (diminishing returns) ───────────────────────────────
    // armorRawDR: raw sum of per-piece reductions (e.g. 7×0.15 + 0.08 Guardian = 1.13).
    // Falls back to deriving from old armorFactor for sessions created before this update.
    const armorRawDR = (opponent.character.armorRawDR !== undefined && opponent.character.armorRawDR !== null)
        ? Math.min(1.5, Math.max(0, Number(opponent.character.armorRawDR)))
        : Math.max(0, 1 - Math.min(1.0, Math.max(0.25, Number((opponent.character.armorFactor as number) ?? 1.0))));
    // Status DR feeds the same pool — every point still reduces damage, just with diminishing returns.
    const rawStatusDR = drContributionFor(self, opponent, round);
    const rawTotalDR = armorRawDR + rawStatusDR;
    // effectiveDR = rawTotal / (rawTotal + K_DR)  →  always < 1, always grows with more DR
    const effectiveDR = rawTotalDR > 0 ? rawTotalDR / (rawTotalDR + K_DR) : 0;

    const tags = jutsu.tags ?? [];
    const lines: string[] = [];
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
        if (tag.name === 'Heal') { healing += Math.floor(HEAL_FLAT * healBoost); damage = 0; lines.push(`Heal: ${s.name} restores ${Math.floor(HEAL_FLAT * healBoost)} HP.`); continue; }
        if (tag.name === 'Shield') { shieldGain += SHIELD_FLAT; damage = 0; lines.push(`Shield: ${s.name} gains ${SHIELD_FLAT} shield.`); continue; }
        if (tag.name === 'Barrier') { const tile = nextStepToward(s.pos, o.pos); if (tile !== s.pos && tile !== o.pos) { s = addStatus(s, { name: 'Barrier', rounds: 2, amount: tile, kind: 'positive' }); lines.push(`Barrier: ${s.name} blocks hex ${tile} for 2 turns.`); } else lines.push(`Barrier: no room to place a wall.`); damage = 0; continue; }
        if (tag.name === 'Pierce') { pierce = true; lines.push(`Pierce: bypasses defenses.`); continue; }
        if (tag.name === 'Stun') { if (!hasStatus(o, 'Debuff Prevent', round) && !hasStatus(o, 'Stun Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Stun', rounds: 1, kind: 'negative' }, round); lines.push(`Stun: ${o.name} loses 40 AP next turn.`); } continue; }
        if (tag.name === 'Poison') { if (!hasStatus(o, 'Debuff Prevent', round)) { const poisonPct = pct > 0 ? pct : 6; const dmg = Math.floor(o.maxChakra * (poisonPct / 100)); o = addJutsuStatus(o, jutsu, { name: 'Poison', rounds: 2, percent: poisonPct, kind: 'negative' }, round); lines.push(`Poison: ${o.name} takes ~${dmg}/round for 2 turns.`); } continue; }
        if (tag.name === 'Drain') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Drain', rounds: 2, amount: DRAIN_AMOUNT, kind: 'negative' }, round); lines.push(`Drain: ${o.name} loses ${DRAIN_AMOUNT} HP+chakra/turn for 2 turns.`); } continue; }
        if (tag.name === 'Absorb') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Absorb', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Absorb: ${s.name} converts ${pct}% incoming damage for 2 turns.`); } continue; }
        if (tag.name === 'Reflect') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Reflect', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Reflect: ${s.name} reflects ${pct}% damage for 2 turns.`); } continue; }
        if (tag.name === 'Lifesteal') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Lifesteal', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Lifesteal: ${s.name} heals on hit for 2 turns.`); } continue; }
        if (tag.name === 'Increase Damage Given') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Increase Damage Given', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`+${pct}% Damage Given: ${s.name} for 2 turns.`); } continue; }
        if (tag.name === 'Decrease Damage Given') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Decrease Damage Given', rounds: 2, percent: pct, kind: 'negative' }, round); lines.push(`-${pct}% Damage Given: ${o.name} for 2 turns.`); } continue; }
        if (tag.name === 'Increase Damage Taken') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Increase Damage Taken', rounds: 2, percent: pct, kind: 'negative' }, round); lines.push(`+${pct}% Damage Taken: ${o.name} for 2 turns.`); } continue; }
        if (tag.name === 'Decrease Damage Taken') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Decrease Damage Taken', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`-${pct}% Damage Taken: ${s.name} for 2 turns.`); } continue; }
        if (tagName === 'Ignition') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Ignition', rounds: 2, percent: pct, kind: 'negative' }, round); lines.push(`Ignition: ${o.name} +${pct}% damage taken for 2 turns.`); } continue; }
        if (tag.name === 'Debuff Prevent') { s = addJutsuStatus(s, jutsu, { name: 'Debuff Prevent', rounds: 2, kind: 'positive' }, round); lines.push(`Debuff Prevent: ${s.name} for 2 turns.`); continue; }
        if (tag.name === 'Buff Prevent') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Buff Prevent', rounds: 2, kind: 'negative' }, round); lines.push(`Buff Prevent: ${o.name} cannot gain positive effects for 2 turns.`); } continue; }
        if (tag.name === 'Cleanse Prevent') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' }, round); lines.push(`Cleanse Prevent: ${o.name} cannot cleanse debuffs for 2 turns.`); } continue; }
        if (tag.name === 'Clear Prevent') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Clear Prevent', rounds: 2, kind: 'positive' }, round); lines.push(`Clear Prevent: ${s.name}'s buffs cannot be cleared for 2 turns.`); } continue; }
        if (tag.name === 'Stun Prevent') { s = addJutsuStatus(s, jutsu, { name: 'Stun Prevent', rounds: 2, kind: 'positive' }, round); lines.push(`Stun Prevent: ${s.name} is immune to Stun for 2 turns.`); continue; }
        if (tag.name === 'Copy') { const copied = activeStatuses(o, round).filter(st => st.kind === 'positive'); copied.forEach(st => { s = addJutsuStatus(s, jutsu, { ...st }, round); }); lines.push(`Copy: ${s.name} copied ${copied.length ? copied.map(st => st.name).join(', ') : 'nothing'} from ${o.name}.`); continue; }
        if (tag.name === 'Mirror') { const mirrored = activeStatuses(s, round).filter(st => st.kind === 'negative' && st.name !== 'Wound' && !nameMatches(st.name, 'Ignition') && st.name !== 'Poison' && st.name !== 'Drain'); if (!hasStatus(o, 'Debuff Prevent', round)) { mirrored.forEach(st => { o = addJutsuStatus(o, jutsu, { ...st }, round); }); s = { ...s, statuses: s.statuses.filter(st => !mirrored.includes(st)) }; lines.push(`Mirror: ${s.name} reflected ${mirrored.length ? mirrored.map(st => st.name).join(', ') : 'no debuffs'} onto ${o.name}.`); } continue; }
        if (tagName === 'Lag') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Lag', rounds: 2, percent: pct || 20, kind: 'negative' }, round); lines.push(`Lag: ${o.name}'s actions cost ${pct || 20}% more AP for 2 turns.`); } continue; }
        if (tagName === 'Overclock') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Overclock', rounds: 2, percent: pct || 20, kind: 'positive' }, round); lines.push(`Overclock: ${s.name}'s actions cost ${pct || 20}% less AP for 2 turns.`); } continue; }
        if (tag.name === 'Increase Heal') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Increase Heal', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Increase Heal: ${s.name}'s healing is increased by ${pct}% for 2 turns.`); } continue; }
        if (tag.name === 'Push') { if (!hasStatus(o, 'Debuff Prevent', round)) { const dist = Math.max(1, Number(jutsu.range) || 1); if (bloodlineTagsResolveNextRound(jutsu)) { o = addJutsuStatus(o, jutsu, { name: 'Push', rounds: 1, amount: dist, kind: 'negative' }, round); lines.push(`Push: ${o.name} will be pushed ${dist} tile(s) next round.`); } else { let nextPos = o.pos; for (let step = 0; step < dist; step++) { const away = hexNeighbors(nextPos).filter(t => distance(t, s.pos) > distance(nextPos, s.pos) && t !== s.pos && !tileBlocked(t, s, o)); if (!away.length) break; nextPos = away[0]!; } o = { ...o, pos: nextPos }; lines.push(`Push: ${o.name} is pushed ${dist} tile(s).`); } } continue; }
        if (tag.name === 'Pull') { if (!hasStatus(o, 'Debuff Prevent', round)) { const dist = Math.max(1, Number(jutsu.range) || 1); if (bloodlineTagsResolveNextRound(jutsu)) { o = addJutsuStatus(o, jutsu, { name: 'Pull', rounds: 1, amount: dist, kind: 'negative' }, round); lines.push(`Pull: ${o.name} will be pulled ${dist} tile(s) next round.`); } else { let nextPos = o.pos; for (let step = 0; step < dist; step++) { const toward = hexNeighbors(nextPos).filter(t => distance(t, s.pos) < distance(nextPos, s.pos) && t !== s.pos && !tileBlocked(t, s, o)); if (!toward.length) break; nextPos = toward[0]!; } o = { ...o, pos: nextPos }; lines.push(`Pull: ${o.name} is pulled ${dist} tile(s).`); } } continue; }
        if (tag.name === 'Bloodline Seal' || tag.name === 'Seal') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Bloodline Seal', rounds: 2, kind: 'negative' }, round); lines.push(`Bloodline Seal: ${o.name}'s bloodline is sealed.`); } continue; }
        if (tag.name === 'Elemental Seal') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: tag.name, rounds: 1, kind: 'negative' }, round); lines.push(`${tag.name}: ${o.name}'s elemental jutsu are sealed.`); } continue; }
    }

    if (pierce) {
        damage = (jutsu.ap ?? 40) >= 60 ? 900 : 0;
    } else {
        // Amplifiers (Increase Damage Given, Increase Damage Taken, Ignition) apply at full value.
        const ampMult = ampMultiplierFor(self, opponent, round);
        // DR is already computed above as effectiveDR ∈ [0, 1).
        // Armor, DDT, and DDG all feed the same pool — more always helps, but with diminishing returns.
        damage = Math.max(0, Math.floor(damage * (1 - effectiveDR) * ampMult));
    }

    if (damage > 0) {
        const blocked = pierce ? 0 : Math.min(o.shield, damage);
        const finalDmg = Math.max(0, damage - blocked);
        const reflect = activeStatuses(o, round).find(st => st.name === 'Reflect');
        const reflectedDmg = reflect && !pierce ? cappedPostDamage(finalDmg, reflect.percent ?? 30) : 0;
        const defAbsorb = activeStatuses(o, round).find(st => st.name === 'Absorb');
        const absorbHeal = defAbsorb ? cappedPostDamage(finalDmg, defAbsorb.percent ?? 30) : 0;

        o = { ...o, hp: Math.max(0, o.hp - finalDmg), shield: Math.max(0, o.shield - damage) };
        if (absorbHeal > 0) o = { ...o, hp: Math.min(o.maxHp, o.hp + absorbHeal) };
        if (blocked > 0) lines.push(`${blocked} absorbed by ${o.name}'s shield.`);
        if (finalDmg > 0) lines.push(`${finalDmg} damage to ${o.name}.`);
        if (absorbHeal > 0) lines.push(`${o.name} absorbs ${absorbHeal} HP.`);
        if (reflectedDmg > 0) { s = { ...s, hp: Math.max(0, s.hp - reflectedDmg) }; lines.push(`${s.name} takes ${reflectedDmg} reflected damage.`); }

        for (const tag of tags) {
            const pct = tag.percent ?? 0;
            if (tag.name === 'Wound' && !hasStatus(o, 'Debuff Prevent', round)) {
                const amt = cappedPostDamage(finalDmg, pct || 30);
                o = addJutsuStatus(o, jutsu, { name: 'Wound', rounds: 2, amount: amt, kind: 'negative' }, round);
                lines.push(`Wound: ${o.name} bleeds ${amt}/turn for 2 turns.`);
            }
            if (tag.name === 'Recoil') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Recoil', rounds: 2, percent: pct || 30, kind: 'negative' }, round); lines.push(`Recoil: ${o.name} will suffer ${pct || 30}% recoil on their attacks for 2 turns.`); } continue; }
            if (normalizeTagName(tag.name) === 'Siphon') { const h = Math.floor(cappedPostDamage(finalDmg, pct || 30) * healBoost); s = { ...s, hp: Math.min(s.maxHp, s.hp + h) }; lines.push(`Siphon: ${s.name} heals ${h} HP.`); }
        }

        const recoilStatus = activeStatuses(s, round).find(st => st.name === 'Recoil');
        if (recoilStatus && finalDmg > 0) { const rc = cappedPostDamage(finalDmg, recoilStatus.percent ?? 30); s = { ...s, hp: Math.max(0, s.hp - rc) }; lines.push(`Recoil: ${s.name} takes ${rc} recoil damage from their own attack.`); }

        const ls = activeStatuses(s, round).find(st => st.name === 'Lifesteal');
        if (ls && finalDmg > 0) { const h = Math.floor(cappedPostDamage(finalDmg, ls.percent ?? 30) * healBoost); s = { ...s, hp: Math.min(s.maxHp, s.hp + h) }; lines.push(`Lifesteal: ${s.name} heals ${h} HP.`); }
    }

    if (healing > 0) s = { ...s, hp: Math.min(s.maxHp, s.hp + healing) };
    if (shieldGain > 0) s = { ...s, shield: s.shield + shieldGain };
    return { self: s, opponent: o, lines };
}

// ─── DoTs applied at start of each turn ───────────────────────────────────────
function applyDoTs(fighter: PvpFighter, round: number): { fighter: PvpFighter; lines: string[] } {
    const lines: string[] = [];
    let f = { ...fighter };
    for (const s of activeStatuses(f, round)) {
        if (s.name === 'Wound' && s.amount) { f = { ...f, hp: Math.max(0, f.hp - s.amount) }; lines.push(`${f.name} bleeds ${s.amount} (Wound).`); }
        if (s.name === 'Poison') { const poisonPct = s.percent && s.percent > 0 ? s.percent : 6; const dmg = Math.floor(f.maxChakra * (poisonPct / 100)); f = { ...f, hp: Math.max(0, f.hp - dmg), chakra: Math.max(0, f.chakra - dmg) }; lines.push(`${f.name} takes ${dmg} Poison damage.`); }
        if (s.name === 'Drain') { const amt = s.amount ?? DRAIN_AMOUNT; f = { ...f, hp: Math.max(0, f.hp - amt), chakra: Math.max(0, f.chakra - amt) }; lines.push(`${f.name} drained ${amt} HP+chakra.`); }
    }
    return { fighter: f, lines };
}

// ─── Win check ────────────────────────────────────────────────────────────────
function applyQueuedMovement(target: PvpFighter, source: PvpFighter, round: number): { fighter: PvpFighter; lines: string[] } {
    let fighter = { ...target };
    const lines: string[] = [];
    const movementStatuses = activeStatuses(fighter, round).filter(status => status.name === 'Push' || status.name === 'Pull');
    for (const status of movementStatuses) {
        const dist = Math.max(1, status.amount ?? 1);
        let nextPos = fighter.pos;
        for (let step = 0; step < dist; step++) {
            const candidates = hexNeighbors(nextPos).filter(tile => {
                if (tile === source.pos || tileBlocked(tile, fighter, source)) return false;
                return status.name === 'Push'
                    ? distance(tile, source.pos) > distance(nextPos, source.pos)
                    : distance(tile, source.pos) < distance(nextPos, source.pos);
            });
            if (!candidates.length) break;
            nextPos = candidates[0]!;
        }
        fighter = { ...fighter, pos: nextPos };
        lines.push(`${status.name}: ${fighter.name} is ${status.name === 'Push' ? 'pushed' : 'pulled'} ${dist} tile(s).`);
    }
    if (movementStatuses.length) {
        fighter = { ...fighter, statuses: fighter.statuses.filter(status => !movementStatuses.includes(status)) };
    }
    return { fighter, lines };
}

function checkWinner(s: PvpSession): PvpSession {
    if (s.status === 'done') return s;
    const { p1, p2 } = s;
    const lines: string[] = [];
    let status: 'active' | 'done' = 'active';
    let winner: 'p1' | 'p2' | 'draw' | null = null;
    if (p1.hp <= 0 && p2.hp <= 0) { status = 'done'; winner = 'draw'; lines.push('Both fighters fall! Draw!'); }
    else if (p1.hp <= 0) { status = 'done'; winner = 'p2'; lines.push(`⚔️ ${p2.name} wins!`); }
    else if (p2.hp <= 0) { status = 'done'; winner = 'p1'; lines.push(`⚔️ ${p1.name} wins!`); }
    else if (s.round > MAX_ROUNDS) {
        status = 'done';
        if (p1.hp > p2.hp) { winner = 'p1'; lines.push(`Time limit! ${p1.name} wins by HP!`); }
        else if (p2.hp > p1.hp) { winner = 'p2'; lines.push(`Time limit! ${p2.name} wins by HP!`); }
        else { winner = 'draw'; lines.push('Time limit! Draw!'); }
    }
    return { ...s, status, winner, log: lines.length ? [...s.log, ...lines] : s.log };
}

// ─── End active player's turn, hand off to the other ──────────────────────────
function endTurn(session: PvpSession): PvpSession {
    const current = session.activePlayer;
    const next: 'p1' | 'p2' = current === 'p1' ? 'p2' : 'p1';
    const newRound = current === 'p2' ? session.round + 1 : session.round;
    const lines: string[] = [];
    if (newRound > session.round) lines.push(`--- Round ${newRound} ---`);

    // Tick current player's statuses + cooldowns
    let s = { ...session };
    if (newRound > session.round) {
        s = { ...s, groundEffects: tickGroundEffects(s.groundEffects) };
    }
    if (current === 'p1') {
        s = { ...s, p1: tickStatuses(s.p1, session.round), cooldowns: { ...s.cooldowns, p1: tickCooldowns(s.cooldowns.p1) } };
    } else {
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
    if (s.status === 'done') return s;

    // Stun applies a 40 AP penalty instead of skipping the turn entirely
    const stunStatus = activeStatuses(nextFighter, newRound).find(st => st.name === 'Stun');
    const baseAp = stunStatus ? Math.max(0, 100 - 40) : 100;
    if (stunStatus) {
        const unstunned = { ...nextFighter, statuses: nextFighter.statuses.filter(st => st.name !== 'Stun') };
        s = next === 'p1' ? { ...s, p1: unstunned } : { ...s, p2: unstunned };
        lines.push(`${nextFighter.name} is stunned — starts turn with ${baseAp} AP.`);
    }

    // Lag: next player's AP costs increase by percent
    // Overclock: next player's AP costs decrease by percent — stored on fighter, applied by canAct in handler
    // Both are status effects already applied; the handler reads them via the session

    return { ...s, activePlayer: next, ap: { ...s.ap, [next]: baseAp }, actionsThisTurn: 0 };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { battleId, role, action, tile, jutsuId, itemId, itemName, itemData, weatherPositiveElement = '', weatherNegativeElement = '', biome = 'central' } = body as {
            battleId?: string;
            role?: 'p1' | 'p2';
            action?: string;
            tile?: number;
            jutsuId?: string;
            itemId?: string;
            itemName?: string;
            weatherPositiveElement?: string;
            weatherNegativeElement?: string;
            biome?: string;
            itemData?: {
                effectPower?: number;
                type?: string;
                weaponElement?: string;
                weaponRange?: number;
                ap?: number;
                tags?: JutsuTag[];
                weaponEffect?: string;
                weaponEffectValue?: number;
            };
        };
        if (!battleId || !role || !action) return res.status(400).json({ error: 'Missing battleId, role, or action' });

        const key = `pvp:${battleId}`;
        const sessionMaybe = await kv.get<PvpSession>(key);
        if (!sessionMaybe) return res.status(404).json({ error: 'Battle session not found' });
        const session: PvpSession = sessionMaybe;
        if (session.status === 'done') return res.status(200).json(session);
        if (session.activePlayer !== role) return res.status(200).json(session);

        const lockKey = `${key}:lock`;
        const lockToken = `${role}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const lockResult = await kv.set(lockKey, lockToken, { nx: true, ex: 3 } as never);
        if (!lockResult) return res.status(200).json(session);

        async function finish(payload: PvpSession) {
            await kv.del(lockKey).catch(() => undefined);
            return res.status(200).json(payload);
        }

        const me = role === 'p1' ? session.p1 : session.p2;
        const opp = role === 'p1' ? session.p2 : session.p1;
        const myCooldowns = role === 'p1' ? session.cooldowns.p1 : session.cooldowns.p2;
        const myAp = role === 'p1' ? session.ap.p1 : session.ap.p2;
        const lines: string[] = [];

        // Apply Lag (costs more) and Overclock (costs less) to AP
        function adjustedCost(base: number): number {
            let cost = base;
            const compression = activeStatuses(me, session.round).find(st => nameMatches(st.name, 'Lag'));
            const dilation = activeStatuses(me, session.round).find(st => nameMatches(st.name, 'Overclock'));
            if (compression) cost = Math.ceil(cost * (1 + (compression.percent ?? 20) / 100));
            if (dilation) cost = Math.floor(cost * (1 - (dilation.percent ?? 20) / 100));
            return Math.max(1, cost);
        }
        function canAct(cost: number) { return myAp >= adjustedCost(cost) && session.actionsThisTurn < MAX_ACTIONS; }

        function commit(updMe: PvpFighter | null, updOpp: PvpFighter | null, apCost: number, cd?: Record<string, number>, extra?: Partial<PvpSession>): PvpSession {
            let s: PvpSession = { ...session, ...extra } as PvpSession;
            if (updMe) s = role === 'p1' ? { ...s, p1: updMe } : { ...s, p2: updMe };
            if (updOpp) s = role === 'p1' ? { ...s, p2: updOpp } : { ...s, p1: updOpp };
            s = { ...s, ap: { ...s.ap, [role as 'p1' | 'p2']: myAp - adjustedCost(apCost) }, actionsThisTurn: s.actionsThisTurn + 1 };
            if (cd) s = { ...s, cooldowns: { ...s.cooldowns, [role as 'p1' | 'p2']: { ...myCooldowns, ...cd } } };
            if (lines.length) s = { ...s, log: [...s.log, ...lines] };
            return checkWinner(s);
        }

        let result: PvpSession;

        switch (action) {
            case 'wait': {
                lines.push(`${me.name} ends their turn.`);
                result = endTurn({ ...session, log: [...session.log, ...lines] });
                break;
            }

            case 'move': {
                if (tile === undefined || !canAct(30)) return finish(session);
                if (!hexNeighbors(me.pos).includes(tile) || tile === opp.pos || tileBlocked(tile, me, opp)) return finish(session);
                lines.push(`${me.name} moves.`);
                result = commit({ ...me, pos: tile }, null, 30);
                break;
            }

            case 'dash': {
                if (tile === undefined || !canAct(30)) return finish(session);
                if (distance(me.pos, tile) > 3 || tile === opp.pos || tile === me.pos || tileBlocked(tile, me, opp)) return finish(session);
                lines.push(`${me.name} dashes.`);
                result = commit({ ...me, pos: tile }, null, 30);
                break;
            }

            case 'basicAttack': {
                if (!canAct(40)) return finish(session);
                if (distance(me.pos, opp.pos) > 1) {
                    await kv.set(key, { ...session, log: [...session.log, `${me.name}: too far for basic attack — move closer.`] }, { ex: SESSION_TTL });
                    return finish({ ...session, log: [...session.log, `${me.name}: too far for basic attack.`] });
                }
                if (me.stamina < 10) {
                    await kv.set(key, { ...session, log: [...session.log, `${me.name}: not enough stamina.`] }, { ex: SESSION_TTL });
                    return finish({ ...session, log: [...session.log, `${me.name}: not enough stamina.`] });
                }
                const specialty = (me.character.specialty as string) ?? 'Ninjutsu';
                const basicJutsu: Jutsu = { id: 'basic-attack', name: 'Basic Attack', type: specialty, effectPower: 10, ap: 40, range: 1, tags: [] };
                lines.push(`${me.name} uses Basic Attack:`);
                const atk = applyJutsu(me, opp, basicJutsu, 1, biome, session.round);
                lines.push(...atk.lines);
                result = commit({ ...atk.self, stamina: Math.max(0, atk.self.stamina - 10) }, atk.opponent, 40);
                break;
            }

            case 'basicHeal': {
                if (!canAct(60) || (myCooldowns.basicHeal ?? 0) > 0 || me.chakra < 10) return finish(session);
                const healAmt = Math.max(1, Math.floor(me.maxHp * 0.1));
                lines.push(`${me.name} uses Basic Heal, restoring ${healAmt} HP.`);
                result = commit({ ...me, hp: Math.min(me.maxHp, me.hp + healAmt), chakra: Math.max(0, me.chakra - 10) }, null, 60, { basicHeal: 5 });
                break;
            }

            case 'clear': {
                if (!canAct(60) || (myCooldowns.clear ?? 0) > 0) return finish(session);
                if (hasStatus(opp, 'Clear Prevent', session.round)) {
                    lines.push(`${opp.name}'s Clear Prevent blocks the clear.`);
                    result = commit(null, null, 60, { clear: 10 });
                } else {
                    const removed = opp.statuses.filter(s => s.kind === 'positive').map(s => s.name);
                    lines.push(`Clear: removed ${removed.length ? removed.join(', ') : 'no positive effects'} from ${opp.name}.`);
                    result = commit(null, { ...opp, statuses: opp.statuses.filter(s => s.kind !== 'positive') }, 60, { clear: 10 });
                }
                break;
            }

            case 'cleanse': {
                if (!canAct(60) || (myCooldowns.cleanse ?? 0) > 0) return finish(session);
                if (hasStatus(me, 'Cleanse Prevent', session.round)) {
                    lines.push(`${me.name}'s Cleanse Prevent blocks the cleanse.`);
                    result = commit(null, null, 60, { cleanse: 10 });
                } else {
                    const removed = me.statuses.filter(s => s.kind === 'negative').map(s => s.name);
                    lines.push(`Cleanse: removed ${removed.length ? removed.join(', ') : 'no negative effects'} from ${me.name}.`);
                    result = commit({ ...me, statuses: me.statuses.filter(s => s.kind !== 'negative') }, null, 60, { cleanse: 10 });
                }
                break;
            }

            case 'jutsu': {
                if (!jutsuId) { await kv.del(lockKey).catch(() => undefined); return res.status(400).json({ error: 'Missing jutsuId' }); }
                const jutsuList = (me.character.jutsu as Jutsu[] | undefined) ?? [];
                const jutsu = jutsuList.find(j => j.id === jutsuId);
                if (!jutsu) {
                    const missingMsg = `${me.name}: selected jutsu is not available in this PvP session. Reopen the duel or re-equip your loadout.`;
                    const updated = { ...session, log: [...session.log, missingMsg] };
                    await kv.set(key, updated, { ex: SESSION_TTL });
                    return finish(updated);
                }
                const apCost = jutsu.ap ?? 40;
                if (!canAct(apCost) || (myCooldowns[jutsuId] ?? 0) > 0) return finish(session);

                // ── Elemental Seal enforcement ───────────────────────────────────
                // Elemental Seal blocks the five basic elements only.
                const BASIC_ELEMENTS = new Set(['Earth', 'Wind', 'Water', 'Lightning', 'Fire']);
                if (hasStatus(me, 'Elemental Seal', session.round) && jutsu.element && BASIC_ELEMENTS.has(jutsu.element)) {
                    const esMsg = `${me.name} is Elementally Sealed — cannot use ${jutsu.name} (${jutsu.element}).`;
                    const esState = { ...session, log: [...session.log, esMsg] };
                    await kv.set(key, esState, { ex: SESSION_TTL });
                    return finish(esState);
                }

                const jChakraCost = jutsu.chakraCost ?? 0;
                const jStaminaCost = jutsu.staminaCost ?? 0;
                if (jChakraCost > 0 && me.chakra < jChakraCost) {
                    const msg = `${me.name}: not enough chakra for ${jutsu.name} (need ${jChakraCost}).`;
                    const updated = { ...session, log: [...session.log, msg] };
                    await kv.set(key, updated, { ex: SESSION_TTL });
                    return finish(updated);
                }
                if (jStaminaCost > 0 && me.stamina < jStaminaCost) {
                    const msg = `${me.name}: not enough stamina for ${jutsu.name} (need ${jStaminaCost}).`;
                    const updated = { ...session, log: [...session.log, msg] };
                    await kv.set(key, updated, { ex: SESSION_TTL });
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
                    await kv.set(key, updated, { ex: SESSION_TTL });
                    return finish(updated);
                }
                if (!selfTarget && !groundTarget && !moveTag && affectsOpponent) {
                    const range = Math.max(0, Number(jutsu.range) || 0);
                    if (range > 0 && distance(me.pos, opp.pos) > range) {
                        const outOfRangeMsg = `${jutsu.name} is out of range (need ≤${range}, distance ${Math.round(distance(me.pos, opp.pos))}).`;
                        const updated = { ...session, log: [...session.log, outOfRangeMsg] };
                        await kv.set(key, updated, { ex: SESSION_TTL });
                        return finish(updated);
                    }
                }

                lines.push(`${me.name} uses ${jutsu.name}:`);
                const jWMult = weatherMultiplier(jutsu.element, weatherPositiveElement, weatherNegativeElement);
                const cd = (jutsu.cooldown ?? 0) > 0 ? { [jutsuId]: jutsu.cooldown! } : undefined;
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
                        await kv.set(key, updated, { ex: SESSION_TTL });
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
                    } else if (jutsuMethod === 'AOE_CIRCLE') {
                        lines.push(`${opp.name} is outside the impact area.`);
                        result = commit(movedSelf, null, apCost, cd);
                    } else {
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
                        await kv.set(key, updated, { ex: SESSION_TTL });
                        return finish(updated);
                    }
                    if (jutsuMethod === 'INSTANT_EFFECT') {
                        const zoneTags = groundEffectTags(tags);
                        if (!zoneTags.length) {
                            const msg = `${me.name}: ${jutsu.name} needs Decrease Damage Given, Recoil, or Poison for its ground effect.`;
                            const updated = { ...session, log: [...session.log, msg] };
                            await kv.set(key, updated, { ex: SESSION_TTL });
                            return finish(updated);
                        }
                        const groundEffect: PvpGroundEffect = {
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
                    } else {
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
                    await kv.del(lockKey).catch(() => undefined);
                    return res.status(400).json({ error: 'Weapon is not equipped for this fighter' });
                }
                const weapRange = serverItem.weaponRange ?? (normalizeEquipmentSlot(serverItem.slot) === 'thrown' ? 4 : 1);
                const wApCost = serverItem.apCost ?? 40;
                if (!canAct(wApCost)) return finish(session);
                if (distance(me.pos, opp.pos) > weapRange) {
                    const msg = `${me.name}: ${itemName ?? 'Weapon'} is out of range (need ≤${weapRange}).`;
                    const updated = { ...session, log: [...session.log, msg] };
                    await kv.set(key, updated, { ex: SESSION_TTL });
                    return finish(updated);
                }
                const wTags: JutsuTag[] = [...(serverItem.weaponTags ?? [])];
                if (serverItem.weaponEffect && !wTags.find(t => t.name === serverItem.weaponEffect)) {
                    wTags.push({ name: serverItem.weaponEffect, percent: serverItem.weaponEffectValue ?? 0 });
                }
                const weaponJutsu: Jutsu = {
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
                    await kv.del(lockKey).catch(() => undefined);
                    return res.status(400).json({ error: 'Item is not equipped for this fighter' });
                }
                const iApCost = serverItem.apCost ?? 35;
                if (!canAct(iApCost)) return finish(session);
                const iTags: JutsuTag[] = serverItem.weaponTags?.length
                    ? serverItem.weaponTags
                    : serverItem.weaponEffect
                        ? [{ name: serverItem.weaponEffect, percent: serverItem.weaponEffectValue ?? 0 }]
                        : [{ name: 'Heal' }];
                const itemJutsu: Jutsu = {
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
                if (!canAct(100)) return finish(session);
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
                } else {
                    lines.push(`${me.name} tried to flee, lost ${hpCost} HP, but failed.`);
                    result = commit(updatedMe, null, 100);
                }
                break;
            }

            default:
                await kv.del(lockKey).catch(() => undefined);
                return res.status(400).json({ error: `Unknown action: ${action}` });
        }

        await kv.set(key, result, { ex: SESSION_TTL });
        return finish(result);
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}

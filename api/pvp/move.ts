import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomInt } from 'crypto';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import type { PvpFighter, PvpGroundEffect, PvpSession, PvpStatus, HitFxTarget, CombatVfxTarget, CombatVfxKey } from './session.js';
import { COMBAT_RESOURCES_V2, v2ResourceRegen, v2PoisonOnSpend } from '../_combat-resources.js';
import { GRID_H, GRID_W, MAX_ACTIONS, MAX_ROUNDS, SESSION_TTL } from '../combat-core/constants.js';
import { hexDistance as distance, hexNeighbors, nextStepToward } from '../combat-core/grid.js';
import { tickCombatCooldowns } from '../combat-core/cooldowns.js';
import { adjustedApCost } from '../combat-core/resources.js';
import { resolveJutsu as resolveCoreJutsu, type ResolveJutsuMetadata } from '../combat-core/resolveJutsu.js';
import {
    DISCIPLINE_OFFENSE_FIELD,
    DRAIN_BASE_TICK,
    MAX_WOUND_STACKS,
    STUN_AP_PENALTY,
    ampMultiplierFromStatuses,
    armorRawDrFromCharacter,
    disciplineBonusesFromStatuses,
    dotMitigationFromRawDr,
    drainTick,
    drContributionFromStatuses,
    getOffense,
    generalsBonusFromStatuses,
    directDamageBaseFormula,
    directDamageNumberFormula,
    healMultiplierFromStatuses,
    healAmountForMastery,
    JUTSU_MAX_LEVEL,
    jutsuLevelCapForLevel,
    perRankStatCap,
    postDamageFormula,
    postDamagePercentAmount,
    scaledTagPercent as scaleCombatTagPercent,
    shieldAmountForMastery,
    WEAPON_AMP_TAG_CAP,
    statusDurationFor,
    weatherMultiplier,
    withDisciplineBonuses,
    withGeneralsBonus,
    woundAmountForFinalDamage,
} from '../combat-core/formulas.js';
import {
    activeCombatStatuses,
    addCombatStatus,
    capCombatStatusStacks,
    countActiveCombatStatuses,
    hasCombatStatus,
    isCombatStatusActive,
    sumActiveCombatStatusPercent,
    tickCombatStatuses,
} from '../combat-core/statuses.js';
import type { CombatFxEvent, CombatTag } from '../combat-core/types.js';
import {
    CASTER_WARD_VFX_KEYS as VFX_CASTER_WARD_KEYS,
    ELEMENTAL_60_VFX_KEYS as VFX_ELEMENTAL_60_KEYS,
    MAX_COMBAT_VFX_TILES,
    canonicalJutsuTagNames,
    semanticJutsuVfx,
    semanticKeyForJutsuTags,
} from '../combat-core/jutsu-vfx.js';

// Internal floating-number event before it's mapped to a concrete fighter slot.
// `self` = the caster / ticking fighter, `opp` = the opponent — resolved to
// p1/p2 by the handler (which knows the acting role). Mirrors the log line that
// is pushed alongside it, so the flying number equals the logged damage/heal.
type HitFxEvent = CombatFxEvent;
function pushFx(fx: HitFxEvent[], who: 'self' | 'opp', amount: number, kind: 'damage' | 'heal') {
    if (amount > 0) fx.push({ who, amount: Math.round(amount), kind });
}
type RelativeVfxEvent = Omit<CombatVfxTarget, 'target'> & { who: 'self' | 'opp' };
// durationMs values are ~25% longer than the original tuning so plates linger a
// beat longer on screen. Keep this table in sync with the client-side
// `COMBAT_VFX_REGISTRY` in shinobij.client/src/lib/combat-vfx.ts.
const VFX_DEFAULTS: Record<CombatVfxKey, { durationMs: number; maxParticles: number }> = {
    fire: { durationMs: 850, maxParticles: 20 },
    fire60: { durationMs: 1050, maxParticles: 24 },
    water: { durationMs: 900, maxParticles: 18 },
    water60: { durationMs: 1100, maxParticles: 24 },
    wind: { durationMs: 780, maxParticles: 16 },
    wind60: { durationMs: 1000, maxParticles: 24 },
    lightning: { durationMs: 700, maxParticles: 18 },
    lightning60: { durationMs: 900, maxParticles: 24 },
    earth: { durationMs: 900, maxParticles: 16 },
    earth60: { durationMs: 1050, maxParticles: 24 },
    blood: { durationMs: 850, maxParticles: 18 },
    shadow: { durationMs: 930, maxParticles: 16 },
    poison: { durationMs: 950, maxParticles: 16 },
    magma: { durationMs: 950, maxParticles: 22 },
    metal: { durationMs: 800, maxParticles: 14 },
    slash: { durationMs: 530, maxParticles: 8 },
    impact: { durationMs: 580, maxParticles: 10 },
    pierce: { durationMs: 580, maxParticles: 10 },
    heal: { durationMs: 1030, maxParticles: 16 },
    shield: { durationMs: 1130, maxParticles: 14 },
    reflect: { durationMs: 1030, maxParticles: 14 },
    absorb: { durationMs: 1030, maxParticles: 14 },
    spark: { durationMs: 700, maxParticles: 18 },
    seal: { durationMs: 950, maxParticles: 14 },
    wound: { durationMs: 780, maxParticles: 12 },
    burn: { durationMs: 900, maxParticles: 18 },
    poisonCloud: { durationMs: 1130, maxParticles: 18 },
    drain: { durationMs: 1050, maxParticles: 16 },
    cleanse: { durationMs: 950, maxParticles: 14 },
    buff: { durationMs: 1030, maxParticles: 14 },
    debuff: { durationMs: 950, maxParticles: 14 },
    throwable: { durationMs: 650, maxParticles: 10 },
    weapon: { durationMs: 550, maxParticles: 8 },
    namedWeapon: { durationMs: 780, maxParticles: 14 },
    heavy: { durationMs: 780, maxParticles: 16 },
    ko: { durationMs: 1050, maxParticles: 24 },
};
function vfxEvent(
    who: 'self' | 'opp',
    key: CombatVfxKey,
    anchor: CombatVfxTarget['anchor'],
    intensity: CombatVfxTarget['intensity'] = 'normal',
    patch: Partial<Omit<RelativeVfxEvent, 'who' | 'key' | 'anchor' | 'intensity'>> = {},
): RelativeVfxEvent {
    const defaults = VFX_DEFAULTS[key] ?? VFX_DEFAULTS.impact;
    return {
        who,
        key,
        anchor,
        intensity,
        durationMs: patch.durationMs ?? defaults.durationMs,
        persistent: patch.persistent,
        maxParticles: patch.maxParticles ?? defaults.maxParticles,
        tiles: patch.tiles?.slice(0, MAX_COMBAT_VFX_TILES),
    };
}
import type { ActionReceiptCategory } from '../_receipts.js';

// Readable fallback label + category per raw move action, used to seed the
// receipt metadata before the switch. Branches that resolve a real jutsu/item
// overwrite both; the terminal/system actions rely on these entries so a
// historical log never shows a bare protocol string like "claim-afk-win".
const DEFAULT_ACTION_LABELS: Record<string, string> = {
    wait: 'Wait',
    move: 'Move',
    clear: 'Clear',
    cleanse: 'Cleanse',
    flee: 'Flee',
    basicAttack: 'Basic Attack',
    basicHeal: 'Basic Heal',
    jutsu: 'Jutsu',
    weapon: 'Weapon Attack',
    item: 'Item',
    'claim-afk-win': 'Forfeit Win Claimed',
    join: 'Join Battle',
};

const DEFAULT_ACTION_CATEGORIES: Record<string, ActionReceiptCategory> = {
    wait: 'turn',
    move: 'movement',
    clear: 'basic',
    cleanse: 'basic',
    flee: 'turn',
    basicAttack: 'basic',
    basicHeal: 'basic',
    jutsu: 'jutsu',
    weapon: 'weapon',
    item: 'item',
    'claim-afk-win': 'system',
    join: 'system',
};
import { replayCommittedPvpTerminalEffects } from './_committed-terminal-effects.js';
import { commitPvpSessionMutation } from './_session-mutation.js';
import {
    replayCommittedPvpActionReceipt,
    withPvpActionReceiptReplay,
} from './_action-receipt-replay.js';
import { ensurePvpSectorWarRegistration } from './_sector-war-continuation.js';
import { ensureKageDuelAdmission } from '../village/_kage-settle.js';
import {
    TAG_ALIASES,
    STACKABLE_STATUS,
    CAPPED_AMP_TAGS,
} from './_tags.js';
import {
    createCanonicalGroundEffect,
    resolveJutsuActionPlan,
} from '../combat-core/resolve-jutsu-action.js';
import {
    activatePvpPendingSessionPointer,
    clearPvpPendingSessionPointer,
    loadPvpPendingSessionPointer,
    pendingPointerMatchesSession,
    pendingPointerForSessionRole,
    pvpPendingReservationIsFresh,
    publishPvpPendingSessionPointer,
    requirePvpPendingSessionOwnership,
} from './_pending-session.js';
import { loadPvpRewardRecoverySnapshot } from './_reward-recovery.js';
import { pvpRewardCompletionStatus } from './_reward-completion.js';

// Combat formula constants and pure numeric helpers live in combat-core/formulas.
// move.ts keeps PvP session/API glue, tag aliases, grid mutation, and log wording.

// ─── Tile helpers ─────────────────────────────────────────────────────────────
function barrierTiles(...fighters: PvpFighter[]): number[] {
    return fighters.flatMap(f => f.statuses.filter(s => s.name === 'Barrier' && typeof s.amount === 'number').map(s => s.amount!));
}
function tileBlocked(tile: number, ...fighters: PvpFighter[]) {
    return barrierTiles(...fighters).includes(tile);
}
// ─── Jutsu types ──────────────────────────────────────────────────────────────
type JutsuTag = CombatTag;
type PvpItem = {
    id?: string;
    name?: string;
    slot?: string;
    weaponEp?: number;
    weaponElement?: string;
    weaponRange?: number;
    weaponCooldown?: number;
    apCost?: number;
    weaponTags?: JutsuTag[];
    weaponEffect?: string;
    weaponEffectValue?: number;
    weaponEffectTarget?: string;
    restoreChakra?: number;
    restoreStamina?: number;
};
type Jutsu = {
    id: string;
    name: string;
    type: string;
    element?: string;
    // Weather affinity, decoupled from the cosmetic `element`. Mirrors the
    // client (shinobij.client/src/lib/elements.ts weatherElementOf): a base
    // element gains/loses with weather; "None" or absent → no weather effect.
    weatherElement?: string;
    /** Cosmetic 60 AP plate chosen in the Bloodline Builder. */
    visualEffect?: string;
    target?: string;
    range?: number;
    ap?: number;
    cooldown?: number;
    effectPower?: number;
    isUtility?: boolean;
    bloodlineRank?: string;
    method?: string;
    chakraCost?: number;
    staminaCost?: number;
    tags?: JutsuTag[];
    battleDescription?: string;
    // Weapon strikes set this when the wielder lacks the weapon's element (or the
    // weapon has no element at all). resolveBaseDamage folds it into the
    // Bloodline-Seal branch so the swing gets NO bloodline damage multiplier —
    // the "an elemental weapon only rides the bloodline boost when its element is
    // one the wielder has awakened" rule. Absent/false on real jutsu and basic
    // attacks, so their bloodline boost is unchanged.
    suppressBloodline?: boolean;
};

// Canonicalize a tag name via the shared alias map (./_tags). Sessions are
// sealed with canonical names already; this stays as a defensive normalizer so
// applyJutsu also works on raw/un-sanitized inputs (e.g. the engine tests).
function normalizeTagName(name: string): string {
    return TAG_ALIASES[name] ?? name;
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

function vfxTagNames(tags?: JutsuTag[]): string[] {
    return canonicalJutsuTagNames(tags);
}
function vfxForTagEffect(tags: JutsuTag[] | undefined, intensity: CombatVfxTarget['intensity'] = 'minor'): RelativeVfxEvent[] {
    const key = semanticKeyForJutsuTags(vfxTagNames(tags), false) as CombatVfxKey | null;
    if (!key) return [];
    const selfVisual = VFX_CASTER_WARD_KEYS.has(key);
    return [vfxEvent(selfVisual ? 'self' : 'opp', key, selfVisual ? 'caster' : 'target', intensity)];
}
function strongestDamageRatio(fx: HitFxEvent[] | undefined, self: PvpFighter, opponent: PvpFighter): number {
    let ratio = 0;
    for (const event of fx ?? []) {
        if (event.kind !== 'damage') continue;
        const maxHp = event.who === 'self' ? self.maxHp : opponent.maxHp;
        ratio = Math.max(ratio, event.amount / Math.max(1, maxHp));
    }
    return ratio;
}
function intensityFromHit(fx: HitFxEvent[] | undefined, self: PvpFighter, opponent: PvpFighter, ko = false): CombatVfxTarget['intensity'] {
    if (ko) return 'finisher';
    return strongestDamageRatio(fx, self, opponent) >= 0.18 ? 'heavy' : 'normal';
}
function vfxForJutsu(
    jutsu: Jutsu,
    self: PvpFighter,
    opponent: PvpFighter,
    fx: HitFxEvent[] | undefined,
    opts: { ground?: boolean; area?: boolean; tiles?: number[]; persistent?: boolean; ko?: boolean; who?: 'self' | 'opp' } = {},
): RelativeVfxEvent {
    const measuredIntensity = intensityFromHit(fx, self, opponent, !!opts.ko);
    const semantic = semanticJutsuVfx(jutsu, { ground: opts.ground || opts.area, area: opts.area, heavy: measuredIntensity === 'heavy', ko: opts.ko });
    const key = semantic.key as CombatVfxKey;
    const intensity = measuredIntensity === 'finisher' ? measuredIntensity : VFX_ELEMENTAL_60_KEYS.has(key) ? 'heavy' : measuredIntensity;
    const anchor = semantic.anchor;
    const who = opts.who ?? (anchor === 'caster' ? 'self' : 'opp');
    return vfxEvent(who, key, anchor, intensity, {
        persistent: opts.persistent,
        tiles: opts.tiles,
    });
}
function reactionVfx(beforeDefender: PvpFighter, afterDefender: PvpFighter, fx: HitFxEvent[] | undefined): RelativeVfxEvent[] {
    const out: RelativeVfxEvent[] = [];
    if (beforeDefender.shield > afterDefender.shield) out.push(vfxEvent('opp', 'shield', 'target', 'minor'));
    if ((fx ?? []).some(event => event.who === 'self' && event.kind === 'damage')) out.push(vfxEvent('opp', 'reflect', 'target', 'minor'));
    if ((fx ?? []).some(event => event.who === 'opp' && event.kind === 'heal')) out.push(vfxEvent('opp', 'absorb', 'target', 'minor'));
    return out;
}

// ─── Stat helpers ─────────────────────────────────────────────────────────────
function generalsBonus(f: PvpFighter, round: number): number {
    return generalsBonusFromStatuses(activeStatuses(f, round), nameMatches);
}

function disciplineBonuses(f: PvpFighter, round: number): Record<string, number> {
    return disciplineBonusesFromStatuses(activeStatuses(f, round), nameMatches);
}
// ─── Fighter helpers ──────────────────────────────────────────────────────────
function isStatusActive(status: PvpStatus, round: number) {
    return isCombatStatusActive(status, round);
}
function activeStatuses(f: PvpFighter, round: number) {
    return activeCombatStatuses(f.statuses, round);
}
// `round` is REQUIRED: a status scheduled for a future round (activeRound =
// round + 1) must never read as active in the current turn. Defaulting the
// round (the old `= Infinity`) silently treated not-yet-active statuses as live
// if a caller forgot to pass it — so the type now forces every call site to be
// explicit about which round it's asking about.
function hasStatus(f: PvpFighter, name: string, round: number) {
    return hasCombatStatus(f.statuses, name, round, nameMatches);
}
function addStatus(f: PvpFighter, s: PvpStatus): PvpFighter {
    // v4.3: apply duration override (IDG/IDT/DDG/DDT → 2 rounds), then either stack or replace.
    return {
        ...f,
        statuses: addCombatStatus(f.statuses, s, {
            durationFor: statusDurationFor,
            isStackable: name => STACKABLE_STATUS.has(name),
            nameMatches,
        }),
    };
}
function countActive(f: PvpFighter, name: string, round: number): number {
    return countActiveCombatStatuses(f.statuses, name, round, nameMatches);
}
// Sum the percents of every active stack of a status. Used by the post-damage
// defensive tags (Absorb/Reflect/Lifesteal): they stack additively and the
// total is hard-capped at 60% downstream by cappedPostDamage. A single stack
// sums to itself, so this is behaviour-preserving for the common case.
function sumActivePct(f: PvpFighter, name: string, round: number, fallback = 30): number {
    return sumActiveCombatStatusPercent(f.statuses, name, round, fallback);
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
// Wound is a stacking bleed DoT (every cast adds a stack, all stacks tick). Per-hit
// magnitude is rank-capped, but the STACK COUNT was unbounded → repeated casts
// compounded into unwinnable bleed-lock. Cap concurrent Wound stacks: keep the
// MAX_WOUND_STACKS highest-amount ones (ties → most-recently-applied wins, so a
// re-cast refreshes rather than being dropped). Mirrors client combat-math
// capWoundStacks — KEEP IN SYNC (parity test).
function capWoundStacks(f: PvpFighter): PvpFighter {
    const statuses = capCombatStatusStacks(f.statuses, 'Wound', MAX_WOUND_STACKS);
    return statuses === f.statuses ? f : { ...f, statuses: statuses as PvpStatus[] };
}
// Exported for the ground-effect timing test (_combat-tags.test.ts), which pins
// "a zone applies its tags exactly once per pass and Debuff Prevent blocks it".
export function applyGroundEffectToFighter(fighter: PvpFighter, effect: PvpGroundEffect, round: number): { fighter: PvpFighter; lines: string[] } {
    let next = { ...fighter };
    const lines: string[] = [];
    if (!effect.tiles.includes(fighter.pos)) return { fighter: next, lines };
    // Round-aware: a Debuff Prevent the target cast THIS turn (deferred) must not
    // block the ground effect a round early. (hasStatus defaults to +Infinity,
    // which would treat a not-yet-active Prevent as live — pass the real round.)
    if (hasStatus(next, 'Debuff Prevent', round)) {
        lines.push(`${next.name}'s Debuff Prevent blocks ${effect.name}.`);
        return { fighter: next, lines };
    }
    for (const tag of effect.tags) {
        const tagName = normalizeTagName(tag.name);
        const pct = Math.max(1, Math.floor(tag.percent ?? 30));
        // Zone debuffs refresh to ONE turn each pass (not 2). The zone re-applies
        // every round a fighter stands in it, and these statuses are non-stackable
        // (addStatus replaces), so a 2-turn refresh would reset the timer each pass
        // and leave the debuff lingering a full 2 rounds AFTER the zone expired —
        // strictly stronger than the same tag cast directly. A 1-turn refresh keeps
        // it active only while standing in the zone, ending when the zone does.
        if (tagName === 'Decrease Damage Given') {
            next = addStatus(next, { name: 'Decrease Damage Given', rounds: 1, percent: pct, kind: 'negative' });
            lines.push(`${effect.name}: ${next.name} deals ${pct}% less damage this turn.`);
        } else if (tagName === 'Recoil') {
            next = addStatus(next, { name: 'Recoil', rounds: 1, percent: pct, kind: 'negative' });
            lines.push(`${effect.name}: ${next.name} suffers ${pct}% recoil on attacks this turn.`);
        } else if (tagName === 'Poison') {
            const poisonPct = pct > 0 ? pct : 6;
            // v2: zone poison lasts 2 rounds (on-spend model — matches PvE + jutsu poison).
            // v1: 1-round refresh tracks zone presence for the legacy per-round pool tick.
            next = addStatus(next, { name: 'Poison', rounds: COMBAT_RESOURCES_V2 ? 2 : 1, percent: poisonPct, kind: 'negative' });
            if (COMBAT_RESOURCES_V2) {
                lines.push(`${effect.name}: ${next.name} is poisoned for 2 rounds — casting jutsu will hurt.`);
            } else {
                const dmg = Math.floor(next.maxChakra * (poisonPct / 100));
                lines.push(`${effect.name}: ${next.name} is poisoned for ~${dmg} this turn.`);
            }
        }
    }
    return { fighter: next, lines };
}
function applyGroundEffects(session: PvpSession, round: number): { session: PvpSession; lines: string[] } {
    let p1 = session.p1;
    let p2 = session.p2;
    const lines: string[] = [];
    for (const effect of session.groundEffects ?? []) {
        const targetRole = effect.owner === 'p1' ? 'p2' : 'p1';
        if (targetRole === 'p1') {
            const applied = applyGroundEffectToFighter(p1, effect, round);
            p1 = applied.fighter;
            lines.push(...applied.lines);
        } else {
            const applied = applyGroundEffectToFighter(p2, effect, round);
            p2 = applied.fighter;
            lines.push(...applied.lines);
        }
    }
    return { session: { ...session, p1, p2 }, lines };
}
// Exported for the ground-effect timing test (_combat-tags.test.ts).
export function tickGroundEffects(effects: PvpGroundEffect[] | undefined): PvpGroundEffect[] {
    return (effects ?? [])
        .map(effect => ({ ...effect, rounds: effect.rounds - 1 }))
        .filter(effect => effect.rounds > 0);
}
// Exported so other server-authoritative combat modes (Battle Towers' N-actor engine)
// can expire statuses with the IDENTICAL active-round / decrement semantics. Pure
// function; exporting it changes zero PvP behaviour.
export function tickStatuses(f: PvpFighter, round: number): PvpFighter {
    return { ...f, statuses: tickCombatStatuses(f.statuses, round) };
}
function tickCooldowns(cds: Record<string, number>): Record<string, number> {
    return tickCombatCooldowns(cds);
}
// Raw DR contribution from defensive status effects.
// v4.3: DDT/DDG are stackable; each instance contributes its percent to the DR pool.
// Soft-capped via K_DR so stacking always helps but with diminishing returns.
function drContributionFor(attacker: PvpFighter, defender: PvpFighter, round: number): number {
    return drContributionFromStatuses(activeStatuses(attacker, round), activeStatuses(defender, round));
}
// Amplifiers (offensive / vulnerability buffs). All amp tags feed a single
// diminishing-returns pool, mirroring K_DR for defensive stacks:
//     rawAmp     = Σ(IDG attacker) + Σ(IDT defender) + Σ(Ignition defender)
//     effective  = rawAmp / (rawAmp + K_AMP)        ← always < 1, soft-caps
//     multiplier = 1 + effective
// Stack 1 of 35% gives ~1.41×; stack 4 of 35% gives ~1.74× (was ~3.32×).
// Also stops the IDG-+-Ignition combo from compounding past the soft cap.
function ampMultiplierFor(attacker: PvpFighter, defender: PvpFighter, round: number): number {
    return ampMultiplierFromStatuses(activeStatuses(attacker, round), activeStatuses(defender, round), nameMatches);
}

// Amp/DR tags whose percent is rank-capped (CAPPED_AMP_TAGS from ./_tags —
// mirrors the client's `cappedDamageTags`). Wound is NOT in that set (it has its
// own rank cap via woundCapForJutsu).
// Rank → max amp-tag percent. Mirrors client tagCapForRank (S 40 / A·B 35 / else 30).
// Scale a tag percent by mastery level — mirrors the client's effectiveTagPercent logic:
//   level 50 = full stored value, each level below 50 subtracts 0.2 from the raw percent.
// For amp/DR tags, then clamp to the bloodline rank cap (parity with PvE, which
// caps these via effectiveTagPercent — previously PvP applied no cap).
// `capOverride` lets a WEAPON swing answer to WEAPON_AMP_TAG_CAP instead of the
// bloodline table — a weapon has no rank, so it would otherwise take the 30 floor.
function scaledTagPercent(rawPct: number, masteryLevel: number, tagName?: string, bloodlineRank?: string | null, capOverride?: number): number {
    return scaleCombatTagPercent(rawPct, masteryLevel, tagName, bloodlineRank, CAPPED_AMP_TAGS, capOverride);
}

// ─── Jutsu application — resolved in explicit, fixed-order phases ─────────────
// applyJutsu is the heart of PvP resolution. The resolution ORDER is load-bearing
// (a reflect that ran before the shield block, or an amp that read a buff this
// same cast applied, would change outcomes), so the engine runs as a sequence of
// named phases — each one a self-contained step that hands its result to the next:
//
//   1. resolveBaseDamage  — EP scaling, statFactor, base damage, defensive DR pool
//   2. resolveTagStatuses — apply/prevent statuses + INSTANT movement (Push/Pull),
//                           and surface the Heal/Shield/Barrier/Pierce outcomes
//   3. resolveDamageNumber— final damage = pierce true-damage OR base×(1−DR)×amp
//   4. resolvePostDamage  — shield → reflect → absorb → item passives → wound →
//                           recoil → lifesteal → siphon   (order is load-bearing)
//   5. applyJutsu (below) — applies the pending self heal/shield, returns the result
//
// Phases 1 & 3 read the ORIGINAL fighters on purpose, so amp/DR can't read a buff
// THIS cast just applied. Phases 2 & 4 thread the mutated copies. DoT/tick effects
// (Wound/Poison/Drain ticks) are NOT here — they resolve at the start of the
// victim's turn in applyDoTs (endTurn). Action validation lives in the move handler.

type JutsuDamageSetup = { baseDmg: number; effectiveDR: number; offStats: Record<string, number> };

// Steep mastery→magnitude ramp, shared by EP damage and the flat Heal/Shield tags:
// an untrained jutsu is MASTERY_MIN_DAMAGE_FRAC of its fully-mastered value, ramping
// to 100% at JUTSU_MAX_LEVEL. Applied to Heal/Shield (hard-capped at the FLAT ceiling)
// it leaves maxed play byte-identical while damping low-mastery heal/shield spam.
// Mirrors client combat-math.ts masteryDamageFrac — KEEP IN SYNC (parity test).
// characterOwnsElement lives in the leaf module ./_elements.js so the weapon
// attunement endpoint can reuse it without importing the combat engine. Imported
// for internal use (the weapon synth's bloodline gate) and re-exported so existing
// importers (api/towers/_engine.ts, the tests) keep resolving it from './move.js'.
import { characterOwnsElement } from './_elements.js';
export { characterOwnsElement };

// Phase 1 — EP scaling → base damage, plus the defender's diminishing-returns DR pool.
function resolveBaseDamage(self: PvpFighter, opponent: PvpFighter, jutsu: Jutsu, wMult: number, biome: string, round: number, masteryLevel: number): JutsuDamageSetup {
    const offStats = (self.character.stats as Record<string, number>) ?? {};
    const defStats = (opponent.character.stats as Record<string, number>) ?? {};
    return directDamageBaseFormula({
        jutsu,
        attackerStats: offStats,
        defenderStats: defStats,
        attackerCharacter: self.character as Record<string, unknown>,
        defenderCharacter: opponent.character as Record<string, unknown>,
        masteryLevel,
        wMult,
        biome,
        rawStatusDR: drContributionFor(self, opponent, round),
        // A weapon swing that doesn't match an awakened element carries
        // suppressBloodline → treat it like a Bloodline Seal for THIS hit so the
        // bloodline damage multiplier collapses to 1.0 (weapon-only; jutsu unset).
        hasBloodlineSeal: hasStatus(self, 'Bloodline Seal', round) || jutsu.suppressBloodline === true,
    });
}

// Heal-amplification multiplier from the caster's ACTIVE Increase Heal statuses.
// (An Increase Heal applied THIS cast is deferred to next round, so it doesn't
// boost the same-turn Heal/Siphon — matching the old in-line computation.)
function increaseHealMult(fighter: PvpFighter, round: number): number {
    return healMultiplierFromStatuses(activeStatuses(fighter, round));
}

type StatusPhaseResult = { s: PvpFighter; o: PvpFighter; lines: string[]; damage: number; healing: number; shieldGain: number; pierce: boolean };

// Phase 2 — walk the jutsu's tags: apply/prevent statuses, resolve INSTANT
// movement (Push/Pull), and surface the zero-damage outcomes (Heal/Shield/Barrier)
// and the Pierce flag. Returns mutated copies; never touches the originals.
function resolveTagStatuses(self: PvpFighter, opponent: PvpFighter, jutsu: Jutsu, round: number, masteryLevel: number, baseDmg: number, healBoost: number): StatusPhaseResult {
    const tags = jutsu.tags ?? [];
    const lines: string[] = [];
    let s = { ...self };
    let o = { ...opponent };
    let damage = baseDmg;
    let healing = 0;
    let shieldGain = 0;
    let pierce = false;
    // Flat Heal/Shield ramp by the same mastery fraction as damage, hard-capped at
    // the FLAT ceiling — maxed casts stay exactly HEAL_FLAT/SHIELD_FLAT, low-mastery
    // ones heal/shield proportionally less (curbs early heal-spam). See masteryDamageFrac.

    // A WEAPON SWING is not a jutsu. Every weapon synth (PvP move.ts, solo-PvE
    // _engine.ts, towers _engine.ts) marks itself `isUtility: false` — the flag that
    // already exempts it from the legacy 40-AP zero-damage rule, and the only place
    // in the repo that sets it. Two jutsu-only conventions are wrong for a swing:
    //
    //  1. Heal/Shield no longer zero the direct damage at all. A cast that deals
    //     damage KEEPS it, and the heal/shield rides on top (owner ruling
    //     2026-08-16). This does not open the 40-AP utility door: a utility cast
    //     already has scaledEp 0 via isZeroDamageFortyApJutsu
    //     (combat-core/formulas.ts), so its damage is 0 before this loop runs. What
    //     it fixes is the 60-AP DAMAGE jutsu and the weapon swing, both of which
    //     were silently zeroed by their own support tag — the named weapons that
    //     rolled Heal/Shield (2 of the 12 tags in craft/_named.ts WEAPON_TAGS) and
    //     the built-in Frostfang Oathblade / Glacier King Cleaver swung for ZERO.
    //     Barrier is deliberately excluded: it is pure board control, not a payload,
    //     so it still zeroes the cast.
    //  2. Tag percents ramp with JUTSU MASTERY, and a weapon has none — it is always
    //     mastery 0, a flat −10 points. That silently made every 10%-effect weapon
    //     (the whole common tier) completely inert and halved the rest, while the
    //     item tooltip and the client's own weapon path both promised the authored
    //     value. Percents resolve at max mastery so the number on the item is the
    //     number you get, under the weapon's own amp ceiling (WEAPON_AMP_TAG_CAP,
    //     35 — mythic weapons are authored at 35 by design, and a weapon has no
    //     bloodline rank so ampTagCapForRank would wrongly floor it at 30).
    //
    // The flat Heal/Shield MAGNITUDE deliberately keeps the real mastery — a swing
    // heals its ~30% share, not a full jutsu's 750. See _weapon-damage.test.ts.
    const weaponSwing = jutsu.isUtility === false;
    const tagPercentMastery = weaponSwing ? JUTSU_MAX_LEVEL : masteryLevel;
    for (const tag of tags) {
        // Branch on the CANONICAL name only — sessions are sealed canonical, and
        // normalizeTagName re-canonicalizes here so direct (un-sanitized) callers
        // (engine tests, NPC payloads) resolve aliases the same way.
        const tagName = normalizeTagName(tag.name);
        const pct = Math.floor(scaledTagPercent(tag.percent ?? 0, tagPercentMastery, tagName, jutsu.bloodlineRank, weaponSwing ? WEAPON_AMP_TAG_CAP : undefined));
        if (tagName === 'Heal') { const healAmt = healAmountForMastery(masteryLevel, healBoost); healing += healAmt; lines.push(`Heal: ${s.name} restores ${healAmt} HP.`); continue; }
        if (tagName === 'Shield') { const shieldAmt = shieldAmountForMastery(masteryLevel); shieldGain += shieldAmt; lines.push(`Shield: ${s.name} gains ${shieldAmt} shield.`); continue; }
        // Barrier stays a JUTSU-only tag: it drops a wall tile on the board, which
        // is a cast-time control mechanic, not something a blade does. Owner ruling
        // 2026-08-16 — no built-in weapon carries it and the forge cannot roll it, so
        // this exempts nothing today; it is the fail-safe if one ever reaches a swing.
        // sanitizePvpItems strips it from weapon tags at the seal (the real gate).
        if (tagName === 'Barrier') { const tile = nextStepToward(s.pos, o.pos); if (tile !== s.pos && tile !== o.pos) { s = addStatus(s, { name: 'Barrier', rounds: 2, amount: tile, kind: 'positive' }); lines.push(`Barrier: ${s.name} blocks hex ${tile} for 2 turns.`); } else lines.push(`Barrier: no room to place a wall.`); damage = 0; continue; }
        if (tagName === 'Pierce') { pierce = true; lines.push(`Pierce: bypasses defenses.`); continue; }
        if (tagName === 'Stun') { if (!hasStatus(o, 'Debuff Prevent', round) && !hasStatus(o, 'Stun Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Stun', rounds: 1, kind: 'negative' }, round); lines.push(`Stun: ${o.name} loses 40 AP next turn.`); } continue; }
        if (tagName === 'Poison') { if (!hasStatus(o, 'Debuff Prevent', round)) { const poisonPct = pct > 0 ? pct : 6; o = addJutsuStatus(o, jutsu, { name: 'Poison', rounds: 2, percent: poisonPct, kind: 'negative' }, round); if (COMBAT_RESOURCES_V2) { lines.push(`Poison: ${o.name} is poisoned for 2 turns — casting jutsu will hurt.`); } else { const dmg = Math.floor(o.maxChakra * (poisonPct / 100)); lines.push(`Poison: ${o.name} takes ~${dmg}/round for 2 turns.`); } } continue; }
        if (tagName === 'Drain') {
            // v4.3: Drain is single-stack (addStatus replaces on re-apply) and scales with attacker mastery.
            // Tick = clamp(50 + masteryLevel × 5, 50, 300). At mastery 50: 300/tick.
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                const drainTickAmount = drainTick(masteryLevel);
                o = addJutsuStatus(o, jutsu, { name: 'Drain', rounds: 2, amount: drainTickAmount, kind: 'negative' }, round);
                lines.push(`Drain: ${o.name} loses ${drainTickAmount} HP+chakra/turn for 2 turns.`);
            }
            continue;
        }
        if (tagName === 'Absorb') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Absorb', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Absorb: ${s.name} converts ${pct}% incoming damage for 2 turns.`); } continue; }
        if (tagName === 'Reflect') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Reflect', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Reflect: ${s.name} reflects ${pct}% damage for 2 turns.`); } continue; }
        if (tagName === 'Lifesteal') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Lifesteal', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Lifesteal: ${s.name} heals on hit for 2 turns.`); } continue; }
        if (tagName === 'Increase Damage Given') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Increase Damage Given', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`+${pct}% Damage Given: ${s.name} for 2 turns.`); } continue; }
        if (tagName === 'Decrease Damage Given') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Decrease Damage Given', rounds: 2, percent: pct, kind: 'negative' }, round); lines.push(`-${pct}% Damage Given: ${o.name} for 2 turns.`); } continue; }
        if (tagName === 'Increase Damage Taken') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Increase Damage Taken', rounds: 2, percent: pct, kind: 'negative' }, round); lines.push(`+${pct}% Damage Taken: ${o.name} for 2 turns.`); } continue; }
        if (tagName === 'Decrease Damage Taken') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Decrease Damage Taken', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`-${pct}% Damage Taken: ${s.name} for 2 turns.`); } continue; }
        if (tagName === 'Ignition') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Ignition', rounds: 2, percent: pct, kind: 'negative' }, round); lines.push(`Ignition: ${o.name} +${pct}% damage taken for 2 turns.`); } continue; }
        if (tagName === 'Debuff Prevent') { s = addJutsuStatus(s, jutsu, { name: 'Debuff Prevent', rounds: 2, kind: 'positive' }, round); lines.push(`Debuff Prevent: ${s.name} for 2 turns.`); continue; }
        if (tagName === 'Buff Prevent') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Buff Prevent', rounds: 2, kind: 'negative' }, round); lines.push(`Buff Prevent: ${o.name} cannot gain positive effects for 2 turns.`); } continue; }
        if (tagName === 'Cleanse Prevent') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' }, round); lines.push(`Cleanse Prevent: ${o.name} cannot cleanse debuffs for 2 turns.`); } continue; }
        if (tagName === 'Clear Prevent') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Clear Prevent', rounds: 2, kind: 'positive' }, round); lines.push(`Clear Prevent: ${s.name}'s buffs cannot be cleared for 2 turns.`); } continue; }
        if (tagName === 'Stun Prevent') { s = addJutsuStatus(s, jutsu, { name: 'Stun Prevent', rounds: 2, kind: 'positive' }, round); lines.push(`Stun Prevent: ${s.name} is immune to Stun for 2 turns.`); continue; }
        if (tagName === 'Copy') { if (!hasStatus(s, 'Buff Prevent', round)) { const copied = activeStatuses(o, round).filter(st => st.kind === 'positive'); copied.forEach(st => { s = addJutsuStatus(s, jutsu, { ...st, rounds: Math.min(2, st.rounds) }, round); }); lines.push(`Copy: ${s.name} copied ${copied.length ? copied.map(st => st.name).join(', ') : 'nothing'} from ${o.name}.`); } continue; }
        if (tagName === 'Mirror') {
            // Copies caster's non-DoT debuffs onto the opponent. Debuffs stay
            // on the caster too — Mirror is "spread the pain", not "free
            // cleanse + transfer". Sim showed the old transfer behavior let
            // Disruption builds win 100% vs setup-heavy opponents.
            const mirrored = activeStatuses(s, round).filter(st => st.kind === 'negative'
                && st.name !== 'Wound' && !nameMatches(st.name, 'Ignition')
                && st.name !== 'Poison' && st.name !== 'Drain');
            if (!hasStatus(o, 'Debuff Prevent', round)) {
                mirrored.forEach(st => { o = addJutsuStatus(o, jutsu, { ...st, rounds: Math.min(2, st.rounds) }, round); });
                lines.push(`Mirror: ${s.name} copies ${mirrored.length ? mirrored.map(st => st.name).join(', ') : 'no debuffs'} onto ${o.name}.`);
            }
            continue;
        }
        if (tagName === 'Lag') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Lag', rounds: 1, percent: pct || 20, kind: 'negative' }, round); lines.push(`Lag: ${o.name}'s actions cost ${pct || 20}% more AP for 1 turn.`); } continue; }
        if (tagName === 'Overclock') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Overclock', rounds: 1, percent: pct || 20, kind: 'positive' }, round); lines.push(`Overclock: ${s.name}'s actions cost ${pct || 20}% less AP for 1 turn.`); } continue; }
        if (tagName === 'Increase Heal') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Increase Heal', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Increase Heal: ${s.name}'s healing is increased by ${pct}% for 2 turns.`); } continue; }
        // Increase Generals: self-buff to str/spd/int/wil for 2 turns. The stat lift is
        // read from active stacks in generalsBonus (pooled + Seal-gated) when the capped
        // fighters are built, so it raises this fighter's offense AND defense. Stores the
        // scaled + rank-capped pct like the amp tags; stacks (STACKABLE_STATUS) but the
        // summed effect is soft-capped by K_GENERALS.
        if (tagName === 'Increase Generals') { if (!hasStatus(s, 'Buff Prevent', round)) { s = addJutsuStatus(s, jutsu, { name: 'Increase Generals', rounds: 2, percent: pct, kind: 'positive' }, round); lines.push(`Increase Generals: ${s.name}'s general stats rise ${pct}% for 2 turns.`); } continue; }
        // Increase Discipline (legacy signature jutsu): style-locked self-buff. Lifts
        // ONLY the offense composite of the cast jutsu's discipline — the discipline is
        // captured server-side from jutsu.type here (never client-supplied) and read
        // back by disciplineBonuses when the capped fighters are built. No-op on a
        // typeless/'Any' cast so it can't ride the 40-AP utility convention.
        if (tagName === 'Increase Discipline') {
            const disc = DISCIPLINE_OFFENSE_FIELD[String(jutsu.type ?? '')] ? (jutsu.type as PvpStatus['discipline']) : undefined;
            if (disc && !hasStatus(s, 'Buff Prevent', round)) {
                s = addJutsuStatus(s, jutsu, { name: 'Increase Discipline', rounds: 2, percent: pct, kind: 'positive', discipline: disc }, round);
                lines.push(`Increase Discipline: ${s.name}'s ${disc} offense rises ${pct}% for 2 turns.`);
            }
            continue;
        }
        // Push/Pull resolve INSTANTLY (matches PvE) — was deferred to next round
        // for non-ground jutsus. Displacement happens on cast.
        if (tagName === 'Push') { if (!hasStatus(o, 'Debuff Prevent', round)) { const dist = Math.max(1, Number(jutsu.range) || 1); let nextPos = o.pos; for (let step = 0; step < dist; step++) { const away = hexNeighbors(nextPos).filter(t => distance(t, s.pos) > distance(nextPos, s.pos) && t !== s.pos && !tileBlocked(t, s, o)); if (!away.length) break; nextPos = away[0]!; } o = { ...o, pos: nextPos }; lines.push(`Push: ${o.name} is pushed ${dist} tile(s).`); } continue; }
        if (tagName === 'Pull') { if (!hasStatus(o, 'Debuff Prevent', round)) { const dist = Math.max(1, Number(jutsu.range) || 1); let nextPos = o.pos; for (let step = 0; step < dist; step++) { const toward = hexNeighbors(nextPos).filter(t => distance(t, s.pos) < distance(nextPos, s.pos) && t !== s.pos && !tileBlocked(t, s, o)); if (!toward.length) break; nextPos = toward[0]!; } o = { ...o, pos: nextPos }; lines.push(`Pull: ${o.name} is pulled ${dist} tile(s).`); } continue; }
        if (tagName === 'Bloodline Seal') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Bloodline Seal', rounds: 2, kind: 'negative' }, round); lines.push(`Bloodline Seal: ${o.name}'s bloodline is sealed.`); } continue; }
        if (tagName === 'Elemental Seal') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Elemental Seal', rounds: 1, kind: 'negative' }, round); lines.push(`Elemental Seal: ${o.name}'s elemental jutsu are sealed.`); } continue; }
        // Recoil applies regardless of THIS jutsu's damage — a zero-damage 40-AP
        // utility jutsu carrying Recoil still seeds it (matches the client/PvE).
        // The self-damage from HAVING Recoil resolves in the post-damage phase
        // (gated on finalDmg). Percent uses the scaled + rank-capped `pct` like
        // every other CAPPED_AMP_TAGS tag — and like the PvE engine's
        // effectiveTagPercent (Arena.tsx) — so the tooltip, PvE and PvP all agree.
        // (Was raw/un-scaled, which made PvP Recoil disagree with both.)
        if (tagName === 'Recoil') { if (!hasStatus(o, 'Debuff Prevent', round)) { o = addJutsuStatus(o, jutsu, { name: 'Recoil', rounds: 2, percent: pct, kind: 'negative' }, round); lines.push(`Recoil: ${o.name} will suffer ${pct}% recoil on their attacks for 2 turns.`); } continue; }
    }

    return { s, o, lines, damage, healing, shieldGain, pierce };
}

// Phase 3 — collapse the running damage to a single final number. Pierce is true
// damage (offense-scaled, bypasses everything downstream); otherwise the base is
// reduced by the DR pool and amplified by the IDG/IDT/Ignition amp pool. Amp/DR
// read the ORIGINAL fighters so a buff applied THIS cast can't feed back in.
function resolveDamageNumber(self: PvpFighter, opponent: PvpFighter, jutsu: Jutsu, round: number, masteryLevel: number, offStats: Record<string, number>, damageIn: number, pierce: boolean, effectiveDR: number): number {
    return directDamageNumberFormula({
        damageIn,
        pierce,
        offenseComposite: getOffense(offStats, jutsu.type),
        jutsuAp: jutsu.ap ?? 40,
        masteryLevel,
        effectiveDR,
        ampMultiplier: ampMultiplierFor(self, opponent, round),
        guardDefensePct: opponent.character.guardDefensePct,
    });
}

// Phase 4 — the post-damage consequence pipeline. Resolution order is LOAD-BEARING
// (every step reads the FINAL post-mitigation damage, finalDmg) and is the single
// authority for it:
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
function resolvePostDamage(sIn: PvpFighter, oIn: PvpFighter, jutsu: Jutsu, round: number, damage: number, pierce: boolean, healBoost: number): { s: PvpFighter; o: PvpFighter; lines: string[]; fx: HitFxEvent[] } {
    const tags = jutsu.tags ?? [];
    const lines: string[] = [];
    const fx: HitFxEvent[] = [];
    let s = sIn;
    let o = oIn;

    // Absorb/Reflect stack additively across active stacks (hard-capped at 60%
    // by cappedPostDamage), matching Lifesteal below. Was first-stack-only (.find).
    const reflectPct = sumActivePct(o, 'Reflect', round);
    const absorbPct = sumActivePct(o, 'Absorb', round);
    const {
        blocked,
        finalDmg,
        reflectedDmg,
        absorbHeal,
        itemAbsorbHeal,
        itemReflectedDmg,
        itemLifeStealHeal,
    } = postDamageFormula({
        damage,
        shield: o.shield,
        pierce,
        reflectPct,
        absorbPct,
        itemAbsorbPct: o.character.itemAbsorbPct,
        itemReflectPct: o.character.itemReflectPct,
        itemLifeStealPct: s.character.itemLifeStealPct,
    });

    o = { ...o, hp: Math.max(0, o.hp - finalDmg), shield: Math.max(0, o.shield - damage) };
    if (absorbHeal > 0) o = { ...o, hp: Math.min(o.maxHp, o.hp + absorbHeal) };
    if (itemAbsorbHeal > 0) o = { ...o, hp: Math.min(o.maxHp, o.hp + itemAbsorbHeal) };
    if (blocked > 0) lines.push(`${blocked} absorbed by ${o.name}'s shield.`);
    if (finalDmg > 0) { lines.push(`${finalDmg} damage to ${o.name}.`); pushFx(fx, 'opp', finalDmg, 'damage'); }
    if (absorbHeal > 0) { lines.push(`${o.name} absorbs ${absorbHeal} HP.`); pushFx(fx, 'opp', absorbHeal, 'heal'); }
    if (itemAbsorbHeal > 0) { lines.push(`${o.name}'s armor absorbs ${itemAbsorbHeal} HP.`); pushFx(fx, 'opp', itemAbsorbHeal, 'heal'); }
    if (reflectedDmg > 0) { s = { ...s, hp: Math.max(0, s.hp - reflectedDmg) }; lines.push(`${s.name} takes ${reflectedDmg} reflected damage.`); pushFx(fx, 'self', reflectedDmg, 'damage'); }
    if (itemReflectedDmg > 0) { s = { ...s, hp: Math.max(0, s.hp - itemReflectedDmg) }; lines.push(`${s.name} takes ${itemReflectedDmg} damage reflected by ${o.name}'s armor.`); pushFx(fx, 'self', itemReflectedDmg, 'damage'); }
    if (itemLifeStealHeal > 0) { s = { ...s, hp: Math.min(s.maxHp, s.hp + itemLifeStealHeal) }; lines.push(`${s.name}'s armor steals ${itemLifeStealHeal} HP.`); pushFx(fx, 'self', itemLifeStealHeal, 'heal'); }

    for (const tag of tags) {
        const tagName = normalizeTagName(tag.name);
        const pct = tag.percent ?? 0;
        if (tagName === 'Wound' && !hasStatus(o, 'Debuff Prevent', round)) {
            // v4.3: Wound bleeds finalDmg × min(tag.pct, rank_cap, 60%) per tick.
            // Basic jutsus cap at 25%, A/B-rank bloodline at 30%, S-rank at 35%.
            const amt = woundAmountForFinalDamage(finalDmg, pct, jutsu);
            o = capWoundStacks(addJutsuStatus(o, jutsu, { name: 'Wound', rounds: 2, amount: amt, kind: 'negative' }, round));
            lines.push(`Wound: ${o.name} bleeds ${amt}/turn for 2 turns.`);
        }
        // Recoil debuff application happens in the status phase so it applies even
        // on zero-damage utility jutsu. (Self-recoil damage is resolved below,
        // gated on finalDmg.)
        if (tagName === 'Siphon') { const h = postDamagePercentAmount(finalDmg, pct, healBoost); s = { ...s, hp: Math.min(s.maxHp, s.hp + h) }; lines.push(`Siphon: ${s.name} heals ${h} HP.`); pushFx(fx, 'self', h, 'heal'); }
    }

    const recoilStatus = activeStatuses(s, round).find(st => st.name === 'Recoil');
    if (recoilStatus && finalDmg > 0) { const rc = postDamagePercentAmount(finalDmg, recoilStatus.percent ?? 30); s = { ...s, hp: Math.max(0, s.hp - rc) }; lines.push(`Recoil: ${s.name} takes ${rc} recoil damage from their own attack.`); pushFx(fx, 'self', rc, 'damage'); }

    // Sum all active Lifesteal stacks' percents (capped at 60% by
    // cappedPostDamage), matching PvE — was first-stack-only (.find).
    const lsPct = activeStatuses(s, round).filter(st => st.name === 'Lifesteal').reduce((sum, st) => sum + (st.percent ?? 0), 0);
    if (lsPct > 0 && finalDmg > 0) { const h = postDamagePercentAmount(finalDmg, lsPct, healBoost); s = { ...s, hp: Math.min(s.maxHp, s.hp + h) }; lines.push(`Lifesteal: ${s.name} heals ${h} HP.`); pushFx(fx, 'self', h, 'heal'); }

    return { s, o, lines, fx };
}

const pvpResolveJutsuPhases = {
    resolveBaseDamage,
    resolveTagStatuses,
    resolveDamageNumber,
    resolvePostDamage,
    applyHealing: (fighter: PvpFighter, amount: number): PvpFighter => ({ ...fighter, hp: Math.min(fighter.maxHp, fighter.hp + amount) }),
    applyShield: (fighter: PvpFighter, amount: number): PvpFighter => ({ ...fighter, shield: fighter.shield + amount }),
    makeHitFx: (who: 'self' | 'opp', amount: number, kind: 'damage' | 'heal'): HitFxEvent | undefined => (
        amount > 0 ? { who, amount: Math.round(amount), kind } : undefined
    ),
};

// Exported for the Lifesteal/tag-lifecycle regression test (_lifesteal.test.ts)
// and the characterization snapshot (_applyjutsu-characterization.test.ts), which
// pin the "lingering tags don't fire on the cast turn" behaviour + exact numbers.
export function applyJutsu(self: PvpFighter, opponent: PvpFighter, jutsu: Jutsu, wMult = 1, biome = 'central', round = 1, damageCap?: number): { self: PvpFighter; opponent: PvpFighter; lines: string[]; fx: HitFxEvent[]; metadata: ResolveJutsuMetadata } {
    // Use jutsu mastery level (0–50) for EP scaling so trained jutsus hit harder in PvP.
    // Falls back to 0 if the jutsu has never been trained (no bonus).
    const jutsuMasteries = (self.character.jutsuMastery as Array<{ jutsuId: string; level: number }> | null) ?? [];
    const masteryEntry = jutsuMasteries.find(m => m.jutsuId === jutsu.id);
    const storedMastery = Math.max(0, Math.min(50, masteryEntry?.level ?? 0));
    // Rank cap: clamp the EFFECTIVE mastery (feeds EP/tag/drain/pierce scaling
    // below) to the caster's rank ceiling. Authoritative anti-twink guard — even a
    // tampered client that reports mastery 50 can't exceed the rank cap here. The
    // stored value is untouched (save-safe); ranking up unlocks the rest.
    const masteryLevel = Math.min(storedMastery, jutsuLevelCapForLevel(Number(self.character.level) || 1));

    // Per-rank STAT cap (anti-twink): clamp the stats the DAMAGE FORMULA reads to each
    // fighter's rank ceiling — never the stored/sealed stat. Only the offStats/defStats
    // read (statFactor + the returned offStats that feeds pierce) sees the capped copy;
    // status mutation + HP application below keep the ORIGINAL fighters.
    // Increase Generals is folded in AFTER the cap (generalsBonus is pooled + Seal-gated)
    // so an active buff can push the effective generals above the per-rank ceiling — the
    // only intended way to break the maxed-mirror statFactor=1.0 parity. Applied to both
    // fighters so it lifts the caster's offense AND (on the opponent's copy) their defense.
    const cappedSelf = { ...self, character: { ...self.character, stats: withDisciplineBonuses(withGeneralsBonus(perRankStatCap((self.character.stats as Record<string, number>) ?? {}, Number(self.character.level) || 1), generalsBonus(self, round)), disciplineBonuses(self, round)) } };
    const cappedOpp = { ...opponent, character: { ...opponent.character, stats: withDisciplineBonuses(withGeneralsBonus(perRankStatCap((opponent.character.stats as Record<string, number>) ?? {}, Number(opponent.character.level) || 1), generalsBonus(opponent, round)), disciplineBonuses(opponent, round)) } };

    const resolved = resolveCoreJutsu({
        self,
        opponent,
        formulaSelf: cappedSelf,
        formulaOpponent: cappedOpp,
        jutsu,
        wMult,
        biome,
        round,
        masteryLevel,
        healBoost: increaseHealMult(self, round),
        // Undefined for every PvP caller — see ResolveJutsuArgs.damageCap. Only
        // the tower engine's sealed PvE guard supplies one.
        damageCap,
        phases: pvpResolveJutsuPhases,
    });

    // `metadata` is additive: existing callers destructure {self, opponent,
    // lines, fx} and are unaffected. The tower engine reads metadata.damage to
    // meter its per-turn damage budget instead of inferring it from an HP delta
    // (which would be post-shield, and therefore the wrong number).
    return { self: resolved.self, opponent: resolved.opponent, lines: resolved.logLines, fx: resolved.hitFx, metadata: resolved.metadata };
}

// ─── DoTs applied at start of each turn ───────────────────────────────────────
// v4.3: DoT ticks are partially mitigated by the defender's own DR pool (armor + DDT stacks),
// scaled by DR_DOT_SCALE so DoT can't be made fully invulnerable.
// Exported so Battle Towers' engine can tick Wound/Poison/Drain with identical math.
// Pure function; exporting it changes zero PvP behaviour.
export function applyDoTs(fighter: PvpFighter, round: number): { fighter: PvpFighter; lines: string[]; fx: HitFxEvent[]; vfx: RelativeVfxEvent[] } {
    const lines: string[] = [];
    const fx: HitFxEvent[] = [];
    const vfx: RelativeVfxEvent[] = [];
    let f = { ...fighter };
    // Compute own DR pool against incoming DoT.
    const ownArmor = armorRawDrFromCharacter(f.character as Record<string, unknown>);
    let ownStatusDR = 0;
    for (const s of activeStatuses(f, round)) {
        if (s.name === 'Decrease Damage Taken') ownStatusDR += (s.percent ?? 0) / 100;
    }
    const dotMitigation = dotMitigationFromRawDr(ownArmor, ownStatusDR);
    const mit = (raw: number) => Math.max(0, Math.floor(raw * dotMitigation));

    for (const s of activeStatuses(f, round)) {
        if (s.name === 'Wound' && s.amount) {
            const dmg = mit(s.amount);
            f = { ...f, hp: Math.max(0, f.hp - dmg) };
            lines.push(`${f.name} bleeds ${dmg} (Wound).`);
            pushFx(fx, 'self', dmg, 'damage');
            vfx.push(vfxEvent('self', 'wound', 'target', 'minor'));
        }
        if (s.name === 'Poison' && !COMBAT_RESOURCES_V2) {
            // Legacy poison: an HP-only DoT = a % of the victim's max chakra (does
            // NOT drain chakra — that's Drain's job, below). Under combatResourcesV2
            // poison has NO per-round tick; it triggers on-spend in the jutsu handler
            // instead. Mirrors the PvE engine (Arena.tsx applyDoTs Poison branch).
            const poisonPct = s.percent && s.percent > 0 ? s.percent : 6;
            const dmg = mit(Math.floor(f.maxChakra * (poisonPct / 100)));
            f = { ...f, hp: Math.max(0, f.hp - dmg) };
            lines.push(`${f.name} takes ${dmg} Poison damage.`);
            pushFx(fx, 'self', dmg, 'damage');
            vfx.push(vfxEvent('self', 'poisonCloud', 'target', 'minor'));
        }
        if (s.name === 'Drain') {
            const amt = mit(s.amount ?? DRAIN_BASE_TICK);
            f = { ...f, hp: Math.max(0, f.hp - amt), chakra: Math.max(0, f.chakra - amt) };
            lines.push(`${f.name} drained ${amt} HP+chakra.`);
            pushFx(fx, 'self', amt, 'damage');
            vfx.push(vfxEvent('self', 'drain', 'target', 'minor'));
        }
    }
    return { fighter: f, lines, fx, vfx };
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

    // combatResourcesV2: the next fighter regenerates chakra/stamina at the start of
    // their turn (applied below, once nextFighter is resolved). Legacy PvP had none —
    // resources were finite per fight.

    // Apply DoTs to the next player at start of their turn
    let nextFighter = next === 'p1' ? s.p1 : s.p2;
    const groundApplied = applyGroundEffects(s, newRound);
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
    if (COMBAT_RESOURCES_V2) {
        const rgLvl = Number((nextFighter.character as { level?: number } | undefined)?.level) || 1;
        const rg = v2ResourceRegen(rgLvl);
        nextFighter = { ...nextFighter, chakra: Math.min(nextFighter.maxChakra, nextFighter.chakra + rg), stamina: Math.min(nextFighter.maxStamina, nextFighter.stamina + rg) };
    }
    s = next === 'p1' ? { ...s, p1: nextFighter } : { ...s, p2: nextFighter };

    // DoT ticks all land on the next player — surface each as its own floating
    // number (true amount, matching the log) with a bumped fxSeq so the client
    // renders it exactly once.
    const dotFx: HitFxTarget[] = dots.fx.map((e) => ({ target: next, amount: e.amount, kind: e.kind }));
    const dotVfx: CombatVfxTarget[] = dots.vfx.map((e) => ({
        target: next,
        key: e.key,
        anchor: e.anchor,
        intensity: e.intensity,
        durationMs: e.durationMs,
        persistent: e.persistent,
        maxParticles: e.maxParticles,
        tiles: e.tiles,
    }));
    const fxPatch = {
        ...(dotFx.length ? { fx: dotFx, fxSeq: (session.fxSeq ?? 0) + 1 } : {}),
        ...(dotVfx.length ? { vfx: dotVfx, vfxSeq: (session.vfxSeq ?? 0) + 1 } : {}),
    };

    s = checkWinner({ ...s, round: newRound, log: lines.length ? [...s.log, ...lines] : s.log, ...fxPatch });
    if (s.status === 'done') return s;

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

function isPvpSessionRow(value: unknown, battleId: string): value is PvpSession {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<PvpSession>;
    return candidate.battleId === battleId
        && (candidate.status === 'active' || candidate.status === 'done')
        && !!candidate.p1
        && !!candidate.p2;
}

async function helpCommittedTerminal(session: PvpSession): Promise<void> {
    if (session.status !== 'done') return;
    // The recovery snapshot + player discovery pointers are a mandatory first
    // phase inside this replay. Propagate failure so the client retries the
    // exact terminal row instead of receiving an undiscoverable success.
    await replayCommittedPvpTerminalEffects(session);
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Move cadence: legitimate gameplay caps at ~1 action/sec with the 45s
    // round timer + 5 actions/round; 120/min is roughly 4× that, leaving
    // headroom for retries and the AFK-fallback POSTs while blocking
    // scripted spam (which would also tank the move-lock NX path).
    //
    // Parse the action first, then authenticate before choosing the per-player
    // quota key. A body-supplied name must never be able to burn someone else's
    // rate-limit budget; authenticated identity keeps NAT'd players separate.
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        // NOTE: biome and weather* are intentionally NOT read from the body —
        // they were a trust-the-client hole. We pull them from the session
        // that was sealed at create time.
        const { battleId, role, action, tile, jutsuId, itemId, itemName, auto, moveToken } = body as {
            battleId?: string;
            role?: 'p1' | 'p2';
            action?: string;
            tile?: number;
            jutsuId?: string;
            itemId?: string;
            itemName?: string;
            auto?: boolean;  // true when the client's 45s round timer fired
            moveToken?: string;  // client-generated UUID for idempotency
        };
        if (!battleId || !role || !action) return res.status(400).json({ error: 'Missing battleId, role, or action' });

        // Authenticate before selecting the named quota key. A request body is
        // not identity proof and must never be able to burn another user's cap.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pvp-move', 120, 60_000, identity.name))) return;

        const key = `pvp:${battleId}`;
        const sessionMaybe = await kv.get<unknown>(key);
        if (!sessionMaybe) return res.status(404).json({ error: 'Battle session not found' });
        // Close tombstones and malformed rows are control data, never combat.
        // Validate before role ownership dereferences p1/p2.
        if (!isPvpSessionRow(sessionMaybe, battleId)) {
            return res.status(409).json({ error: 'This battle session is no longer active.' });
        }
        // `let`, not `const`: once we hold the move lock below we re-read the
        // freshest session and reassign, so the read-modify-write resolves
        // against the latest committed state (audit #5).
        let session: PvpSession = sessionMaybe;

        // Verify the requester actually owns the role they're moving as.
        // Without this, anyone could submit moves on another player's behalf.
        if (!identity.admin) {
            const claimedFighter = role === 'p1' ? session.p1 : session.p2;
            const claimedName = safeName(String(claimedFighter.name ?? ''));
            if (claimedName !== identity.name) {
                return res.status(403).json({ error: 'Cannot move as another player.' });
            }
        }

        // Repair a process death immediately after the preceding combat CAS.
        // This runs before any later mutation can replace its replay capsule.
        await replayCommittedPvpActionReceipt(kv, session);

        // Idempotency: if the token already landed, return the exact current
        // projection. Terminal reads also replay post-CAS settlement after a
        // process death or lost response; none of those helpers mutate combat.
        if (action !== 'join' && moveToken
            && Array.isArray(session.recentMoveTokens)
            && session.recentMoveTokens.includes(moveToken)) {
            await helpCommittedTerminal(session);
            return res.status(200).json(session);
        }
        if (session.status === 'done') {
            await helpCommittedTerminal(session);
            return res.status(200).json(session);
        }
        if (session.rankedCloseFence) {
            return res.status(409).json({ error: 'This ranked match ended as a season-close no-contest.' });
        }
        // Environment is read from the session — clients can't override it.
        let biome: string = session.biome ?? 'central';
        let weatherPositiveElement: string = session.weatherPositiveElement ?? '';
        let weatherNegativeElement: string = session.weatherNegativeElement ?? '';
        // Out-of-turn actions are ignored — EXCEPT 'claim-afk-win', which is by
        // definition submitted by the INACTIVE player (the one claiming the
        // active player went AFK). Letting only that action through the guard;
        // the switch case re-validates that the claimant is indeed inactive.
        if (session.activePlayer !== role && action !== 'claim-afk-win' && action !== 'join') {
            return res.status(200).json(session);
        }

        const lockKey = `${key}:lock`;
        const lockToken = `${role}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        // Per-session move lock, 3s TTL. The critical section is <50ms in the
        // common case; 3s is generous headroom while still releasing quickly if
        // a process dies mid-move. Reward idempotency does NOT rely on this lock
        // — terminal grants use a durable NX receipt keyed on the battleId (see
        // _vanguard-rewards.ts), so even a lock-expiry + replay can't double-pay.
        //
        // Audit #5: acquire with a few short backoff retries instead of bailing
        // on first contention. A move that races another writer (a double-tap,
        // the opponent's overlapping claim-afk-win, a network retry) now waits
        // for the in-flight write to land and then re-resolves on FRESH state,
        // rather than being silently dropped and looking to the player like the
        // battle froze.
        let lockResult: unknown = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            lockResult = await kv.set(lockKey, lockToken, { nx: true, ex: 3 } as never);
            if (lockResult) break;
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
        }
        if (!lockResult) {
            // Still contended after the retry budget — surface a retry hint so
            // the client re-submits (keeping the player's pending selection),
            // instead of returning the unchanged session as if it applied.
            return res.status(200).json(withRejected(session, 'The battle is busy applying another action — please try again.'));
        }

        async function finish(payload: PvpSession) {
            await kv.delIfEqual(lockKey, lockToken).catch(() => undefined);
            if (payload.rankedCloseFence) {
                return res.status(409).json({ error: 'This ranked match ended as a season-close no-contest.' });
            }
            return res.status(200).json(payload);
        }

        async function finishTerminal(payload: PvpSession) {
            await kv.delIfEqual(lockKey, lockToken).catch(() => undefined);
            await helpCommittedTerminal(payload);
            return res.status(200).json(payload);
        }

        async function finishUnavailable(status: 404 | 409 | 503, message: string) {
            await kv.delIfEqual(lockKey, lockToken).catch(() => undefined);
            return res.status(status).json({ error: message });
        }

        // Now that we hold the lock, re-read the freshest session: a writer may
        // have committed during our acquire wait, so re-resolve against the
        // latest state and re-check the state-dependent gates (audit #5). This
        // closes the read-modify-write window the pre-lock snapshot left open.
        {
            const fresh = await kv.get<unknown>(key);
            if (!fresh) {
                return finishUnavailable(404, 'Battle session not found');
            }
            if (!isPvpSessionRow(fresh, battleId)) {
                return finishUnavailable(409, 'This battle session is no longer active.');
            }
            session = fresh;
            await replayCommittedPvpActionReceipt(kv, session);
            if (action !== 'join' && moveToken
                && Array.isArray(session.recentMoveTokens)
                && session.recentMoveTokens.includes(moveToken)) {
                return session.status === 'done' ? finishTerminal(session) : finish(session);
            }
            if (session.status === 'done') return finishTerminal(session);
            if (session.rankedCloseFence) {
                return finishUnavailable(409, 'This ranked match ended as a season-close no-contest.');
            }
            try {
                await ensureKageDuelAdmission(session);
            } catch (error) {
                console.error('[pvp/move] official Kage duel admission pending', error);
                return finishUnavailable(503, 'The official Kage duel is still being sealed; retry.');
            }
            try {
                const registration = await ensurePvpSectorWarRegistration(session);
                if (registration.registered
                    && registration.biome
                    && session.biome !== registration.biome) {
                    const terrainWrite = await commitPvpSessionMutation(
                        kv,
                        key,
                        session,
                        { ...session, biome: registration.biome },
                        { ttlSeconds: SESSION_TTL },
                    );
                    if (terrainWrite.status !== 'committed') {
                        return finishUnavailable(503, 'Sector terrain changed while registration finalized; retry.');
                    }
                    session = terrainWrite.session;
                }
                biome = session.biome ?? 'central';
                weatherPositiveElement = session.weatherPositiveElement ?? '';
                weatherNegativeElement = session.weatherNegativeElement ?? '';
            } catch (error) {
                console.error('[pvp/move] sector contest registration pending', error);
                return finishUnavailable(503, 'Sector contest registration is still finalizing; retry.');
            }
            if (action !== 'join'
                && (session.joined?.p1 !== true || session.joined?.p2 !== true)) {
                return finish(withRejected(session, 'Waiting for both fighters to join before combat can advance.'));
            }
            if (session.activePlayer !== role && action !== 'claim-afk-win' && action !== 'join') {
                return finish(withRejected(session, 'It is no longer your turn.'));
            }
        }
        // Opening the battle screen sends this idempotent membership handshake.
        // AFK forfeits and every reward consumer require both bits, so merely
        // creating an unsolicited session against an offline name can never pay.
        if (action === 'join') {
            async function reserveJoinPointer(desired: NonNullable<ReturnType<typeof pendingPointerForSessionRole>>) {
                try {
                    return await publishPvpPendingSessionPointer(kv, desired);
                } catch (error) {
                    if (!(error instanceof Error) || !error.message.startsWith('pvp-pending-session-conflict:')) {
                        throw error;
                    }
                    const current = await loadPvpPendingSessionPointer(kv, desired.playerName);
                    const liveRaw = current ? await kv.get<unknown>(`pvp:${current.battleId}`) : null;
                    const priorSession = current && isPvpSessionRow(liveRaw, current.battleId)
                        ? liveRaw
                        : current
                            ? await loadPvpRewardRecoverySnapshot(kv, current.battleId)
                            : null;
                    let stale = !current;
                    if (current && !priorSession) stale = !pvpPendingReservationIsFresh(current);
                    if (current && priorSession) stale = !pendingPointerMatchesSession(current, priorSession);
                    if (!stale && current && priorSession?.status === 'done') {
                        if (!priorSession.winner) {
                            stale = true;
                        } else {
                            const completion = pvpRewardCompletionStatus(await kv.get<unknown>(
                                `pvp:rewarded:${current.playerName}:${current.battleId}`,
                            ));
                            if (completion === 'invalid') throw new Error('pvp-join-prior-completion-invalid');
                            stale = completion === 'completed';
                        }
                    }
                    if (!stale || !current) throw error;
                    await clearPvpPendingSessionPointer(
                        kv,
                        current.playerName,
                        current.battleId,
                        current.createdAt,
                        current.role,
                    );
                    return publishPvpPendingSessionPointer(kv, desired);
                }
            }

            if (session.joined?.[role] === true) {
                const existingPointer = pendingPointerForSessionRole(session, role);
                if (existingPointer) {
                    try {
                        await reserveJoinPointer(existingPointer);
                        await activatePvpPendingSessionPointer(
                            kv,
                            existingPointer.playerName,
                            existingPointer.battleId,
                            existingPointer.createdAt,
                            existingPointer.createRequestFingerprint,
                        );
                    } catch {
                        return finishUnavailable(409, 'Finish the pending PvP battle settlement before joining another battle.');
                    }
                }
                return finish(session);
            }
            const joined = {
                p1: session.joined?.p1 === true,
                p2: session.joined?.p2 === true,
                [role]: true,
            } as { p1: boolean; p2: boolean };
            const updated = { ...session, joined };
            const desiredPointer = pendingPointerForSessionRole(updated, role, 'reserving');
            let pointerCreated = false;
            let reservedPointer = desiredPointer;
            if (desiredPointer) {
                try {
                    const reservation = await reserveJoinPointer(desiredPointer);
                    pointerCreated = reservation.created;
                    reservedPointer = reservation.pointer;
                } catch (error) {
                    console.error('[pvp/move] join pending-session reservation failed', error);
                    return finishUnavailable(409, 'Finish the pending PvP battle settlement before joining another battle.');
                }
            }
            let write;
            try {
                if (reservedPointer) await requirePvpPendingSessionOwnership(kv, reservedPointer);
                write = await commitPvpSessionMutation(kv, key, session, updated, {
                    ttlSeconds: SESSION_TTL,
                });
            } catch (error) {
                if (pointerCreated && desiredPointer) {
                    await clearPvpPendingSessionPointer(
                        kv,
                        desiredPointer.playerName,
                        desiredPointer.battleId,
                        desiredPointer.createdAt,
                        desiredPointer.role,
                    );
                }
                throw error;
            }
            if (write.status === 'committed') {
                if (desiredPointer) {
                    try {
                        if (reservedPointer) await requirePvpPendingSessionOwnership(kv, reservedPointer);
                    } catch {
                        const rollback = await commitPvpSessionMutation(kv, key, write.session, session, {
                            ttlSeconds: SESSION_TTL,
                        });
                        return rollback.status === 'committed'
                            ? finishUnavailable(409, 'PvP join reservation expired before publication; retry join.')
                            : finishUnavailable(503, 'PvP join publication could not be quarantined; retry.');
                    }
                    try {
                        await activatePvpPendingSessionPointer(
                            kv,
                            desiredPointer.playerName,
                            desiredPointer.battleId,
                            desiredPointer.createdAt,
                            desiredPointer.createRequestFingerprint,
                        );
                    } catch {
                        return finishUnavailable(503, 'The battle join is published but recovery is still finalizing. Retry join.');
                    }
                }
                return finish(write.session);
            }
            const current = isPvpSessionRow(write.session, battleId) ? write.session : null;
            if (pointerCreated && desiredPointer && current?.joined?.[role] !== true) {
                await clearPvpPendingSessionPointer(
                    kv,
                    desiredPointer.playerName,
                    desiredPointer.battleId,
                    desiredPointer.createdAt,
                    desiredPointer.role,
                );
            }
            if (!current || current.rankedCloseFence) {
                return finishUnavailable(409, 'This ranked match ended as a season-close no-contest.');
            }
            if (desiredPointer && current.joined?.[role] === true) {
                try {
                    await activatePvpPendingSessionPointer(
                        kv,
                        desiredPointer.playerName,
                        desiredPointer.battleId,
                        desiredPointer.createdAt,
                        desiredPointer.createRequestFingerprint,
                    );
                } catch {
                    return finishUnavailable(503, 'The battle join is published but recovery is still finalizing. Retry join.');
                }
            }
            return current.status === 'done'
                ? finishTerminal(current)
                : finish(withRejected(current, 'The battle advanced while joining. Please retry.'));
        }
        // Annotate a soft-rejected move with a structured, response-only reason.
        // The session itself is unchanged (and NOT persisted), so this never
        // touches KV / GET / SSE — it only rides the direct move reply so the
        // client can surface why nothing happened instead of looking frozen.
        // For paths that ALSO append a shared log line, pass that same string as
        // `reason` so the client shows it exactly once (it de-dups on substring).
        function withRejected(payload: PvpSession, reason: string): PvpSession {
            return { ...payload, rejected: { applied: false, reason, serverRound: payload.round, activePlayer: payload.activePlayer } };
        }
        // Soft-reject that ALSO records a shared log line (persisted) — e.g. out of
        // range, not enough chakra. Saves the line (spectators see it) and returns
        // the same text as the structured reason, so the client shows it once.
        async function rejectWithLog(reason: string): Promise<PvpSession> {
            const updated = { ...session, log: [...session.log, reason] };
            const write = await commitPvpSessionMutation(kv, key, session, updated, {
                ttlSeconds: SESSION_TTL,
            });
            if (write.status === 'committed') return withRejected(write.session, reason);
            const current = isPvpSessionRow(write.session, String(battleId)) ? write.session : session;
            return withRejected(current, 'The battle advanced before that action could be recorded. Please retry.');
        }

        const me = role === 'p1' ? session.p1 : session.p2;
        const opp = role === 'p1' ? session.p2 : session.p1;
        const myCooldowns = role === 'p1' ? session.cooldowns.p1 : session.cooldowns.p2;
        const myAp = role === 'p1' ? session.ap.p1 : session.ap.p2;
        const lines: string[] = [];

        // Apply Lag (costs more) and Overclock (costs less) to AP
        function adjustedCost(base: number): number {
            const compression = activeStatuses(me, session.round).find(st => nameMatches(st.name, 'Lag'));
            const dilation = activeStatuses(me, session.round).find(st => nameMatches(st.name, 'Overclock'));
            return adjustedApCost(base, {
                lagPct: compression ? compression.percent ?? 20 : null,
                overclockPct: dilation ? dilation.percent ?? 20 : null,
            });
        }
        function canAct(cost: number) { return myAp >= adjustedCost(cost) && session.actionsThisTurn < MAX_ACTIONS; }

        function commit(updMe: PvpFighter | null, updOpp: PvpFighter | null, apCost: number, cd?: Record<string, number>, extra?: Partial<PvpSession>, fx?: HitFxEvent[], visualFx?: RelativeVfxEvent[]): PvpSession {
            let s: PvpSession = { ...session, ...extra } as PvpSession;
            if (updMe) s = role === 'p1' ? { ...s, p1: updMe } : { ...s, p2: updMe };
            if (updOpp) s = role === 'p1' ? { ...s, p2: updOpp } : { ...s, p1: updOpp };
            s = { ...s, ap: { ...s.ap, [role as 'p1' | 'p2']: myAp - adjustedCost(apCost) }, actionsThisTurn: s.actionsThisTurn + 1 };
            if (cd) s = { ...s, cooldowns: { ...s.cooldowns, [role as 'p1' | 'p2']: { ...myCooldowns, ...cd } } };
            if (lines.length) s = { ...s, log: [...s.log, ...lines] };
            // Map this action's floating-number events (self = the acting role,
            // opp = the other) to concrete slots + bump fxSeq so the client
            // renders the TRUE per-hit numbers once, matching the log.
            if (fx && fx.length) {
                const otherRole: 'p1' | 'p2' = role === 'p1' ? 'p2' : 'p1';
                const mapped: HitFxTarget[] = fx.map((e) => ({ target: e.who === 'self' ? (role as 'p1' | 'p2') : otherRole, amount: e.amount, kind: e.kind }));
                s = { ...s, fx: mapped, fxSeq: (session.fxSeq ?? 0) + 1 };
            }
            if (visualFx && visualFx.length) {
                const otherRole: 'p1' | 'p2' = role === 'p1' ? 'p2' : 'p1';
                const mapped: CombatVfxTarget[] = visualFx.map((e) => ({
                    target: e.who === 'self' ? (role as 'p1' | 'p2') : otherRole,
                    key: e.key,
                    anchor: e.anchor,
                    intensity: e.intensity,
                    durationMs: e.durationMs,
                    persistent: e.persistent,
                    maxParticles: e.maxParticles,
                    tiles: e.tiles,
                }));
                s = { ...s, vfx: mapped, vfxSeq: (session.vfxSeq ?? 0) + 1 };
            }
            // Stamp lastMoveAt + reset this player's AFK counter (any real
            // action ends the streak of skipped rounds). Both are read by
            // the claim-afk-win action.
            const nextConsec = { ...(s.consecAutoWait ?? {}), [role as 'p1' | 'p2']: 0 };
            s = { ...s, lastMoveAt: Date.now(), consecAutoWait: nextConsec };
            return checkWinner(s);
        }

        // Spend one charge of a consumable (thrown / item / potion) from the
        // server-sealed budget (session.itemCharges). Returns ok=false when the
        // supply is exhausted — which, for the potion, also enforces its per-fight
        // cap since that cap IS the sealed starting charge. The patch updates
        // itemCharges/itemsUsed for this role and is folded into the committed
        // session via commit's `extra`. A legacy session with no sealed budget
        // (or a melee weapon, never sealed) allows the action without tracking.
        function spendItemCharge(itemId: string): { ok: boolean; patch: Partial<PvpSession> } {
            const r = role as 'p1' | 'p2';
            if (session.pvpConsumableAuthorityVersion === 1 && session.realFighters?.[r] === true) {
                return { ok: false, patch: {} };
            }
            const myCharges = session.itemCharges?.[r];
            if (!myCharges || myCharges[itemId] === undefined) return { ok: true, patch: {} };
            const remaining = myCharges[itemId];
            if (remaining <= 0) return { ok: false, patch: {} };
            const myUsed = session.itemsUsed?.[r] ?? {};
            const patch: Partial<PvpSession> = {
                itemCharges: {
                    ...(session.itemCharges ?? { p1: {}, p2: {} }),
                    [r]: { ...myCharges, [itemId]: remaining - 1 },
                },
                itemsUsed: {
                    ...(session.itemsUsed ?? { p1: {}, p2: {} }),
                    [r]: { ...myUsed, [itemId]: (myUsed[itemId] ?? 0) + 1 },
                },
            };
            return { ok: true, patch };
        }

        let result: PvpSession;

        // ── Server-owned receipt metadata ────────────────────────────────────
        // The durable action receipt used to derive its display name from the
        // request body (`itemName ?? jutsuId ?? action`), which meant a jutsu
        // persisted its raw ID as the label and a client could influence what a
        // historical record claims happened. This single object is seeded with a
        // safe default and then overwritten INSIDE each switch branch from the
        // object the server itself resolved and validated, so the receipt can
        // only ever describe what actually executed.
        const receiptAction: {
            id: string;
            name: string;
            type: string;
            category: ActionReceiptCategory;
            element?: string;
            discipline?: string;
            imageRef?: string;
        } = {
            id: String(action),
            name: DEFAULT_ACTION_LABELS[String(action)] ?? String(action),
            type: String(action),
            category: DEFAULT_ACTION_CATEGORIES[String(action)] ?? 'system',
        };

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
                if (session.joined?.p1 !== true || session.joined?.p2 !== true) {
                    return finish(withRejected(session, 'A forfeit win is unavailable until both fighters have joined the battle.'));
                }
                // Inactive player claims the win when the active player has
                // skipped 2 consecutive rounds (let the 45s timer run out
                // twice). Falls back to a 90s "no contact" timeout for the
                // crashed-tab case where the round timer never fires.
                if (session.activePlayer === role) {
                    // can only claim against opponent
                    return finish(withRejected(session, 'You can only claim a forfeit while it is your opponent\'s turn.'));
                }
                const oppRole: 'p1' | 'p2' = role === 'p1' ? 'p2' : 'p1';
                const oppSkipCount = session.consecAutoWait?.[oppRole] ?? 0;
                const AFK_FALLBACK_MS = 90_000;
                const lastMove = Number(session.lastMoveAt ?? session.createdAt);
                const elapsed = Date.now() - lastMove;
                const timedOut = elapsed >= AFK_FALLBACK_MS;
                if (oppSkipCount < 2 && !timedOut) {
                    const remaining = Math.max(0, Math.ceil((AFK_FALLBACK_MS - elapsed) / 1000));
                    const claimMsg = `${me.name}'s AFK claim rejected — opponent has skipped ${oppSkipCount}/2 rounds (or ${remaining}s of inactivity remain).`;
                    return finish(withRejected({ ...session, log: [...session.log, claimMsg] }, claimMsg));
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
                if (tile === undefined || !canAct(30)) return finish(withRejected(session, 'Move blocked — out of AP/actions this turn, or no tile selected.'));
                if (!hexNeighbors(me.pos).includes(tile) || tile === opp.pos || tileBlocked(tile, me, opp)) return finish(withRejected(session, 'Move blocked — choose an adjacent open tile.'));
                lines.push(`${me.name} moves.`);
                result = commit({ ...me, pos: tile }, null, 30);
                break;
            }

            case 'basicAttack': {
                if (!canAct(40)) return finish(withRejected(session, 'Basic attack blocked — out of AP or actions this turn.'));
                if (distance(me.pos, opp.pos) > 1) {
                    return finish(await rejectWithLog(`${me.name}: too far for basic attack — move closer.`));
                }
                if (me.stamina < 10) {
                    return finish(await rejectWithLog(`${me.name}: not enough stamina.`));
                }
                const specialty = (me.character.specialty as string) ?? 'Ninjutsu';
                const basicJutsu: Jutsu = { id: 'basic-attack', name: 'Basic Attack', type: specialty, effectPower: 10, ap: 40, range: 1, tags: [] };
                lines.push(`${me.name} uses Basic Attack:`);
                const atk = applyJutsu(me, opp, basicJutsu, 1, biome, session.round);
                lines.push(...atk.lines);
                const basicIntensity = intensityFromHit(atk.fx, atk.self, atk.opponent, atk.opponent.hp <= 0);
                const basicKey: CombatVfxKey = basicIntensity === 'finisher' ? 'ko' : basicIntensity === 'heavy' ? 'heavy' : 'impact';
                result = commit(
                    { ...atk.self, stamina: Math.max(0, atk.self.stamina - 10) },
                    atk.opponent,
                    40,
                    undefined,
                    undefined,
                    atk.fx,
                    [vfxEvent('opp', basicKey, 'target', basicIntensity), ...reactionVfx(opp, atk.opponent, atk.fx)],
                );
                break;
            }

            case 'basicHeal': {
                if (!canAct(60) || (myCooldowns.basicHeal ?? 0) > 0 || me.chakra < 10) return finish(withRejected(session, 'Basic Heal isn\'t ready — out of AP/chakra, or on cooldown.'));
                const healAmt = Math.max(1, Math.floor(me.maxHp * 0.1));
                const healFx: HitFxEvent[] = [{ who: 'self', amount: healAmt, kind: 'heal' }];
                lines.push(`${me.name} uses Basic Heal, restoring ${healAmt} HP.`);
                result = commit(
                    { ...me, hp: Math.min(me.maxHp, me.hp + healAmt), chakra: Math.max(0, me.chakra - 10) },
                    null,
                    60,
                    { basicHeal: 5 },
                    undefined,
                    healFx,
                    [vfxEvent('self', 'heal', 'caster')],
                );
                break;
            }

            case 'clear': {
                if (!canAct(60) || (myCooldowns.clear ?? 0) > 0) return finish(withRejected(session, 'Clear isn\'t ready — out of AP/actions, or on cooldown.'));
                if (hasStatus(opp, 'Clear Prevent', session.round)) {
                    lines.push(`${opp.name}'s Clear Prevent blocks the clear.`);
                    result = commit(null, null, 60, { clear: 10 }, undefined, undefined, [vfxEvent('opp', 'shield', 'target', 'minor')]);
                } else {
                    const removed = opp.statuses.filter(s => s.kind === 'positive').map(s => s.name);
                    lines.push(`Clear: removed ${removed.length ? removed.join(', ') : 'no positive effects'} from ${opp.name}.`);
                    result = commit(null, { ...opp, statuses: opp.statuses.filter(s => s.kind !== 'positive') }, 60, { clear: 10 }, undefined, undefined, [vfxEvent('opp', 'cleanse', 'target')]);
                }
                break;
            }

            case 'cleanse': {
                if (!canAct(60) || (myCooldowns.cleanse ?? 0) > 0) return finish(withRejected(session, 'Cleanse isn\'t ready — out of AP/actions, or on cooldown.'));
                if (hasStatus(me, 'Cleanse Prevent', session.round)) {
                    lines.push(`${me.name}'s Cleanse Prevent blocks the cleanse.`);
                    result = commit(null, null, 60, { cleanse: 10 }, undefined, undefined, [vfxEvent('self', 'seal', 'caster', 'minor')]);
                } else {
                    const removed = me.statuses.filter(s => s.kind === 'negative').map(s => s.name);
                    lines.push(`Cleanse: removed ${removed.length ? removed.join(', ') : 'no negative effects'} from ${me.name}.`);
                    result = commit({ ...me, statuses: me.statuses.filter(s => s.kind !== 'negative') }, null, 60, { cleanse: 10 }, undefined, undefined, [vfxEvent('self', 'cleanse', 'caster')]);
                }
                break;
            }

            case 'jutsu': {
                if (!jutsuId) { await kv.delIfEqual(lockKey, lockToken).catch(() => undefined); return res.status(400).json({ error: 'Missing jutsuId' }); }
                const jutsuList = (me.character.jutsu as Jutsu[] | undefined) ?? [];
                const jutsu = jutsuList.find(j => j.id === jutsuId);
                if (!jutsu) {
                    return finish(await rejectWithLog(`${me.name}: selected jutsu is not available in this PvP session. Reopen the duel or re-equip your loadout.`));
                }
                // Receipt metadata from the SERVER's resolved jutsu (sanitized by
                // session.ts at fight-create), not the request body. No imageRef:
                // the sealed PvP loadout carries NO art field at all, which is
                // exactly why a receipt can never end up holding a base64 blob.
                // The client renders an element/category glyph instead.
                receiptAction.id = String(jutsu.id ?? jutsuId);
                receiptAction.name = String(jutsu.name ?? jutsuId);
                receiptAction.category = 'jutsu';
                receiptAction.element = jutsu.element ? String(jutsu.element) : undefined;
                receiptAction.discipline = jutsu.type ? String(jutsu.type) : undefined;
                // jutsuIsSane re-validation removed — the jutsu comes from the
                // session's loadout list, which session.ts already sanitized at
                // fight-create time and is immutable afterwards. No code path
                // mutates the loadout mid-fight, so per-move re-validation was
                // pure overhead (~2-5ms in big loadouts).
                const plan = resolveJutsuActionPlan({
                    jutsu,
                    casterPos: me.pos,
                    opponentPos: opp.pos,
                    casterChakra: me.chakra,
                    casterStamina: me.stamina,
                    casterStatuses: me.statuses,
                    round: session.round,
                    availableAp: myAp,
                    actionsThisTurn: session.actionsThisTurn,
                    cooldownRemaining: myCooldowns[jutsuId] ?? 0,
                    tile,
                    board: {
                        width: GRID_W,
                        height: GRID_H,
                        unavailableTiles: new Set([opp.pos, ...barrierTiles(me, opp)]),
                    },
                });
                if (!plan.accepted) {
                    switch (plan.rejection) {
                        case 'cannot-act':
                            return finish(withRejected(session, `Not enough AP or actions left for ${jutsu.name}.`));
                        case 'on-cooldown':
                            return finish(withRejected(session, `${jutsu.name} is on cooldown (${myCooldowns[jutsuId]} turn(s) left).`));
                        case 'elementally-sealed':
                            return finish(await rejectWithLog(`${me.name} is Elementally Sealed — cannot use ${jutsu.name} (${jutsu.element}).`));
                        case 'no-chakra':
                            return finish(await rejectWithLog(`${me.name}: not enough chakra for ${jutsu.name} (need ${jutsu.chakraCost ?? 0}).`));
                        case 'no-stamina':
                            return finish(await rejectWithLog(`${me.name}: not enough stamina for ${jutsu.name} (need ${jutsu.staminaCost ?? 0}).`));
                        case 'target-tile-required':
                            return finish(await rejectWithLog(`${me.name}: ${jutsu.name} needs a ground tile target.`));
                        case 'out-of-range':
                            return finish(await rejectWithLog(`${jutsu.name} is out of range (need ≤${Math.max(0, Number(jutsu.range) || 0)}, distance ${Math.round(distance(me.pos, opp.pos))}).`));
                        case 'invalid-move-target':
                            return finish(await rejectWithLog(`${me.name}: ${jutsu.name} — destination out of range or occupied.`));
                        case 'invalid-ground-target':
                            return finish(await rejectWithLog(`${me.name}: ${jutsu.name} — target tile out of range or occupied.`));
                        case 'ground-effect-needs-supported-tag':
                            return finish(await rejectWithLog(`${me.name}: ${jutsu.name} needs Decrease Damage Given, Recoil, or Poison for its ground effect.`));
                    }
                }

                const apCost = plan.apCost;
                const jChakraCost = plan.chakraCost;
                const jStaminaCost = plan.staminaCost;

                // combatResourcesV2: Poison feeds on exertion — spending chakra/stamina
                // to cast deals HP damage scaled by the spend + the caster's active
                // Poison. Computed once, folded into every cost-deduction branch below
                // via paySpendPoison. 0 when the flag is off / not poisoned / free jutsu.
                const jPoisonPct = COMBAT_RESOURCES_V2 ? sumActivePct(me, 'Poison', session.round, 6) : 0;
                const poisonSpendDmg = jPoisonPct > 0 ? v2PoisonOnSpend(jChakraCost + jStaminaCost, jPoisonPct) : 0;
                const spendPoisonVfx: RelativeVfxEvent[] = [];
                const paySpendPoison = <T extends { name: string; hp: number }>(self: T): T => {
                    if (poisonSpendDmg <= 0) return self;
                    lines.push(`${self.name} takes ${poisonSpendDmg} Poison damage from exertion.`);
                    spendPoisonVfx.push(vfxEvent('self', 'poisonCloud', 'caster', 'minor'));
                    return { ...self, hp: Math.max(0, self.hp - poisonSpendDmg) };
                };

                const tags = jutsu.tags ?? [];
                const moveTag = plan.move;
                const pureMoveJutsu = plan.pureMove;
                const groundTarget = plan.groundTarget;
                const jutsuMethod = plan.method;

                // Append the jutsu's flavor line (from the catalog) after the cast
                // header so PvP players see the same battle-log flavor as PvE.
                // Purely cosmetic — no effect on damage/AP/targeting/cooldowns.
                const castFlavor = (typeof jutsu.battleDescription === 'string' ? jutsu.battleDescription.trim() : '')
                    .replace(/%user/g, me.name).replace(/%target/g, opp.name);
                lines.push(`${me.name} uses ${jutsu.name}:${castFlavor ? ' ' + castFlavor : ''}`);
                // Weather keys off the jutsu's weather affinity: bloodline jutsu
                // set an explicit weatherElement (base element, or "None" for no
                // interaction); others fall back to their own element. Mirrors the
                // client's weatherElementOf (lib/elements.ts).
                const jWMult = weatherMultiplier(jutsu.weatherElement ?? jutsu.element, weatherPositiveElement, weatherNegativeElement);
                const cd = plan.cooldown > 0 ? { [jutsuId]: plan.cooldown } : undefined;

                // Ground-target and movement jutsus: choose an open tile in range.
                // AOE_CIRCLE resolves from the chosen tile and only hits if the opponent
                // is in the surrounding ring. Pure Move jutsus just relocate the user.
                if (moveTag && plan.targetTile !== undefined) {
                    const destTile = plan.targetTile;
                    const movedSelf = paySpendPoison({ ...me, pos: destTile, chakra: Math.max(0, me.chakra - jChakraCost), stamina: Math.max(0, me.stamina - jStaminaCost) });
                    lines.push(`${me.name} dashes to hex ${destTile}.`);
                    if (plan.createsGroundEffect) {
                        // Dash in, then erupt a spiral ground nova centred on the
                        // landing tile. The filled hex disk becomes a
                        // 2-round ground zone carrying this jutsu's ground tags; the
                        // enemy takes the effect immediately if caught inside it and
                        // again each round they stand in the zone.
                        const groundEffect: PvpGroundEffect = createCanonicalGroundEffect({
                            id: `${jutsu.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            owner: role,
                            name: jutsu.name,
                            plan,
                        });
                        lines.push(`${jutsu.name} erupts in a spiral, blanketing ${groundEffect.tiles.length} hexes for 2 rounds.`);
                        const spiralGround = applyGroundEffectToFighter(opp, groundEffect, session.round);
                        lines.push(...spiralGround.lines);
                        result = commit(
                            movedSelf,
                            spiralGround.fighter,
                            apCost,
                            cd,
                            { groundEffects: [...(session.groundEffects ?? []), groundEffect] },
                            undefined,
                            [
                                vfxForJutsu(jutsu, movedSelf, spiralGround.fighter, undefined, { area: true, tiles: groundEffect.tiles, persistent: true, who: 'opp' }),
                                ...spendPoisonVfx,
                            ],
                        );
                        break;
                    }
                    if (jutsuMethod === 'AOE_CIRCLE' && plan.hitsOpponent) {
                        // Strip Move tag so applyJutsu treats this as a pure damage/effect jutsu
                        const damageJutsu = { ...jutsu, tags: tags.filter(t => normalizeTagName(t.name) !== 'Move') };
                        const jr = applyJutsu(movedSelf, opp, damageJutsu, jWMult, biome, session.round);
                        lines.push(`Ring impact catches ${opp.name}!`);
                        lines.push(...jr.lines);
                        result = commit(
                            jr.self,
                            jr.opponent,
                            apCost,
                            cd,
                            undefined,
                            jr.fx,
                            [
                                vfxForJutsu(damageJutsu, jr.self, jr.opponent, jr.fx, { area: true, tiles: plan.footprint, ko: jr.opponent.hp <= 0, who: 'opp' }),
                                ...reactionVfx(opp, jr.opponent, jr.fx),
                                ...spendPoisonVfx,
                            ],
                        );
                    } else if (jutsuMethod === 'AOE_CIRCLE') {
                        lines.push(`${opp.name} is outside the impact area.`);
                        result = commit(
                            movedSelf,
                            null,
                            apCost,
                            cd,
                            undefined,
                            undefined,
                            [
                                vfxForJutsu(jutsu, movedSelf, opp, undefined, { area: true, tiles: plan.footprint, who: 'opp' }),
                                ...spendPoisonVfx,
                            ],
                        );
                    } else {
                        const movementVfx = pureMoveJutsu
                            ? (spendPoisonVfx.length ? spendPoisonVfx : undefined)
                            : [
                                vfxForJutsu(jutsu, movedSelf, opp, undefined, { tiles: [destTile], who: 'self' }),
                                ...spendPoisonVfx,
                            ];
                        result = commit(
                            movedSelf,
                            null,
                            apCost,
                            cd,
                            undefined,
                            undefined,
                            movementVfx,
                        );
                    }
                    break;
                }

                if (groundTarget && plan.targetTile !== undefined) {
                    const targetTile = plan.targetTile;
                    if (plan.createsGroundEffect) {
                        const groundEffect: PvpGroundEffect = createCanonicalGroundEffect({
                            id: `${jutsu.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            owner: role,
                            name: jutsu.name,
                            plan,
                        });
                        const paidSelf = paySpendPoison({ ...me, chakra: Math.max(0, me.chakra - jChakraCost), stamina: Math.max(0, me.stamina - jStaminaCost) });
                        lines.push(`${jutsu.name} creates a ground effect for 2 rounds.`);
                        const instantGround = applyGroundEffectToFighter(opp, groundEffect, session.round);
                        lines.push(...instantGround.lines);
                        result = commit(
                            paidSelf,
                            instantGround.fighter,
                            apCost,
                            cd,
                            { groundEffects: [...(session.groundEffects ?? []), groundEffect] },
                            undefined,
                            [
                                vfxForJutsu(jutsu, paidSelf, instantGround.fighter, undefined, { ground: true, tiles: plan.footprint, persistent: true, who: 'opp' }),
                                ...spendPoisonVfx,
                            ],
                        );
                        break;
                    }
                    const catchesOpponent = jutsuMethod === 'AOE_CIRCLE' && plan.hitsOpponent;
                    const paidSelf = paySpendPoison({ ...me, chakra: Math.max(0, me.chakra - jChakraCost), stamina: Math.max(0, me.stamina - jStaminaCost) });
                    if (catchesOpponent) {
                        const jr = applyJutsu(paidSelf, opp, jutsu, jWMult, biome, session.round);
                        lines.push(`Area burst catches ${opp.name}!`);
                        lines.push(...jr.lines);
                        result = commit(
                            jr.self,
                            jr.opponent,
                            apCost,
                            cd,
                            undefined,
                            jr.fx,
                            [
                                vfxForJutsu(jutsu, jr.self, jr.opponent, jr.fx, { area: true, tiles: plan.footprint, ko: jr.opponent.hp <= 0, who: 'opp' }),
                                ...reactionVfx(opp, jr.opponent, jr.fx),
                                ...spendPoisonVfx,
                            ],
                        );
                    } else {
                        lines.push(`${opp.name} is outside the impact area.`);
                        result = commit(
                            paidSelf,
                            null,
                            apCost,
                            cd,
                            undefined,
                            undefined,
                            [
                                vfxForJutsu(jutsu, paidSelf, opp, undefined, { area: jutsuMethod === 'AOE_CIRCLE', tiles: plan.footprint, who: 'opp' }),
                                ...spendPoisonVfx,
                            ],
                        );
                    }
                    break;
                }

                const jr = applyJutsu(me, opp, jutsu, jWMult, biome, session.round);
                const jUpdatedSelf = paySpendPoison({
                    ...jr.self,
                    chakra: Math.max(0, jr.self.chakra - jChakraCost),
                    stamina: Math.max(0, jr.self.stamina - jStaminaCost),
                });
                lines.push(...jr.lines);
                result = commit(
                    jUpdatedSelf,
                    jr.opponent,
                    apCost,
                    cd,
                    undefined,
                    jr.fx,
                    [
                        vfxForJutsu(jutsu, jUpdatedSelf, jr.opponent, jr.fx, { ko: jr.opponent.hp <= 0 }),
                        ...reactionVfx(opp, jr.opponent, jr.fx),
                        ...spendPoisonVfx,
                    ],
                );
                break;
            }

            case 'weapon': {
                const serverItem = equippedPvpItem(me, itemId, itemName);
                if (!serverItem || !['hand', 'thrown'].includes(normalizeEquipmentSlot(serverItem.slot))) {
                    await kv.delIfEqual(lockKey, lockToken).catch(() => undefined);
                    return res.status(400).json({ error: 'Weapon is not equipped for this fighter' });
                }
                // Receipt metadata from the SERVER's equipped item, not the
                // client's itemName (which equippedPvpItem only uses to look up).
                receiptAction.id = String(serverItem.id ?? 'weapon');
                receiptAction.name = String(serverItem.name ?? 'Weapon Attack');
                receiptAction.category = 'weapon';
                receiptAction.element = serverItem.weaponElement ? String(serverItem.weaponElement) : undefined;
                const wSlot = normalizeEquipmentSlot(serverItem.slot);
                const weapRange = serverItem.weaponRange ?? (wSlot === 'thrown' ? 4 : 1);
                const wApCost = serverItem.apCost ?? 40;
                if (!canAct(wApCost)) return finish(withRejected(session, `Not enough AP or actions left for ${serverItem.name ?? 'that weapon'}.`));
                if (distance(me.pos, opp.pos) > weapRange) {
                    return finish(await rejectWithLog(`${me.name}: ${itemName ?? 'Weapon'} is out of range (need ≤${weapRange}).`));
                }
                // Cooldown enforcement — both thrown weapons AND named melee (hand)
                // weapons cool down between uses server-side. The case above already
                // guarantees wSlot ∈ {hand, thrown}. Catalog weapons set weaponCooldown
                // explicitly (CD 5); forged "named weapons", forged hand-slot gauntlets,
                // and older admin weapons can omit it — so a missing cooldown falls back
                // to the standard 5 rounds (covers weapons already crafted into saves)
                // rather than 0, which let them strike every turn (the spam vector). An
                // explicit 0 is honoured (?? only fills null/undefined). Keep the default
                // in sync with PvE (shinobij.client Arena.tsx). Keyed by item id (falls
                // back to name) and ticked by tickCooldowns exactly like jutsu cooldowns.
                const wCdKey = serverItem.id ?? serverItem.name ?? 'weapon';
                const wCdTurns = Math.max(0, Math.floor(Number(serverItem.weaponCooldown ?? 5)));
                if (wCdTurns > 0 && (myCooldowns[wCdKey] ?? 0) > 0) {
                    return finish(withRejected(session, `${serverItem.name ?? 'That weapon'} is on cooldown (${myCooldowns[wCdKey]} turn(s) left).`));
                }
                // Thrown weapons are spent from inventory on each throw; melee
                // (hand) weapons are reusable and never sealed.
                let wChargePatch: Partial<PvpSession> = {};
                if (wSlot === 'thrown') {
                    const wSpend = spendItemCharge(serverItem.id ?? '');
                    if (!wSpend.ok) return finish(await rejectWithLog(`${me.name}: out of ${serverItem.name ?? 'that weapon'}.`));
                    wChargePatch = wSpend.patch;
                }
                const wTags: JutsuTag[] = [...(serverItem.weaponTags ?? [])];
                if (serverItem.weaponEffect && !wTags.find(t => t.name === serverItem.weaponEffect)) {
                    wTags.push({ name: serverItem.weaponEffect, percent: serverItem.weaponEffectValue ?? 0 });
                }
                const weaponJutsu: Jutsu = {
                    id: 'weapon',
                    name: serverItem.name ?? 'Weapon Attack',
                    type: 'Bukijutsu',
                    // A weapon attack deals damage from its weaponEp — it is NOT a
                    // zero-damage utility. Hand weapons omit apCost, so wApCost
                    // defaults to 40; without this flag the synthesized jutsu (id
                    // 'weapon', ap 40) would trip the legacy 40-AP utility rule
                    // (isZeroDamageFortyApJutsu) and deal ZERO base damage in PvP.
                    // PvE is already exempt (its weapon synth uses an 'item-' id).
                    isUtility: false,
                    effectPower: serverItem.weaponEp ?? 15,
                    ap: wApCost,
                    range: weapRange,
                    // Elemental-weapon gate: this swing rides the wielder's bloodline
                    // damage multiplier ONLY when the weapon's element is one the
                    // wielder has awakened. No element (every base weapon today) → no
                    // boost. An elemental shard/core stamps serverItem.weaponElement.
                    suppressBloodline: !characterOwnsElement(me.character, serverItem.weaponElement),
                    tags: wTags,
                };
                lines.push(`${me.name} uses ${weaponJutsu.name}:`);
                const wWMult = weatherMultiplier(serverItem.weaponElement, weatherPositiveElement, weatherNegativeElement);
                const wr = applyJutsu(me, opp, weaponJutsu, wWMult, biome, session.round);
                lines.push(...wr.lines);
                const wCd = wCdTurns > 0 ? { [wCdKey]: wCdTurns } : undefined;
                const wIntensity = intensityFromHit(wr.fx, wr.self, wr.opponent, wr.opponent.hp <= 0);
                const namedWeapon = wSlot === 'hand' && (Boolean(serverItem.weaponEffect) || (serverItem.weaponTags?.length ?? 0) > 0);
                const wVisualKey: CombatVfxKey =
                    wIntensity === 'finisher' ? 'ko' :
                    wSlot === 'thrown' ? 'throwable' :
                    namedWeapon ? 'namedWeapon' :
                    wIntensity === 'heavy' ? 'heavy' :
                    'weapon';
                const wEffectVfx = wIntensity === 'finisher' ? [] : vfxForTagEffect(wTags, 'minor');
                result = commit(
                    wr.self,
                    wr.opponent,
                    wApCost,
                    wCd,
                    wChargePatch,
                    wr.fx,
                    [
                        vfxEvent('opp', wVisualKey, 'target', wIntensity),
                        ...wEffectVfx,
                        ...reactionVfx(opp, wr.opponent, wr.fx),
                    ],
                );
                break;
            }

            case 'item': {
                const serverItem = equippedPvpItem(me, itemId, itemName);
                if (!serverItem || ['hand', 'thrown'].includes(normalizeEquipmentSlot(serverItem.slot))) {
                    await kv.delIfEqual(lockKey, lockToken).catch(() => undefined);
                    return res.status(400).json({ error: 'Item is not equipped for this fighter' });
                }
                // Receipt metadata from the SERVER's equipped item (see weapon).
                receiptAction.id = String(serverItem.id ?? 'item');
                receiptAction.name = String(serverItem.name ?? 'Item');
                receiptAction.category = 'item';
                receiptAction.element = serverItem.weaponElement ? String(serverItem.weaponElement) : undefined;
                const iApCost = serverItem.apCost ?? 35;
                if (!canAct(iApCost)) return finish(withRejected(session, `Not enough AP or actions left for ${serverItem.name ?? 'that item'}.`));
                // Cooldown enforcement — combat items (pills / smoke bomb) honour
                // their catalog weaponCooldown so they can't be spammed every turn
                // (the server previously ignored it). Restore-only potions carry no
                // weaponCooldown → iCdTurns 0 → unaffected (they keep the separate
                // 2/fight charge cap). Checked before spending a charge.
                const iCdKey = serverItem.id ?? serverItem.name ?? 'item';
                const iCdTurns = Math.max(0, Math.floor(Number(serverItem.weaponCooldown ?? 0)));
                if (iCdTurns > 0 && (myCooldowns[iCdKey] ?? 0) > 0) {
                    return finish(withRejected(session, `${serverItem.name ?? 'That item'} is on cooldown (${myCooldowns[iCdKey]} turn(s) left).`));
                }
                const iCd = iCdTurns > 0 ? { [iCdKey]: iCdTurns } : undefined;
                // Spend from the sealed supply (the potion's 2/fight cap is the
                // sealed starting charge, so this also enforces it).
                const iSpend = spendItemCharge(serverItem.id ?? '');
                if (!iSpend.ok) return finish(await rejectWithLog(`${me.name}: out of ${serverItem.name ?? 'that item'}.`));
                // Restore-only potions (Rejuvenation Potion): refill chakra/stamina
                // directly and skip the jutsu synth so they never heal HP via the
                // default Heal tag.
                const iRestoreCk = Math.max(0, Number(serverItem.restoreChakra) || 0);
                const iRestoreSt = Math.max(0, Number(serverItem.restoreStamina) || 0);
                if ((iRestoreCk > 0 || iRestoreSt > 0) && !serverItem.weaponEffect && !serverItem.weaponTags?.length) {
                    const restoredMe: PvpFighter = {
                        ...me,
                        chakra: Math.min(me.maxChakra, me.chakra + iRestoreCk),
                        stamina: Math.min(me.maxStamina, me.stamina + iRestoreSt),
                    };
                    lines.push(`${me.name} uses ${serverItem.name ?? 'Potion'}: restores ${iRestoreCk} chakra and ${iRestoreSt} stamina.`);
                    result = commit(restoredMe, null, iApCost, iCd, iSpend.patch, undefined, [vfxEvent('self', 'buff', 'caster')]);
                    break;
                }
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
                const iVisualTags = vfxTagNames(iTags);
                const iVisualKey = semanticKeyForJutsuTags(iVisualTags, false) ?? 'buff';
                const iIntensity = intensityFromHit(ir.fx, irSelf, ir.opponent, ir.opponent.hp <= 0);
                const iKey: CombatVfxKey = iIntensity === 'finisher' ? 'ko' : iVisualKey;
                const iVisualSelf = VFX_CASTER_WARD_KEYS.has(iVisualKey);
                const iBothTargetVfx = serverItem.weaponEffectTarget === 'both' && !iVisualSelf && iKey !== 'ko'
                    ? [vfxEvent('self', iVisualKey, 'caster', 'minor')]
                    : [];
                result = commit(
                    irSelf,
                    ir.opponent,
                    iApCost,
                    iCd,
                    iSpend.patch,
                    ir.fx,
                    [
                        vfxEvent(iVisualSelf ? 'self' : 'opp', iKey, iVisualSelf ? 'caster' : 'target', iIntensity),
                        ...iBothTargetVfx,
                        ...reactionVfx(opp, ir.opponent, ir.fx),
                    ],
                );
                break;
            }

            case 'flee': {
                if (!canAct(100)) return finish(withRejected(session, 'Cannot flee — out of AP or actions this turn.'));
                const hpCost = Math.max(1, Math.floor(me.maxHp * 0.1));
                // Crypto-random 50% (1-in-2) — consistent with the session coin-flip;
                // V8's Math.random is seeded/predictable and shouldn't gate an outcome.
                const escaped = randomInt(2) === 0;
                const updatedMe = { ...me, hp: Math.max(0, me.hp - hpCost) };
                if (escaped) {
                    lines.push(`${me.name} fled the battle, losing ${hpCost} HP.`);
                    result = commit(updatedMe, null, 100, undefined, {
                        status: 'done',
                        winner: role === 'p1' ? 'p2' : 'p1',
                        fleedBy: role,
                    });
                } else {
                    lines.push(`${me.name} tried to flee, lost ${hpCost} HP, but failed.`);
                    result = commit(updatedMe, null, 100);
                }
                break;
            }

            default:
                await kv.delIfEqual(lockKey, lockToken).catch(() => undefined);
                return res.status(400).json({ error: `Unknown action: ${action}` });
        }

        // Publish the combat projection before any terminal or receipt side
        // effect. The exact pre-move row, not the expiring lease, is authority.
        const receiptCandidate = withPvpActionReceiptReplay(session, result, {
            role,
            actionId: receiptAction.id,
            actionName: receiptAction.name,
            actionType: action,
            display: {
                label: receiptAction.name,
                category: receiptAction.category,
                element: receiptAction.element,
                discipline: receiptAction.discipline,
                imageRef: receiptAction.imageRef,
            },
            moveToken,
        });
        const write = await commitPvpSessionMutation(kv, key, session, receiptCandidate, {
            moveToken,
            ttlSeconds: SESSION_TTL,
        });
        if (write.status === 'conflict') {
            await kv.delIfEqual(lockKey, lockToken).catch(() => undefined);
            const current = isPvpSessionRow(write.session, battleId) ? write.session : null;
            if (!current || current.rankedCloseFence) {
                return res.status(409).json({ error: 'This ranked match ended as a season-close no-contest.' });
            }
            await replayCommittedPvpActionReceipt(kv, current);
            await helpCommittedTerminal(current);
            return res.status(200).json(withRejected(current, 'The battle advanced before this action committed. Please retry.'));
        }
        const persisted = write.session;
        await kv.delIfEqual(lockKey, lockToken).catch(() => undefined);
        // The receipt body uses a deterministic revision-derived key and is
        // recoverable from the committed capsule. Propagate a transient failure:
        // the same-token retry repairs it before returning current combat state.
        await replayCommittedPvpActionReceipt(kv, persisted);
        await helpCommittedTerminal(persisted);
        return res.status(200).json(persisted);
    } catch (err) {
        console.error('[pvp/move]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

import { jutsuLevelCapForLevel } from '../combat-core/formulas.js';
import { masteryBonus } from '../_profession-mastery.js';

/**
 * A lesson is paid in ryo (levels 1-30) or, past the ryo cap, in Honor Seals
 * (levels 30-40). Both are the same timed lesson in the same two slots; only
 * the price, the currency and the level ceiling differ. A lesson without
 * `currency` is a ryo lesson, which is every lesson written before Seal lessons.
 */
export type LessonCurrency = 'ryo' | 'honorSeals';

export type ServerJutsuTraining = {
    serverToken: string;
    jutsuId: string;
    label: string;
    fromLevel: number;
    toLevel: number;
    ryoCost: number;
    currency?: LessonCurrency;
    sealCost?: number;
    startedAt: number;
    endsAt: number;
    next?: ServerQueuedJutsuTraining | null;
    autoClaim?: boolean;
};

export type ServerQueuedJutsuTraining = {
    serverToken: string;
    jutsuId: string;
    label: string;
    fromLevel: number;
    toLevel: number;
    ryoCost: number;
    currency?: LessonCurrency;
    sealCost?: number;
    durationMs: number;
};

// Honor Seal price per lesson, indexed by the level being trained FROM
// (30→31 = 20 Seals …). Per docs/professions.md. Moved here from the retired
// instant endpoint (api/jutsu/train-with-seals.ts) so there is one table.
const SEAL_COSTS_BY_FROM_LEVEL: Record<number, number> = {
    30: 20, 31: 25, 32: 30, 33: 35, 34: 40, 35: 45, 36: 50, 37: 55, 38: 60, 39: 65,
};
export const SEAL_LESSON_MIN_LEVEL = 30;
/** Seal lessons stop at 40; 40→50 still requires PvP. */
export const SEAL_LESSON_MAX_LEVEL = 40;
const VANGUARD_RANK_FOR_DISCOUNT = 8;
const VANGUARD_DISCOUNT_MULT = 0.9;

/** Honor Seal price of the lesson that trains FROM `fromLevel`, after Vanguard discounts. */
export function jutsuSealTrainingCost(fromLevel: number, character: Record<string, unknown>): number {
    let cost = SEAL_COSTS_BY_FROM_LEVEL[fromLevel] ?? 0;
    if (cost === 0) return 0;
    // Vanguard Rank 8+ pays 90% of the listed cost.
    if (character.profession === 'vanguard' && Number(character.professionRank ?? 0) >= VANGUARD_RANK_FOR_DISCOUNT) {
        cost = cost * VANGUARD_DISCOUNT_MULT;
    }
    // Vanguard mastery (Quartermaster → Efficient Forging) stacks multiplicatively, capped.
    const masteryPct = Math.min(50, masteryBonus(character.profession, character.masterySpec, 'sealTrainCostPct'));
    if (masteryPct > 0) cost = cost * (1 - masteryPct / 100);
    return Math.max(1, Math.ceil(cost));
}

/** Seal lessons can't raise a jutsu past the player's rank cap (the combat clamp) either. */
export const jutsuSealTrainingCap = (characterLevel: unknown): number =>
    Math.min(SEAL_LESSON_MAX_LEVEL, jutsuLevelCapForLevel(Math.max(1, whole(characterLevel))));

const isSealLesson = (lesson: { currency?: unknown }) => lesson.currency === 'honorSeals';
/** The level ceiling a lesson settles against. */
function lessonCap(character: Record<string, unknown>, lesson: { currency?: unknown }): number {
    return isSealLesson(lesson) ? jutsuSealTrainingCap(character.level) : jutsuRyoTrainingCap(character.level);
}

const whole = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));
/** The mutation layer has already reconciled elderFocus against occupied seats. */
export function jutsuTrainingBonusPct(character: Record<string, unknown>): number {
    const upgrades = character.villageUpgrades as Record<string, unknown> | undefined;
    const village = Math.min(50, whole(upgrades?.jutsuTraining)) * 0.25;
    const equipment = character.equipment as Record<string, unknown> | undefined;
    const auraEquipped = equipment?.aura === 'aura-sphere' || equipment?.accessory === 'aura-sphere';
    const aura = auraEquipped ? (whole(character.auraSphereLevel) >= 250 ? 10 : whole(character.auraSphereLevel) >= 150 ? 5 : 0) : 0;
    return village + aura + (character.elderFocus === 'training' ? 10 : 0);
}
export const jutsuRyoTrainingCost = (levelRaw: unknown): number => {
    const level = whole(levelRaw);
    return level < 10 ? 2500 + level * 500 : 8000 + Math.max(0, level - 10) * 1200;
};
/**
 * `bonusPct` is the player's training bonus derived from the authoritative save.
 * `moraleTimeMult` is the village's war MORALE, resolved SERVER-SIDE — a separate
 * multiplier on purpose: folding morale into `bonusPct` made the server-owned window
 * could only ever shave an existing bonus, so a player without one felt the
 * advertised "+20% training time" not at all. As its own factor it always bites,
 * in both directions, and the client cannot touch it.
 */
export const jutsuRyoTrainingDuration = (levelRaw: unknown, bonusPctRaw: unknown, moraleTimeMult: unknown = 1): number => {
    const base = whole(levelRaw) < 10 ? 10 * 60_000 : 30 * 60_000;
    const bonus = Math.max(0, Math.min(60, Number(bonusPctRaw) || 0));
    const morale = Math.max(0.5, Math.min(2, Number(moraleTimeMult) || 1));
    return Math.max(60_000, Math.floor(base * (1 - bonus / 100) * morale));
};
export const jutsuRyoTrainingCap = (characterLevel: unknown): number => Math.min(30, jutsuLevelCapForLevel(Math.max(1, whole(characterLevel))));

type Mastery = { jutsuId: string; level: number; xp?: number };
function masteries(character: Record<string, unknown>): Mastery[] {
    return Array.isArray(character.jutsuMastery)
        ? (character.jutsuMastery as unknown[]).filter((row): row is Mastery => !!row && typeof row === 'object' && typeof (row as Mastery).jutsuId === 'string')
        : [];
}
export function currentJutsuLevel(character: Record<string, unknown>, jutsuId: string): number {
    return whole(masteries(character).find((row) => row.jutsuId === jutsuId)?.level);
}
export function applyJutsuLevel(character: Record<string, unknown>, jutsuId: string, requestedLevel: number, cap: number = jutsuRyoTrainingCap(character.level)): Record<string, unknown> {
    const rows = masteries(character);
    const current = rows.find((row) => row.jutsuId === jutsuId);
    const level = Math.max(whole(current?.level), Math.min(cap, whole(requestedLevel)));
    return { ...character, jutsuMastery: [...rows.filter((row) => row.jutsuId !== jutsuId), { jutsuId, level, xp: whole(current?.xp) }] };
}

/** Grant a finished lesson's level under that lesson's own ceiling. */
const applyLesson = (character: Record<string, unknown>, lesson: ServerJutsuTraining) =>
    applyJutsuLevel(character, lesson.jutsuId, lesson.toLevel, lessonCap(character, lesson));

/** Price a Seal lesson from `fromLevel`, or say why it can't be bought. */
function priceSealLesson(character: Record<string, unknown>, fromLevel: number) {
    if (fromLevel < SEAL_LESSON_MIN_LEVEL) return { ok: false as const, reason: 'seal-training-below-level-30' as const };
    if (fromLevel >= jutsuSealTrainingCap(character.level)) return { ok: false as const, reason: 'jutsu-at-seal-training-cap' as const };
    const sealCost = jutsuSealTrainingCost(fromLevel, character);
    if (sealCost <= 0) return { ok: false as const, reason: 'jutsu-at-seal-training-cap' as const };
    if (whole(character.honorSeals) < sealCost) return { ok: false as const, reason: 'not-enough-honor-seals' as const };
    return { ok: true as const, sealCost };
}

/**
 * Start a timed Honor Seal lesson (Lv 30→40). Same duration rule, bonuses and
 * war morale as a ryo lesson at that level (30 min base), same single active
 * slot; the Seals are debited up front exactly like ryo.
 */
export function startJutsuSealTraining(character: Record<string, unknown>, jutsuId: string, label: string, token: string, now: number, bonusPct: unknown, moraleTimeMult: unknown = 1) {
    const fromLevel = currentJutsuLevel(character, jutsuId);
    const price = priceSealLesson(character, fromLevel);
    if (!price.ok) return price;
    const duration = jutsuRyoTrainingDuration(fromLevel, bonusPct, moraleTimeMult);
    const active: ServerJutsuTraining = {
        serverToken: token, jutsuId, label: label.slice(0, 80), fromLevel, toLevel: fromLevel + 1,
        ryoCost: 0, currency: 'honorSeals', sealCost: price.sealCost, startedAt: now, endsAt: now + duration,
    };
    const paid: Record<string, unknown> = { ...character, honorSeals: whole(character.honorSeals) - price.sealCost };
    return { ok: true as const, character: paid, active, cost: price.sealCost };
}

/** Queue a Seal lesson in the second slot, behind any active lesson. */
export function queueJutsuSealTraining(
    character: Record<string, unknown>,
    active: ServerJutsuTraining,
    jutsuId: string,
    label: string,
    token: string,
    bonusPct: unknown,
    moraleTimeMult: unknown = 1,
) {
    if (active.next) return { ok: false as const, reason: 'jutsu-training-queue-full' as const };
    const fromLevel = active.jutsuId === jutsuId ? active.toLevel : currentJutsuLevel(character, jutsuId);
    const price = priceSealLesson(character, fromLevel);
    if (!price.ok) return price;
    const queued: ServerQueuedJutsuTraining = {
        serverToken: token, jutsuId, label: label.slice(0, 80), fromLevel, toLevel: fromLevel + 1,
        ryoCost: 0, currency: 'honorSeals', sealCost: price.sealCost,
        durationMs: jutsuRyoTrainingDuration(fromLevel, bonusPct, moraleTimeMult),
    };
    const paid: Record<string, unknown> = { ...character, honorSeals: whole(character.honorSeals) - price.sealCost };
    return {
        ok: true as const,
        character: paid,
        active: { ...active, next: queued },
        cost: price.sealCost,
        refund: 0,
    };
}

/** Promote a queued lesson (either currency) to the active slot. */
export function promoteQueuedLesson(queued: ServerQueuedJutsuTraining, startedAt: number): ServerJutsuTraining {
    return {
        serverToken: queued.serverToken,
        jutsuId: queued.jutsuId,
        label: queued.label,
        fromLevel: queued.fromLevel,
        toLevel: queued.toLevel,
        ryoCost: queued.ryoCost,
        ...(isSealLesson(queued) ? { currency: 'honorSeals' as const, sealCost: whole(queued.sealCost) } : {}),
        startedAt,
        endsAt: startedAt + queued.durationMs,
        next: null,
        autoClaim: true,
    };
}

/** Return a lesson's price in its own currency. */
function refundLesson(character: Record<string, unknown>, lesson: { currency?: unknown; ryoCost?: unknown; sealCost?: unknown }, share: number): { character: Record<string, unknown>; refund: number } {
    if (isSealLesson(lesson)) {
        const refund = Math.floor(whole(lesson.sealCost) * share);
        return { character: { ...character, honorSeals: whole(character.honorSeals) + refund }, refund };
    }
    const refund = Math.floor(whole(lesson.ryoCost) * share);
    return { character: { ...character, ryo: whole(character.ryo) + refund }, refund };
}

export function startJutsuRyoTraining(character: Record<string, unknown>, jutsuId: string, label: string, token: string, now: number, bonusPct: unknown, moraleTimeMult: unknown = 1) {
    const fromLevel = currentJutsuLevel(character, jutsuId);
    const cap = jutsuRyoTrainingCap(character.level);
    if (fromLevel >= cap) return { ok: false as const, reason: 'jutsu-at-training-cap' as const };
    if (fromLevel === 0) return { ok: true as const, character: applyJutsuLevel(character, jutsuId, 1), active: null, cost: 0 };
    const cost = jutsuRyoTrainingCost(fromLevel);
    if (whole(character.ryo) < cost) return { ok: false as const, reason: 'not-enough-ryo' as const };
    const duration = jutsuRyoTrainingDuration(fromLevel, bonusPct, moraleTimeMult);
    const active: ServerJutsuTraining = { serverToken: token, jutsuId, label: label.slice(0, 80), fromLevel, toLevel: fromLevel + 1, ryoCost: cost, startedAt: now, endsAt: now + duration };
    return { ok: true as const, character: { ...character, ryo: whole(character.ryo) - cost }, active, cost };
}

export function settleJutsuRyoTraining(character: Record<string, unknown>, active: ServerJutsuTraining, action: 'complete' | 'cancel' | 'finish', now: number) {
    if (action === 'complete') {
        if (now < active.endsAt) return { ok: false as const, reason: 'training-not-finished' as const };
        return { ok: true as const, character: applyLesson(character, active), active: null, cost: 0, refund: 0 };
    }
    if (action === 'cancel') {
        // Half back, in the currency the lesson was paid in.
        const { character: refunded, refund } = refundLesson(character, active, 0.5);
        // Cancelling clears both slots. A paid lesson queued behind it never
        // started, so it comes back in full — it used to be dropped unrefunded,
        // e.g. when a second tab that couldn't see the queue pressed Cancel.
        const withQueueRefund = active.next ? refundLesson(refunded, active.next, 1).character : refunded;
        return { ok: true as const, character: withQueueRefund, active: null, cost: 0, refund };
    }
    // Finish-now is always paid in ryo (500 per remaining minute), whichever
    // currency bought the lesson — the same rule the ryo lessons use.
    const finishCost = Math.max(0, Math.ceil(Math.max(0, active.endsAt - now) / 60_000)) * 500;
    if (whole(character.ryo) < finishCost) return { ok: false as const, reason: 'not-enough-ryo' as const };
    const debited = { ...character, ryo: whole(character.ryo) - finishCost };
    return { ok: true as const, character: applyLesson(debited, active), active: null, cost: finishCost, refund: 0 };
}

export function queueJutsuRyoTraining(
    character: Record<string, unknown>,
    active: ServerJutsuTraining,
    jutsuId: string,
    label: string,
    token: string,
    bonusPct: unknown,
    moraleTimeMult: unknown = 1,
) {
    if (active.next) return { ok: false as const, reason: 'jutsu-training-queue-full' as const };
    const fromLevel = active.jutsuId === jutsuId ? active.toLevel : currentJutsuLevel(character, jutsuId);
    const cap = jutsuRyoTrainingCap(character.level);
    if (fromLevel <= 0) return { ok: false as const, reason: 'train-level-zero-directly' as const };
    if (fromLevel >= cap) return { ok: false as const, reason: 'jutsu-at-training-cap' as const };
    const cost = jutsuRyoTrainingCost(fromLevel);
    if (whole(character.ryo) < cost) return { ok: false as const, reason: 'not-enough-ryo' as const };
    const queued: ServerQueuedJutsuTraining = {
        serverToken: token,
        jutsuId,
        label: label.slice(0, 80),
        fromLevel,
        toLevel: fromLevel + 1,
        ryoCost: cost,
        durationMs: jutsuRyoTrainingDuration(fromLevel, bonusPct, moraleTimeMult),
    };
    return {
        ok: true as const,
        character: { ...character, ryo: whole(character.ryo) - cost },
        active: { ...active, next: queued },
        cost,
        refund: 0,
    };
}

export function cancelQueuedJutsuRyoTraining(character: Record<string, unknown>, active: ServerJutsuTraining) {
    if (!active.next) return { ok: false as const, reason: 'jutsu-training-queue-empty' as const };
    // A queued lesson never started, so it is refunded in full, in its own currency.
    const { character: refunded, refund } = refundLesson(character, active.next, 1);
    return {
        ok: true as const,
        character: refunded,
        active: { ...active, next: null },
        cost: 0,
        refund,
    };
}

export function advanceQueuedJutsuRyoTraining(character: Record<string, unknown>, active: ServerJutsuTraining, now: number) {
    let nextCharacter = character;
    let current: ServerJutsuTraining | null = active;
    for (let step = 0; current && step < 4 && now >= current.endsAt; step += 1) {
        if (current.next) {
            nextCharacter = applyLesson(nextCharacter, current);
            current = promoteQueuedLesson(current.next, current.endsAt);
            continue;
        }
        if (current.autoClaim) {
            nextCharacter = applyLesson(nextCharacter, current);
            current = null;
        }
        break;
    }
    return { ok: true as const, character: nextCharacter, active: current, cost: 0, refund: 0 };
}

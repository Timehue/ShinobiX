import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import {
    startWarfrontMatch,
    scoutedWarfrontDoctrine,
    WF_MAX_SECONDS,
    WF_ROUND_SECONDS,
    WF_STACK_CAP,
    type WarfrontRoundChoice,
    type WfBuildPackage,
    type WfCoachOrder,
    type WfCounterstrike,
    type WfObjectiveTechnique,
    type WfPowerupKind,
    type WfStance,
} from '../_pet-sim/pet-warfront-sim.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import type { SealedManualWarfront, SealedWarfrontSlot } from './warfront-start.js';
import { warfrontAiWarband } from './_warfront-ai.js';
import {
    WARFRONT_BUILD_PACKAGES,
    WARFRONT_COACH_ORDERS,
    WARFRONT_COUNTERSTRIKES,
    WARFRONT_OBJECTIVE_TECHNIQUES,
    isWarfrontOpeningDeployment,
    warfrontAiAuthoredSetup,
} from './_warfront-setup.js';

const WARFRONT_POWERUPS = new Set<WfPowerupKind>(['strike', 'guard', 'vitality', 'swift', 'mend']);
const WARFRONT_STANCES = new Set<WfStance>(['balanced', 'siege', 'jungle', 'headhunt', 'turtle']);
const WARFRONT_DOCTRINES = new Set(['none', 'vanguard', 'bulwark', 'zealot', 'warden-pact']);
const WARFRONT_BUILD_PACKAGE_SET = new Set<string>(WARFRONT_BUILD_PACKAGES);
const WARFRONT_COACH_ORDER_SET = new Set<string>(WARFRONT_COACH_ORDERS);
const WARFRONT_OBJECTIVE_TECHNIQUE_SET = new Set<string>(WARFRONT_OBJECTIVE_TECHNIQUES);
const WARFRONT_COUNTERSTRIKE_SET = new Set<string>(WARFRONT_COUNTERSTRIKES);
const WARFRONT_ROLES = new Set(['defender', 'tracker', 'assassin', 'sage']);
const WARFRONT_ELEMENTS = new Set(['Earth', 'Wind', 'Lightning', 'Fire', 'Water', 'None']);
const WARFRONT_RARITIES = new Set(['standard', 'rare', 'legendary', 'mythic']);
export const MAX_MANUAL_COUNCILS = Math.max(0, Math.ceil(WF_MAX_SECONDS / WF_ROUND_SECONDS) - 1);
const MAX_MANUAL_CHOICES = 4 * WARFRONT_POWERUPS.size * WF_STACK_CAP;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Parse the only player-authored part of a Manual Warfront. Every opened
 * Council is explicit, including a no-spend round, and the prefix is always
 * consecutive from round one. */
export function parseWarfrontChoiceLog(value: unknown): WarfrontRoundChoice[] | null {
    if (!Array.isArray(value) || value.length > MAX_MANUAL_COUNCILS) return null;
    const parsed: WarfrontRoundChoice[] = [];
    let totalChoices = 0;
    for (let i = 0; i < value.length; i++) {
        const entry = value[i];
        if (!isRecord(entry) || entry.round !== i + 1 || !Array.isArray(entry.choices)) return null;
        totalChoices += entry.choices.length;
        if (totalChoices > MAX_MANUAL_CHOICES) return null;
        const choices = [] as WarfrontRoundChoice['choices'];
        for (const rawChoice of entry.choices) {
            if (!isRecord(rawChoice)
                || !Number.isInteger(rawChoice.petIndex)
                || Number(rawChoice.petIndex) < 0
                || Number(rawChoice.petIndex) > 3
                || typeof rawChoice.kind !== 'string'
                || !WARFRONT_POWERUPS.has(rawChoice.kind as WfPowerupKind)) return null;
            choices.push({ petIndex: Number(rawChoice.petIndex), kind: rawChoice.kind as WfPowerupKind });
        }
        const hasStance = Object.prototype.hasOwnProperty.call(entry, 'stance');
        if (hasStance && (typeof entry.stance !== 'string' || !WARFRONT_STANCES.has(entry.stance as WfStance))) return null;
        const hasCoachOrder = Object.prototype.hasOwnProperty.call(entry, 'coachOrder');
        if (hasCoachOrder && (typeof entry.coachOrder !== 'string' || !WARFRONT_COACH_ORDER_SET.has(entry.coachOrder))) return null;
        const hasBuildPackage = Object.prototype.hasOwnProperty.call(entry, 'buildPackage');
        if (hasBuildPackage && (typeof entry.buildPackage !== 'string' || !WARFRONT_BUILD_PACKAGE_SET.has(entry.buildPackage))) return null;
        const hasObjectiveTechnique = Object.prototype.hasOwnProperty.call(entry, 'objectiveTechnique');
        if (hasObjectiveTechnique && (typeof entry.objectiveTechnique !== 'string' || !WARFRONT_OBJECTIVE_TECHNIQUE_SET.has(entry.objectiveTechnique))) return null;
        const hasCounterstrike = Object.prototype.hasOwnProperty.call(entry, 'counterstrike');
        if (hasCounterstrike && (typeof entry.counterstrike !== 'string' || !WARFRONT_COUNTERSTRIKE_SET.has(entry.counterstrike))) return null;
        parsed.push({
            round: i + 1,
            choices,
            ...(hasStance ? { stance: entry.stance as WfStance } : {}),
            ...(hasCoachOrder ? { coachOrder: entry.coachOrder as WfCoachOrder } : {}),
            ...(hasBuildPackage ? { buildPackage: entry.buildPackage as WfBuildPackage } : {}),
            ...(hasObjectiveTechnique ? { objectiveTechnique: entry.objectiveTechnique as WfObjectiveTechnique } : {}),
            ...(hasCounterstrike ? { counterstrike: entry.counterstrike as WfCounterstrike } : {}),
        });
    }
    return parsed;
}

export function warfrontChoiceLogsEqual(a: readonly WarfrontRoundChoice[], b: readonly WarfrontRoundChoice[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((entry, i) => {
        const other = b[i];
        return entry.round === other.round
            && entry.stance === other.stance
            && entry.coachOrder === other.coachOrder
            && entry.buildPackage === other.buildPackage
            && entry.objectiveTechnique === other.objectiveTechnique
            && entry.counterstrike === other.counterstrike
            && entry.choices.length === other.choices.length
            && entry.choices.every((choice, j) => choice.petIndex === other.choices[j].petIndex && choice.kind === other.choices[j].kind);
    });
}

function isSealedWarfrontSlot(value: unknown): value is SealedWarfrontSlot {
    if (!isRecord(value) || !WARFRONT_ROLES.has(String(value.role ?? '')) || !isRecord(value.pet)) return false;
    const pet = value.pet;
    if (typeof pet.id !== 'string' || !pet.id || pet.id.length > 128) return false;
    if (typeof pet.name !== 'string' || !pet.name || pet.name.length > 80) return false;
    if (typeof pet.rarity !== 'string' || !WARFRONT_RARITIES.has(pet.rarity)) return false;
    for (const stat of ['hp', 'attack', 'defense', 'speed'] as const) {
        if (Object.prototype.hasOwnProperty.call(pet, stat) && (typeof pet[stat] !== 'number' || !Number.isFinite(pet[stat]))) return false;
    }
    if (Object.prototype.hasOwnProperty.call(pet, 'element')
        && (typeof pet.element !== 'string' || !WARFRONT_ELEMENTS.has(pet.element))) return false;
    if (Object.prototype.hasOwnProperty.call(pet, 'templateId')
        && (typeof pet.templateId !== 'string' || !pet.templateId || pet.templateId.length > 128)) return false;
    if (Object.prototype.hasOwnProperty.call(pet, 'paletteVariantId')
        && (typeof pet.paletteVariantId !== 'string' || !pet.paletteVariantId || pet.paletteVariantId.length > 128)) return false;
    return !Object.prototype.hasOwnProperty.call(pet, 'evolutionStage')
        || pet.evolutionStage === 0 || pet.evolutionStage === 1 || pet.evolutionStage === 2;
}

const REQUIRED_AUTHORED_OPTION_KEYS = [
    'redStance', 'redDoctrine',
    'blueDeployment', 'redDeployment',
    'blueBuildPackage', 'redBuildPackage',
    'redObjectiveTechnique',
    'redCounterstrike',
    'blueRoundDecisions', 'redRoundDecisions',
] as const;
const ALL_AUTHORED_OPTION_KEYS = [
    ...REQUIRED_AUTHORED_OPTION_KEYS,
    'blueObjectiveTechnique', 'blueCounterstrike',
] as const;

function coachOrderPlan(value: unknown): WfCoachOrder | null {
    if (!Array.isArray(value) || value.length !== MAX_MANUAL_COUNCILS) return null;
    let order: WfCoachOrder | null = null;
    for (const raw of value) {
        if (!isRecord(raw)
            || Object.keys(raw).length !== 1
            || typeof raw.coachOrder !== 'string'
            || !WARFRONT_COACH_ORDER_SET.has(raw.coachOrder)) return null;
        if (order !== null && order !== raw.coachOrder) return null;
        order = raw.coachOrder as WfCoachOrder;
    }
    return order;
}

export function isSealedManualWarfront(value: unknown): value is SealedManualWarfront {
    if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.seed)) return false;
    if (!Array.isArray(value.blue) || !Array.isArray(value.red)
        || value.blue.length < 1 || value.blue.length > 4
        || value.red.length !== value.blue.length
        || !value.blue.every(isSealedWarfrontSlot) || !value.red.every(isSealedWarfrontSlot)) return false;
    const opts = value.options;
    const legacyValid = isRecord(opts)
        && opts.bluePolicy === 'off'
        && opts.redPolicy === 'balanced'
        && opts.adaptStances === true
        && typeof opts.blueStance === 'string'
        && WARFRONT_STANCES.has(opts.blueStance as WfStance)
        && typeof opts.blueDoctrine === 'string'
        && WARFRONT_DOCTRINES.has(opts.blueDoctrine);
    if (!legacyValid || !isRecord(opts)) return false;

    // Honor one-hour legacy tokens that contain none of the additive authored
    // fields. A partially present snapshot is never treated as legacy.
    const authoredKeysPresent = ALL_AUTHORED_OPTION_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(opts, key));
    if (authoredKeysPresent.length === 0) return true;
    if (!REQUIRED_AUTHORED_OPTION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(opts, key))) return false;

    const blueOrder = coachOrderPlan(opts.blueRoundDecisions);
    const redOrder = coachOrderPlan(opts.redRoundDecisions);
    const expectedRed = warfrontAiAuthoredSetup(warfrontAiWarband(Number(value.seed)).id);
    const redDeployment = opts.redDeployment;
    return typeof opts.redStance === 'string' && opts.redStance === 'balanced'
        && typeof opts.redDoctrine === 'string' && opts.redDoctrine === scoutedWarfrontDoctrine(Number(value.seed), 'red')
        && isWarfrontOpeningDeployment(opts.blueDeployment)
        && isWarfrontOpeningDeployment(redDeployment)
        && expectedRed.deployment.every((lane, index) => redDeployment[index] === lane)
        && typeof opts.blueBuildPackage === 'string' && WARFRONT_BUILD_PACKAGE_SET.has(opts.blueBuildPackage)
        && opts.redBuildPackage === expectedRed.buildPackage
        && (!Object.prototype.hasOwnProperty.call(opts, 'blueObjectiveTechnique')
            || (typeof opts.blueObjectiveTechnique === 'string' && WARFRONT_OBJECTIVE_TECHNIQUE_SET.has(opts.blueObjectiveTechnique)))
        && opts.redObjectiveTechnique === expectedRed.objectiveTechnique
        && (!Object.prototype.hasOwnProperty.call(opts, 'blueCounterstrike')
            || (typeof opts.blueCounterstrike === 'string' && WARFRONT_COUNTERSTRIKE_SET.has(opts.blueCounterstrike)))
        && opts.redCounterstrike === expectedRed.counterstrike
        && blueOrder !== null
        && redOrder === expectedRed.coachOrder;
}

/** Validate a committed prefix against the sealed simulation. This rejects a
 * skipped boundary and any purchase the engine would drop as unaffordable or
 * capped before it becomes the token's irreversible path. */
export function isEffectiveManualWarfrontPrefix(value: unknown, rawChoices: unknown): boolean {
    if (!isSealedManualWarfront(value)) return false;
    const choices = parseWarfrontChoiceLog(rawChoices);
    if (!choices) return false;
    const authoredTechniqueChoices = choices.filter((entry) => entry.objectiveTechnique !== undefined).length;
    const authoredCounterstrikeChoices = choices.filter((entry) => entry.counterstrike !== undefined).length;
    if (authoredTechniqueChoices > (value.options.blueObjectiveTechnique === undefined ? 1 : 0)
        || authoredCounterstrikeChoices > (value.options.blueCounterstrike === undefined ? 1 : 0)) return false;
    const toSlots = (slots: SealedWarfrontSlot[]) => slots.map((slot) => ({
        role: slot.role,
        pet: slot.pet as unknown as Pet,
    }));
    // Prefix validation inspects only round progression and the effective
    // choice log. Avoid constructing replay frames for every Council commit.
    const ctl = startWarfrontMatch(toSlots(value.blue), toSlots(value.red), value.seed, {
        ...value.options,
        captureSnapshots: false,
    });
    for (const entry of choices) {
        if (ctl.done) return false;
        if (ctl.round === 0) ctl.advanceRound();
        if (ctl.done || ctl.round !== entry.round) return false;
        ctl.advanceRound(entry);
    }
    return warfrontChoiceLogsEqual(ctl.result.choiceLog ?? [], choices);
}

export type ManualWarfrontAttempt = {
    version: 1;
    playerName: string;
    battleToken: string;
    reportKey: string;
    choices: WarfrontRoundChoice[];
    createdAt: number;
    updatedAt: number;
    finalizedAt?: number;
};

export type ManualWarfrontAttemptResult =
    | { ok: true; attempt: ManualWarfrontAttempt; idempotent: boolean }
    | { ok: false; code: 'invalid-choice' | 'path-conflict' | 'round-order' | 'path-finalized' };

export function manualWarfrontAttemptKey(playerName: string, battleToken: string): string {
    return `pet:warfront-council:${playerName}:${battleToken}`;
}

export function parseManualWarfrontAttempt(
    value: unknown,
    playerName: string,
    battleToken: string,
    reportKey: string,
): ManualWarfrontAttempt | null {
    if (!isRecord(value)) return null;
    const choices = parseWarfrontChoiceLog(value.choices);
    if (value.version !== 1
        || value.playerName !== playerName
        || value.battleToken !== battleToken
        || value.reportKey !== reportKey
        || !choices
        || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
        || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)
        || (value.finalizedAt !== undefined && (typeof value.finalizedAt !== 'number' || !Number.isFinite(value.finalizedAt)))) return null;
    return {
        version: 1,
        playerName,
        battleToken,
        reportKey,
        choices,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        ...(value.finalizedAt !== undefined ? { finalizedAt: value.finalizedAt } : {}),
    };
}

/** Pure append-only state transition, exported for focused exploit tests. */
export function appendManualWarfrontRound(
    current: ManualWarfrontAttempt | null,
    binding: { playerName: string; battleToken: string; reportKey: string },
    sealed: SealedManualWarfront,
    rawEntry: unknown,
    now = Date.now(),
): ManualWarfrontAttemptResult {
    const candidate = parseWarfrontChoiceLog([rawEntry]);
    // parseWarfrontChoiceLog([round > 1]) is intentionally strict, so parse the
    // entry as the next member of the already committed prefix instead.
    const combinedRaw = [...(current?.choices ?? []), rawEntry];
    const combined = parseWarfrontChoiceLog(combinedRaw);
    const entryRecord = isRecord(rawEntry) ? rawEntry : null;
    const requestedRound = Number(entryRecord?.round);

    if (current) {
        if (current.playerName !== binding.playerName || current.battleToken !== binding.battleToken || current.reportKey !== binding.reportKey) {
            return { ok: false, code: 'path-conflict' };
        }
        if (requestedRound >= 1 && requestedRound <= current.choices.length) {
            const parsedExistingShape = parseWarfrontChoiceLog(current.choices.map((entry, index) => index === requestedRound - 1 ? rawEntry : entry));
            if (parsedExistingShape && warfrontChoiceLogsEqual(parsedExistingShape, current.choices)) {
                return { ok: true, attempt: current, idempotent: true };
            }
            return { ok: false, code: 'path-conflict' };
        }
        if (current.finalizedAt !== undefined) return { ok: false, code: 'path-finalized' };
        if (requestedRound !== current.choices.length + 1) return { ok: false, code: 'round-order' };
    } else if (requestedRound !== 1) {
        return { ok: false, code: 'round-order' };
    }
    if ((!current && !candidate) || !combined || !isEffectiveManualWarfrontPrefix(sealed, combined)) {
        return { ok: false, code: 'invalid-choice' };
    }
    const attempt: ManualWarfrontAttempt = {
        version: 1,
        ...binding,
        choices: combined,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
    };
    return { ok: true, attempt, idempotent: false };
}

export function finalizeManualWarfrontAttemptState(
    current: ManualWarfrontAttempt | null,
    binding: { playerName: string; battleToken: string; reportKey: string },
    rawChoices: unknown,
    now = Date.now(),
): ManualWarfrontAttemptResult {
    const choices = parseWarfrontChoiceLog(rawChoices);
    if (!choices) return { ok: false, code: 'invalid-choice' };
    if (!current) {
        // A match that ends before its first Council legitimately has an empty
        // path. Any non-empty path must have been committed round-by-round.
        if (choices.length) return { ok: false, code: 'path-conflict' };
        return {
            ok: true,
            idempotent: false,
            attempt: { version: 1, ...binding, choices, createdAt: now, updatedAt: now, finalizedAt: now },
        };
    }
    if (current.playerName !== binding.playerName || current.battleToken !== binding.battleToken || current.reportKey !== binding.reportKey
        || !warfrontChoiceLogsEqual(current.choices, choices)) return { ok: false, code: 'path-conflict' };
    if (current.finalizedAt !== undefined) return { ok: true, attempt: current, idempotent: true };
    return { ok: true, idempotent: false, attempt: { ...current, updatedAt: now, finalizedAt: now } };
}

export async function readManualWarfrontAttempt(
    playerName: string,
    battleToken: string,
    reportKey: string,
): Promise<ManualWarfrontAttempt | null> {
    return parseManualWarfrontAttempt(
        await kv.get<unknown>(manualWarfrontAttemptKey(playerName, battleToken)),
        playerName,
        battleToken,
        reportKey,
    );
}

export async function commitManualWarfrontRound(
    binding: { playerName: string; battleToken: string; reportKey: string },
    sealed: SealedManualWarfront,
    rawEntry: unknown,
    ttlSeconds: number,
): Promise<ManualWarfrontAttemptResult> {
    const key = manualWarfrontAttemptKey(binding.playerName, binding.battleToken);
    return withKvLock(key, async () => {
        const rawCurrent = await kv.get<unknown>(key);
        const current = rawCurrent === null ? null : parseManualWarfrontAttempt(rawCurrent, binding.playerName, binding.battleToken, binding.reportKey);
        if (rawCurrent !== null && !current) return { ok: false, code: 'path-conflict' } as const;
        const result = appendManualWarfrontRound(current, binding, sealed, rawEntry);
        if (result.ok && !result.idempotent) await kv.set(key, result.attempt, { ex: ttlSeconds });
        return result;
    }, { failClosed: true });
}

export async function finalizeManualWarfrontAttempt(
    binding: { playerName: string; battleToken: string; reportKey: string },
    rawChoices: unknown,
    ttlSeconds: number,
): Promise<ManualWarfrontAttemptResult> {
    const key = manualWarfrontAttemptKey(binding.playerName, binding.battleToken);
    return withKvLock(key, async () => {
        const rawCurrent = await kv.get<unknown>(key);
        const current = rawCurrent === null ? null : parseManualWarfrontAttempt(rawCurrent, binding.playerName, binding.battleToken, binding.reportKey);
        if (rawCurrent !== null && !current) return { ok: false, code: 'path-conflict' } as const;
        const result = finalizeManualWarfrontAttemptState(current, binding, rawChoices);
        if (result.ok && !result.idempotent) await kv.set(key, result.attempt, { ex: ttlSeconds });
        return result;
    }, { failClosed: true });
}

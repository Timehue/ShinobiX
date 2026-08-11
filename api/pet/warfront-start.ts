import { safeLogValue } from '../_safe-log.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import {
    runWarfrontMatch,
    scoutedWarfrontDoctrine,
    WARFRONT_TPS,
    WF_MAX_SECONDS,
    WF_ROUND_SECONDS,
    type WarfrontRoundChoice,
    type WarfrontRoundDecision,
    type WfBuildPackage,
    type WfCoachOrder,
    type WfCounterstrike,
    type WfObjectiveTechnique,
    type WfOpeningDeployment,
} from '../_pet-sim/pet-warfront-sim.js';
import { derivePetRole } from '../_pet-sim/pet-roles.js';
import {
    buildProgressionWarfrontAiTeam,
    normalizeWarfrontPlayerTeam,
    warfrontAiWarband,
    WARFRONT_AI_WARBAND_VERSION,
    type WarfrontAiWarbandScout,
    type WarfrontDifficultySeal,
} from './_warfront-ai.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { petCombatBusyReason } from './_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import { readManualWarfrontAttempt } from './_warfront-council.js';
import {
    DEFAULT_WARFRONT_AUTHORED_SETUP,
    WARFRONT_BUILD_PACKAGES,
    WARFRONT_COACH_ORDERS,
    WARFRONT_COUNTERSTRIKES,
    WARFRONT_OBJECTIVE_TECHNIQUES,
    isWarfrontOpeningDeployment,
    parseWarfrontAuthoredSetup,
    warfrontAiAuthoredSetup,
    warfrontAuthoredSetupsEqual,
    type WarfrontAuthoredSetup,
} from './_warfront-setup.js';
import { WARFRONT_COACH_COMPLETION_DAILY_CAP, warfrontBaseRyoReward } from './_warfront-reward.js';

/*
 * /api/pet/warfront-start — POST only.
 *
 * Mints the single-use reward token for a Hollow Warfront vs-AI match, the
 * SERVER-AUTHORITATIVE way: the server RE-RUNS the exact deterministic match the
 * browser is about to render (same player pets, canonical AI red team, seed,
 * buy policy, stance) and seals the match into a `pet:battle-token` — the SAME
 * token family battle-result.ts already redeems for 1v1/2v2. Auto-Council
 * matches seal the server-computed winner. Manual-Council matches instead seal
 * an immutable, minimal combat snapshot; battle-result replays the submitted
 * Council choices against that snapshot before it can pay anything.
 *
 * Determinism: the Warfront sim meets the cross-engine contract (no
 * sin/cos/atan2/hypot — see its header), and warfront-parity.test.ts proves the
 * server re-sim === the client render (streamed) === this full-auto run, so a
 * Firefox player's win reproduces here byte-for-byte. Manual play is still a
 * pure function of the sealed inputs plus its bounded choice log; PvP/co-op
 * continue to use a locked automatic policy.
 */

// A regulation match lasts ten minutes, but Manual Councils, accessibility
// pauses, reconnects, and the post-match result animation can extend the wall
// clock substantially. Keep the authorization long enough for a real session;
// it remains single-use and bound to the exact sealed report.
export const WARFRONT_TOKEN_TTL_SECONDS = 60 * 60;
export const WARFRONT_PREPARE_TTL_SECONDS = 24 * 60 * 60;
// An abandoned authorization must not become an instant seed reroll. Auto
// matches hold this lease for their exact sealed simulation duration; Manual
// Council matches conservatively hold it for the ten-minute regulation clock.
// A short grace keeps the lease alive while the result request is in flight.
export const WARFRONT_ACTIVE_GRACE_SECONDS = 60;
export const WARFRONT_START_RESERVATION_SECONDS = 120;
type WfBuyPolicy = 'off' | 'balanced' | 'offense' | 'defense';
type WfStance = 'balanced' | 'siege' | 'jungle' | 'headhunt' | 'turtle';
type WfDoctrine = 'none' | 'vanguard' | 'bulwark' | 'zealot' | 'warden-pact';
type ArenaRole = 'defender' | 'tracker' | 'assassin' | 'sage';
interface ArenaSlot { pet: Pet; role: ArenaRole }

/** Combat fields plus the minimal authoritative visual identity needed to
 * render the same owned pet the server simulated. Images, jutsu, loadouts, and
 * all other save state remain outside the short-lived token. */
export interface SealedWarfrontPet {
    id: string;
    name: string;
    rarity: Pet['rarity'];
    level?: number;
    hp?: number;
    attack?: number;
    defense?: number;
    speed?: number;
    element?: Pet['element'];
    templateId?: string;
    evolutionStage?: 0 | 1 | 2;
    paletteVariantId?: string;
}
export interface SealedWarfrontSlot { pet: SealedWarfrontPet; role: ArenaRole }
export type WarfrontTacticalSetup = Omit<WarfrontAuthoredSetup, 'objectiveTechnique' | 'counterstrike'> & {
    stance: WfStance;
    doctrine: WfDoctrine;
    buyPolicy: WfBuyPolicy;
    /** Coach Council may deliberately defer these one-shot calls until a live
     * Council. Auto play must always seal concrete values before seed reveal. */
    objectiveTechnique?: WfObjectiveTechnique;
    counterstrike?: WfCounterstrike;
};
export interface SealedManualWarfront {
    version: 1;
    seed: number;
    blue: SealedWarfrontSlot[];
    red: SealedWarfrontSlot[];
    options: {
        bluePolicy: 'off';
        redPolicy: 'balanced';
        blueStance: WfStance;
        blueDoctrine: WfDoctrine;
        /** Optional only for one-hour backwards compatibility with an
         * authorization minted immediately before authored playbooks shipped.
         * Every newly minted snapshot seals every field below. */
        redStance?: WfStance;
        redDoctrine?: WfDoctrine;
        blueDeployment?: WfOpeningDeployment;
        redDeployment?: WfOpeningDeployment;
        blueBuildPackage?: WfBuildPackage;
        redBuildPackage?: WfBuildPackage;
        blueObjectiveTechnique?: WfObjectiveTechnique;
        redObjectiveTechnique?: WfObjectiveTechnique;
        blueCounterstrike?: WfCounterstrike;
        redCounterstrike?: WfCounterstrike;
        blueRoundDecisions?: readonly WarfrontRoundDecision[];
        redRoundDecisions?: readonly WarfrontRoundDecision[];
        adaptStances: true;
    };
}

export type WarfrontStartAuthorization = {
    playerName: string;
    reportKey: string;
    seed: number;
    prepareToken: string;
    fingerprint: string;
    token: string;
    manual: boolean;
    outcome?: 'win' | 'loss' | 'draw';
    blue: SealedWarfrontSlot[];
    red: SealedWarfrontSlot[];
    warband: WarfrontAiWarbandScout;
    difficulty: WarfrontDifficultySeal;
    setup: WarfrontTacticalSetup;
    redSetup: WarfrontTacticalSetup;
    createdAt: number;
    notBefore: number;
};

export type PreparedWarfrontGrant = {
    version: 1;
    playerName: string;
    seed: number;
    prepareToken: string;
    createdAt: number;
};

export type PreparedWarfrontResponse = {
    ok: true;
    prepareToken: string;
    scoutedDoctrineOptions: readonly [CombatDoctrine, CombatDoctrine];
    scoutedWarband: WarfrontAiWarbandScout;
    preparedAt: number;
};

type CombatDoctrine = 'vanguard' | 'bulwark' | 'zealot';
const COMBAT_DOCTRINES: readonly CombatDoctrine[] = ['vanguard', 'bulwark', 'zealot'];
const WARFRONT_STANCES = new Set<WfStance>(['balanced', 'siege', 'jungle', 'headhunt', 'turtle']);
const WARFRONT_DOCTRINES = new Set<WfDoctrine>(['none', 'vanguard', 'bulwark', 'zealot', 'warden-pact']);
const WARFRONT_BUY_POLICIES = new Set<WfBuyPolicy>(['off', 'balanced', 'offense', 'defense']);
const WARFRONT_BUILD_PACKAGE_SET = new Set<string>(WARFRONT_BUILD_PACKAGES);
const WARFRONT_COACH_ORDER_SET = new Set<string>(WARFRONT_COACH_ORDERS);
const WARFRONT_OBJECTIVE_TECHNIQUE_SET = new Set<string>(WARFRONT_OBJECTIVE_TECHNIQUES);
const WARFRONT_COUNTERSTRIKE_SET = new Set<string>(WARFRONT_COUNTERSTRIKES);
export const WARFRONT_COUNCIL_ROUNDS = Math.max(0, Math.ceil(WF_MAX_SECONDS / WF_ROUND_SECONDS) - 1);

function hasValidAuthoredSetup(value: unknown): value is WarfrontTacticalSetup {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const raw = value as Record<string, unknown>;
    const required = ['deployment', 'buildPackage', 'coachOrder']
        .every((key) => Object.prototype.hasOwnProperty.call(raw, key))
        && isWarfrontOpeningDeployment(raw.deployment)
        && typeof raw.buildPackage === 'string' && WARFRONT_BUILD_PACKAGE_SET.has(raw.buildPackage)
        && typeof raw.coachOrder === 'string' && WARFRONT_COACH_ORDER_SET.has(raw.coachOrder);
    if (!required) return false;
    if (Object.prototype.hasOwnProperty.call(raw, 'objectiveTechnique')
        && (typeof raw.objectiveTechnique !== 'string' || !WARFRONT_OBJECTIVE_TECHNIQUE_SET.has(raw.objectiveTechnique))) return false;
    if (Object.prototype.hasOwnProperty.call(raw, 'counterstrike')
        && (typeof raw.counterstrike !== 'string' || !WARFRONT_COUNTERSTRIKE_SET.has(raw.counterstrike))) return false;
    return true;
}

function isWarfrontTacticalSetup(value: unknown, allowManual = true): value is WarfrontTacticalSetup {
    if (!hasValidAuthoredSetup(value)) return false;
    const setup = value as WarfrontTacticalSetup;
    return WARFRONT_STANCES.has(setup.stance)
        && WARFRONT_DOCTRINES.has(setup.doctrine)
        && WARFRONT_BUY_POLICIES.has(setup.buyPolicy)
        && (allowManual || setup.buyPolicy !== 'off')
        && (setup.buyPolicy === 'off'
            || (setup.objectiveTechnique !== undefined && setup.counterstrike !== undefined));
}

export function parseStartAuthoredSetup(value: Record<string, unknown>, buyPolicy: WfBuyPolicy): Omit<WarfrontTacticalSetup, 'stance' | 'doctrine' | 'buyPolicy'> | null {
    const hasTechnique = Object.prototype.hasOwnProperty.call(value, 'objectiveTechnique');
    const hasCounterstrike = Object.prototype.hasOwnProperty.call(value, 'counterstrike');
    if (buyPolicy !== 'off'
        && (!hasTechnique || value.objectiveTechnique === null || !hasCounterstrike || value.counterstrike === null)) return null;

    const deferredTechnique = buyPolicy === 'off' && !hasTechnique;
    const deferredCounterstrike = buyPolicy === 'off' && !hasCounterstrike;
    const parsed = parseWarfrontAuthoredSetup({
        ...value,
        ...(deferredTechnique ? { objectiveTechnique: DEFAULT_WARFRONT_AUTHORED_SETUP.objectiveTechnique } : {}),
        ...(deferredCounterstrike ? { counterstrike: DEFAULT_WARFRONT_AUTHORED_SETUP.counterstrike } : {}),
    });
    if (!parsed) return null;
    return {
        deployment: parsed.deployment,
        buildPackage: parsed.buildPackage,
        coachOrder: parsed.coachOrder,
        ...(deferredTechnique ? {} : { objectiveTechnique: parsed.objectiveTechnique }),
        ...(deferredCounterstrike ? {} : { counterstrike: parsed.counterstrike }),
    };
}

export function warfrontAiTacticalSetup(seed: number): WarfrontTacticalSetup {
    const warband = warfrontAiWarband(seed);
    return {
        stance: 'balanced',
        doctrine: scoutedWarfrontDoctrine(seed, 'red'),
        buyPolicy: 'balanced',
        ...warfrontAiAuthoredSetup(warband.id),
    };
}

export function sealedWarfrontCoachRounds(coachOrder: WfCoachOrder): readonly WarfrontRoundDecision[] {
    return Array.from({ length: WARFRONT_COUNCIL_ROUNDS }, () => ({ coachOrder }));
}

export function warfrontAuthorizationFingerprint(
    prepareToken: string,
    playerPetIds: readonly string[],
    setup: WarfrontTacticalSetup,
    warband: WarfrontAiWarbandScout,
    redSetup: WarfrontTacticalSetup,
): string {
    const requestFingerprint = JSON.stringify({ prepareToken, playerPetIds, ...setup });
    return JSON.stringify({
        requestFingerprint,
        warbandVersion: warband.version,
        warbandId: warband.id,
        redSetup,
    });
}

/** Two-item partial intel: the actual seed-sealed doctrine plus one seeded
 * decoy, in seeded order. Neither position identifies the real doctrine. */
export function scoutedWarfrontDoctrineOptions(seed: number): readonly [CombatDoctrine, CombatDoctrine] {
    const actual = scoutedWarfrontDoctrine(seed, 'red') as CombatDoctrine;
    const actualIndex = COMBAT_DOCTRINES.indexOf(actual);
    const mixed = Math.imul(((seed >>> 0) ^ 0x85ebca6b) >>> 0, 2246822519) >>> 0;
    const decoy = COMBAT_DOCTRINES[(actualIndex + 1 + (mixed & 1)) % COMBAT_DOCTRINES.length];
    return (mixed & 2) === 0 ? [actual, decoy] : [decoy, actual];
}

/** The scouting preview deliberately omits the raw seed. The player receives
 * two unmarked doctrine candidates, but cannot identify the exact declaration
 * or search battlefield outcomes before squad and setup are committed. */
export function preparedWarfrontResponse(grant: PreparedWarfrontGrant): PreparedWarfrontResponse {
    return {
        ok: true,
        prepareToken: grant.prepareToken,
        scoutedDoctrineOptions: scoutedWarfrontDoctrineOptions(grant.seed),
        scoutedWarband: warfrontAiWarband(grant.seed),
        preparedAt: grant.createdAt,
    };
}

export function authorizedWarfrontResponse(
    grant: WarfrontStartAuthorization,
    committedChoices: WarfrontRoundChoice[],
    idempotentReplay: boolean,
) {
    const opponentLevel = clampLevel(grant.red.reduce((sum, slot) => sum + Number(slot.pet.level ?? 1), 0) / Math.max(1, grant.red.length));
    const baseAmount = warfrontBaseRyoReward(opponentLevel);
    return {
        ok: true,
        token: grant.token,
        seed: grant.seed,
        reportKey: grant.reportKey,
        manual: grant.manual,
        // A revealed Manual seed cannot authorize outcome, win-counter, or
        // first-win rewards. Its separately disclosed Coach-completion reward
        // is outcome-independent, server-fixed, replay-verified, and daily
        // capped; Auto remains the competitive outcome-reward path.
        rewardEligible: !grant.manual,
        rewardModel: grant.manual
            ? {
                kind: 'coach-completion' as const,
                currency: 'ryo' as const,
                amount: baseAmount,
                dailyCap: WARFRONT_COACH_COMPLETION_DAILY_CAP,
                outcomeIndependent: true,
            }
            : {
                kind: 'competitive-outcome' as const,
                currency: 'ryo' as const,
                amount: baseAmount,
                dailyCap: 100,
                outcomeIndependent: false,
            },
        blue: grant.blue,
        red: grant.red,
        warband: grant.warband,
        difficulty: grant.difficulty,
        // Exact doctrine reveal is safe only after squad/setup commitment.
        scoutedDoctrine: scoutedWarfrontDoctrine(grant.seed, 'red'),
        setup: grant.setup,
        redSetup: grant.redSetup,
        committedChoices,
        ...(grant.outcome ? { outcome: grant.outcome } : {}),
        idempotentReplay,
    };
}

async function authorizationResponse(grant: WarfrontStartAuthorization, idempotentReplay: boolean) {
    const committedChoices: WarfrontRoundChoice[] = grant.manual
        ? (await readManualWarfrontAttempt(grant.playerName, grant.token, grant.reportKey))?.choices ?? []
        : [];
    return authorizedWarfrontResponse(grant, committedChoices, idempotentReplay);
}

function parsePreparedWarfrontGrant(value: unknown, playerName: string): PreparedWarfrontGrant | null {
    let decoded: unknown = value;
    if (typeof value === 'string') {
        try { decoded = JSON.parse(value); } catch { return null; }
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    const grant = decoded as Partial<PreparedWarfrontGrant>;
    const valid = grant.version === 1
        && grant.playerName === playerName
        && Number.isSafeInteger(grant.seed)
        && Number(grant.seed) > 0
        && Number(grant.seed) <= 0x7fffffff
        && typeof grant.prepareToken === 'string'
        && /^[A-Za-z0-9]{16,128}$/.test(grant.prepareToken)
        && typeof grant.createdAt === 'number'
        && Number.isFinite(grant.createdAt);
    return valid ? grant as PreparedWarfrontGrant : null;
}

function freshServerWarfrontSeed(): number {
    return (randomBytes(4).readUInt32BE(0) & 0x7fffffff) || 1;
}

function warfrontActiveKey(playerName: string): string {
    return `pet:warfront-active:${playerName}`;
}

function activeLeaseSeconds(notBefore: number, now = Date.now()): number {
    const remaining = Math.max(0, Math.ceil((notBefore - now) / 1000));
    return Math.max(WARFRONT_ACTIVE_GRACE_SECONDS, remaining + WARFRONT_ACTIVE_GRACE_SECONDS);
}

async function recoverAuthorizationActiveLease(
    activeKey: string,
    authorization: WarfrontStartAuthorization,
): Promise<'active' | 'conflict' | 'spent'> {
    const recovered = await withKvLock(activeKey, async () => {
        const current = await kv.get<unknown>(activeKey);
        if (current === authorization.token) return true;
        if (current !== null) return false;
        return kv.set(activeKey, authorization.token, {
            nx: true,
            ex: activeLeaseSeconds(authorization.notBefore),
        });
    }, { failClosed: true });
    if (!recovered) return 'conflict';

    // Settlement may delete the battle token between the first lookup and the
    // lease recovery. Re-check after recovery, and never return a dead token or
    // strand a newly recreated active key for it.
    const liveToken = await kv.get<{ playerName?: string; reportKey?: string }>(
        `pet:battle-token:${authorization.playerName}:${authorization.token}`,
    );
    if (liveToken?.playerName === authorization.playerName && liveToken.reportKey === authorization.reportKey) {
        return 'active';
    }
    await kv.delIfEqual(activeKey, authorization.token);
    return 'spent';
}

export function isRecoverableWarfrontAuthorization(
    value: unknown,
    playerName: string,
    prepareToken: string,
): value is WarfrontStartAuthorization {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const authorization = value as Partial<WarfrontStartAuthorization>;
    const expectedWarband = warfrontAiWarband(Number(authorization.seed));
    const expectedRedSetup = warfrontAiTacticalSetup(Number(authorization.seed));
    const expectedRedAuthored = parseWarfrontAuthoredSetup(expectedRedSetup);
    const setupAuthored = parseWarfrontAuthoredSetup(authorization.setup);
    const redAuthored = parseWarfrontAuthoredSetup(authorization.redSetup);
    const bluePetIds = Array.isArray(authorization.blue)
        ? authorization.blue.map((slot) => String((slot as SealedWarfrontSlot)?.pet?.id ?? ''))
        : [];
    const scaledOpponent = Array.isArray(authorization.blue)
        ? buildProgressionWarfrontAiTeam(
            4,
            Number(authorization.seed),
            authorization.blue.map((slot) => slot.pet as unknown as Pet),
        )
        : null;
    const expectedRedSlots = scaledOpponent ? autoRole(scaledOpponent.pets).map(sealWarfrontSlot) : [];
    const expectedFingerprint = authorization.setup && typeof authorization.setup === 'object'
        ? warfrontAuthorizationFingerprint(prepareToken, bluePetIds, authorization.setup, expectedWarband, expectedRedSetup)
        : '';
    return authorization.playerName === playerName
        && authorization.prepareToken === prepareToken
        && authorization.fingerprint === expectedFingerprint
        && typeof authorization.reportKey === 'string'
        && authorization.reportKey === `${authorization.seed}:tactical`
        && Number.isSafeInteger(authorization.seed)
        && Number(authorization.seed) > 0
        && Number(authorization.seed) <= 0x7fffffff
        && typeof authorization.token === 'string'
        && /^[A-Za-z0-9]+$/.test(authorization.token)
        && Array.isArray(authorization.blue) && authorization.blue.length === 4
        && bluePetIds.every(Boolean) && new Set(bluePetIds).size === 4
        && Array.isArray(authorization.red) && authorization.red.length === 4
        && JSON.stringify(authorization.red) === JSON.stringify(expectedRedSlots)
        && authorization.warband?.version === WARFRONT_AI_WARBAND_VERSION
        && ['siege', 'sustain', 'ambush'].includes(String(authorization.warband?.id))
        && authorization.warband.id === expectedWarband.id
        && authorization.warband.name === expectedWarband.name
        && authorization.warband.style === expectedWarband.style
        && Boolean(scaledOpponent)
        && JSON.stringify(authorization.difficulty) === JSON.stringify(scaledOpponent?.difficulty)
        && isWarfrontTacticalSetup(authorization.setup)
        && (authorization.setup.buyPolicy === 'off'
            || setupAuthored !== null)
        && isWarfrontTacticalSetup(authorization.redSetup, false)
        && redAuthored !== null
        && expectedRedAuthored !== null
        && warfrontAuthoredSetupsEqual(redAuthored, expectedRedAuthored)
        && authorization.redSetup.stance === expectedRedSetup.stance
        && authorization.redSetup.doctrine === expectedRedSetup.doctrine
        && authorization.redSetup.buyPolicy === expectedRedSetup.buyPolicy
        && typeof authorization.manual === 'boolean'
        && authorization.manual === (authorization.setup.buyPolicy === 'off')
        && (authorization.manual
            ? authorization.outcome === undefined
            : authorization.outcome === 'win' || authorization.outcome === 'loss' || authorization.outcome === 'draw')
        && typeof authorization.createdAt === 'number' && Number.isFinite(authorization.createdAt)
        && typeof authorization.notBefore === 'number' && Number.isFinite(authorization.notBefore)
        && authorization.notBefore >= authorization.createdAt
        && authorization.notBefore <= authorization.createdAt + WF_MAX_SECONDS * 1000;
}

async function consumePreparedWarfrontGrant(
    preparedKey: string,
    playerName: string,
    seed: number,
    prepareToken: string,
): Promise<void> {
    await withKvLock(preparedKey, async () => {
        const current = parsePreparedWarfrontGrant(await kv.get<unknown>(preparedKey), playerName);
        if (current?.seed === seed && current.prepareToken === prepareToken) await kv.del(preparedKey);
    }, { failClosed: true });
}

const clampLevel = (n: number): number => Math.max(1, Math.min(100, Math.floor(Number.isFinite(n) ? n : 1)));
// Roles the client's way: the pet's own role, else derive it (id/name/element/rarity).
const autoRole = (pets: Pet[]): ArenaSlot[] => pets.map((pet) => ({ pet, role: (pet.role ?? derivePetRole(pet).role) as ArenaRole }));
const finiteStat = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const boundedIdentity = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().slice(0, 128);
    return normalized || undefined;
};
export function sealWarfrontSlot(slot: ArenaSlot): SealedWarfrontSlot {
    const element = ['Earth', 'Wind', 'Lightning', 'Fire', 'Water', 'None'].includes(String(slot.pet.element ?? ''))
        ? slot.pet.element
        : undefined;
    const rarity = ['standard', 'rare', 'legendary', 'mythic'].includes(String(slot.pet.rarity ?? ''))
        ? slot.pet.rarity
        : 'standard';
    const templateId = boundedIdentity(slot.pet.templateId);
    const paletteVariantId = boundedIdentity(slot.pet.paletteVariantId);
    const evolutionStage = slot.pet.evolutionStage === 0 || slot.pet.evolutionStage === 1 || slot.pet.evolutionStage === 2
        ? slot.pet.evolutionStage
        : undefined;
    return {
        role: slot.role,
        pet: {
            id: String(slot.pet.id ?? '').slice(0, 128),
            name: String(slot.pet.name ?? 'Pet').slice(0, 80),
            rarity,
            level: clampLevel(Number(slot.pet.level ?? 1)),
            hp: finiteStat(slot.pet.hp),
            attack: finiteStat(slot.pet.attack),
            defense: finiteStat(slot.pet.defense),
            speed: finiteStat(slot.pet.speed),
            ...(element ? { element } : {}),
            ...(templateId ? { templateId } : {}),
            ...(evolutionStage !== undefined ? { evolutionStage } : {}),
            ...(paletteVariantId ? { paletteVariantId } : {}),
        },
    };
}

export function chooseEligibleWarfrontPets(
    character: Record<string, unknown>,
    requestedIds: readonly string[],
    petsOverride?: unknown,
): Pet[] | null {
    const ids = [...new Set(requestedIds.filter(Boolean))];
    if (ids.length !== 4) return null;
    const eligible = activeCarriedPets<Pet>(character, petsOverride);
    const chosen = ids
        .map((id) => eligible.find((pet) => String(pet.id) === id))
        .filter((pet): pet is Pet => Boolean(pet));
    return chosen.length === 4 ? chosen : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const action = body.action === 'prepare' ? 'prepare' : 'start';

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only prepare or start your own matches.' });
        const startLimit = action === 'prepare' ? 8 : 6;
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `warfront-${action}`, startLimit, 60_000, identity.name, { strict: true }))) return;

        const preparedKey = `pet:warfront-prepared:${playerName}`;
        const activeKey = warfrontActiveKey(playerName);
        if (action === 'prepare') {
            // Reserve the same atomic active slot used by Start. Unlike an
            // advisory lock + GET, this NX marker cannot read through a stale
            // multi-process cache and leak a second searchable seed. A crashed
            // prepare request self-releases after the short grace window.
            const prepareLease = `prepare-${randomUUID().replace(/-/g, '')}`;
            const reserved = await kv.set(activeKey, prepareLease, {
                nx: true,
                ex: WARFRONT_ACTIVE_GRACE_SECONDS,
            });
            if (!reserved) {
                const heldLease = await kv.get<unknown>(activeKey);
                const cooldownMatch = typeof heldLease === 'string'
                    ? /^forfeit-cooldown:.*:(\d+)$/.exec(heldLease)
                    : null;
                const cooldownUntil = cooldownMatch ? Number(cooldownMatch[1]) : 0;
                if (Number.isFinite(cooldownUntil) && cooldownUntil > Date.now()) {
                    return res.status(409).json({
                        error: 'That forfeited Warfront remains sealed until its original regulation clock expires; a fresh scouting seed is not available yet.',
                        code: 'warfront-forfeit-cooldown',
                        activeMatch: true,
                        retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000)),
                    });
                }
                return res.status(409).json({
                    error: 'Your current Warfront contract must settle or finish its regulation lease before a new scouting report unlocks.',
                    code: 'warfront-match-active',
                    activeMatch: true,
                });
            }
            try {
                const prepared = await withKvLock(preparedKey, async () => {
                    const existingRaw = await kv.get<unknown>(preparedKey);
                    const existing = parsePreparedWarfrontGrant(existingRaw, playerName);
                    if (existing) return existing;
                    if (existingRaw !== null) await kv.del(preparedKey);

                    const grant: PreparedWarfrontGrant = {
                        version: 1,
                        playerName,
                        seed: freshServerWarfrontSeed(),
                        prepareToken: randomUUID().replace(/-/g, ''),
                        createdAt: Date.now(),
                    };
                    const claimed = await kv.set(preparedKey, JSON.stringify(grant), { nx: true, ex: WARFRONT_PREPARE_TTL_SECONDS });
                    if (claimed) return grant;
                    const winner = parsePreparedWarfrontGrant(await kv.get<unknown>(preparedKey), playerName);
                    if (!winner) throw new Error('Could not prepare a Warfront scouting contract.');
                    return winner;
                }, { failClosed: true });
                const released = await kv.delIfEqual(activeKey, prepareLease);
                if (!released) {
                    return res.status(409).json({
                        error: 'A Warfront became active while the scouting report was being prepared. Retry after it settles.',
                        code: 'warfront-match-active',
                        activeMatch: true,
                    });
                }
                return res.status(200).json(preparedWarfrontResponse(prepared));
            } catch (error) {
                await kv.delIfEqual(activeKey, prepareLease).catch(() => false);
                throw error;
            }
        }

        const prepareTokenRaw = typeof body.prepareToken === 'string' ? body.prepareToken.trim() : '';
        const prepareToken = /^[A-Za-z0-9]{16,128}$/.test(prepareTokenRaw) ? prepareTokenRaw : '';
        const playerPetIds: string[] = Array.isArray(body.playerPetIds) ? body.playerPetIds.map((v: unknown) => String(v)).slice(0, 4) : [];
        const stanceRaw = String(body.stance ?? 'balanced');
        const stance: WfStance = (['balanced', 'siege', 'jungle', 'headhunt', 'turtle'].includes(stanceRaw) ? stanceRaw : 'balanced') as WfStance;
        const doctrineRaw = String(body.doctrine ?? 'none');
        const doctrine: WfDoctrine = (['vanguard', 'bulwark', 'zealot', 'warden-pact'].includes(doctrineRaw) ? doctrineRaw : 'none') as WfDoctrine;
        const policyRaw = String(body.buyPolicy ?? 'balanced');
        const buyPolicy: WfBuyPolicy = (policyRaw === 'off' || policyRaw === 'offense' || policyRaw === 'defense') ? policyRaw : 'balanced';
        const authoredSetup = parseStartAuthoredSetup(body as Record<string, unknown>, buyPolicy);

        if (!prepareToken) return res.status(400).json({ error: 'A server-prepared Warfront scouting grant is required.' });
        if (!authoredSetup) {
            return res.status(400).json({
                error: 'Warfront deployment and playbook choices must use the sealed tactical options.',
                code: 'warfront-setup-invalid',
            });
        }
        if (playerPetIds.length !== 4 || new Set(playerPetIds).size !== 4) {
            return res.status(400).json({ error: 'Hollow Warfront requires four distinct player pets.' });
        }

        // The prepared seed remains server-only until this exact ordered squad
        // and setup are committed. Recovery is keyed by the opaque grant, so a
        // lost response can recover without asking the client to retain a seed.
        const setup: WarfrontTacticalSetup = { stance, doctrine, buyPolicy, ...authoredSetup };
        const authorizationKey = `pet:warfront-authorization:${playerName}:${prepareToken}`;

        // Fast-path a lost start response before loading rosters or running the
        // full deterministic simulation. The original prepared grant is normally
        // consumed at mint, so the authorization must be consulted first.
        const existingAuthorization = await kv.get<unknown>(authorizationKey);
        if (existingAuthorization !== null) {
            if (!isRecoverableWarfrontAuthorization(existingAuthorization, playerName, prepareToken)) {
                return res.status(409).json({ error: 'This scouting grant is already bound to another authorization.' });
            }
            const activeStatus = await recoverAuthorizationActiveLease(activeKey, existingAuthorization);
            if (activeStatus === 'spent') {
                return res.status(409).json({ error: 'This Warfront authorization was already settled or expired. Prepare a new match.' });
            }
            if (activeStatus === 'conflict') {
                return res.status(409).json({
                    error: 'Another Warfront contract is already active for this player.',
                    code: 'warfront-match-active',
                });
            }
            await consumePreparedWarfrontGrant(preparedKey, playerName, existingAuthorization.seed, prepareToken);
            return res.status(200).json(await authorizationResponse(existingAuthorization, true));
        }

        // Reject missing, forged, or consumed scouting grants before the
        // expensive roster load and simulation. Mint revalidates it under lock.
        const preparedPreview = parsePreparedWarfrontGrant(await kv.get<unknown>(preparedKey), playerName);
        if (!preparedPreview
            || preparedPreview.prepareToken !== prepareToken) {
            return res.status(409).json({
                error: 'This scouting contract is missing, expired, or already consumed.',
                code: 'prepared-contract-invalid',
            });
        }
        const seed = preparedPreview.seed;
        const warband = warfrontAiWarband(seed);
        const redSetup = warfrontAiTacticalSetup(seed);
        const fingerprint = warfrontAuthorizationFingerprint(prepareToken, playerPetIds, setup, warband, redSetup);
        const reportKey = `${seed}:tactical`;
        // Recover the tiny crash/lease-expiry window where the token and active
        // slot were committed but the report authorization pointer was not. The
        // exact immutable grant is duplicated inside the unexposed token, so a
        // retry can finish the pointer instead of locking the player out or
        // simulating/minting a different match.
        const interrupted = await withKvLock(authorizationKey, async () => {
            const nowAuthorized = await kv.get<unknown>(authorizationKey);
            if (nowAuthorized !== null) {
                return isRecoverableWarfrontAuthorization(nowAuthorized, playerName, prepareToken)
                    ? { kind: 'grant', grant: nowAuthorized } as const
                    : { kind: 'conflict' } as const;
            }
            const activeToken = await kv.get<unknown>(activeKey);
            if (activeToken === null) return { kind: 'empty' } as const;
            if (typeof activeToken === 'string' && activeToken.startsWith('start-')) {
                return { kind: 'in-flight' } as const;
            }
            if (typeof activeToken !== 'string' || !/^[A-Za-z0-9]+$/.test(activeToken)) {
                return { kind: 'conflict' } as const;
            }
            const tokenData = await kv.get<{ warfrontAuthorization?: unknown }>(`pet:battle-token:${playerName}:${activeToken}`);
            const recoverable = tokenData?.warfrontAuthorization;
            if (!isRecoverableWarfrontAuthorization(recoverable, playerName, prepareToken)
                || recoverable.token !== activeToken) {
                return { kind: 'conflict' } as const;
            }
            const claimed = await kv.set(authorizationKey, recoverable, { nx: true, ex: WARFRONT_TOKEN_TTL_SECONDS });
            if (claimed) return { kind: 'grant', grant: recoverable } as const;
            const winner = await kv.get<unknown>(authorizationKey);
            return isRecoverableWarfrontAuthorization(winner, playerName, prepareToken)
                ? { kind: 'grant', grant: winner } as const
                : { kind: 'conflict' } as const;
        }, { failClosed: true });
        if (interrupted.kind === 'grant') {
            const activeStatus = await recoverAuthorizationActiveLease(activeKey, interrupted.grant);
            if (activeStatus === 'spent') {
                return res.status(409).json({ error: 'This Warfront authorization was already settled or expired. Prepare a new match.' });
            }
            if (activeStatus === 'conflict') {
                return res.status(409).json({ error: 'Another Warfront contract is already active for this player.', code: 'warfront-match-active' });
            }
            await consumePreparedWarfrontGrant(preparedKey, playerName, seed, prepareToken);
            return res.status(200).json(await authorizationResponse(interrupted.grant, true));
        }
        if (interrupted.kind === 'in-flight') {
            return res.status(425).json({
                error: 'This Warfront authorization is already being sealed.',
                code: 'warfront-start-in-flight',
                retryAfterMs: 500,
            });
        }
        if (interrupted.kind === 'conflict') {
            return res.status(409).json({
                error: 'Another Warfront contract is already active for this player.',
                code: 'warfront-match-active',
            });
        }

        // BLUE = the player's REAL pets (authoritative stats loaded from the save —
        // never client-supplied), in the picked order.
        const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const myChar = mySave?.character as Record<string, unknown> | undefined;
        const myPets = Array.isArray(myChar?.pets) ? myChar.pets : [];
        const bluePets = myChar ? chooseEligibleWarfrontPets(myChar, playerPetIds, myPets) : null;
        if (!bluePets) {
            return res.status(409).json({ error: 'Warfront needs 4 eligible pets. Base account: 3 carried. Shinobi Supporter: 5 carried.' });
        }
        if (bluePets.some((pet) => petCombatBusyReason(myChar ?? {}, pet as unknown as Record<string, unknown>))) {
            return res.status(409).json({ error: 'A selected pet is busy with breeding, training, or an expedition.' });
        }

        // Own the player-wide slot BEFORE opponent scaling or the deterministic
        // Auto simulation. A burst of identical start requests now performs one
        // expensive run; followers get a bounded retry rather than multiplying
        // CPU and racing later at token mint.
        const startReservation = `start-${randomUUID().replace(/-/g, '')}`;
        const startReserved = await kv.set(activeKey, startReservation, {
            nx: true,
            ex: WARFRONT_START_RESERVATION_SECONDS,
        });
        if (!startReserved) {
            const current = await kv.get<unknown>(activeKey);
            if (typeof current === 'string' && current.startsWith('start-')) {
                return res.status(425).json({
                    error: 'This Warfront authorization is already being sealed.',
                    code: 'warfront-start-in-flight',
                    retryAfterMs: 500,
                });
            }
            return res.status(409).json({
                error: 'Another Warfront contract is already active for this player.',
                code: 'warfront-match-active',
            });
        }

        try {

        // RED = one of three canonical, seed-sealed Warfront warbands. The
        // scouting tell was exposed before commitment; exact members were not.
        const normalizedBluePets = normalizeWarfrontPlayerTeam(bluePets);
        const scaledOpponent = buildProgressionWarfrontAiTeam(normalizedBluePets.length, seed, normalizedBluePets);
        const redPets = scaledOpponent.pets;
        const difficulty = scaledOpponent.difficulty;

        const blueSlots = autoRole(normalizedBluePets);
        const redSlots = autoRole(redPets);
        const sealedBlue = blueSlots.map(sealWarfrontSlot);
        const sealedRed = redSlots.map(sealWarfrontSlot);
        // Auto-Council can be resolved immediately. Manual-Council cannot: seal
        // the exact combat inputs now, then replay its effective choices when
        // the one-use token is redeemed.
        let authoritativeOutcome: 'win' | 'loss' | 'draw' | undefined;
        let manualWarfront: SealedManualWarfront | undefined;
        let sealedMatchDurationMs = WF_MAX_SECONDS * 1000;
        const blueRoundDecisions = sealedWarfrontCoachRounds(setup.coachOrder);
        const redRoundDecisions = sealedWarfrontCoachRounds(redSetup.coachOrder);
        if (buyPolicy === 'off') {
            manualWarfront = {
                version: 1,
                seed,
                blue: sealedBlue,
                red: sealedRed,
                options: {
                    bluePolicy: 'off',
                    redPolicy: 'balanced',
                    blueStance: setup.stance,
                    redStance: redSetup.stance,
                    blueDoctrine: setup.doctrine,
                    redDoctrine: redSetup.doctrine,
                    blueDeployment: setup.deployment,
                    redDeployment: redSetup.deployment,
                    blueBuildPackage: setup.buildPackage,
                    redBuildPackage: redSetup.buildPackage,
                    redObjectiveTechnique: redSetup.objectiveTechnique,
                    redCounterstrike: redSetup.counterstrike,
                    ...(setup.objectiveTechnique !== undefined ? { blueObjectiveTechnique: setup.objectiveTechnique } : {}),
                    ...(setup.counterstrike !== undefined ? { blueCounterstrike: setup.counterstrike } : {}),
                    blueRoundDecisions,
                    redRoundDecisions,
                    adaptStances: true,
                },
            };
        } else {
            // Token minting consumes only the authoritative verdict and elapsed
            // ticks. Presentation frames stay client-side, so retaining up to
            // Presentation keyframes are pure allocation overhead on the server.
            const result = runWarfrontMatch(
                blueSlots,
                redSlots,
                seed,
                buyPolicy,
                'balanced',
                undefined,
                { blue: setup.stance, red: redSetup.stance },
                { blue: setup.doctrine, red: redSetup.doctrine },
                {
                    captureSnapshots: false,
                    blueDeployment: setup.deployment,
                    redDeployment: redSetup.deployment,
                    blueBuildPackage: setup.buildPackage,
                    redBuildPackage: redSetup.buildPackage,
                    blueObjectiveTechnique: setup.objectiveTechnique,
                    redObjectiveTechnique: redSetup.objectiveTechnique,
                    blueCounterstrike: setup.counterstrike,
                    redCounterstrike: redSetup.counterstrike,
                    blueRoundDecisions,
                    redRoundDecisions,
                },
            );
            authoritativeOutcome = result.winner === 'blue' ? 'win' : result.winner === 'red' ? 'loss' : 'draw';
            sealedMatchDurationMs = Math.ceil(result.ticks * 1000 / WARFRONT_TPS);
        }

        // Reward magnitude sealed from the AI actually fought (avg level).
        const sealedOpponentLevel = clampLevel(redPets.reduce((s, p) => s + Number((p as { level?: unknown }).level ?? 1), 0) / Math.max(1, redPets.length));

        // A dropped mint response must not create a second live payout token.
        // Serialize by opaque prepared grant and always return its original,
        // immutable roster/setup. This also lets a refresh recover a custom team
        // after local picker defaults have changed, without minting a new match.
        const authorization = await withKvLock(authorizationKey, async () => {
            const existing = await kv.get<unknown>(authorizationKey);
            if (existing !== null) {
                if (!isRecoverableWarfrontAuthorization(existing, playerName, prepareToken)) {
                    return { error: 'This scouting grant is already bound to another authorization.' } as const;
                }
                const activeStatus = await recoverAuthorizationActiveLease(activeKey, existing);
                if (activeStatus === 'spent') {
                    return { error: 'This Warfront authorization was already settled or expired. Prepare a new match.' } as const;
                }
                if (activeStatus === 'conflict') {
                    return { error: 'Another Warfront contract is already active for this player.', code: 'warfront-match-active' } as const;
                }
                await consumePreparedWarfrontGrant(preparedKey, playerName, seed, prepareToken);
                return { grant: existing, idempotentReplay: true } as const;
            }

            const preparedRaw = await kv.get<unknown>(preparedKey);
            const prepared = parsePreparedWarfrontGrant(preparedRaw, playerName);
            if (!prepared
                || prepared.seed !== seed
                || prepared.prepareToken !== prepareToken) {
                return { error: 'This scouting contract is missing, expired, or already consumed.', code: 'prepared-contract-invalid' } as const;
            }

            const token = randomUUID().replace(/-/g, '');
            const createdAt = Date.now();
            const notBefore = createdAt + sealedMatchDurationMs;
            const grant: WarfrontStartAuthorization = {
                playerName,
                reportKey,
                seed,
                prepareToken,
                fingerprint,
                token,
                manual: buyPolicy === 'off',
                ...(authoritativeOutcome ? { outcome: authoritativeOutcome } : {}),
                blue: sealedBlue,
                red: sealedRed,
                warband,
                difficulty,
                setup,
                redSetup,
                createdAt,
                notBefore,
            };
            const tokenKey = `pet:battle-token:${playerName}:${token}`;
            const tokenStored = await kv.set(tokenKey, {
                playerName,
                opponentLevel: sealedOpponentLevel,
                reportKey,
                mode: 'warfront',
                createdAt,
                notBefore,
                rewardRyo: warfrontBaseRyoReward(sealedOpponentLevel),
                playerPetIds,
                warfrontAuthorization: grant,
                ...(authoritativeOutcome ? { authoritativeOutcome } : {}),
                ...(manualWarfront ? { manualWarfront } : {}),
            }, { nx: true, ex: WARFRONT_TOKEN_TTL_SECONDS });
            if (!tokenStored) throw new Error('Could not reserve a unique Warfront token.');

            // Claim the player-wide active lease before the report pointer is
            // exposed. The active-key NX and authorization-key NX are atomic
            // backstops for advisory-lock lease expiry and concurrent tabs.
            const claim = await withKvLock(activeKey, async () => {
                const current = await kv.get<unknown>(activeKey);
                if (current !== startReservation) return { active: false } as const;
                // The reservation is still ours and its TTL cannot expire under
                // a normal two-minute seal. Replace it directly; no empty-key
                // window exists for Prepare to steal between simulation/mint.
                await kv.set(activeKey, token, { ex: activeLeaseSeconds(notBefore, createdAt) });
                try {
                    const authorizationStored = await kv.set(authorizationKey, grant, { nx: true, ex: WARFRONT_TOKEN_TTL_SECONDS });
                    if (!authorizationStored) {
                        const winner = await kv.get<unknown>(authorizationKey);
                        if (isRecoverableWarfrontAuthorization(winner, playerName, prepareToken)
                            && winner.token === token) {
                            // A retry may have repaired the interrupted pointer
                            // from this token while our advisory lock lease was
                            // expired. That is success; never delete the token it
                            // just returned to the honest caller.
                            return { active: true, authorization: true, idempotentReplay: true } as const;
                        }
                        await kv.delIfEqual(activeKey, token).catch(() => false);
                        return { active: true, authorization: false } as const;
                    }
                    return { active: true, authorization: true, idempotentReplay: false } as const;
                } catch (error) {
                    await kv.delIfEqual(activeKey, token).catch(() => false);
                    throw error;
                }
            }, { failClosed: true }).catch(async (error) => {
                await kv.del(tokenKey).catch(() => undefined);
                throw error;
            });
            if (!claim.active) {
                await kv.del(tokenKey).catch(() => undefined);
                return { error: 'Another Warfront contract is already active for this player.', code: 'warfront-match-active' } as const;
            }
            if (!claim.authorization) {
                await kv.del(tokenKey).catch(() => undefined);
                const winner = await kv.get<unknown>(authorizationKey);
                if (!isRecoverableWarfrontAuthorization(winner, playerName, prepareToken)) {
                    return { error: 'This scouting grant is already bound to another authorization.' } as const;
                }
                return { error: 'This Warfront authorization is being finalized. Retry the same scouting contract.', code: 'authorization-race' } as const;
            }

            // Once the authorization pointer exists, never roll it back on a
            // prepared-key cleanup failure. A retry recovers this exact token.
            await consumePreparedWarfrontGrant(preparedKey, playerName, seed, prepareToken);
            return { grant, idempotentReplay: claim.idempotentReplay } as const;
        }, { failClosed: true });

        if ('error' in authorization) return res.status(409).json({ error: authorization.error, ...('code' in authorization ? { code: authorization.code } : {}) });
        const { grant } = authorization;
        return res.status(200).json(await authorizationResponse(grant, authorization.idempotentReplay));
        } finally {
            // No-op after successful promotion (the value is now the token).
            // On validation, lock, storage, or response-path failure this clears
            // only our own short reservation and lets an honest retry recover.
            await kv.delIfEqual(activeKey, startReservation).catch(() => false);
        }
    } catch (err) {
        console.error('[pet/warfront-start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

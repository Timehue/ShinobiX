import { createHash, randomUUID } from 'node:crypto';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { HOLLOW_GATE_PAID_AMBUSHES_PER_RUN, scaleHollowGateRyo } from './_gate-scale.js';
import { hollowShardDrop } from './_run-token.js';

export const HOLLOW_GATE_COMBAT_TTL_SECONDS = 24 * 60 * 60;
export const HOLLOW_GATE_MAX_COMBATS_PER_FLOOR = 16;

export type HollowGateCombatKind = 'battle' | 'elite' | 'ambush' | 'beast' | 'boss';

export const HOLLOW_GATE_PET_AUTHORITY_VERSION = 1 as const;
export type HollowGatePetEngine = 'cinematic' | 'showdown';
/** The most pets one Hollow Gate pet duel fields: a Showdown 3v3. */
export const HOLLOW_GATE_PET_MAX_FIELD = 3;

/**
 * The one child combat proof allowed to decide a Pet-mode encounter.
 *
 * New encounters are mounted on the Showdown engine, the same random 1v1, 2v2
 * or 3v3 Colosseum duel the road beasts fight. The proof id is chosen with the
 * parent binding, before a client can ask a pet endpoint to start work, and it
 * becomes the Showdown session id itself. `cinematic` remains only so a proof
 * issued before that cutover can finish and be recovered without becoming a
 * second authority.
 */
export interface HollowGatePetAuthority {
    version: typeof HOLLOW_GATE_PET_AUTHORITY_VERSION;
    engine: HollowGatePetEngine;
    proofId: string;
    claimedAt: number;
}

export interface HollowGateActiveEncounter {
    runId: string;
    nodeId: string;
    floor: number;
    kind: HollowGateCombatKind;
    enemyProfileId: string;
    createdAt: number;
}

export interface HollowGateCombatBinding extends HollowGateActiveEncounter {
    version: 1;
    combatMode: 'solo-pve' | 'pet';
    playerName: string;
    tokenDigest: string;
    status: 'active' | 'won' | 'lost';
    secondWindArmed?: boolean;
    petAssisted?: boolean;
    petAuthority?: HollowGatePetAuthority;
    settledAt?: number;
}

export interface HollowGatePetResultReceipt {
    consumablesCommitted?: true;
    version: typeof HOLLOW_GATE_PET_AUTHORITY_VERSION;
    engine: HollowGatePetEngine;
    proofId: string;
    playerName: string;
    runId: string;
    outcome: 'win' | 'loss' | 'draw';
    playerPetIds: string[];
    settledAt: number;
}

export type HollowGateCombatReward = {
    xp: number;
    ryo: number;
    auraDust: number;
    honorSeals: number;
    boneCharms: number;
    fateShards: number;
    hollowShards: number;
    fragments: number;
    veils: number;
};

export function hollowGateCombatBindingKey(runId: string): string {
    return `hg-combat-binding:${runId}`;
}

export function isHollowGateCombatKind(value: unknown): value is HollowGateCombatKind {
    return value === 'battle' || value === 'elite' || value === 'ambush' || value === 'beast' || value === 'boss';
}

export function normalizeHollowGateNodeId(value: unknown): string {
    const nodeId = String(value ?? '').slice(0, 96);
    return /^floor:\d{1,2}:(?:tile:\d{1,5}|ambush:[a-zA-Z0-9_-]{1,48})$/.test(nodeId) ? nodeId : '';
}

export function hollowGateEncounterKey(floor: number, kind: HollowGateCombatKind, nodeId: string): string {
    return `${Math.floor(floor)}:${kind}:${nodeId}`;
}

export function hollowGateEnemyProfileId(floor: number, kind: HollowGateCombatKind): string {
    return `hollow-hound-${kind}-f${Math.max(1, Math.floor(floor))}`;
}

export function createHollowGateCombatBinding(params: {
    playerName: string;
    token: string;
    floor: number;
    nodeId: string;
    kind: HollowGateCombatKind;
    now?: number;
    runId?: string;
    secondWindArmed?: boolean;
    petAssisted?: boolean;
    combatMode?: 'solo-pve' | 'pet';
}): HollowGateCombatBinding {
    const now = params.now ?? Date.now();
    const combatMode = params.combatMode ?? 'solo-pve';
    return {
        version: 1,
        combatMode,
        runId: params.runId ?? `hgcombat-${randomUUID().replace(/-/g, '')}`,
        playerName: params.playerName,
        tokenDigest: createHash('sha256').update(params.token).digest('hex'),
        floor: Math.max(1, Math.floor(params.floor)),
        nodeId: params.nodeId,
        kind: params.kind,
        enemyProfileId: hollowGateEnemyProfileId(params.floor, params.kind),
        createdAt: now,
        status: 'active',
        ...(params.secondWindArmed ? { secondWindArmed: true } : {}),
        ...(params.petAssisted ? { petAssisted: true } : {}),
        ...(combatMode === 'pet' ? {
            petAuthority: {
                version: HOLLOW_GATE_PET_AUTHORITY_VERSION,
                engine: 'showdown',
                proofId: randomUUID().replace(/-/g, ''),
                claimedAt: now,
            },
        } : {}),
    };
}

export function isHollowGatePetAuthority(value: unknown): value is HollowGatePetAuthority {
    if (!value || typeof value !== 'object') return false;
    const authority = value as Partial<HollowGatePetAuthority>;
    return authority.version === HOLLOW_GATE_PET_AUTHORITY_VERSION
        && (authority.engine === 'cinematic' || authority.engine === 'showdown')
        && typeof authority.proofId === 'string'
        && /^[A-Za-z0-9]{8,96}$/.test(authority.proofId)
        && Number.isFinite(authority.claimedAt);
}

export function parseHollowGatePetResultReceipt(value: unknown): HollowGatePetResultReceipt | null {
    if (!value || typeof value !== 'object') return null;
    const receipt = value as Partial<HollowGatePetResultReceipt>;
    if (receipt.version !== HOLLOW_GATE_PET_AUTHORITY_VERSION
        || (receipt.engine !== 'cinematic' && receipt.engine !== 'showdown')
        || typeof receipt.proofId !== 'string'
        || !/^[A-Za-z0-9]{8,96}$/.test(receipt.proofId)
        || typeof receipt.playerName !== 'string'
        || typeof receipt.runId !== 'string'
        || (receipt.outcome !== 'win' && receipt.outcome !== 'loss' && receipt.outcome !== 'draw')
        || !Array.isArray(receipt.playerPetIds)
        || !receipt.playerPetIds.every((id) => typeof id === 'string')
        || !Number.isFinite(receipt.settledAt)) {
        return null;
    }
    return {
        version: HOLLOW_GATE_PET_AUTHORITY_VERSION,
        engine: receipt.engine,
        proofId: receipt.proofId,
        playerName: receipt.playerName,
        runId: receipt.runId,
        outcome: receipt.outcome,
        playerPetIds: receipt.playerPetIds.slice(0, HOLLOW_GATE_PET_MAX_FIELD),
        ...(receipt.consumablesCommitted === true ? { consumablesCommitted: true } : {}),
        settledAt: Number(receipt.settledAt),
    };
}

export function hollowGatePetAuthorityMatches(
    binding: HollowGateCombatBinding | null | undefined,
    engine: HollowGatePetEngine,
    proofId: string,
): boolean {
    return binding?.combatMode === 'pet'
        && isHollowGatePetAuthority(binding.petAuthority)
        && binding.petAuthority.engine === engine
        && binding.petAuthority.proofId === proofId;
}

export function hollowGatePetReceiptMatchesBinding(
    binding: HollowGateCombatBinding | null | undefined,
    receipt: HollowGatePetResultReceipt | null | undefined,
    playerName: string,
): boolean {
    return Boolean(receipt
        && binding
        && hollowGatePetAuthorityMatches(binding, receipt.engine, receipt.proofId)
        && receipt.playerName === playerName
        && receipt.runId === binding.runId);
}

export type HollowGateCombatValidation =
    | { ok: true; binding: HollowGateCombatBinding }
    | { ok: false; reason: 'invalid-binding' | 'wrong-player' | 'wrong-run' | 'wrong-token' | 'binding-drift' | 'not-complete' | 'not-a-member' | 'already-settled' };

export function validateHollowGateSoloPveSession(params: {
    binding: HollowGateCombatBinding | null | undefined;
    session: SoloPveSession | null | undefined;
    activeEncounter: HollowGateActiveEncounter | null | undefined;
    playerName: string;
    token: string;
}): HollowGateCombatValidation {
    const { binding, session, activeEncounter, playerName, token } = params;
    if (!binding || binding.version !== 1 || binding.combatMode !== 'solo-pve' || !binding.runId || !binding.nodeId) {
        return { ok: false, reason: 'invalid-binding' };
    }
    if (binding.playerName !== playerName) return { ok: false, reason: 'wrong-player' };
    if (binding.tokenDigest !== createHash('sha256').update(token).digest('hex')) return { ok: false, reason: 'wrong-token' };
    if (!activeEncounter || activeEncounter.runId !== binding.runId) return { ok: false, reason: 'wrong-run' };
    if (activeEncounter.nodeId !== binding.nodeId
        || activeEncounter.floor !== binding.floor
        || activeEncounter.kind !== binding.kind
        || activeEncounter.enemyProfileId !== binding.enemyProfileId) {
        return { ok: false, reason: 'binding-drift' };
    }
    if (binding.settledAt || binding.status !== 'active') return { ok: false, reason: 'already-settled' };
    if (!session || session.sessionId !== binding.runId) return { ok: false, reason: 'wrong-run' };
    if (session.ownerSlug !== playerName) return { ok: false, reason: 'not-a-member' };
    if (session.encounter.kind !== 'hollow-gate'
        || session.encounter.bindingId !== binding.runId
        || session.encounter.sourceId !== binding.enemyProfileId
        || session.encounter.metadata?.floor !== binding.floor
        || session.encounter.metadata?.nodeId !== binding.nodeId
        || session.encounter.metadata?.combatKind !== binding.kind) {
        return { ok: false, reason: 'binding-drift' };
    }
    if (session.status !== 'done' || !session.terminalEvidence || !session.outcome) return { ok: false, reason: 'not-complete' };
    if (session.settlementState !== 'pending' || session.terminalEvidence.settlementState !== 'pending') return { ok: false, reason: 'already-settled' };
    return { ok: true, binding };
}

/** Validate a Hollow Hound pet duel against the same one-use run encounter
 * binding used by shinobi PvE. The pet result itself is sealed as a receipt by
 * the child duel (api/pet/showdown, or api/pet/battle-result for a cinematic
 * proof issued before the Showdown cutover) and consumed by combat-settle. */
export function validateHollowGatePetClaim(params: {
    binding: HollowGateCombatBinding | null | undefined;
    activeEncounter: HollowGateActiveEncounter | null | undefined;
    playerName: string;
    token: string;
}): HollowGateCombatValidation {
    const { binding, activeEncounter, playerName, token } = params;
    if (!binding || binding.version !== 1 || binding.combatMode !== 'pet' || !binding.runId || !binding.nodeId) {
        return { ok: false, reason: 'invalid-binding' };
    }
    if (binding.playerName !== playerName) return { ok: false, reason: 'wrong-player' };
    if (binding.tokenDigest !== createHash('sha256').update(token).digest('hex')) return { ok: false, reason: 'wrong-token' };
    if (!activeEncounter || activeEncounter.runId !== binding.runId) return { ok: false, reason: 'wrong-run' };
    if (activeEncounter.nodeId !== binding.nodeId
        || activeEncounter.floor !== binding.floor
        || activeEncounter.kind !== binding.kind
        || activeEncounter.enemyProfileId !== binding.enemyProfileId) {
        return { ok: false, reason: 'binding-drift' };
    }
    if (binding.settledAt || binding.status !== 'active') return { ok: false, reason: 'already-settled' };
    return { ok: true, binding };
}

export function settleHollowGateCombatBinding(binding: HollowGateCombatBinding, won: boolean, now = Date.now()): HollowGateCombatBinding {
    if (binding.status !== 'active' || binding.settledAt) return binding;
    return { ...binding, status: won ? 'won' : 'lost', settledAt: now };
}

export function hollowGatePostWinHp(maxHpRaw: unknown, survivingHpRaw: unknown, kind: HollowGateCombatKind): number {
    const maxHp = Math.max(1, Math.floor(Number(maxHpRaw) || 1));
    const survivingHp = Math.max(1, Math.floor(Number(survivingHpRaw) || 1));
    void kind;
    return Math.min(maxHp, survivingHp);
}

/** Every Gate and Rift boss pays the same Fate Shards (2026-10 rebalance #11). */
export const HOLLOW_GATE_BOSS_FATE_SHARDS = 3;
/** A hidden relic's Bone Charms (#16); it used to follow its honor roll. */
export const HOLLOW_GATE_RELIC_BONE_CHARMS = 2;

/** Boss Bone Charms by floor: 3, 3, 4, 4, 5, then 5 (#16). */
export function hollowGateBossBoneCharms(floorRaw: unknown): number {
    const floor = Math.max(1, Math.floor(Number(floorRaw) || 1));
    return Math.min(5, 3 + Math.floor((floor - 1) / 2));
}

export type HollowGateCombatRewardOptions = {
    /** The run's sealed ryo scale (hollowGateRunRyoScale); 1 when omitted. */
    ryoScale?: number;
    /** Threat ambushes this run has already won (hollowGatePaidAmbushCount). */
    paidAmbushes?: number;
};

export function hollowGateCombatReward(
    floorRaw: number,
    kind: HollowGateCombatKind,
    profession?: unknown,
    opts: HollowGateCombatRewardOptions = {},
): HollowGateCombatReward {
    const floor = Math.max(1, Math.min(9, Math.floor(Number(floorRaw) || 1)));
    const boss = kind === 'boss';
    const ambush = kind === 'ambush';
    const depthMult = boss ? 1 + Math.max(0, floor - 1) * 0.2 : 1;
    // Character XP is retired (leveling-without-xp map): the old xp line
    // (600 boss / 140 otherwise) folds into ryo at ~0.75:1. A threat ambush
    // pays a placed battle (#12); at 2.2x a battle it out-earned every loop.
    const baseRyo = boss ? 2400 + Math.floor(600 * 0.75) : 380 + Math.floor(140 * 0.75);
    const baseDust = boss ? 30 : ambush ? 10 : 5;
    // Past the per-run cap an ambush still pays its Aura Dust, so a won fight
    // never pays nothing.
    const unpaidAmbush = ambush
        && Math.max(0, Math.floor(Number(opts.paidAmbushes) || 0)) >= HOLLOW_GATE_PAID_AMBUSHES_PER_RUN;
    // Boss combat is only admitted on the sealed final floor, so it banks the
    // old final-clear package too. Honor, Bone Charms and Fate Shards are now
    // separate tables: they used to be derived from the honor roll, so cutting
    // honor (#28, x0.6: 15·depth + 45 = 57 + 3·floor) would have cut the rest.
    return {
        xp: 0, // retired — kept in the shape for old clients
        ryo: unpaidAmbush ? 0 : scaleHollowGateRyo(Math.floor(baseRyo * depthMult), opts.ryoScale ?? 1),
        auraDust: Math.floor(baseDust * depthMult),
        honorSeals: boss && profession === 'vanguard' ? 57 + 3 * floor : 0,
        boneCharms: boss ? hollowGateBossBoneCharms(floor) : 0,
        fateShards: boss ? HOLLOW_GATE_BOSS_FATE_SHARDS : 0,
        hollowShards: boss ? hollowShardDrop(floor, 'boss') : 0,
        fragments: boss ? 2 : 0,
        veils: boss ? 1 : 0,
    };
}

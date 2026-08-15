import { randomUUID } from 'node:crypto';
import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import { kv } from '../_storage.js';
import { parseNaturalWandererId, wandererDayBucketFromMs } from '../sector/_wanderer-encounter.js';
import { QUEST_BOOK, finalStageIndex, parseQuestbookSeal, questStage, stageTimerMs } from '../sector/_questbook.js';
import { STORY_RECKONINGS, ownedItemCount, parseStoryReckoningSeal } from '../sector/_story-reckoning.js';
import { findBounty, normalizeBoard } from '../pvp/_bounty.js';
import { huntMissionById } from './_mission-catalog.js';
import { savedCurrentSector } from './_mission-progress-receipt.js';
import { loadAiFightProfile, type AiFightProfile } from './_ai-fight-encounter.js';
import { MAX_WILD_SECTOR, sectorBiomeOf } from '../../shared/sector-geo.js';
import { activeVillageWarEnemiesOf } from '../world-state.js';
import {
    isWorldAiFightKind,
    type WorldAiFightActivePointer,
    type WorldAiFightContext,
    type WorldAiFightPendingChain,
    type WorldAiFightPendingOutcome,
    type WorldAiFightRequest,
} from '../../shared/world-ai-fight.js';

const MAX_WORLD_SECTOR = MAX_WILD_SECTOR;
/** World fights must remain resumable/payable for at least the active solo-PvE
 * session's 30-minute lifetime. Ordinary AI tokens keep their existing TTL. */
export const WORLD_AI_FIGHT_TTL_SECONDS = 30 * 60;
export const WORLD_AI_ACTIVE_TTL_SECONDS = WORLD_AI_FIGHT_TTL_SECONDS;
export const WORLD_AI_CHAIN_TTL_SECONDS = 60 * 60;
export const WORLD_AI_BOUNTY_COOLDOWN_SECONDS = 30 * 60;

export type WorldAiFightSpec = {
    profile: AiFightProfile;
    context: WorldAiFightContext;
    environment: { biome: string };
};

export type HuntTrailState = {
    missionId: string;
    runId: string;
    progress: number;
    quality: number;
    acceptedAt: number;
    receiptResetPending?: boolean;
    decisionId?: string;
    packPending?: boolean;
    packSettled?: boolean;
    targetDefeated?: boolean;
    targetProofId?: string;
    lastDecision?: {
        id: string;
        sector: number;
        stage: number;
        choiceId: string;
        ambush: boolean;
        progress: number;
        quality: number;
        nextSector: number;
        decidedAt?: number;
    };
};

export type WorldAiChainLease = {
    playerName: string;
    chainId: string;
    kind: 'wanderer-ambush' | 'hunt-pack';
    sourceId: string;
    sector: number;
    nextStage: number;
    inFlightStage: number | null;
    status: 'active' | 'closed';
    lastProofId?: string;
    createdAt: number;
};

type WorldAiChainStore = Pick<typeof kv, 'get' | 'set' | 'del'>;

type QuestBossSpec = {
    name: string;
    statBonus: number;
    levelOffset: number;
    loadoutId: 'bruiser' | 'boss' | 'burst' | 'defender';
    scalesWithRivalry?: boolean;
};

const QUEST_BOSSES: Record<string, QuestBossSpec> = {
    'ashbound-raider': { name: 'Ashbound Raider', statBonus: 2, levelOffset: 1, loadoutId: 'bruiser' },
    'bell-wraith': { name: 'The Bell-Wraith', statBonus: 6, levelOffset: 2, loadoutId: 'boss' },
    'bandit-captain-goro': { name: 'Bandit Captain Goro', statBonus: 3, levelOffset: 1, loadoutId: 'bruiser' },
    'puppeteer-itoguchi': { name: 'Itoguchi, the Hand', statBonus: 5, levelOffset: 2, loadoutId: 'boss' },
    'hunter-shirakawa': { name: 'Hunter-Nin Shirakawa', statBonus: 6, levelOffset: 2, loadoutId: 'burst' },
    // Kept in the authoritative catalog for completeness even though its
    // Quest Book stage is resolved by the pet-combat runtime, not World AI.
    'raiju-storm-hound': { name: 'Raijū, the Storm-Hound', statBonus: 7, levelOffset: 2, loadoutId: 'boss' },
    'house-kuroban': { name: 'Kuroban, the Bodyguard', statBonus: 4, levelOffset: 1, loadoutId: 'bruiser' },
    'ashbound-cinder': { name: 'Cinder', statBonus: 3, levelOffset: 0, loadoutId: 'burst' },
    'ashbound-slag': { name: 'Slag', statBonus: 4, levelOffset: 0, loadoutId: 'defender' },
    'kazan-ashbound': { name: 'Kazan the Ashbound', statBonus: 8, levelOffset: 3, loadoutId: 'boss', scalesWithRivalry: true },
};

const STORY_BOSSES: Record<string, QuestBossSpec> = {
    'story-reckoning-vanta-ninth': { name: 'Warden Sesk', statBonus: 4, levelOffset: 2, loadoutId: 'boss' },
    'story-reckoning-mori-working-copy': { name: 'Redactor Sella', statBonus: 4, levelOffset: 2, loadoutId: 'boss' },
    'story-reckoning-yura-exemption': { name: 'Meter-Warden Kree', statBonus: 4, levelOffset: 2, loadoutId: 'boss' },
    'story-reckoning-iro-sealed-shelf': { name: 'The Auction-Enforcer', statBonus: 4, levelOffset: 2, loadoutId: 'boss' },
    'story-reckoning-harrow-unbought': { name: 'Counterfeit Broker Vael', statBonus: 5, levelOffset: 3, loadoutId: 'boss' },
};

const ARCHETYPES = [
    { id: 'bandit', verb: 'attack', weight: .24, names: ['Kazan the Ashbound', 'Goro Two-Blades', 'Saito the Cinder', 'Renga of the Waste', 'Hibiki the Restless'] },
    { id: 'gambler', verb: 'gamble', weight: .18, names: ['Saji Two-Coins', 'Miraa the Sly', 'Old Tatsu', 'Kael of Sixes'] },
    { id: 'pilgrim', verb: 'gift', weight: .18, names: ['Brother Yuki', 'Brother Mibu', 'Wandering Aki', 'Old Doteki'] },
    { id: 'beast', verb: 'petDuel', weight: .16, names: ['Wild Emberlynx', 'Stray Oni-Hound', 'Feral Stormcrow', 'Rogue Guardhound', 'Lone Sparrowhawk'] },
    { id: 'sage', verb: 'quest', weight: .16, names: ['Old Hermit Roku', 'Hermit Kaede', 'The Grey Ascetic', 'Master Tobei', 'Sister Uzune'] },
    { id: 'merchant', verb: 'merchant', weight: .15, names: ['Miko of the Pack', 'Suri Lantern-Hands', 'Jin the Mule', 'Tama Roadstall'] },
    { id: 'medic', verb: 'medic', weight: .14, names: ['Nurse Enka', 'Field Medic Ren', 'Old Stitch', 'Sister Koma'] },
    { id: 'patrol', verb: 'patrol', weight: .14, names: ['Storm Road Patrol', 'Ashen Border Patrol', 'Frostfang Scout', 'Moonshadow Sentry'] },
    { id: 'tracker', verb: 'tracker', weight: .14, names: ['Ibo the Tracker', 'Kana Reed-Eyes', 'Old Pawprint', 'Shin of the Bent Grass'] },
] as const;

function finiteInt(value: unknown, min: number, max: number): number | null {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function cleanWorldAiFightRequest(raw: unknown): WorldAiFightRequest | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (!isWorldAiFightKind(value.kind)) return null;
    const sourceId = typeof value.sourceId === 'string' ? value.sourceId.trim().slice(0, 96) : '';
    const sector = finiteInt(value.sector, 1, MAX_WORLD_SECTOR);
    if (!sourceId || !/^[A-Za-z0-9:_-]+$/.test(sourceId) || sector == null) return null;
    const stage = value.stage == null ? undefined : finiteInt(value.stage, 0, 9);
    if (value.stage != null && stage == null) return null;
    const chainId = typeof value.chainId === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value.chainId) ? value.chainId : undefined;
    const decisionId = typeof value.decisionId === 'string' && /^[A-Za-z0-9:_-]{1,96}$/.test(value.decisionId) ? value.decisionId : undefined;
    const stageValue = stage ?? 0;
    const chained = value.kind === 'wanderer-ambush' || value.kind === 'hunt-pack';
    if (!chained && (stageValue !== 0 || chainId || decisionId)) return null;
    if (value.kind === 'wanderer-ambush' && decisionId) return null;
    if (value.kind === 'hunt-pack' && !decisionId) return null;
    if (chained && ((stageValue === 0 && chainId) || (stageValue > 0 && !chainId))) return null;
    return { kind: value.kind, sourceId, sector, ...(stage != null ? { stage } : {}), ...(chainId ? { chainId } : {}), ...(decisionId ? { decisionId } : {}) };
}

export function worldAiActiveKey(playerName: string): string {
    return `world-ai-active:${playerName}`;
}

export function cleanWorldAiActivePointer(raw: unknown): WorldAiFightActivePointer | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<WorldAiFightActivePointer>;
    if (typeof value.playerName !== 'string' || typeof value.token !== 'string' || typeof value.sessionId !== 'string') return null;
    const context = value.context;
    if (!context || !isWorldAiFightKind(context.kind) || typeof context.sourceId !== 'string') return null;
    const createdAt = Number(value.createdAt);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) return null;
    return value as WorldAiFightActivePointer;
}

export function newWorldChainId(): string {
    return randomUUID().replace(/-/g, '');
}

export function worldHuntKillEvidenceId(proofId: string): string {
    return `huntkill_${proofId}`.slice(0, 96);
}

export function cleanWorldAiPendingChain(raw: unknown): WorldAiFightPendingChain | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<WorldAiFightPendingChain>;
    const request = cleanWorldAiFightRequest(value.request);
    const createdAt = Number(value.createdAt);
    if (!request || (request.kind !== 'wanderer-ambush' && request.kind !== 'hunt-pack')
        || !request.chainId || (request.stage ?? 0) <= 0
        || typeof value.displayName !== 'string'
        || !Number.isSafeInteger(createdAt) || createdAt < 0) return null;
    return { request: request as WorldAiFightPendingChain['request'], displayName: value.displayName.slice(0, 80), createdAt };
}

export function cleanWorldAiPendingOutcome(raw: unknown): WorldAiFightPendingOutcome | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<WorldAiFightPendingOutcome>;
    const sector = finiteInt(value.sector, 1, MAX_WORLD_SECTOR);
    const createdAt = Number(value.createdAt);
    if (value.kind !== 'wanderer-ambush-reward'
        || value.sourceId !== 'wanderer-ambush'
        || typeof value.claimId !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(value.claimId)
        || typeof value.chainId !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value.chainId)
        || sector == null || !Number.isSafeInteger(createdAt) || createdAt < 0) return null;
    return { kind: value.kind, claimId: value.claimId, chainId: value.chainId, sourceId: value.sourceId, sector, createdAt };
}

export function sameWorldAiFightRequest(a: WorldAiFightRequest, b: WorldAiFightRequest): boolean {
    return a.kind === b.kind && a.sourceId === b.sourceId && a.sector === b.sector
        && (a.stage ?? 0) === (b.stage ?? 0)
        && (a.chainId ?? '') === (b.chainId ?? '')
        && (a.decisionId ?? '') === (b.decisionId ?? '');
}

export function worldContextWinProofExists(
    character: Record<string, unknown>,
    expected: { kind: 'questbook-boss' | 'story-reckoning'; sourceId: string; stage: number; sealVersion: string },
): boolean {
    return worldContextWinProofCount(character, expected) > 0;
}

export function worldContextWinProofCount(
    character: Record<string, unknown>,
    expected: { kind: 'questbook-boss' | 'story-reckoning'; sourceId: string; stage: number; sealVersion: string },
): number {
    const wins = Array.isArray(character.worldAiContextWins) ? character.worldAiContextWins as Array<Record<string, unknown>> : [];
    return wins.filter((entry) => entry.kind === expected.kind
        && entry.sourceId === expected.sourceId
        && Number(entry.stage) === expected.stage
        && String(entry.sealVersion ?? '') === expected.sealVersion
        && typeof entry.proofId === 'string' && entry.proofId.length > 0).length;
}

/** Advance the durable Quest Book / Story Reckoning seal from the exact sealed
 * world-boss proof. Called inside report-ai-fight's payout save mutation so a
 * tab crash cannot land the kill while losing the story transition. */
export function applyWorldAiDurableProgression(
    record: Record<string, unknown>,
    character: Record<string, unknown>,
    context: WorldAiFightContext,
    outcome: 'win' | 'loss' | 'draw' | 'forfeit' | 'unknown',
    now = Date.now(),
): { character: Record<string, unknown>; recordPatch?: Record<string, unknown> } {
    if (outcome !== 'win' || !context.sealVersion) return { character };

    if (context.kind === 'questbook-boss') {
        const seal = parseQuestbookSeal(record.activeQuestbookSeal);
        const entry = seal ? QUEST_BOOK[seal.id] : undefined;
        const stage = entry?.stages[seal?.stage ?? -1];
        if (!seal || seal.id !== context.sourceId || seal.stage !== context.stage
            || `${seal.id}:${seal.stage}:${seal.baseline}:${seal.at ?? 0}` !== context.sealVersion
            || worldContextWinProofCount(character, {
                kind: context.kind, sourceId: context.sourceId, stage: context.stage, sealVersion: context.sealVersion,
            }) < Math.max(1, Math.floor(Number(stage?.count) || 1))) return { character };
        if (!entry || !stage?.bossId || stage.metric !== 'totalAiKills' || seal.stage >= finalStageIndex(entry)) {
            return { character };
        }
        const nextIndex = seal.stage + 1;
        const nextStage = entry.stages[nextIndex]!;
        const timerMs = stageTimerMs(nextStage);
        const nextSeal = {
            id: seal.id,
            stage: nextIndex,
            baseline: Number(character[nextStage.metric]) || 0,
            at: now,
            ...(timerMs > 0 ? { deadline: now + timerMs } : {}),
            choices: { ...(seal.choices ?? {}) },
        };
        return {
            character: {
                ...character,
                activeQuestbook: {
                    id: nextSeal.id,
                    stage: nextSeal.stage,
                    baseline: nextSeal.baseline,
                    target: nextStage.count,
                    deadline: nextSeal.deadline ?? null,
                    choices: nextSeal.choices,
                },
            },
            recordPatch: { activeQuestbookSeal: nextSeal },
        };
    }

    if (context.kind === 'story-reckoning') {
        const seal = parseStoryReckoningSeal(record.activeStoryReckoningSeal);
        const def = STORY_RECKONINGS[context.sourceId];
        if (!seal || !def || seal.id !== context.sourceId || seal.stage !== 'task'
            || `${seal.id}:${seal.stage}:${seal.baseline}:${seal.at}` !== context.sealVersion
            || def.metric !== 'totalAiKills'
            || worldContextWinProofCount(character, {
                kind: context.kind, sourceId: context.sourceId, stage: context.stage, sealVersion: context.sealVersion,
            }) < Math.max(1, Math.floor(Number(def.target) || 1))) return { character };
        const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
        if (ownedItemCount(character, def.dropItemId) < 1) inventory.push(def.dropItemId);
        const nextSeal = { ...seal, stage: 'return' as const };
        return {
            character: {
                ...character,
                inventory,
                activeStoryReckoning: {
                    id: def.id,
                    stage: 'return',
                    metric: def.metric,
                    baseline: seal.baseline,
                    target: def.target,
                    dropItemId: def.dropItemId,
                },
            },
            recordPatch: { activeStoryReckoningSeal: nextSeal },
        };
    }
    return { character };
}

export function worldAiChainKey(playerName: string, kind: string, sourceId: string): string {
    return `world-ai-chain:${playerName}:${kind}:${sourceId}`;
}

export function worldAiBountyCooldownKey(playerName: string, sourceId: string): string {
    return `world-ai-bounty-cooldown:${playerName}:${sourceId}`;
}

function cleanWorldAiChainLease(raw: unknown): WorldAiChainLease | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as WorldAiChainLease;
    if ((value.kind !== 'wanderer-ambush' && value.kind !== 'hunt-pack') || typeof value.chainId !== 'string') return null;
    if (value.status !== 'active' && value.status !== 'closed') return null;
    return value;
}

/** Single-flight cursor: one token per wave and exact next-stage ordering. */
export async function reserveWorldAiChainStage(playerName: string, context: WorldAiFightContext, store: WorldAiChainStore = kv): Promise<void> {
    if ((context.kind !== 'wanderer-ambush' && context.kind !== 'hunt-pack') || !context.chainId) return;
    const key = worldAiChainKey(playerName, context.kind, context.sourceId);
    const existing = cleanWorldAiChainLease(await store.get(key));
    if (context.stage === 0) {
        if (existing?.status === 'active') throw new Error('world-chain-already-active');
        const lease: WorldAiChainLease = {
            playerName, chainId: context.chainId, kind: context.kind, sourceId: context.sourceId,
            sector: context.sector, nextStage: 0, inFlightStage: 0, status: 'active', createdAt: Date.now(),
        };
        await store.set(key, lease, { ex: WORLD_AI_CHAIN_TTL_SECONDS });
        return;
    }
    if (!existing || existing.status !== 'active'
        || existing.chainId !== context.chainId
        || existing.sector !== context.sector
        || existing.nextStage !== context.stage
        || existing.inFlightStage !== null) {
        throw new Error('world-chain-cursor-mismatch');
    }
    await store.set(key, { ...existing, inFlightStage: context.stage }, { ex: WORLD_AI_CHAIN_TTL_SECONDS });
}

export async function releaseWorldAiChainStage(playerName: string, context: WorldAiFightContext, store: WorldAiChainStore = kv): Promise<void> {
    if ((context.kind !== 'wanderer-ambush' && context.kind !== 'hunt-pack') || !context.chainId) return;
    const key = worldAiChainKey(playerName, context.kind, context.sourceId);
    const existing = cleanWorldAiChainLease(await store.get(key));
    if (!existing || existing.chainId !== context.chainId || existing.inFlightStage !== context.stage) return;
    if (context.stage === 0 && existing.nextStage === 0) await store.del(key);
    else await store.set(key, { ...existing, inFlightStage: null }, { ex: WORLD_AI_CHAIN_TTL_SECONDS });
}

/** Reconstruct/repair the ephemeral chain cursor from the durable save proof.
 * This covers a process death after report saved the prior win but before it
 * advanced the lease, and a lease TTL expiring while the player was offline. */
export async function repairWorldAiChainForPending(
    playerName: string,
    character: Record<string, unknown>,
    pending: WorldAiFightPendingChain,
    store: WorldAiChainStore = kv,
): Promise<void> {
    const request = pending.request;
    const stage = request.stage;
    if ((request.kind !== 'wanderer-ambush' && request.kind !== 'hunt-pack')
        || stage <= 0 || !chainWinExists(character, request, request.chainId, stage - 1)) {
        throw new Error('world-chain-proof-missing');
    }
    const key = worldAiChainKey(playerName, request.kind, request.sourceId);
    const existing = cleanWorldAiChainLease(await store.get(key));
    if (existing && (existing.chainId !== request.chainId || existing.kind !== request.kind
        || existing.sourceId !== request.sourceId || existing.sector !== request.sector)) {
        throw new Error('world-chain-cursor-mismatch');
    }
    const priorWin = (Array.isArray(character.worldAiChainWins) ? character.worldAiChainWins as Array<Record<string, unknown>> : [])
        .find((entry) => entry.chainId === request.chainId && Number(entry.stage) === stage - 1
            && entry.kind === request.kind && entry.sourceId === request.sourceId && Number(entry.sector) === request.sector);
    const repaired: WorldAiChainLease = {
        playerName,
        chainId: request.chainId,
        kind: request.kind,
        sourceId: request.sourceId,
        sector: request.sector,
        nextStage: stage,
        inFlightStage: null,
        status: 'active',
        lastProofId: typeof priorWin?.proofId === 'string' ? priorWin.proofId : existing?.lastProofId,
        createdAt: existing?.createdAt ?? pending.createdAt,
    };
    if (!existing || existing.status !== 'active' || existing.nextStage !== stage || existing.inFlightStage !== null) {
        await store.set(key, repaired, { ex: WORLD_AI_CHAIN_TTL_SECONDS });
    }
}

export async function settleWorldAiChainStage(
    playerName: string,
    context: WorldAiFightContext,
    outcome: 'win' | 'loss' | 'draw' | 'forfeit' | 'unknown',
    proofId: string,
    store: WorldAiChainStore = kv,
): Promise<void> {
    if ((context.kind !== 'wanderer-ambush' && context.kind !== 'hunt-pack') || !context.chainId) return;
    const key = worldAiChainKey(playerName, context.kind, context.sourceId);
    const existing = cleanWorldAiChainLease(await store.get(key));
    if (existing?.lastProofId === proofId) return;
    if (!existing || existing.status !== 'active' || existing.chainId !== context.chainId
        || existing.sector !== context.sector || existing.inFlightStage !== context.stage) {
        throw new Error('world-chain-settlement-cursor-mismatch');
    }
    const closed = outcome !== 'win' || context.finalStage === true;
    await store.set(key, {
        ...existing,
        status: closed ? 'closed' : 'active',
        nextStage: closed ? existing.nextStage : context.stage + 1,
        inFlightStage: null,
        lastProofId: proofId,
    }, { ex: WORLD_AI_CHAIN_TTL_SECONDS });
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seedFrom(sector: number, bucket: number): number {
    let h = 2166136261 >>> 0;
    for (const n of [sector | 0, bucket | 0]) {
        h ^= n & 0xff; h = Math.imul(h, 16777619);
        h ^= (n >>> 8) & 0xff; h = Math.imul(h, 16777619);
        h ^= (n >>> 16) & 0xff; h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Reconstruct one natural wanderer from the exact roster algorithm the World
 * Map uses. Other server entrypoints import this rather than accepting the
 * client's preview/name/verb as encounter authority. */
export function resolveNaturalWorldWanderer(sourceId: string, character: Record<string, unknown>, requestedSector: number, now: number) {
    const parsed = parseNaturalWandererId(sourceId);
    if (!parsed
        || !Number.isSafeInteger(parsed.sector) || parsed.sector < 1 || parsed.sector > MAX_WORLD_SECTOR
        || !Number.isSafeInteger(parsed.dayBucket) || parsed.dayBucket < 0
        || !Number.isSafeInteger(parsed.index) || parsed.index < 0 || parsed.index > 1
        || parsed.dayBucket !== wandererDayBucketFromMs(now)) return null;
    const moves = character.wandererMoves && typeof character.wandererMoves === 'object' && !Array.isArray(character.wandererMoves)
        ? character.wandererMoves as Record<string, unknown>
        : {};
    const moved = Math.floor(Number(moves[sourceId]));
    const visibleSector = Number.isFinite(moved) && moved >= 1 && moved <= MAX_WORLD_SECTOR ? moved : parsed.sector;
    if (visibleSector !== requestedSector) return null;
    const locked = new Set<string>();
    if (character.starterCardsClaimed !== true) locked.add('gamble');
    if (!Array.isArray(character.pets) || character.pets.length === 0) locked.add('petDuel');
    const pool = ARCHETYPES.filter((entry) => !locked.has(entry.verb));
    const rng = mulberry32(seedFrom(parsed.sector, parsed.dayBucket));
    const countRoll = rng();
    const count = countRoll < .52 ? 0 : countRoll < .93 ? 1 : 2;
    if (parsed.index >= count) return null;
    const used = new Set<number>();
    for (let index = 0; index < count; index += 1) {
        let x = rng() * pool.reduce((sum, entry) => sum + entry.weight, 0);
        let selected = pool[pool.length - 1]!;
        for (const entry of pool) { x -= entry.weight; if (x <= 0) { selected = entry; break; } }
        const interior = () => (2 + Math.floor(rng() * 8)) + (2 + Math.floor(rng() * 8)) * 12;
        let home = interior();
        let guard = 0;
        while (used.has(home) && guard++ < 8) home = interior();
        used.add(home);
        const legs = 2 + Math.floor(rng() * 2);
        for (let leg = 0; leg < legs; leg += 1) { rng(); rng(); }
        const name = selected.names[Math.floor(rng() * selected.names.length)]!;
        rng(); // level jitter
        rng(); // greeting
        if (index === parsed.index) return { ...selected, name };
    }
    return null;
}

function template(loadout: QuestBossSpec['loadoutId']): AiFightProfile {
    const id = loadout === 'boss' ? 'builtin-ai-central-champion'
        : loadout === 'defender' ? 'builtin-ai-mist-sentinel'
        : loadout === 'burst' ? 'builtin-ai-ember-duelist'
        : 'builtin-ai-rogue-ninja';
    const profile = builtinAiProfile(id);
    if (!profile) throw new Error(`Missing built-in AI template: ${id}`);
    return structuredClone(profile) as unknown as AiFightProfile;
}

function runtimeProfile(id: string, name: string, level: number, statBonus: number, loadout: QuestBossSpec['loadoutId']): AiFightProfile {
    const base = { ...template(loadout), id, name } as unknown as RelevelableProfile;
    return relevelAiProfile(base, level, statBonus) as unknown as AiFightProfile;
}

function playerLevel(character: Record<string, unknown>): number {
    return Math.max(1, Math.min(100, Math.floor(Number(character.level) || 1)));
}

function serverHuntTrail(character: Record<string, unknown>, missionId: string): HuntTrailState | null {
    const all = character.serverHuntTrails;
    if (!all || typeof all !== 'object' || Array.isArray(all)) return null;
    const value = (all as Record<string, unknown>)[missionId];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const state = value as HuntTrailState;
    return state.missionId === missionId && typeof state.runId === 'string' ? state : null;
}

function accepted(save: Record<string, unknown>, id: string): boolean {
    return Array.isArray(save.acceptedMissionIds) && save.acceptedMissionIds.some((value) => value === id);
}

function questChoiceBonus(id: string, choices?: Record<string, string>): number {
    const entry = QUEST_BOOK[id];
    if (!entry || !choices) return 0;
    let total = 0;
    for (const stage of entry.stages) {
        const choice = stage.choice?.options.find((option) => option.key === choices[stage.key]);
        total += Math.max(0, Math.floor(Number(choice?.bossStatBonus) || 0));
    }
    return total;
}

function chainWinExists(character: Record<string, unknown>, request: Pick<WorldAiFightRequest, 'kind' | 'sourceId' | 'sector'>, chainId: string, stage: number): boolean {
    const wins = Array.isArray(character.worldAiChainWins) ? character.worldAiChainWins : [];
    return wins.some((raw) => {
        const value = raw as Record<string, unknown>;
        return value?.chainId === chainId
            && Number(value.stage) === stage
            && value.kind === request.kind
            && value.sourceId === request.sourceId
            && Number(value.sector) === request.sector;
    });
}

function requireChain(request: WorldAiFightRequest, character: Record<string, unknown>, stages: number, generatedChainId: string) {
    const stage = request.stage ?? 0;
    if (stage < 0 || stage >= stages) throw new Error('world-chain-stage-invalid');
    if (stage === 0) {
        if (request.chainId) throw new Error('world-chain-unexpected-id');
        return { stage, chainId: generatedChainId };
    }
    if (!request.chainId || !chainWinExists(character, request, request.chainId, stage - 1)) throw new Error('world-chain-proof-missing');
    return { stage, chainId: request.chainId };
}

/** Reconstruct a reachable World Map encounter entirely from server-owned state. */
export async function buildWorldAiFightSpec(params: {
    playerName: string;
    request: WorldAiFightRequest;
    save: Record<string, unknown>;
    now?: number;
    generatedChainId?: string;
}): Promise<WorldAiFightSpec> {
    const now = params.now ?? Date.now();
    const request = params.request;
    const character = params.save.character as Record<string, unknown> | undefined;
    if (!character) throw new Error('world-save-missing');
    const settledSector = savedCurrentSector(params.save);
    if (!Number.isFinite(settledSector) || settledSector !== request.sector) throw new Error('world-sector-mismatch');
    const level = playerLevel(character);
    const environment = { biome: sectorBiomeOf(request.sector) };
    const generatedChainId = params.generatedChainId ?? newWorldChainId();

    if (request.kind === 'wanderer') {
        if (request.sourceId === 'nemesis') {
            const nemesis = character.wandererNemesis as Record<string, unknown> | undefined;
            if (!nemesis || typeof nemesis.name !== 'string') throw new Error('world-nemesis-missing');
            const tier = Math.max(1, Math.floor(Number(nemesis.tier) || 1));
            const name = nemesis.name.slice(0, 80);
            return { profile: runtimeProfile('world-wanderer-nemesis', name, level + tier, Math.min(12, tier * 2), 'bruiser'), environment,
                context: { kind: request.kind, sourceId: request.sourceId, sector: request.sector, stage: 0, displayName: name, finalStage: true } };
        }
        const wanderer = resolveNaturalWorldWanderer(request.sourceId, character, request.sector, now);
        if (!wanderer || wanderer.verb !== 'attack') throw new Error('world-wanderer-not-attackable');
        return { profile: runtimeProfile(`world-wanderer-${request.sourceId}`, wanderer.name, level + 1, 0, 'bruiser'), environment,
            context: { kind: request.kind, sourceId: request.sourceId, sector: request.sector, stage: 0, displayName: wanderer.name, finalStage: true } };
    }

    if (request.kind === 'patrol') {
        const wanderer = resolveNaturalWorldWanderer(request.sourceId, character, request.sector, now);
        if (!wanderer || wanderer.verb !== 'patrol') throw new Error('world-wanderer-not-patrol');
        const village = typeof character.village === 'string' ? character.village : '';
        const hostile = village ? (await activeVillageWarEnemiesOf(village)).length > 0 : false;
        const name = hostile ? `${wanderer.name} Captain` : wanderer.name;
        return { profile: runtimeProfile(`world-patrol-${request.sourceId}`, name, level + (hostile ? 3 : 1), hostile ? 7 : 3, hostile ? 'defender' : 'bruiser'), environment,
            context: { kind: request.kind, sourceId: request.sourceId, sector: request.sector, stage: 0, displayName: name, finalStage: true } };
    }

    if (request.kind === 'bounty-hunter') {
        const cooldown = await kv.get<{ until?: unknown }>(worldAiBountyCooldownKey(params.playerName, request.sourceId));
        if (Number(cooldown?.until) > now) throw new Error('world-bounty-cooldown');
        const board = normalizeBoard(await kv.get('pvp:bounties'));
        const bounty = findBounty(board, params.playerName);
        if (!bounty) throw new Error('world-bounty-missing');
        const slug = params.playerName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32) || 'target';
        const expectedId = `bounty-hunter-${slug}-${Math.floor(bounty.updatedAt || 0)}`;
        if (request.sourceId !== expectedId) throw new Error('world-bounty-stale');
        const bountyPressure = Math.min(12, Math.floor(bounty.amount / 75_000));
        return { profile: runtimeProfile(`world-bounty-${request.sourceId}`, 'Contract Hunter', level + 4 + bountyPressure, Math.min(18, 8 + Math.floor(bounty.amount / 100_000)), 'boss'), environment,
            context: { kind: request.kind, sourceId: request.sourceId, sector: request.sector, stage: 0, displayName: 'Contract Hunter', finalStage: true } };
    }

    if (request.kind === 'wanderer-ambush') {
        if (request.sourceId !== 'wanderer-ambush' || Math.floor(Number(character.robberStreak) || 0) < 5) throw new Error('world-ambush-ineligible');
        const chain = requireChain(request, character, 4, generatedChainId);
        const boss = chain.stage === 3;
        const name = boss ? 'Bandit Warlord' : 'Road Bandit';
        return { profile: runtimeProfile(`world-ambush-${chain.chainId}-${chain.stage}`, name, level + (boss ? 3 : chain.stage), boss ? 8 : 0, boss ? 'boss' : 'bruiser'), environment,
            context: { kind: request.kind, sourceId: request.sourceId, sector: request.sector, stage: chain.stage, chainId: chain.chainId, displayName: name, ...(boss ? { finalStage: true } : { nextStage: chain.stage + 1 }) } };
    }

    if (request.kind === 'hunt-pack' || request.kind === 'hunt-target') {
        const mission = huntMissionById(request.sourceId);
        if (!mission || !accepted(params.save, mission.id)) throw new Error('world-hunt-not-accepted');
        const trail = serverHuntTrail(character, mission.id);
        if (!trail) throw new Error('world-hunt-trail-missing');
        const required = Math.max(1, Math.floor(Number(mission.exploreCount) || 1));
        if (request.kind === 'hunt-pack') {
            if (!trail.packPending || trail.packSettled || !request.decisionId || request.decisionId !== trail.decisionId) throw new Error('world-hunt-pack-not-pending');
            if (!trail.lastDecision
                || trail.lastDecision.id !== trail.decisionId
                || trail.lastDecision.sector !== request.sector) throw new Error('world-hunt-pack-wrong-sector');
            const chain = requireChain(request, character, 3, generatedChainId);
            const beast = await loadAiFightProfile(mission.aiProfileId);
            if (!beast) throw new Error('world-hunt-profile-missing');
            const stem = String(beast.name ?? 'Beast').replace(/^the\s+/i, '').trim();
            const name = `${stem} ${['Yearling', 'Outrider', 'Packmate'][chain.stage]}`;
            return { profile: runtimeProfile(`world-hunt-pack-${mission.id}-${chain.chainId}-${chain.stage}`, name, level + chain.stage, 0, 'bruiser'), environment,
                context: { kind: request.kind, sourceId: mission.id, missionId: mission.id, huntRunId: trail.runId, decisionId: trail.decisionId, sector: request.sector, stage: chain.stage, chainId: chain.chainId, displayName: name, ...(chain.stage === 2 ? { finalStage: true } : { nextStage: chain.stage + 1 }) } };
        }
        if (Math.floor(trail.progress) < required - 1) throw new Error('world-hunt-trail-incomplete');
        if (trail.packPending && !trail.packSettled) throw new Error('world-hunt-pack-unsettled');
        if (trail.targetDefeated) throw new Error('world-hunt-target-already-defeated');
        if (request.sector !== mission.targetSector) throw new Error('world-hunt-wrong-sector');
        const base = await loadAiFightProfile(mission.aiProfileId);
        if (!base) throw new Error('world-hunt-profile-missing');
        const quality = Math.max(-3, Math.min(3, Math.floor(Number(trail.quality) || 0)));
        const opening = quality >= 2 ? 'cornered' : quality <= -2 ? 'enraged' : 'even';
        let profile = relevelAiProfile(base as unknown as RelevelableProfile, level, 0) as unknown as AiFightProfile;
        if (opening === 'cornered') profile = { ...profile, hp: Math.max(1, Math.floor(Number(profile.hp) * .8)), hpFloorExempt: true };
        if (opening === 'enraged') {
            const stats = { ...(profile.stats as Record<string, number>) };
            for (const key of Object.keys(stats)) stats[key] = Number(stats[key] ?? 0) + 6;
            profile = { ...profile, stats };
        }
        return { profile, environment, context: { kind: request.kind, sourceId: mission.id, missionId: mission.id, huntRunId: trail.runId, sector: request.sector, stage: 0, displayName: String(profile.name ?? mission.id), finalStage: true, huntQuality: quality, huntOpening: opening } };
    }

    if (request.kind === 'questbook-boss') {
        const seal = parseQuestbookSeal(params.save.activeQuestbookSeal);
        if (!seal || seal.id !== request.sourceId) throw new Error('world-questbook-seal-mismatch');
        const sealVersion = `${seal.id}:${seal.stage}:${seal.baseline}:${seal.at ?? 0}`;
        const stage = questStage(seal.id, seal.stage);
        const boss = stage?.bossId ? QUEST_BOSSES[stage.bossId] : null;
        if (!stage || stage.metric !== 'totalAiKills' || !stage.bossId || !boss) throw new Error('world-questbook-stage-not-fight');
        if (worldContextWinProofCount(character, {
            kind: 'questbook-boss', sourceId: seal.id, stage: seal.stage, sealVersion,
        }) >= Math.max(1, Math.floor(Number(stage.count) || 1))) throw new Error('world-context-already-won');
        let levelOffset = boss.levelOffset;
        let statBonus = boss.statBonus + questChoiceBonus(seal.id, seal.choices);
        let name = boss.name;
        const completedWaves = worldContextWinProofCount(character, {
            kind: 'questbook-boss', sourceId: seal.id, stage: seal.stage, sealVersion,
        });
        if (stage.count > 1) {
            // Multi-wave authored stages (the Hollow Caravan) stay on the same
            // durable seal until every exact boss win exists. Each newly sealed
            // wave escalates from server-owned proof count; no client wave index
            // or counter can skip the sequence.
            levelOffset += completedWaves;
            statBonus += completedWaves * 2;
            name = `${name} — Wave ${completedWaves + 1}`;
        }
        if (boss.scalesWithRivalry) {
            const nemesis = character.wandererNemesis as Record<string, unknown> | undefined;
            const tier = Math.max(0, Math.floor(Number(nemesis?.tier) || 0));
            levelOffset += Math.min(12, tier * 2);
            statBonus += Math.min(8, tier * 2);
            if (tier >= 4) name += ', Risen';
        }
        return { profile: runtimeProfile(`world-questbook-${seal.id}-${stage.bossId}`, name, level + levelOffset, statBonus, boss.loadoutId), environment,
            context: { kind: request.kind, sourceId: seal.id, sector: request.sector, stage: seal.stage, displayName: name, finalStage: true, sealVersion } };
    }

    if (request.kind === 'story-reckoning') {
        const seal = parseStoryReckoningSeal(params.save.activeStoryReckoningSeal);
        const definition = STORY_RECKONINGS[request.sourceId];
        const boss = STORY_BOSSES[request.sourceId];
        if (!seal || seal.id !== request.sourceId || seal.stage !== 'task' || definition?.metric !== 'totalAiKills' || !boss) throw new Error('world-story-seal-mismatch');
        const sealVersion = `${seal.id}:${seal.stage}:${seal.baseline}:${seal.at}`;
        if (worldContextWinProofCount(character, {
            kind: 'story-reckoning', sourceId: request.sourceId, stage: request.stage ?? 0, sealVersion,
        }) >= Math.max(1, Math.floor(Number(definition.target) || 1))) throw new Error('world-context-already-won');
        return { profile: runtimeProfile(`world-story-${request.sourceId}`, boss.name, level + boss.levelOffset, boss.statBonus, boss.loadoutId), environment,
            context: { kind: request.kind, sourceId: request.sourceId, sector: request.sector, stage: 0, displayName: boss.name, finalStage: true, sealVersion } };
    }

    throw new Error('world-encounter-unsupported');
}

export function worldChainHealRequired(request: WorldAiFightRequest): { chainId: string; priorStage: number } | null {
    const stage = request.stage ?? 0;
    return stage > 0 && request.chainId ? { chainId: request.chainId, priorStage: stage - 1 } : null;
}

export function applyWorldChainHeal(character: Record<string, unknown>, request: WorldAiFightRequest): Record<string, unknown> {
    const required = worldChainHealRequired(request);
    if (!required) return character;
    if (!chainWinExists(character, request, required.chainId, required.priorStage)) throw new Error('world-chain-proof-missing');
    const receipts = Array.isArray(character.worldAiChainHeals) ? character.worldAiChainHeals as Array<Record<string, unknown>> : [];
    const id = `${required.chainId}:${request.stage}`;
    if (receipts.some((entry) => entry.id === id)) return character;
    const maxHp = Math.max(1, Math.floor(Number(character.maxHp) || 1));
    const hp = Math.max(0, Math.min(maxHp, Math.floor(Number(character.hp) || 0) + Math.floor(maxHp / 3)));
    return { ...character, hp, worldAiChainHeals: [...receipts.slice(-39), { id, at: Date.now() }] };
}

function trailMap(character: Record<string, unknown>): Record<string, HuntTrailState> {
    return character.serverHuntTrails && typeof character.serverHuntTrails === 'object' && !Array.isArray(character.serverHuntTrails)
        ? { ...(character.serverHuntTrails as Record<string, HuntTrailState>) }
        : {};
}

/** World-only progression applied inside report-ai-fight's single save commit. */
export function applyWorldAiFightSettlement(
    character: Record<string, unknown>,
    context: WorldAiFightContext,
    outcome: 'win' | 'loss' | 'draw' | 'forfeit' | 'unknown',
    proofId: string,
): Record<string, unknown> {
    const won = outcome === 'win';
    let next = character;

    if (context.kind === 'wanderer') {
        const streak = Math.max(0, Math.floor(Number(character.robberStreak) || 0));
        if (context.sourceId === 'nemesis') {
            const nemesis = character.wandererNemesis as Record<string, unknown> | undefined;
            next = won
                ? { ...next, wandererNemesis: null, robberStreak: streak + 1 }
                : { ...next, robberStreak: 0, ...(nemesis ? { wandererNemesis: { ...nemesis, tier: Math.max(1, Math.floor(Number(nemesis.tier) || 1)) + 1 } } : {}) };
        } else if (won) {
            next = { ...next, robberStreak: streak + 1 };
        } else {
            next = {
                ...next,
                robberStreak: 0,
                ...(character.wandererNemesis ? {} : {
                    wandererNemesis: {
                        name: context.displayName,
                        level: Math.max(1, Math.floor(Number(character.level) || 1) + 1),
                        tier: 1,
                    },
                }),
            };
        }
    }
    if (context.kind === 'wanderer-ambush' && (!won || context.finalStage === true)) {
        next = { ...next, robberStreak: 0 };
        if (won && context.finalStage === true && context.chainId) {
            next = {
                ...next,
                worldAiPendingOutcome: {
                    kind: 'wanderer-ambush-reward',
                    claimId: `ambush:${context.chainId}:${context.sector}`,
                    chainId: context.chainId,
                    sourceId: 'wanderer-ambush',
                    sector: context.sector,
                    createdAt: Date.now(),
                } satisfies WorldAiFightPendingOutcome,
            };
        }
    }

    if (won && context.chainId) {
        const wins = Array.isArray(next.worldAiChainWins) ? next.worldAiChainWins as Array<Record<string, unknown>> : [];
        const id = `${context.chainId}:${context.stage}`;
        if (!wins.some((entry) => entry.id === id)) {
            next = { ...next, worldAiChainWins: [...wins.slice(-39), { id, chainId: context.chainId, stage: context.stage, kind: context.kind, sourceId: context.sourceId, sector: context.sector, proofId, at: Date.now() }] };
        }
    }

    if (context.chainId && (context.kind === 'wanderer-ambush' || context.kind === 'hunt-pack')) {
        if (won && typeof context.nextStage === 'number' && context.finalStage !== true) {
            next = {
                ...next,
                worldAiPendingChain: {
                    request: {
                        kind: context.kind,
                        sourceId: context.sourceId,
                        sector: context.sector,
                        stage: context.nextStage,
                        chainId: context.chainId,
                        ...(context.decisionId ? { decisionId: context.decisionId } : {}),
                    },
                    displayName: context.displayName,
                    createdAt: Date.now(),
                } satisfies WorldAiFightPendingChain,
            };
        } else {
            const pending = cleanWorldAiPendingChain(next.worldAiPendingChain);
            if (pending?.request.chainId === context.chainId) {
                const { worldAiPendingChain: _cleared, ...withoutPending } = next;
                next = withoutPending;
            }
        }
    }

    if (context.kind === 'hunt-pack' && context.missionId) {
        const trails = trailMap(next);
        const trail = trails[context.missionId];
        if (trail && trail.runId === context.huntRunId && trail.decisionId === context.decisionId && trail.packPending && !trail.packSettled) {
            const terminalWin = won && context.finalStage === true;
            if (!won || terminalWin) {
                const delta = terminalWin ? 1 : -1;
                trails[context.missionId] = {
                    ...trail,
                    quality: Math.max(-3, Math.min(3, Math.floor(Number(trail.quality) || 0) + delta)),
                    // Pack combat is a terminal detour on either outcome. A loss
                    // worsens the eventual target opening but does not strand the
                    // contract behind an unintended pack rematch.
                    packPending: false,
                    packSettled: true,
                };
                next = { ...next, serverHuntTrails: trails };
            }
        }
    }
    if (won && context.kind === 'hunt-target' && context.missionId) {
        const trails = trailMap(next);
        const trail = trails[context.missionId];
        if (trail && trail.runId === context.huntRunId && !trail.targetDefeated) {
            // Use the exact evidence id written to the mission receipt so claim
            // can prove that this active trail and this sealed target win are the
            // same event (and reject a generic AI fight against the same profile).
            const targetProofId = worldHuntKillEvidenceId(proofId);
            trails[context.missionId] = { ...trail, targetDefeated: true, targetProofId };
            next = { ...next, serverHuntTrails: trails };
        }
    }
    if (won && (context.kind === 'questbook-boss' || context.kind === 'story-reckoning')) {
        const wins = Array.isArray(next.worldAiContextWins) ? next.worldAiContextWins as Array<Record<string, unknown>> : [];
        const sealVersion = context.sealVersion ?? '';
        const id = `${context.kind}:${context.sourceId}:${context.stage}:${sealVersion}:${proofId}`;
        if (!wins.some((entry) => entry.proofId === proofId)) {
            next = { ...next, worldAiContextWins: [...wins.slice(-39), { id, kind: context.kind, sourceId: context.sourceId, stage: context.stage, sealVersion, proofId, at: Date.now() }] };
        }
    }
    return next;
}

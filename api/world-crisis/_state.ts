import { addHallEntry, announce } from '../_announce.js';
import { recordAudit } from '../_audit.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import {
    WORLD_CRISIS_DEFAULT_TARGET,
    WORLD_CRISIS_ID,
    WORLD_CRISIS_MAX_TARGET,
    WORLD_CRISIS_MIN_TARGET,
    WORLD_CRISIS_TITLE,
    WORLD_CRISIS_TRIGGER_LEVEL,
    WORLD_CRISIS_VILLAGES,
    isWorldCrisisVillage,
    worldCrisisEncounterForVillage,
    worldCrisisPhaseForProgress,
    type WorldCrisisContributor,
    type WorldCrisisProjection,
    type WorldCrisisState,
    type WorldCrisisStatus,
    type WorldCrisisVillage,
    type WorldCrisisVillageState,
} from '../../shared/world-crisis.js';

export const WORLD_CRISIS_STATE_KEY = `world:crisis:${WORLD_CRISIS_ID}`;
const WORLD_CRISIS_PROOF_PREFIX = `${WORLD_CRISIS_STATE_KEY}:proof:`;
const MAX_APPLIED_PROOFS = WORLD_CRISIS_MAX_TARGET * WORLD_CRISIS_VILLAGES.length;

function cleanTarget(value: unknown): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed)
        ? Math.max(WORLD_CRISIS_MIN_TARGET, Math.min(WORLD_CRISIS_MAX_TARGET, parsed))
        : WORLD_CRISIS_DEFAULT_TARGET;
}

function emptyVillages(target: number): WorldCrisisState['villages'] {
    return Object.fromEntries(WORLD_CRISIS_VILLAGES.map((village) => [village, {
        village,
        defenses: 0,
        target,
        lastDefendedAt: null,
        completedAt: null,
    } satisfies WorldCrisisVillageState])) as WorldCrisisState['villages'];
}

/** The shipped state starts ARMED. Existing level-37+ saves do not trigger it:
 * only a committed crossing from below the threshold calls the observer. */
export function newWorldCrisisState(now = Date.now(), status: WorldCrisisStatus = 'armed'): WorldCrisisState {
    const targetPerVillage = WORLD_CRISIS_DEFAULT_TARGET;
    return {
        schemaVersion: 1,
        crisisId: WORLD_CRISIS_ID,
        runId: `${WORLD_CRISIS_ID}:world-first`,
        status,
        phase: 'first-signal',
        triggerLevel: WORLD_CRISIS_TRIGGER_LEVEL,
        armedAt: status === 'armed' ? now : null,
        awakenedAt: null,
        awakenedBy: null,
        awakenedVillage: null,
        resolvedAt: null,
        targetPerVillage,
        villages: emptyVillages(targetPerVillage),
        contributors: {},
        appliedProofIds: [],
        awakeningAnnouncementId: null,
        resolutionAnnouncementId: null,
        revision: 1,
        updatedAt: now,
    };
}

function cleanVillageState(value: unknown, village: WorldCrisisVillage, target: number): WorldCrisisVillageState {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<WorldCrisisVillageState> : {};
    const defenses = Math.max(0, Math.min(target, Math.floor(Number(raw.defenses) || 0)));
    return {
        village,
        defenses,
        target,
        lastDefendedAt: Number.isSafeInteger(raw.lastDefendedAt) ? Number(raw.lastDefendedAt) : null,
        completedAt: defenses >= target && Number.isSafeInteger(raw.completedAt) ? Number(raw.completedAt) : null,
    };
}

export function normalizeWorldCrisisState(value: unknown, now = Date.now()): WorldCrisisState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return newWorldCrisisState(now);
    const raw = value as Partial<WorldCrisisState>;
    const targetPerVillage = cleanTarget(raw.targetPerVillage);
    const status: WorldCrisisStatus = raw.status === 'dormant' || raw.status === 'armed'
        || raw.status === 'active' || raw.status === 'resolved' ? raw.status : 'armed';
    const villages = Object.fromEntries(WORLD_CRISIS_VILLAGES.map((village) => [
        village,
        cleanVillageState(raw.villages?.[village], village, targetPerVillage),
    ])) as WorldCrisisState['villages'];
    const contributors: Record<string, WorldCrisisContributor> = {};
    if (raw.contributors && typeof raw.contributors === 'object' && !Array.isArray(raw.contributors)) {
        for (const [key, candidate] of Object.entries(raw.contributors)) {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
            const item = candidate as Partial<WorldCrisisContributor>;
            if (typeof item.player !== 'string' || !isWorldCrisisVillage(item.village)) continue;
            contributors[key.slice(0, 80)] = {
                player: item.player.slice(0, 80),
                village: item.village,
                wins: Math.max(0, Math.floor(Number(item.wins) || 0)),
                lastAt: Math.max(0, Math.floor(Number(item.lastAt) || 0)),
            };
        }
    }
    const totalDefenses = WORLD_CRISIS_VILLAGES.reduce((sum, village) => sum + villages[village].defenses, 0);
    const totalTarget = targetPerVillage * WORLD_CRISIS_VILLAGES.length;
    const resolved = status === 'resolved';
    return {
        schemaVersion: 1,
        crisisId: WORLD_CRISIS_ID,
        runId: typeof raw.runId === 'string' && raw.runId ? raw.runId.slice(0, 120) : `${WORLD_CRISIS_ID}:world-first`,
        status,
        phase: worldCrisisPhaseForProgress(Math.round(totalDefenses / Math.max(1, totalTarget) * 100), resolved),
        triggerLevel: WORLD_CRISIS_TRIGGER_LEVEL,
        armedAt: Number.isSafeInteger(raw.armedAt) ? Number(raw.armedAt) : null,
        awakenedAt: Number.isSafeInteger(raw.awakenedAt) ? Number(raw.awakenedAt) : null,
        awakenedBy: typeof raw.awakenedBy === 'string' ? raw.awakenedBy.slice(0, 80) : null,
        awakenedVillage: isWorldCrisisVillage(raw.awakenedVillage) ? raw.awakenedVillage : null,
        resolvedAt: Number.isSafeInteger(raw.resolvedAt) ? Number(raw.resolvedAt) : null,
        targetPerVillage,
        villages,
        contributors,
        appliedProofIds: Array.isArray(raw.appliedProofIds)
            ? raw.appliedProofIds.filter((id): id is string => typeof id === 'string').slice(-MAX_APPLIED_PROOFS)
            : [],
        awakeningAnnouncementId: Number.isSafeInteger(raw.awakeningAnnouncementId) ? Number(raw.awakeningAnnouncementId) : null,
        resolutionAnnouncementId: Number.isSafeInteger(raw.resolutionAnnouncementId) ? Number(raw.resolutionAnnouncementId) : null,
        revision: Math.max(1, Math.floor(Number(raw.revision) || 1)),
        updatedAt: Math.max(0, Math.floor(Number(raw.updatedAt) || now)),
    };
}

export function projectWorldCrisisState(state: WorldCrisisState): WorldCrisisProjection {
    const villages = Object.fromEntries(WORLD_CRISIS_VILLAGES.map((village) => {
        const item = state.villages[village];
        const progressPercent = Math.min(100, Math.round(item.defenses / Math.max(1, item.target) * 100));
        return [village, {
            ...item,
            remaining: Math.max(0, item.target - item.defenses),
            progressPercent,
            // The assault begins with the walls under visible pressure. Verified
            // defenses recover the objective to full integrity.
            integrityPercent: Math.min(100, 40 + Math.round(progressPercent * .6)),
            attackersActive: state.status === 'active' && item.defenses < item.target,
        }];
    })) as WorldCrisisProjection['villages'];
    const totalDefenses = WORLD_CRISIS_VILLAGES.reduce((sum, village) => sum + villages[village].defenses, 0);
    const totalTarget = WORLD_CRISIS_VILLAGES.reduce((sum, village) => sum + villages[village].target, 0);
    return {
        ...state,
        villages,
        totalDefenses,
        totalTarget,
        globalProgressPercent: Math.min(100, Math.round(totalDefenses / Math.max(1, totalTarget) * 100)),
        topDefenders: Object.values(state.contributors)
            .sort((left, right) => right.wins - left.wins || left.lastAt - right.lastAt || left.player.localeCompare(right.player))
            .slice(0, 12),
    };
}

async function loadWorldCrisisState(): Promise<WorldCrisisState> {
    const stored = await kv.get<WorldCrisisState>(WORLD_CRISIS_STATE_KEY);
    if (stored) return normalizeWorldCrisisState(stored);
    return await withKvLock(WORLD_CRISIS_STATE_KEY, async () => {
        const current = await kv.get<WorldCrisisState>(WORLD_CRISIS_STATE_KEY);
        if (current) return normalizeWorldCrisisState(current);
        const created = newWorldCrisisState();
        await kv.set(WORLD_CRISIS_STATE_KEY, created);
        return created;
    }, { failClosed: true });
}

function awakeningMessage(state: WorldCrisisState): string {
    const player = state.awakenedBy ?? 'An unnamed shinobi';
    return `${player} crossed a line the old works could not classify. A quartered seal has lit beneath every village, and recall wardens are advancing through the outskirts. Every shinobi is called to defend.`;
}

async function ensureWorldCrisisOutbox(state: WorldCrisisState): Promise<void> {
    if ((state.status === 'active' || state.status === 'resolved') && !state.awakeningAnnouncementId && state.awakenedAt) {
        const receiptId = `${state.runId}:awakening`;
        const posted = await announce({
            type: 'world_crisis_awakened',
            importance: 'mythic',
            title: WORLD_CRISIS_TITLE,
            message: awakeningMessage(state),
            ...(state.awakenedBy ? { player: state.awakenedBy } : {}),
            ...(state.awakenedVillage ? { village: state.awakenedVillage } : {}),
            meta: {
                crisisId: state.crisisId,
                runId: state.runId,
                cinematicId: 'quartered-recall',
                action: 'open-world-crisis',
                triggerLevel: state.triggerLevel,
            },
        }, { receiptId });
        if (state.awakenedBy) {
            await addHallEntry({
                entryType: 'server_first',
                title: 'The First Omen',
                description: `${state.awakenedBy} was the first shinobi whose field record woke the quartered recall. The four villages answered together.`,
                player: state.awakenedBy,
                ...(state.awakenedVillage ? { village: state.awakenedVillage } : {}),
                meta: { worldCrisisId: state.crisisId, runId: state.runId },
            }, { nxKey: `${state.runId}:first-omen` });
        }
        if (posted) {
            await withKvLock(WORLD_CRISIS_STATE_KEY, async () => {
                const current = normalizeWorldCrisisState(await kv.get(WORLD_CRISIS_STATE_KEY));
                if (current.runId !== state.runId || current.awakeningAnnouncementId) return;
                await kv.set(WORLD_CRISIS_STATE_KEY, {
                    ...current,
                    awakeningAnnouncementId: posted.id,
                    revision: current.revision + 1,
                    updatedAt: Date.now(),
                });
            }, { failClosed: true });
        }
    }

    if (state.status === 'resolved' && !state.resolutionAnnouncementId && state.resolvedAt) {
        const receiptId = `${state.runId}:resolved`;
        const posted = await announce({
            type: 'world_crisis_resolved',
            importance: 'high',
            title: 'The Villages Hold',
            message: 'The recall order has broken at all four outskirts. Stormveil, Ashen Leaf, Frostfang, and Moonshadow still stand because their shinobi answered together.',
            meta: { crisisId: state.crisisId, runId: state.runId, action: 'open-world-crisis' },
        }, { receiptId });
        if (posted) {
            await withKvLock(WORLD_CRISIS_STATE_KEY, async () => {
                const current = normalizeWorldCrisisState(await kv.get(WORLD_CRISIS_STATE_KEY));
                if (current.runId !== state.runId || current.resolutionAnnouncementId) return;
                await kv.set(WORLD_CRISIS_STATE_KEY, {
                    ...current,
                    resolutionAnnouncementId: posted.id,
                    revision: current.revision + 1,
                    updatedAt: Date.now(),
                });
            }, { failClosed: true });
        }
    }
}

export async function readWorldCrisisProjection(): Promise<WorldCrisisProjection> {
    let state = await loadWorldCrisisState();
    await ensureWorldCrisisOutbox(state);
    state = await loadWorldCrisisState();
    return projectWorldCrisisState(state);
}

function eligibleFirstAwakener(playerName: string, auth: Record<string, unknown> | null): boolean {
    const name = safeName(playerName);
    if (!name || name === 'system' || name === 'server' || name.startsWith('admin') || name.startsWith('health-probe-') || name.startsWith('clan-')) return false;
    // Credential-less guests are temporary, reclaimable accounts. They can
    // defend once the crisis is open, but cannot own permanent server-first history.
    if (auth?.guest === true && (!auth.hash || !auth.salt)) return false;
    return true;
}

export async function observeWorldCrisisLevelCrossing(input: {
    playerName: string;
    beforeLevel: number;
    afterLevel: number;
    character: Record<string, unknown>;
    now?: number;
}): Promise<boolean> {
    if (input.beforeLevel < 1 || input.beforeLevel >= WORLD_CRISIS_TRIGGER_LEVEL || input.afterLevel < WORLD_CRISIS_TRIGGER_LEVEL) return false;
    const village = input.character.village;
    if (!isWorldCrisisVillage(village)) return false;
    const playerName = safeName(input.playerName);
    const displayName = typeof input.character.name === 'string' && input.character.name.trim()
        ? input.character.name.trim().slice(0, 80)
        : playerName;
    const auth = await kv.get<Record<string, unknown>>(`auth:${playerName}`);
    if (!eligibleFirstAwakener(playerName, auth)) return false;
    const now = input.now ?? Date.now();
    let awakened = false;
    let state = await withKvLock(WORLD_CRISIS_STATE_KEY, async () => {
        const current = normalizeWorldCrisisState(await kv.get(WORLD_CRISIS_STATE_KEY), now);
        if (current.status !== 'armed') return current;
        const next: WorldCrisisState = {
            ...current,
            status: 'active',
            phase: 'first-signal',
            awakenedAt: now,
            awakenedBy: displayName,
            awakenedVillage: village,
            revision: current.revision + 1,
            updatedAt: now,
        };
        await kv.set(WORLD_CRISIS_STATE_KEY, next);
        awakened = true;
        return next;
    }, { failClosed: true });
    if (awakened) await ensureWorldCrisisOutbox(state);
    return awakened;
}

export async function activeWorldCrisisEncounter(input: {
    playerName: string;
    character: Record<string, unknown>;
    sourceId: string;
}): Promise<ReturnType<typeof worldCrisisEncounterForVillage>> {
    const village = input.character.village;
    if (!isWorldCrisisVillage(village)) throw new Error('world-crisis-village-invalid');
    const state = await loadWorldCrisisState();
    if (state.status !== 'active') throw new Error('world-crisis-not-active');
    const villageState = state.villages[village];
    if (villageState.defenses >= villageState.target) throw new Error('world-crisis-village-secured');
    const encounter = worldCrisisEncounterForVillage(village);
    if (encounter.sourceId !== input.sourceId) throw new Error('world-crisis-encounter-stale');
    return encounter;
}

export async function recordWorldCrisisDefense(input: {
    playerName: string;
    village: string;
    sourceId: string;
    proofId: string;
    outcome: 'win' | 'loss' | 'draw' | 'forfeit' | 'unknown';
    now?: number;
}): Promise<WorldCrisisProjection> {
    if (input.outcome !== 'win') return await readWorldCrisisProjection();
    if (!isWorldCrisisVillage(input.village)) throw new Error('world-crisis-village-invalid');
    const village = input.village;
    const encounter = worldCrisisEncounterForVillage(village);
    if (input.sourceId !== encounter.sourceId) throw new Error('world-crisis-encounter-stale');
    const playerName = safeName(input.playerName);
    if (!playerName || !/^[A-Za-z0-9:_-]{8,160}$/.test(input.proofId)) throw new Error('world-crisis-proof-invalid');
    const now = input.now ?? Date.now();
    const markerKey = `${WORLD_CRISIS_PROOF_PREFIX}${input.proofId}`;
    let state = await withKvLock(WORLD_CRISIS_STATE_KEY, async () => {
        const current = normalizeWorldCrisisState(await kv.get(WORLD_CRISIS_STATE_KEY), now);
        const marker = await kv.get<{ status?: string }>(markerKey);
        if (marker?.status === 'done' || current.appliedProofIds.includes(input.proofId)) return current;
        if (current.status !== 'active') return current;
        await kv.set(markerKey, { status: 'pending', playerName, village, at: now });

        const villageState = current.villages[village];
        const defenses = Math.min(villageState.target, villageState.defenses + 1);
        const villageCompleted = defenses >= villageState.target;
        const villages = {
            ...current.villages,
            [village]: {
                ...villageState,
                defenses,
                lastDefendedAt: now,
                completedAt: villageCompleted ? villageState.completedAt ?? now : null,
            },
        };
        const contributorKey = playerName.toLowerCase();
        const prior = current.contributors[contributorKey];
        const contributors = {
            ...current.contributors,
            [contributorKey]: {
                player: playerName,
                village,
                wins: (prior?.wins ?? 0) + 1,
                lastAt: now,
            },
        };
        const allHeld = WORLD_CRISIS_VILLAGES.every((village) => villages[village].defenses >= villages[village].target);
        const totalDefenses = WORLD_CRISIS_VILLAGES.reduce((sum, village) => sum + villages[village].defenses, 0);
        const totalTarget = current.targetPerVillage * WORLD_CRISIS_VILLAGES.length;
        const next: WorldCrisisState = {
            ...current,
            villages,
            contributors,
            appliedProofIds: [...current.appliedProofIds, input.proofId].slice(-MAX_APPLIED_PROOFS),
            status: allHeld ? 'resolved' : 'active',
            resolvedAt: allHeld ? current.resolvedAt ?? now : null,
            phase: worldCrisisPhaseForProgress(Math.round(totalDefenses / Math.max(1, totalTarget) * 100), allHeld),
            revision: current.revision + 1,
            updatedAt: now,
        };
        await kv.set(WORLD_CRISIS_STATE_KEY, next);
        await kv.set(markerKey, { status: 'done', playerName, village, at: now });
        return next;
    }, { failClosed: true });
    await ensureWorldCrisisOutbox(state);
    state = await loadWorldCrisisState();
    return projectWorldCrisisState(state);
}

export type WorldCrisisAdminAction = 'arm' | 'stand-down' | 'awaken-now' | 'resolve' | 'set-target';

export async function applyWorldCrisisAdminAction(input: {
    action: WorldCrisisAdminAction;
    targetPerVillage?: unknown;
    creditPlayer?: string;
    reason?: string;
    now?: number;
}): Promise<WorldCrisisProjection> {
    const now = input.now ?? Date.now();
    const before = await loadWorldCrisisState();
    let state = await withKvLock(WORLD_CRISIS_STATE_KEY, async () => {
        const current = normalizeWorldCrisisState(await kv.get(WORLD_CRISIS_STATE_KEY), now);
        let next = current;
        if (input.action === 'arm') {
            if (current.status !== 'dormant') throw new Error('Only a dormant crisis can be armed.');
            next = { ...current, status: 'armed', armedAt: now, revision: current.revision + 1, updatedAt: now };
        } else if (input.action === 'stand-down') {
            if (current.status !== 'armed') throw new Error('Only an unawakened crisis can stand down.');
            next = { ...current, status: 'dormant', armedAt: null, revision: current.revision + 1, updatedAt: now };
        } else if (input.action === 'set-target') {
            if (current.status !== 'armed' && current.status !== 'dormant') throw new Error('Targets lock once the crisis awakens.');
            const targetPerVillage = cleanTarget(input.targetPerVillage);
            next = { ...current, targetPerVillage, villages: emptyVillages(targetPerVillage), revision: current.revision + 1, updatedAt: now };
        } else if (input.action === 'awaken-now') {
            if (current.status !== 'armed') throw new Error('The crisis is not waiting for an awakening.');
            const creditPlayer = safeName(input.creditPlayer ?? '');
            const creditSave = creditPlayer ? await kv.get<Record<string, unknown>>(`save:${creditPlayer}`) : null;
            const creditCharacter = creditSave?.character as Record<string, unknown> | undefined;
            const creditVillage = creditCharacter?.village;
            const creditDisplayName = typeof creditCharacter?.name === 'string' && creditCharacter.name.trim()
                ? creditCharacter.name.trim().slice(0, 80)
                : creditPlayer;
            next = {
                ...current,
                status: 'active',
                phase: 'first-signal',
                awakenedAt: now,
                awakenedBy: creditDisplayName || 'World Herald',
                awakenedVillage: isWorldCrisisVillage(creditVillage) ? creditVillage : null,
                revision: current.revision + 1,
                updatedAt: now,
            };
        } else if (input.action === 'resolve') {
            if (current.status !== 'active') throw new Error('Only an active crisis can be resolved.');
            const villages = Object.fromEntries(WORLD_CRISIS_VILLAGES.map((village) => [village, {
                ...current.villages[village],
                defenses: current.villages[village].target,
                completedAt: current.villages[village].completedAt ?? now,
            }])) as WorldCrisisState['villages'];
            next = { ...current, villages, status: 'resolved', phase: 'villages-hold', resolvedAt: now, revision: current.revision + 1, updatedAt: now };
        }
        await kv.set(WORLD_CRISIS_STATE_KEY, next);
        return next;
    }, { failClosed: true });
    await recordAudit({
        actor: 'admin',
        domain: 'legacy',
        action: `world-crisis.${input.action}`,
        entityType: 'world-crisis',
        entityId: WORLD_CRISIS_ID,
        before: { status: before.status, phase: before.phase, targetPerVillage: before.targetPerVillage, revision: before.revision },
        after: { status: state.status, phase: state.phase, targetPerVillage: state.targetPerVillage, revision: state.revision },
        reason: input.reason?.trim().slice(0, 300),
    });
    await ensureWorldCrisisOutbox(state);
    state = await loadWorldCrisisState();
    return projectWorldCrisisState(state);
}

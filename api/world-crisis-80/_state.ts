import { addHallEntry, announce } from '../_announce.js';
import { recordAudit } from '../_audit.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import {
    WORLD_CRISIS_80_DEFAULT_TARGET,
    WORLD_CRISIS_80_ID,
    WORLD_CRISIS_80_MAX_TARGET,
    WORLD_CRISIS_80_MIN_TARGET,
    WORLD_CRISIS_80_TITLE,
    WORLD_CRISIS_80_TRIGGER_LEVEL,
    WORLD_CRISIS_80_VILLAGES,
    isWorldCrisis80Village,
    worldCrisis80EncounterForVillage,
    worldCrisis80PhaseForProgress,
    type WorldCrisis80Contributor,
    type WorldCrisis80DefensePath,
    type WorldCrisis80Projection,
    type WorldCrisis80State,
    type WorldCrisis80Status,
    type WorldCrisis80Village,
    type WorldCrisis80VillageState,
} from '../../shared/world-crisis-80.js';

export const WORLD_CRISIS_80_STATE_KEY = `world:crisis:${WORLD_CRISIS_80_ID}`;
const WORLD_CRISIS_80_PROOF_PREFIX = `${WORLD_CRISIS_80_STATE_KEY}:proof:`;
const MAX_APPLIED_PROOFS = WORLD_CRISIS_80_MAX_TARGET * WORLD_CRISIS_80_VILLAGES.length;

function cleanTarget(value: unknown): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed)
        ? Math.max(WORLD_CRISIS_80_MIN_TARGET, Math.min(WORLD_CRISIS_80_MAX_TARGET, parsed))
        : WORLD_CRISIS_80_DEFAULT_TARGET;
}

function emptyVillages(target: number): WorldCrisis80State['villages'] {
    return Object.fromEntries(WORLD_CRISIS_80_VILLAGES.map((village) => [village, {
        village,
        defenses: 0,
        shinobiDefenses: 0,
        companionDefenses: 0,
        target,
        lastDefendedAt: null,
        completedAt: null,
    } satisfies WorldCrisis80VillageState])) as WorldCrisis80State['villages'];
}

/** Existing level-80 saves never retroactively awaken the event. Only a new,
 * committed crossing from below the threshold reaches the observer. */
export function newWorldCrisis80State(now = Date.now(), status: WorldCrisis80Status = 'armed'): WorldCrisis80State {
    const targetPerVillage = WORLD_CRISIS_80_DEFAULT_TARGET;
    return {
        schemaVersion: 1,
        crisisId: WORLD_CRISIS_80_ID,
        runId: `${WORLD_CRISIS_80_ID}:world-first`,
        status,
        phase: 'witness-signal',
        triggerLevel: WORLD_CRISIS_80_TRIGGER_LEVEL,
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

function cleanVillageState(value: unknown, village: WorldCrisis80Village, target: number): WorldCrisis80VillageState {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<WorldCrisis80VillageState> : {};
    const shinobiDefenses = Math.max(0, Math.floor(Number(raw.shinobiDefenses) || 0));
    const companionDefenses = Math.max(0, Math.floor(Number(raw.companionDefenses) || 0));
    const defenses = Math.max(0, Math.min(target, Math.floor(Number(raw.defenses) || shinobiDefenses + companionDefenses)));
    return {
        village,
        defenses,
        shinobiDefenses: Math.min(defenses, shinobiDefenses),
        companionDefenses: Math.min(defenses, companionDefenses),
        target,
        lastDefendedAt: Number.isSafeInteger(raw.lastDefendedAt) ? Number(raw.lastDefendedAt) : null,
        completedAt: defenses >= target && Number.isSafeInteger(raw.completedAt) ? Number(raw.completedAt) : null,
    };
}

export function normalizeWorldCrisis80State(value: unknown, now = Date.now()): WorldCrisis80State {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return newWorldCrisis80State(now);
    const raw = value as Partial<WorldCrisis80State>;
    const targetPerVillage = cleanTarget(raw.targetPerVillage);
    const status: WorldCrisis80Status = raw.status === 'dormant' || raw.status === 'armed'
        || raw.status === 'active' || raw.status === 'resolved' ? raw.status : 'armed';
    const villages = Object.fromEntries(WORLD_CRISIS_80_VILLAGES.map((village) => [
        village,
        cleanVillageState(raw.villages?.[village], village, targetPerVillage),
    ])) as WorldCrisis80State['villages'];
    const contributors: Record<string, WorldCrisis80Contributor> = {};
    if (raw.contributors && typeof raw.contributors === 'object' && !Array.isArray(raw.contributors)) {
        for (const [key, candidate] of Object.entries(raw.contributors)) {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
            const item = candidate as Partial<WorldCrisis80Contributor>;
            if (typeof item.player !== 'string' || !isWorldCrisis80Village(item.village)) continue;
            const shinobiWins = Math.max(0, Math.floor(Number(item.shinobiWins) || 0));
            const companionWins = Math.max(0, Math.floor(Number(item.companionWins) || 0));
            contributors[key.slice(0, 80)] = {
                player: item.player.slice(0, 80),
                village: item.village,
                wins: Math.max(shinobiWins + companionWins, Math.floor(Number(item.wins) || 0)),
                shinobiWins,
                companionWins,
                lastAt: Math.max(0, Math.floor(Number(item.lastAt) || 0)),
            };
        }
    }
    const totalDefenses = WORLD_CRISIS_80_VILLAGES.reduce((sum, village) => sum + villages[village].defenses, 0);
    const totalTarget = targetPerVillage * WORLD_CRISIS_80_VILLAGES.length;
    const resolved = status === 'resolved';
    return {
        schemaVersion: 1,
        crisisId: WORLD_CRISIS_80_ID,
        runId: typeof raw.runId === 'string' && raw.runId ? raw.runId.slice(0, 120) : `${WORLD_CRISIS_80_ID}:world-first`,
        status,
        phase: worldCrisis80PhaseForProgress(Math.round(totalDefenses / Math.max(1, totalTarget) * 100), resolved),
        triggerLevel: WORLD_CRISIS_80_TRIGGER_LEVEL,
        armedAt: Number.isSafeInteger(raw.armedAt) ? Number(raw.armedAt) : null,
        awakenedAt: Number.isSafeInteger(raw.awakenedAt) ? Number(raw.awakenedAt) : null,
        awakenedBy: typeof raw.awakenedBy === 'string' ? raw.awakenedBy.slice(0, 80) : null,
        awakenedVillage: isWorldCrisis80Village(raw.awakenedVillage) ? raw.awakenedVillage : null,
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

export function projectWorldCrisis80State(state: WorldCrisis80State): WorldCrisis80Projection {
    const villages = Object.fromEntries(WORLD_CRISIS_80_VILLAGES.map((village) => {
        const item = state.villages[village];
        const progressPercent = Math.min(100, Math.round(item.defenses / Math.max(1, item.target) * 100));
        return [village, {
            ...item,
            remaining: Math.max(0, item.target - item.defenses),
            progressPercent,
            integrityPercent: Math.min(100, 24 + Math.round(progressPercent * .76)),
            attackersActive: state.status === 'active' && item.defenses < item.target,
        }];
    })) as WorldCrisis80Projection['villages'];
    const totalDefenses = WORLD_CRISIS_80_VILLAGES.reduce((sum, village) => sum + villages[village].defenses, 0);
    const totalShinobiDefenses = WORLD_CRISIS_80_VILLAGES.reduce((sum, village) => sum + villages[village].shinobiDefenses, 0);
    const totalCompanionDefenses = WORLD_CRISIS_80_VILLAGES.reduce((sum, village) => sum + villages[village].companionDefenses, 0);
    const totalTarget = WORLD_CRISIS_80_VILLAGES.reduce((sum, village) => sum + villages[village].target, 0);
    return {
        ...state,
        villages,
        totalDefenses,
        totalShinobiDefenses,
        totalCompanionDefenses,
        totalTarget,
        globalProgressPercent: Math.min(100, Math.round(totalDefenses / Math.max(1, totalTarget) * 100)),
        topDefenders: Object.values(state.contributors)
            .sort((left, right) => right.wins - left.wins || left.lastAt - right.lastAt || left.player.localeCompare(right.player))
            .slice(0, 12),
    };
}

async function loadWorldCrisis80State(): Promise<WorldCrisis80State> {
    const stored = await kv.get<WorldCrisis80State>(WORLD_CRISIS_80_STATE_KEY);
    if (stored) return normalizeWorldCrisis80State(stored);
    return await withKvLock(WORLD_CRISIS_80_STATE_KEY, async () => {
        const current = await kv.get<WorldCrisis80State>(WORLD_CRISIS_80_STATE_KEY);
        if (current) return normalizeWorldCrisis80State(current);
        const created = newWorldCrisis80State();
        await kv.set(WORLD_CRISIS_80_STATE_KEY, created);
        return created;
    }, { failClosed: true });
}

function awakeningMessage(state: WorldCrisis80State): string {
    const player = state.awakenedBy ?? 'An unnamed shinobi';
    return `${player} reached level 80 and triggered the public alarm. Village record keepers opened four regional reports already filed by Kite Harrow and found the same quartered claim in each. People serving Hollow Gate's old claims answered by sending Collection Cells and pursuit packs toward every village ledger. Every shinobi and companion handler is called to the outskirts.`;
}

async function ensureWorldCrisis80Outbox(state: WorldCrisis80State): Promise<void> {
    if ((state.status === 'active' || state.status === 'resolved') && !state.awakeningAnnouncementId && state.awakenedAt) {
        const posted = await announce({
            type: 'world_crisis_80_awakened',
            importance: 'mythic',
            title: WORLD_CRISIS_80_TITLE,
            message: awakeningMessage(state),
            ...(state.awakenedBy ? { player: state.awakenedBy } : {}),
            ...(state.awakenedVillage ? { village: state.awakenedVillage } : {}),
            meta: {
                crisisId: state.crisisId,
                runId: state.runId,
                cinematicId: 'four-witnesses',
                action: 'open-world-crisis-80',
                triggerLevel: state.triggerLevel,
            },
        }, { receiptId: `${state.runId}:awakening` });
        if (state.awakenedBy) {
            await addHallEntry({
                entryType: 'server_first',
                title: 'The First Alarm',
                description: `${state.awakenedBy}'s level-80 field record triggered the mobilization while village record keepers compared Kite Harrow's four regional reports.`,
                player: state.awakenedBy,
                ...(state.awakenedVillage ? { village: state.awakenedVillage } : {}),
                meta: { worldCrisisId: state.crisisId, runId: state.runId },
            }, { nxKey: `${state.runId}:first-witness` });
        }
        if (posted) {
            await withKvLock(WORLD_CRISIS_80_STATE_KEY, async () => {
                const current = normalizeWorldCrisis80State(await kv.get(WORLD_CRISIS_80_STATE_KEY));
                if (current.runId !== state.runId || current.awakeningAnnouncementId) return;
                await kv.set(WORLD_CRISIS_80_STATE_KEY, {
                    ...current,
                    awakeningAnnouncementId: posted.id,
                    revision: current.revision + 1,
                    updatedAt: Date.now(),
                });
            }, { failClosed: true });
        }
    }

    if (state.status === 'resolved' && !state.resolutionAnnouncementId && state.resolvedAt) {
        const posted = await announce({
            type: 'world_crisis_80_resolved',
            importance: 'mythic',
            title: 'The Claims Are Broken',
            message: 'Every witness ledger remains in village hands. Defenders held the outskirts and cut the converging attack off from its lower routes. Hollow Gate has lost its claim on the four reports.',
            meta: { crisisId: state.crisisId, runId: state.runId, action: 'open-world-crisis-80' },
        }, { receiptId: `${state.runId}:resolved` });
        if (posted) {
            await withKvLock(WORLD_CRISIS_80_STATE_KEY, async () => {
                const current = normalizeWorldCrisis80State(await kv.get(WORLD_CRISIS_80_STATE_KEY));
                if (current.runId !== state.runId || current.resolutionAnnouncementId) return;
                await kv.set(WORLD_CRISIS_80_STATE_KEY, {
                    ...current,
                    resolutionAnnouncementId: posted.id,
                    revision: current.revision + 1,
                    updatedAt: Date.now(),
                });
            }, { failClosed: true });
        }
    }
}

export async function readWorldCrisis80Projection(): Promise<WorldCrisis80Projection> {
    let state = await loadWorldCrisis80State();
    await ensureWorldCrisis80Outbox(state);
    state = await loadWorldCrisis80State();
    return projectWorldCrisis80State(state);
}

function eligibleFirstWitness(playerName: string, auth: Record<string, unknown> | null): boolean {
    const name = safeName(playerName);
    if (!name || name === 'system' || name === 'server' || name.startsWith('admin') || name.startsWith('health-probe-') || name.startsWith('clan-')) return false;
    if (auth?.guest === true && (!auth.hash || !auth.salt)) return false;
    return true;
}

export async function observeWorldCrisis80LevelCrossing(input: {
    playerName: string;
    beforeLevel: number;
    afterLevel: number;
    character: Record<string, unknown>;
    now?: number;
}): Promise<boolean> {
    if (input.beforeLevel < 1 || input.beforeLevel >= WORLD_CRISIS_80_TRIGGER_LEVEL || input.afterLevel < WORLD_CRISIS_80_TRIGGER_LEVEL) return false;
    const village = input.character.village;
    if (!isWorldCrisis80Village(village)) return false;
    const playerName = safeName(input.playerName);
    const displayName = typeof input.character.name === 'string' && input.character.name.trim()
        ? input.character.name.trim().slice(0, 80)
        : playerName;
    const auth = await kv.get<Record<string, unknown>>(`auth:${playerName}`);
    if (!eligibleFirstWitness(playerName, auth)) return false;
    const now = input.now ?? Date.now();
    let awakened = false;
    let state = await withKvLock(WORLD_CRISIS_80_STATE_KEY, async () => {
        const current = normalizeWorldCrisis80State(await kv.get(WORLD_CRISIS_80_STATE_KEY), now);
        if (current.status !== 'armed') return current;
        const next: WorldCrisis80State = {
            ...current,
            status: 'active',
            phase: 'witness-signal',
            awakenedAt: now,
            awakenedBy: displayName,
            awakenedVillage: village,
            revision: current.revision + 1,
            updatedAt: now,
        };
        await kv.set(WORLD_CRISIS_80_STATE_KEY, next);
        awakened = true;
        return next;
    }, { failClosed: true });
    if (awakened) await ensureWorldCrisis80Outbox(state);
    return awakened;
}

export async function activeWorldCrisis80Encounter(input: {
    character: Record<string, unknown>;
    sourceId: string;
    path: WorldCrisis80DefensePath;
}): Promise<ReturnType<typeof worldCrisis80EncounterForVillage>> {
    const village = input.character.village;
    if (!isWorldCrisis80Village(village)) throw new Error('world-crisis-80-village-invalid');
    const state = await loadWorldCrisis80State();
    if (state.status !== 'active') throw new Error('world-crisis-80-not-active');
    const villageState = state.villages[village];
    if (villageState.defenses >= villageState.target) throw new Error('world-crisis-80-village-secured');
    const encounter = worldCrisis80EncounterForVillage(village);
    const expected = input.path === 'companion' ? encounter.petSourceId : encounter.sourceId;
    if (expected !== input.sourceId) throw new Error('world-crisis-80-encounter-stale');
    return encounter;
}

export async function recordWorldCrisis80Defense(input: {
    playerName: string;
    village: WorldCrisis80Village;
    sourceId: string;
    proofId: string;
    path: WorldCrisis80DefensePath;
    outcome: 'win' | 'loss' | 'draw';
    now?: number;
}): Promise<WorldCrisis80Projection> {
    if (input.outcome !== 'win') return await readWorldCrisis80Projection();
    if (!isWorldCrisis80Village(input.village)) throw new Error('world-crisis-80-village-invalid');
    if (input.path !== 'shinobi' && input.path !== 'companion') throw new Error('world-crisis-80-path-invalid');
    const encounter = worldCrisis80EncounterForVillage(input.village);
    const expectedSourceId = input.path === 'companion' ? encounter.petSourceId : encounter.sourceId;
    if (input.sourceId !== expectedSourceId) throw new Error('world-crisis-80-encounter-stale');
    const playerName = safeName(input.playerName);
    if (!playerName || !/^[A-Za-z0-9:_-]{8,180}$/.test(input.proofId)) throw new Error('world-crisis-80-proof-invalid');
    const now = input.now ?? Date.now();
    const proofKey = `${WORLD_CRISIS_80_PROOF_PREFIX}${input.proofId}`;
    let state = await withKvLock(WORLD_CRISIS_80_STATE_KEY, async () => {
        const current = normalizeWorldCrisis80State(await kv.get(WORLD_CRISIS_80_STATE_KEY), now);
        if (current.status !== 'active') return current;
        const villageState = current.villages[input.village];
        if (villageState.defenses >= villageState.target) return current;
        if (current.appliedProofIds.includes(input.proofId) || await kv.get(proofKey)) return current;
        const proofWritten = await kv.set(proofKey, {
            playerName,
            village: input.village,
            sourceId: input.sourceId,
            path: input.path,
            runId: current.runId,
            at: now,
        }, { nx: true, ex: 60 * 60 * 24 * 45 });
        if (proofWritten === null) return current;

        const defenses = Math.min(villageState.target, villageState.defenses + 1);
        const nextVillage: WorldCrisis80VillageState = {
            ...villageState,
            defenses,
            shinobiDefenses: villageState.shinobiDefenses + (input.path === 'shinobi' ? 1 : 0),
            companionDefenses: villageState.companionDefenses + (input.path === 'companion' ? 1 : 0),
            lastDefendedAt: now,
            completedAt: defenses >= villageState.target ? villageState.completedAt ?? now : null,
        };
        const prior = current.contributors[playerName];
        const nextContributor: WorldCrisis80Contributor = {
            player: prior?.player ?? playerName,
            village: input.village,
            wins: (prior?.wins ?? 0) + 1,
            shinobiWins: (prior?.shinobiWins ?? 0) + (input.path === 'shinobi' ? 1 : 0),
            companionWins: (prior?.companionWins ?? 0) + (input.path === 'companion' ? 1 : 0),
            lastAt: now,
        };
        const villages = { ...current.villages, [input.village]: nextVillage };
        const totalDefenses = WORLD_CRISIS_80_VILLAGES.reduce((sum, village) => sum + villages[village].defenses, 0);
        const totalTarget = current.targetPerVillage * WORLD_CRISIS_80_VILLAGES.length;
        const allHeld = WORLD_CRISIS_80_VILLAGES.every((village) => villages[village].defenses >= villages[village].target);
        const next: WorldCrisis80State = {
            ...current,
            villages,
            contributors: { ...current.contributors, [playerName]: nextContributor },
            appliedProofIds: [...current.appliedProofIds, input.proofId].slice(-MAX_APPLIED_PROOFS),
            status: allHeld ? 'resolved' : 'active',
            resolvedAt: allHeld ? now : null,
            phase: worldCrisis80PhaseForProgress(Math.round(totalDefenses / Math.max(1, totalTarget) * 100), allHeld),
            revision: current.revision + 1,
            updatedAt: now,
        };
        await kv.set(WORLD_CRISIS_80_STATE_KEY, next);
        return next;
    }, { failClosed: true });
    await ensureWorldCrisis80Outbox(state);
    state = await loadWorldCrisis80State();
    return projectWorldCrisis80State(state);
}

export type WorldCrisis80AdminAction = 'arm' | 'stand-down' | 'awaken-now' | 'resolve' | 'set-target';

export async function applyWorldCrisis80AdminAction(input: {
    action: WorldCrisis80AdminAction;
    targetPerVillage?: unknown;
    actor?: string;
    creditPlayerName?: string;
    now?: number;
}): Promise<WorldCrisis80Projection> {
    const now = input.now ?? Date.now();
    const before = await loadWorldCrisis80State();
    let state = await withKvLock(WORLD_CRISIS_80_STATE_KEY, async () => {
        const current = normalizeWorldCrisis80State(await kv.get(WORLD_CRISIS_80_STATE_KEY), now);
        let next: WorldCrisis80State;
        if (input.action === 'stand-down') {
            if (current.status !== 'armed') throw new Error('Only an unawakened crisis can stand down.');
            next = { ...current, status: 'dormant', armedAt: null, revision: current.revision + 1, updatedAt: now };
        } else if (input.action === 'set-target') {
            if (current.status !== 'armed' && current.status !== 'dormant') throw new Error('Targets lock once the crisis awakens.');
            const targetPerVillage = cleanTarget(input.targetPerVillage);
            next = { ...current, targetPerVillage, villages: emptyVillages(targetPerVillage), revision: current.revision + 1, updatedAt: now };
        } else if (input.action === 'awaken-now') {
            if (current.status !== 'armed') throw new Error('The crisis is not waiting for an awakening.');
            const creditPlayer = safeName(input.creditPlayerName ?? '');
            const creditSave = creditPlayer ? await kv.get<Record<string, unknown>>(`save:${creditPlayer}`) : null;
            const creditCharacter = creditSave?.character as Record<string, unknown> | undefined;
            const creditDisplayName = typeof creditCharacter?.name === 'string' && creditCharacter.name.trim()
                ? creditCharacter.name.trim().slice(0, 80)
                : '';
            const creditVillage = creditCharacter?.village;
            next = {
                ...current,
                status: 'active',
                phase: 'witness-signal',
                awakenedAt: now,
                awakenedBy: creditDisplayName || 'World Herald',
                awakenedVillage: isWorldCrisis80Village(creditVillage) ? creditVillage : null,
                revision: current.revision + 1,
                updatedAt: now,
            };
        } else if (input.action === 'resolve') {
            if (current.status !== 'active') throw new Error('Only an active crisis can be resolved.');
            const villages = Object.fromEntries(WORLD_CRISIS_80_VILLAGES.map((village) => [village, {
                ...current.villages[village],
                defenses: current.targetPerVillage,
                shinobiDefenses: current.villages[village].shinobiDefenses + Math.max(0, current.targetPerVillage - current.villages[village].defenses),
                target: current.targetPerVillage,
                completedAt: current.villages[village].completedAt ?? now,
                lastDefendedAt: current.villages[village].lastDefendedAt ?? now,
            }])) as WorldCrisis80State['villages'];
            next = { ...current, villages, status: 'resolved', phase: 'claims-broken', resolvedAt: now, revision: current.revision + 1, updatedAt: now };
        } else {
            if (current.status !== 'dormant' && current.status !== 'resolved') throw new Error('Only a dormant or resolved crisis can be armed.');
            next = newWorldCrisis80State(now, 'armed');
            next.runId = `${WORLD_CRISIS_80_ID}:${now}`;
            next.targetPerVillage = current.targetPerVillage;
            next.villages = emptyVillages(current.targetPerVillage);
            next.revision = current.revision + 1;
        }
        await kv.set(WORLD_CRISIS_80_STATE_KEY, next);
        return next;
    }, { failClosed: true });
    await recordAudit({
        actor: input.actor ?? 'admin',
        domain: 'legacy',
        action: `world-crisis-80.${input.action}`,
        entityType: 'world-crisis',
        entityId: WORLD_CRISIS_80_ID,
        before: { status: before.status, runId: before.runId, targetPerVillage: before.targetPerVillage },
        after: { status: state.status, runId: state.runId, targetPerVillage: state.targetPerVillage },
    });
    await ensureWorldCrisis80Outbox(state);
    state = await loadWorldCrisis80State();
    return projectWorldCrisis80State(state);
}

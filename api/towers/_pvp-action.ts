import { createHash } from 'node:crypto';
import type { TowerPvpActionType } from '../../shared/tower-pvp.js';
import { activeActor } from './_tower-session.js';
import {
    applyAction,
    endTurn,
    runAiUntilHuman,
    type TowerAction,
} from './_engine.js';
import { isTowerActionType } from './_action-types.js';
import { makeRng } from './_sim.js';
import {
    commitTowerActionMetadata,
    inspectTowerActionCommand,
    rememberTowerActionMetadata,
    towerActionVersion,
} from './_action-idempotency.js';
import {
    advanceExpiredTowerPvpTurn,
    assertTowerPvpVersionInvariant,
    forfeitTowerPvpActor,
    projectTowerPvpTerminal,
    resetTowerPvpAfkStrikes,
    TOWER_PVP_FLOOR,
    towerPvpMember,
    type StoredTowerPvpMatch,
} from './_pvp-session.js';
import {
    refreshTowerPvpLeases,
    releaseTerminalTowerPvpLeases,
    withTowerPvpMatchMutation,
    writeTowerPvpMatch,
    type TowerPvpStoreDeps,
} from './_pvp-store.js';
import { publishTowerPvpKick } from './_pvp-realtime.js';

export type TowerPvpActionInput = {
    matchId: string;
    slug: string;
    type: TowerPvpActionType;
    targetId?: unknown;
    tile?: unknown;
    jutsuId?: unknown;
    itemId?: unknown;
    moveToken: unknown;
    expectedVersion: unknown;
};

export type TowerPvpActionResult = {
    status: number;
    applied: boolean;
    replayed: boolean;
    reason?: string;
    match?: StoredTowerPvpMatch;
    currentVersion?: number;
};

const PUBLIC_ACTION_TYPES = new Set<TowerPvpActionType>([
    'move', 'dash', 'attack', 'jutsu', 'weapon', 'heal', 'cleanse', 'clear', 'wait', 'forfeit',
]);

function towerPvpCommandFingerprint(
    input: TowerPvpActionInput,
    actorId: string,
): string {
    const intent: Record<string, unknown> = {
        matchId: input.matchId,
        actorId,
        slug: input.slug,
        type: input.type,
    };
    if (input.type === 'move' || input.type === 'dash') intent.tile = Number(input.tile);
    else if (input.type === 'attack' || input.type === 'clear') intent.targetId = String(input.targetId ?? '');
    else if (input.type === 'jutsu') {
        intent.jutsuId = String(input.jutsuId ?? '');
        if (input.targetId !== undefined) intent.targetId = String(input.targetId);
        if (input.tile !== undefined) intent.tile = Number(input.tile);
    } else if (input.type === 'weapon') {
        intent.targetId = String(input.targetId ?? '');
        if (input.itemId) intent.itemId = String(input.itemId);
    }
    return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

function actionFrom(
    input: TowerPvpActionInput,
    actorId: string,
    moveToken: string | undefined,
): TowerAction {
    const token = moveToken ? { token: moveToken } : {};
    switch (input.type) {
        case 'move': return { actorId, type: 'move', tile: Number(input.tile), ...token };
        case 'dash': return { actorId, type: 'dash', tile: Number(input.tile), ...token };
        case 'attack': return { actorId, type: 'attack', targetId: String(input.targetId ?? ''), ...token };
        case 'jutsu': return {
            actorId,
            type: 'jutsu',
            jutsuId: String(input.jutsuId ?? ''),
            ...(input.targetId !== undefined ? { targetId: String(input.targetId) } : {}),
            ...(input.tile !== undefined ? { tile: Number(input.tile) } : {}),
            ...token,
        };
        case 'weapon': return {
            actorId,
            type: 'weapon',
            targetId: String(input.targetId ?? ''),
            ...(input.itemId ? { itemId: String(input.itemId) } : {}),
            ...token,
        };
        case 'heal': return { actorId, type: 'heal', ...token };
        case 'cleanse': return { actorId, type: 'cleanse', ...token };
        case 'clear': return { actorId, type: 'clear', targetId: String(input.targetId ?? ''), ...token };
        default: return { actorId, type: 'wait', ...token };
    }
}

function isTerminalMatch(match: StoredTowerPvpMatch): boolean {
    return match.status === 'done' || match.status === 'cancelled';
}

/**
 * Server-authoritative public 2v2 action reducer. Team, controller and actor ID
 * all come from the sealed match; clients choose only an action target/anchor.
 */
export async function applyTowerPvpCommand(
    input: TowerPvpActionInput,
    deps: TowerPvpStoreDeps = {},
): Promise<TowerPvpActionResult> {
    let terminal: StoredTowerPvpMatch | null = null;
    const outcome = await withTowerPvpMatchMutation(input.matchId, async match => {
        if (!match) return { status: 404, applied: false, replayed: false, reason: 'match-not-found' };
        const member = towerPvpMember(match, input.slug);
        if (!member) return { status: 403, applied: false, replayed: false, reason: 'not-a-member', match, currentVersion: match.version };
        assertTowerPvpVersionInvariant(match);
        const commandFingerprint = towerPvpCommandFingerprint(input, member.actorId);

        const command = inspectTowerActionCommand(match.combat, {
            moveToken: input.moveToken,
            expectedVersion: input.expectedVersion,
            commandFingerprint,
        });
        if (command.status === 'invalid-token') {
            return { status: 400, applied: false, replayed: false, reason: 'invalid-move-token', match, currentVersion: command.currentVersion };
        }
        if (command.status === 'invalid-version') {
            return { status: 400, applied: false, replayed: false, reason: 'invalid-expected-version', match, currentVersion: command.currentVersion };
        }
        if (command.status === 'replay') {
            return { status: 200, applied: true, replayed: true, match, currentVersion: command.currentVersion };
        }
        if (command.status === 'conflict') {
            return { status: 409, applied: false, replayed: false, reason: 'move-token-conflict', match, currentVersion: command.currentVersion };
        }
        if (command.status === 'stale') {
            return { status: 409, applied: false, replayed: false, reason: 'stale-version', match, currentVersion: command.currentVersion };
        }
        if (!command.moveToken) {
            return { status: 400, applied: false, replayed: false, reason: 'invalid-move-token', match, currentVersion: command.currentVersion };
        }
        if (!PUBLIC_ACTION_TYPES.has(input.type)
            || (input.type !== 'forfeit' && !isTowerActionType(input.type))) {
            return { status: 400, applied: false, replayed: false, reason: 'invalid-action-type', match, currentVersion: command.currentVersion };
        }
        if (match.status !== 'active' || match.combat.status !== 'active') {
            if (match.status === 'done' || match.status === 'cancelled') terminal = match;
            return { status: 409, applied: false, replayed: false, reason: 'session-not-active', match, currentVersion: command.currentVersion };
        }
        const lease = await refreshTowerPvpLeases(match, deps);
        if (!lease.ok) {
            return { status: 409, applied: false, replayed: false, reason: 'member-busy', match, currentVersion: command.currentVersion };
        }

        const now = deps.now?.() ?? Date.now();
        if (advanceExpiredTowerPvpTurn(match, now)) {
            if (isTerminalMatch(match)) terminal = match;
            await writeTowerPvpMatch(match, deps);
            return {
                status: 409,
                applied: false,
                replayed: false,
                reason: isTerminalMatch(match) ? 'session-done' : 'turn-expired',
                match,
                currentVersion: match.version,
            };
        }

        if (input.type === 'forfeit') {
            if (!forfeitTowerPvpActor(match, input.slug, now)) {
                return { status: 409, applied: false, replayed: false, reason: 'cannot-forfeit', match, currentVersion: match.version };
            }
            rememberTowerActionMetadata(match.combat, command.moveToken, commandFingerprint);
            if (isTerminalMatch(match)) terminal = match;
            await writeTowerPvpMatch(match, deps);
            return { status: 200, applied: true, replayed: false, match, currentVersion: match.version };
        }

        const actor = activeActor(match.combat);
        if (!actor || actor.ai !== false || actor.hp <= 0 || actor.ownerSlug !== input.slug || actor.id !== member.actorId) {
            return { status: 409, applied: false, replayed: false, reason: 'not-your-turn', match, currentVersion: match.version };
        }
        const rng = makeRng(match.combat.seed);
        const action = actionFrom(input, actor.id, command.moveToken);
        const result = applyAction(match.combat, TOWER_PVP_FLOOR, action, rng);
        if (!result.applied) {
            return { status: 200, applied: false, replayed: false, reason: result.reason ?? 'rejected', match, currentVersion: match.version };
        }
        resetTowerPvpAfkStrikes(match, input.slug);
        if (action.type === 'wait' && match.combat.status === 'active') {
            endTurn(match.combat, TOWER_PVP_FLOOR);
            runAiUntilHuman(match.combat, TOWER_PVP_FLOOR, rng);
        }
        match.combat.turnStartedAt = now;
        commitTowerActionMetadata(match.combat, command.moveToken, commandFingerprint);
        match.version = towerActionVersion(match.combat);
        match.updatedAt = now;
        projectTowerPvpTerminal(match);
        if (isTerminalMatch(match)) terminal = match;
        await writeTowerPvpMatch(match, deps);
        return { status: 200, applied: true, replayed: false, match, currentVersion: match.version };
    }, deps);
    if (terminal) await releaseTerminalTowerPvpLeases(terminal, deps).catch(() => undefined);
    if (outcome.match && (outcome.applied || outcome.reason === 'turn-expired' || outcome.reason === 'session-done')) {
        publishTowerPvpKick(outcome.match, outcome.match.status === 'done' ? 'closed' : 'action');
    }
    return outcome;
}

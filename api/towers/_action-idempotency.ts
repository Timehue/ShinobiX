import type { TowerSession } from './_tower-session.js';

export const TOWER_MOVE_TOKEN_HISTORY = 64;

type VersionedTowerSession = TowerSession & { actionVersion?: number };

export type TowerActionCommandInspection =
    | { status: 'proceed'; moveToken?: string; expectedVersion?: number; currentVersion: number }
    | { status: 'replay'; moveToken: string; currentVersion: number }
    | { status: 'stale'; moveToken?: string; expectedVersion: number; currentVersion: number }
    | { status: 'invalid-token'; currentVersion: number }
    | { status: 'invalid-version'; currentVersion: number };

/**
 * Tower action versions are additive API state. Sessions created before the
 * field was introduced safely start at version zero.
 */
export function towerActionVersion(session: TowerSession): number {
    const value = Number((session as VersionedTowerSession).actionVersion);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function initializeTowerActionVersion(session: TowerSession): void {
    (session as VersionedTowerSession).actionVersion = towerActionVersion(session);
}

/**
 * Validate the optional optimistic-concurrency envelope and detect a replay.
 * Replay wins over expected-version mismatch so a caller that lost the success
 * response can recover the authoritative post-action session.
 */
export function inspectTowerActionCommand(
    session: TowerSession,
    raw: { moveToken?: unknown; expectedVersion?: unknown },
): TowerActionCommandInspection {
    const currentVersion = towerActionVersion(session);
    let moveToken: string | undefined;
    if (raw.moveToken !== undefined && raw.moveToken !== null && raw.moveToken !== '') {
        if (typeof raw.moveToken !== 'string') return { status: 'invalid-token', currentVersion };
        const candidate = raw.moveToken.trim();
        if (!/^[A-Za-z0-9_-]{16,80}$/.test(candidate)) return { status: 'invalid-token', currentVersion };
        moveToken = candidate;
        if ((session.recentMoveTokens ?? []).includes(moveToken)) {
            return { status: 'replay', moveToken, currentVersion };
        }
    }

    let expectedVersion: number | undefined;
    if (raw.expectedVersion !== undefined && raw.expectedVersion !== null && raw.expectedVersion !== '') {
        const candidate = Number(raw.expectedVersion);
        if (!Number.isSafeInteger(candidate) || candidate < 0) return { status: 'invalid-version', currentVersion };
        expectedVersion = candidate;
        if (expectedVersion !== currentVersion) {
            return { status: 'stale', moveToken, expectedVersion, currentVersion };
        }
    }
    return { status: 'proceed', moveToken, expectedVersion, currentVersion };
}

/** Commit metadata only after the combat mutation has applied. */
export function commitTowerActionMetadata(session: TowerSession, moveToken?: string): number {
    if (moveToken) {
        session.recentMoveTokens = [...(session.recentMoveTokens ?? []), moveToken]
            .slice(-TOWER_MOVE_TOKEN_HISTORY);
    }
    const next = towerActionVersion(session) + 1;
    (session as VersionedTowerSession).actionVersion = next;
    return next;
}

/** Record a server-side mutation such as an AFK auto-pass. */
export function bumpTowerActionVersion(session: TowerSession): number {
    return commitTowerActionMetadata(session);
}

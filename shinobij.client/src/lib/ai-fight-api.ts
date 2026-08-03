import type { Character } from "../types/character";
import type { TowerHostLoadout, TowerSession } from "./towers-api";

/*
 * Client wrapper for the sealed AI-fight lifecycle (step 3d of
 * docs/runbooks/combat-mode-migration.md).
 *
 * /api/missions/ai-fight-start does two things in one call:
 *   1. It ALWAYS mints the single-use reward token. The token seals opponentId,
 *      opponentLevel, battleKind and the reward ceilings, and (since the token
 *      carries baseXp/baseRyo, i.e. rewardSource 'server-save') the server
 *      ignores whatever XP/ryo a client claims later — so nothing here needs to
 *      compute a reward.
 *   2. It ALSO seals a real server-resolved encounter and returns
 *      `{ runId, session }` — but only when it could build one. `runId` and
 *      `session` are absent TOGETHER when it could not, and that absence is the
 *      "play it locally" signal, not an error: an unknown opponent (every
 *      client-authored `temp-*` AI is one) or any sealing failure must degrade
 *      to the local Arena path rather than block a fight the player can already
 *      start today.
 */

export type AiFightBattleKind = "practice" | "mission" | "raidAi" | "defense" | "explore" | "endless";

export type AiFightStart = {
    /** Single-use reward token. Present whenever the start call succeeded at all. */
    token: string;
    /** The sealed server encounter. ABSENT TOGETHER when nothing was sealed. */
    runId?: string;
    session?: TowerSession;
};

/**
 * Start one AI fight. Resolves with a token and — when the server sealed an
 * encounter — a `runId` + `session` to mount the server-combat screen with.
 *
 * `hostLoadout` (lib/ai-fight-loadout) is passed IN rather than built here: it
 * needs combat-math, which imports back from ../App for its back-compat
 * re-exports, and that back-edge would make this module unloadable under node's
 * test runner. Keeping it out leaves the lifecycle itself testable.
 *
 * Never throws: a network failure, a 4xx, or a refused seal all resolve to a
 * result with no runId, which callers treat as "play it locally".
 */
export async function startAiFight(params: {
    playerName: string;
    opponentId: string;
    opponentLevel: number;
    battleKind: AiFightBattleKind;
    hostLoadout?: TowerHostLoadout;
}): Promise<AiFightStart> {
    const body = {
        playerName: params.playerName,
        opponentId: params.opponentId,
        opponentLevel: params.opponentLevel,
        battleKind: params.battleKind,
        ...(params.hostLoadout ? { hostLoadout: params.hostLoadout } : {}),
    };
    try {
        const response = await fetch("/api/missions/ai-fight-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) return { token: "" };
        const data = await response.json().catch(() => ({})) as Partial<AiFightStart>;
        const token = typeof data.token === "string" ? data.token : "";
        // runId + session are spread under ONE condition server-side, so they can
        // never diverge; require both anyway — MissionArenaFight takes
        // initialSession as a REQUIRED prop and a runId alone cannot mount it.
        if (!data.runId || !data.session) return { token };
        return { token, runId: data.runId, session: data.session };
    } catch {
        return { token: "" };
    }
}

export type AiFightReportResult = {
    ok: boolean;
    /** What the SESSION said happened. Absent on the local-fallback track. */
    outcome?: "win" | "loss" | "draw" | "forfeit";
    xp: number;
    ryo: number;
    capped?: boolean;
    replayed?: boolean;
    character?: Partial<Character>;
    _saveVersion?: number;
};

/**
 * Settle an AI fight against its sealed token. The SERVER decides the outcome by
 * reading the sealed session — this does not assert a win, it asks for one — and
 * pays, applies the surviving HP, or hospitalizes accordingly, all from the seal.
 * The body carries only the token; there is nothing here to inflate.
 *
 * Returns null when the settle could not be verified (including the 409 the
 * server returns when the sealed session has vanished, which pays nothing and
 * punishes nothing). The caller must then say nothing was granted rather than
 * assume the predicted reward.
 */
export async function reportAiFightWin(playerName: string, token: string): Promise<AiFightReportResult | null> {
    if (!token) return null;
    try {
        const response = await fetch("/api/missions/report-ai-fight", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, aiFightToken: token }),
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => null) as AiFightReportResult | null;
        return data?.ok ? data : null;
    } catch {
        return null;
    }
}

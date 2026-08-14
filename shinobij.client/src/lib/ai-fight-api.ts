import type { Character } from "../types/character";
import type { SoloPveSession } from "./solo-pve-api";
import type {
    WorldAiFightContext,
    WorldAiFightPendingChain,
    WorldAiFightPendingOutcome,
    WorldAiFightRequest,
} from "../../../shared/world-ai-fight";

export type AiFightBattleKind = "practice" | "mission" | "raidAi" | "defense" | "explore" | "endless" | "world" | "dungeon";

export type AiFightStart = {
    token: string;
    sessionId: string;
    session: SoloPveSession;
    worldContext?: WorldAiFightContext;
    resumed?: boolean;
    /** Sealed generic-fight identity, returned on both start and resume. */
    opponentId?: string;
    opponentName?: string;
    battleKind?: AiFightBattleKind;
    sector?: number;
    worldExploreRequestId?: string;
    raidToken?: string;
    dungeonRunToken?: string;
};
export type AiFightPendingWorldChain = { resumed: true; pendingWorldChain: WorldAiFightPendingChain };
export type AiFightPendingWorldOutcome = {
    resumed: true;
    pendingWorldOutcome: WorldAiFightPendingOutcome & {
        action: "claim";
        endpoint: "/api/sector/wanderer-ambush";
    };
};
export type AiFightWorldResume = AiFightStart | AiFightPendingWorldChain | AiFightPendingWorldOutcome;

export type RecoveredWorldOutcome = {
    ok: true;
    replayed?: boolean;
    reward: { ryo: number; fateShards: number; boneCharms: number };
    character: Character;
    _saveVersion: number;
};

/** Start a mandatory server-owned generic AI encounter. */
export async function startAiFight(params: {
    playerName: string;
    opponentId: string;
    opponentLevel: number;
    battleKind: AiFightBattleKind;
    sector?: number;
    worldExploreRequestId?: string;
    raidToken?: string;
    dungeonRunToken?: string;
    worldEncounter?: WorldAiFightRequest;
}): Promise<AiFightWorldResume> {
    let response: Response;
    try {
        response = await fetch("/api/missions/ai-fight-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                playerName: params.playerName,
                battleKind: params.battleKind,
                ...(params.battleKind !== "dungeon" ? {
                    opponentId: params.opponentId,
                    opponentLevel: params.opponentLevel,
                } : {}),
                ...(typeof params.sector === "number" ? { sector: params.sector } : {}),
                ...(params.worldExploreRequestId ? { worldExploreRequestId: params.worldExploreRequestId } : {}),
                ...(params.raidToken ? { raidToken: params.raidToken } : {}),
                ...(params.dungeonRunToken ? { dungeonRunToken: params.dungeonRunToken } : {}),
                ...(params.worldEncounter ? { worldEncounter: params.worldEncounter } : {}),
            }),
        });
    } catch (error) {
        if (params.worldEncounter) {
            try {
                const resumed = await resumeWorldAiFight(params.playerName);
                if (resumed) return resumed;
                if (resumed === null) {
                    const generic = await resumeGenericAiFight(params.playerName).catch(() => null);
                    if (generic) return generic;
                }
            } catch { /* preserve the original start failure below */ }
        } else {
            const resumed = await resumeGenericAiFight(params.playerName).catch(() => null);
            if (resumed) return resumed;
        }
        throw error;
    }
    const data = await response.json().catch(() => ({})) as Partial<AiFightStart> & { error?: string; resumable?: boolean; mode?: string };
    if (!response.ok && response.status === 409 && data.resumable === true) {
        if (data.mode === "generic") {
            const resumed = await resumeGenericAiFight(params.playerName).catch(() => null);
            if (resumed) return resumed;
        } else if (params.worldEncounter || data.mode === "world") {
            const resumed = await resumeWorldAiFight(params.playerName).catch(() => null);
            if (resumed) return resumed;
        } else {
            const resumed = await resumeGenericAiFight(params.playerName).catch(() => null);
            if (resumed) return resumed;
        }
    }
    if (!response.ok) throw new Error(data.error ?? `AI fight start failed (${response.status}).`);
    if (!data.token || !data.sessionId || !data.session || data.session.runtime !== "solo-pve") {
        throw new Error("The combat server returned an incomplete solo-PvE session.");
    }
    if (!data.worldContext && (!data.opponentId || !data.opponentName || !data.battleKind)) {
        throw new Error("The combat server did not seal the AI encounter identity.");
    }
    return {
        token: data.token,
        sessionId: data.sessionId,
        session: data.session,
        ...(data.worldContext ? { worldContext: data.worldContext } : {}),
        ...(data.resumed ? { resumed: true } : {}),
        ...(data.opponentId ? { opponentId: data.opponentId } : {}),
        ...(data.opponentName ? { opponentName: data.opponentName } : {}),
        ...(data.battleKind ? { battleKind: data.battleKind } : {}),
        ...(typeof data.sector === "number" ? { sector: data.sector } : {}),
        ...(data.worldExploreRequestId ? { worldExploreRequestId: data.worldExploreRequestId } : {}),
        ...(data.raidToken ? { raidToken: data.raidToken } : {}),
        ...(data.dungeonRunToken ? { dungeonRunToken: data.dungeonRunToken } : {}),
    };
}

/** Resume the server's single active World Map encounter after refresh. */
export async function resumeWorldAiFight(playerName: string): Promise<AiFightWorldResume | null> {
    const response = await fetch("/api/missions/ai-fight-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, resumeWorldFight: true }),
    });
    if (response.status === 404) return null;
    const data = await response.json().catch(() => ({})) as Partial<AiFightStart & AiFightPendingWorldChain & AiFightPendingWorldOutcome> & { error?: string; mode?: string };
    // The server uses an explicit 409 handoff when the single active pointer is
    // generic. Treat it like "no World fight" so the host probes resumeAiFight.
    if (response.status === 409 && data.mode === "generic") return null;
    if (!response.ok) throw new Error(data.error ?? `World fight resume failed (${response.status}).`);
    if (data.resumed === true && data.pendingWorldChain?.request) {
        return { resumed: true, pendingWorldChain: data.pendingWorldChain };
    }
    if (data.resumed === true
        && data.pendingWorldOutcome?.kind === "wanderer-ambush-reward"
        && data.pendingWorldOutcome.action === "claim"
        && data.pendingWorldOutcome.endpoint === "/api/sector/wanderer-ambush") {
        return { resumed: true, pendingWorldOutcome: data.pendingWorldOutcome };
    }
    if (!data.token || !data.sessionId || !data.session || data.session.runtime !== "solo-pve" || !data.worldContext) {
        throw new Error("The combat server returned an incomplete resumed encounter.");
    }
    return { token: data.token, sessionId: data.sessionId, session: data.session, worldContext: data.worldContext };
}

/** Resume a non-World sealed AI encounter (raid, explore, or practice). */
export async function resumeGenericAiFight(playerName: string): Promise<AiFightStart | null> {
    const response = await fetch("/api/missions/ai-fight-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, resumeAiFight: true }),
    });
    if (response.status === 404) return null;
    const data = await response.json().catch(() => ({})) as Partial<AiFightStart> & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `AI fight resume failed (${response.status}).`);
    if (!data.token || !data.sessionId || !data.session || data.session.runtime !== "solo-pve"
        || !data.opponentId || !data.opponentName || !data.battleKind) {
        throw new Error("The combat server returned an incomplete resumed AI encounter.");
    }
    return {
        token: data.token,
        sessionId: data.sessionId,
        session: data.session,
        resumed: true,
        opponentId: data.opponentId,
        opponentName: data.opponentName,
        battleKind: data.battleKind,
        ...(typeof data.sector === "number" ? { sector: data.sector } : {}),
        ...(data.worldExploreRequestId ? { worldExploreRequestId: data.worldExploreRequestId } : {}),
        ...(data.raidToken ? { raidToken: data.raidToken } : {}),
        ...(data.dungeonRunToken ? { dungeonRunToken: data.dungeonRunToken } : {}),
    };
}

/** Consume the only currently supported durable post-World-combat handoff. */
export async function recoverPendingWorldOutcome(
    playerName: string,
    pending: AiFightPendingWorldOutcome["pendingWorldOutcome"],
): Promise<RecoveredWorldOutcome> {
    if (pending.kind !== "wanderer-ambush-reward"
        || pending.action !== "claim"
        || pending.endpoint !== "/api/sector/wanderer-ambush") {
        throw new Error("Unsupported World encounter recovery handoff.");
    }
    const response = await fetch(pending.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pending.action, playerName }),
    });
    const data = await response.json().catch(() => ({})) as Partial<RecoveredWorldOutcome> & { error?: string; reason?: string };
    if (!response.ok || data.ok !== true || !data.character || !Number.isFinite(data._saveVersion)) {
        throw new Error(data.error ?? data.reason ?? "The ambush reward is still awaiting recovery.");
    }
    return {
        ok: true,
        ...(data.replayed ? { replayed: true } : {}),
        reward: data.reward ?? { ryo: 0, fateShards: 0, boneCharms: 0 },
        character: data.character,
        _saveVersion: Number(data._saveVersion),
    };
}

export type AiFightReportResult = {
    ok: boolean;
    outcome?: "win" | "loss" | "draw" | "forfeit";
    xp: number;
    ryo: number;
    capped?: boolean;
    replayed?: boolean;
    character?: Partial<Character>;
    _saveVersion?: number;
    worldContext?: WorldAiFightContext;
    /** Exact field-mission runs stamped by this sealed raid settlement. */
    fetchMissionsCredited?: string[];
    raidProgression?: {
        fetchMissionsCredited?: string[];
        missionsCompleted?: Array<{ id: string; name: string; xpReward: number }>;
        xpAwarded?: number;
        bonusRyo?: number;
        bonusSeals?: number;
        territoryDamage?: number;
        sector?: number;
        replayed?: boolean;
    };
};

/** Redeem a token whose outcome and costs come only from its sealed session. */
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

import type { Character } from "../types/character";
import type { HuntSign } from "./hunt-encounter";

export type WorldHuntTrailView = {
    missionId: string;
    runId?: string;
    progress: number;
    requiredTracks: number;
    quality: number;
    ready: boolean;
    sector: number;
    sign?: HuntSign | null;
    decisionId?: string;
    packPending?: boolean;
    packSettled?: boolean;
    packLossApplied?: boolean;
    targetDefeated?: boolean;
    claimable?: boolean;
};

export type WorldHuntState = {
    ok: boolean;
    reason?: string;
    error?: string;
    missionId?: string;
    decisionId?: string;
    quality?: number;
    progress?: number;
    requiredTracks?: number;
    ambush?: boolean;
    nextSector?: number;
    opening?: "cornered" | "even" | "enraged";
    migrated?: boolean;
    acceptedMissionIds?: string[];
    missionProgress?: Record<string, number>;
    character?: Character;
    _saveVersion?: number;
    state?: WorldHuntTrailView | null;
};

export async function postWorldHunt(params: {
    playerName: string;
    action: "accept" | "state" | "choose" | "abandon";
    missionId: string;
    sector?: number;
    choiceId?: string;
}): Promise<WorldHuntState> {
    const response = await fetch("/api/missions/hunt-trail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    });
    const body = await response.json().catch(() => ({})) as WorldHuntState;
    if (!response.ok) return { ...body, ok: false, error: body.error ?? `Hunt request failed (${response.status}).` };
    return body;
}

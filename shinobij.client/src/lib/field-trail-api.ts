import type { Character } from "../types/character";

export type FieldMissionRun = { missionId: string; runId: string; acceptedAt: number };
export type FieldTrailResult = {
    ok: boolean;
    state?: FieldMissionRun | null;
    acceptedMissionIds?: string[];
    missionProgress?: Record<string, number>;
    replayed?: boolean;
    migrated?: boolean;
    reason?: string;
    character?: Character;
    _saveVersion?: number;
    error?: string;
};

export async function postFieldTrail(params: {
    playerName: string;
    missionId: string;
    action: "accept" | "state" | "abandon";
}, signal?: AbortSignal): Promise<FieldTrailResult> {
    try {
        const response = await fetch("/api/missions/field-trail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
            signal,
        });
        const data = await response.json().catch(() => null) as FieldTrailResult | null;
        if (!response.ok || data?.ok !== true) {
            return {
                ...(data ?? {}),
                ok: false,
                error: data?.error ?? "The Mission Hall could not verify this contract.",
            };
        }
        return data;
    } catch (error) {
        if (signal?.aborted) throw error;
        return { ok: false, error: "The Mission Hall is unreachable." };
    }
}

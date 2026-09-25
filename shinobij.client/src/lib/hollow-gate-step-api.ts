export type HollowGateStepResult = {
    ok: boolean;
    alreadyReported?: boolean;
    position?: { x: number; y: number };
    torch?: number;
    threat?: number;
    wardSteps?: number;
    stepVersion?: number;
    torchSputtered?: boolean;
    ambush?: { nodeId: string; kind: "ambush" | "boss" | "card" } | null;
    pendingAmbush?: { nodeId: string; kind: "ambush" | "boss" | "card" } | null;
    activeCombat?: { runId: string; nodeId: string; floor: number; kind: "battle" | "elite" | "ambush" | "beast" | "boss"; mode: "pve" | "pet" };
    /** The unresolved combat tile under the player that refused this step. */
    sealedCombat?: HollowGateSealedCombat;
    _saveVersion?: number;
    error?: string;
};

export type HollowGateSealedCombat = { nodeId: string; kind: "battle" | "elite" | "beast" | "boss" };

/**
 * The startHollowGateBattle options that reopen a sealed combat tile. A step
 * off an unresolved combat tile is refused, and a tile fires only when it is
 * stepped onto, so a fight whose start failed would otherwise never reopen.
 */
export function hollowGateSealedCombatOpts(sealed: HollowGateSealedCombat): {
    nodeId: string; isBoss?: boolean; isBeast?: boolean; isElite?: boolean;
} {
    return {
        nodeId: sealed.nodeId,
        ...(sealed.kind === "boss" ? { isBoss: true } : {}),
        ...(sealed.kind === "beast" ? { isBeast: true } : {}),
        ...(sealed.kind === "elite" ? { isElite: true } : {}),
    };
}

export async function sealHollowGateStep(params: {
    playerName: string;
    token: string;
    requestId: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
}): Promise<HollowGateStepResult> {
    try {
        const response = await fetch("/api/hollow-gate/step", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        const data = await response.json().catch(() => ({})) as HollowGateStepResult;
        return response.ok && data.ok ? data : { ...data, ok: false, error: data.error || `Hollow Gate step failed (${response.status}).` };
    } catch {
        return { ok: false, error: "The Hollow Gate step service is unreachable." };
    }
}

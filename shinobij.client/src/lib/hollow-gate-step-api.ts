export type HollowGateStepResult = {
    ok: boolean;
    alreadyReported?: boolean;
    position?: { x: number; y: number };
    torch?: number;
    threat?: number;
    wardSteps?: number;
    stepVersion?: number;
    torchSputtered?: boolean;
    ambush?: { nodeId: string; kind: "ambush" | "boss" } | null;
    _saveVersion?: number;
    error?: string;
};

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
